/**
 * Bridge to ferrum's `mcp-dibs-css` server for live preview styling.
 *
 * When a user asks to change colors/layout in natural language ("make this dealer
 * primary blue"), we need CSS → dibs-css class resolution. The MCP server parses
 * ferrum's generated style-system file and exposes `translate_css`, which accepts
 * CSS rules like `color: #436b93` and returns matching utility keys (`textBlue600`).
 *
 * Flow in llm.ts:
 *   1. inferCssRulesFromMessage() turns NL into CSS rules
 *   2. translateCss() calls MCP translate_css
 *   3. pickRelevantMcpMatches() ranks candidates against the user's message
 *   4. matchesToInlineStylePatch() converts matches to an inlineStyle DomPatch for preview
 *
 * MCP is spawned as a long-lived stdio subprocess from ferrumRoot (see FERRUM_ROOT).
 * If MCP is down or the user already named a class (`textBlue600`), we fall back to
 * lookupDibsCssMatches() from @directdom/shared/dibs-css-lookup (same .d.ts file, no subprocess).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { DomPatch } from "@directdom/shared";
import { rankClassNamesForMessage, mergeCssDeclarationsToInlineStyle } from "@directdom/shared";
import { lookupDibsCssMatches, type DibsCssMatch } from "@directdom/shared/dibs-css-lookup";
import { config } from "../config.js";

export type { DibsCssMatch };

export type DibsCssTranslationResult = {
  query: string;
  normalizedQuery: string;
  status: "found" | "not_found" | "invalid";
  matches?: DibsCssMatch[];
  message?: string;
};

/** Aggregated response from a batch translate_css call (one result per input rule). */
export type DibsCssTranslationSummary = {
  totalQueries: number;
  found: number;
  notFound: number;
  invalid: number;
  results: DibsCssTranslationResult[];
};

type McpTextContent = {
  type: "text";
  text: string;
};

// Singleton MCP client — one subprocess for the lifetime of the backend process.
let clientPromise: Promise<Client> | null = null;

const createClient = async (): Promise<Client> => {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["./mcp/mcp-dibs-css"],
    cwd: config.ferrumRoot,
    stderr: "pipe",
  });

  const client = new Client({
    name: "directdom-backend",
    version: "0.1.0",
  });

  await client.connect(transport);
  return client;
};

const getClient = async (): Promise<Client> => {
  if (!clientPromise) {
    clientPromise = createClient().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
};

export const closeDibsCssMcp = async (): Promise<void> => {
  if (!clientPromise) return;
  const client = await clientPromise.catch(() => null);
  clientPromise = null;
  if (client) {
    await client.close().catch(() => undefined);
  }
};

/** MCP returns JSON as a text content block — parse and validate the shape. */
const parseTranslationSummary = (
  raw: string,
): DibsCssTranslationSummary | null => {
  try {
    const parsed = JSON.parse(raw) as DibsCssTranslationSummary & {
      error?: string;
    };
    if (parsed.error || !Array.isArray(parsed.results)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Call MCP translate_css: CSS rules → dibs-css class matches.
 * Returns null on connection/parse failure so callers can proceed without MCP.
 */
export const translateCss = async (
  cssRules: string[],
): Promise<DibsCssTranslationSummary | null> => {
  const rules = cssRules.map((rule) => rule.trim()).filter(Boolean);
  if (rules.length === 0) {
    return {
      totalQueries: 0,
      found: 0,
      notFound: 0,
      invalid: 0,
      results: [],
    };
  }

  try {
    const client = await getClient();
    const result = await client.callTool({
      name: "translate_css",
      arguments: { cssRules: rules },
    });

    const content = Array.isArray(result.content) ? result.content : [];
    const textBlock = content.find((block): block is McpTextContent => {
      if (!block || typeof block !== "object") return false;
      const candidate = block as Record<string, unknown>;
      return candidate.type === "text" && typeof candidate.text === "string";
    });

    if (!textBlock) return null;
    return parseTranslationSummary(textBlock.text);
  } catch (error) {
    console.warn(
      "[dibs-css-mcp] translate_css failed; falling back without MCP results:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
};

/** Flatten all class names from a successful translate_css batch. */
export const collectMatchedClassNames = (
  summary: DibsCssTranslationSummary | null,
): string[] => {
  if (!summary) return [];

  const classNames = new Set<string>();
  for (const result of summary.results) {
    if (result.status !== "found" || !result.matches) continue;
    for (const match of result.matches) {
      classNames.add(match.className);
    }
  }
  return [...classNames];
};

/**
 * Resolve one class name to its CSS declaration.
 * Prefers the MCP summary when available; falls back to the shared file parser.
 */
export const findMcpMatchForClass = (
  summary: DibsCssTranslationSummary | null,
  className: string,
): DibsCssMatch | null => {
  if (summary) {
    for (const result of summary.results) {
      if (result.status !== "found" || !result.matches) continue;
      const match = result.matches.find((entry) => entry.className === className);
      if (match) return match;
    }
  }

  return lookupDibsCssMatches(config.ferrumRoot, [className])[0] ?? null;
};

const mergeUniqueMatches = (matches: DibsCssMatch[]): DibsCssMatch[] => {
  const seen = new Set<string>();
  const merged: DibsCssMatch[] = [];

  for (const match of matches) {
    const key = `${match.className}::${match.originalCSS}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(match);
  }

  return merged;
};

/**
 * Resolve a set of class names to CSS declarations for inline preview.
 * Tries MCP results first; if none match, reads ferrum's .d.ts directly.
 */
export const resolveDibsCssMatches = (
  message: string,
  summary: DibsCssTranslationSummary | null,
  classNames: string[],
): DibsCssMatch[] => {
  const rankedClassNames =
    classNames.length > 0
      ? classNames
      : pickRelevantClassNames(message, summary, []);

  const matches: DibsCssMatch[] = [];
  for (const className of rankedClassNames) {
    const match = findMcpMatchForClass(summary, className);
    if (match) matches.push(match);
  }

  if (matches.length > 0) {
    return mergeUniqueMatches(matches);
  }

  return lookupDibsCssMatches(config.ferrumRoot, rankedClassNames);
};

/** End-to-end: pick class names from MCP + message context, then resolve to CSS. */
export const pickRelevantMcpMatches = (
  message: string,
  summary: DibsCssTranslationSummary | null,
  explicitClasses: string[] = [],
): DibsCssMatch[] => {
  const classNames = pickRelevantClassNames(message, summary, explicitClasses);
  return resolveDibsCssMatches(message, summary, classNames);
};

/** Turn MCP/file lookup matches into a camelCase inline style object. */
export const mcpMatchesToInlineStyle = (
  matches: DibsCssMatch[],
): Record<string, string> =>
  mergeCssDeclarationsToInlineStyle(matches.map((match) => match.originalCSS));

/** Wrap matches as an inlineStyle DomPatch (value + mode + sourceClassName for codegen). */
export const matchesToInlineStylePatch = (
  matches: DibsCssMatch[],
  options: {
    mode?: "merge" | "replace";
    sourceClassName?: string;
  } = {},
): Extract<DomPatch, { type: "inlineStyle" }> | null => {
  const value = mcpMatchesToInlineStyle(matches);
  if (Object.keys(value).length === 0) return null;

  return {
    type: "inlineStyle",
    value,
    mode: options.mode ?? "merge",
    sourceClassName: options.sourceClassName ?? matches[0]?.className,
  };
};

/**
 * Decide which dibs-css class names to use for this request.
 * Explicit tokens from the message win; otherwise rank MCP candidates by relevance.
 */
export const pickRelevantClassNames = (
  message: string,
  summary: DibsCssTranslationSummary | null,
  explicitClasses: string[] = [],
): string[] => {
  if (explicitClasses.length > 0) {
    return explicitClasses;
  }

  const mcpClasses = collectMatchedClassNames(summary);
  if (mcpClasses.length === 0) return [];
  return rankClassNamesForMessage(message, mcpClasses);
};

/** Startup /health probe — verifies MCP subprocess and style-system file are reachable. */
export const checkDibsCssMcpHealth = async (): Promise<{
  ok: boolean;
  message: string;
  ferrumRoot: string;
}> => {
  try {
    const result = await translateCss(["display: flex"]);
    if (!result) {
      return {
        ok: false,
        message: "translate_css returned no data (MCP may be unreachable)",
        ferrumRoot: config.ferrumRoot,
      };
    }

    const probe = result.results[0];
    if (probe?.status !== "found" || !probe.matches?.length) {
      return {
        ok: false,
        message: "MCP connected but style system lookup failed",
        ferrumRoot: config.ferrumRoot,
      };
    }

    return {
      ok: true,
      message: `connected (${probe.matches[0].className} ↔ ${probe.matches[0].originalCSS})`,
      ferrumRoot: config.ferrumRoot,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      ferrumRoot: config.ferrumRoot,
    };
  }
};

/** Format MCP results as context for the LLM styling prompt. */
export const formatTranslationForPrompt = (
  summary: DibsCssTranslationSummary | null,
): string => {
  if (!summary || summary.results.length === 0) {
    return "No MCP translations available for this request.";
  }

  const lines = summary.results.map((result) => {
    if (result.status === "found" && result.matches?.length) {
      const matches = result.matches
        .map((match) => `${match.className} (${match.originalCSS})`)
        .join(", ");
      return `- ${result.query} → ${matches}`;
    }
    return `- ${result.query} → ${result.status}${result.message ? ` (${result.message})` : ""}`;
  });

  return [
    `MCP translate_css: ${summary.found} found, ${summary.notFound} not found, ${summary.invalid} invalid.`,
    ...lines,
  ].join("\n");
};
