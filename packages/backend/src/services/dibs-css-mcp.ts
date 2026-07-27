import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "../config.js";

export type DibsCssMatch = {
  className: string;
  originalCSS: string;
};

export type DibsCssTranslationResult = {
  query: string;
  normalizedQuery: string;
  status: "found" | "not_found" | "invalid";
  matches?: DibsCssMatch[];
  message?: string;
};

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
