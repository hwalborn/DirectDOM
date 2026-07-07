import type {
  ChangeRecord,
  DomPatch,
  ElementSnapshot,
} from "@directdom/shared";
import { parseDomPatch } from "@directdom/shared";
import { completeJson } from "@directdom/shared/llm";
import { getLlmConfig, useMockLlm } from "../config.js";
import { getRegistry } from "./registry.js";

const extractQuotedValue = (message: string): string | null => {
  const patterns = [
    /(?:to read|to say|to display|to show)\s+(["'])([\s\S]+?)\1/i,
    /(?:change|update|set|make)\b[\s\S]*?(?:to|as)\s+(["'])([\s\S]+?)\1/i,
    /(?:text|copy|label)[\s\S]*?(?:to|as)\s+(["'])([\s\S]+?)\1/i,
    /(?:say|read|display)\s+(["'])([\s\S]+?)\1/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[2]?.trim()) {
      return match[2].trim();
    }
  }

  const fallback = message.match(/(["'])([\s\S]+?)\1/);
  return fallback?.[2]?.trim() ?? null;
};

/**
 * When we mock the LLM (maybe we are working on ui bugs or something), we can use this function to fake
 * a response. It's _very_ simple and only supports a few cases.
 */
export const parsePatchFromMessage = (message: string): DomPatch | null => {
  const quotedText = extractQuotedValue(message);
  if (
    quotedText &&
    /(?:change|update|set|make|read|say|display|show|can we)/i.test(message)
  ) {
    return { type: "textContent", value: quotedText };
  }

  const colorMatch = message.match(
    /(?:change|set).*?color.*?(?:to|as)\s+([#\w-]+)/i,
  );
  if (colorMatch) {
    return {
      type: "className",
      value: colorMatch[1].startsWith("#")
        ? `text-[${colorMatch[1]}]`
        : colorMatch[1],
      mode: "merge",
    };
  }

  return null;
};

const parseLlmJson = (content: string): unknown => {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const jsonText = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(jsonText);
};

const buildSystemPrompt = (): string => {
  const registry = getRegistry();
  return `You are DirectDOM, an assistant that generates structured DOM patches for a React/Tailwind app.
Return JSON only: { "reply": string, "patch": DomPatch | null }

The patch.type field MUST be exactly one of: textContent, className, attribute, swapElement
Do NOT use aliases like "text", "style", "class", or "html".

Examples:
{ "reply": "Updated the button label.", "patch": { "type": "textContent", "value": "Submit order" } }
{ "reply": "Applied blue text.", "patch": { "type": "className", "value": "text-blue-500", "mode": "replace" } }
{ "reply": "Updated the link.", "patch": { "type": "attribute", "name": "href", "value": "https://example.com" } }
{ "reply": "Swapped to the design-system button.", "patch": { "type": "swapElement", "componentName": "Button", "props": { "variant": "primary" } } }
{ "reply": "Select an element first.", "patch": null }

Only use Tailwind classes from this allowlist: ${registry.tailwindAllowlist?.slice(0, 50).join(", ") ?? "standard utilities"}
For swapElement, use component names: ${registry.components.map((c) => c.name).join(", ")}`;
};

export const generatePatch = async (params: {
  message: string;
  elementSnapshot?: ElementSnapshot;
  selectedSelector?: string;
  ledger: ChangeRecord[];
}): Promise<{ reply: string; patch?: DomPatch }> => {
  const { message, elementSnapshot, selectedSelector, ledger } = params;

  if (useMockLlm) {
    if (!selectedSelector) {
      return {
        reply:
          "Please pick an element on the page first using the ⊕ button, then describe your change.",
      };
    }

    const patch = parsePatchFromMessage(message);
    if (!patch) {
      return {
        reply: `I understand you want: "${message}". Try: change the text to "your new text" or change the color to blue-500.`,
      };
    }

    const validated = parseDomPatch(patch);
    if (!validated.success) {
      return {
        reply: `I couldn't apply that change. Try: change the text to "your new text" or change the color to blue-500.`,
      };
    }

    return {
      reply: `Applied ${validated.data.type} change to ${selectedSelector}.`,
      patch: validated.data,
    };
  }

  const llmConfig = getLlmConfig();

  const content = await completeJson(llmConfig, {
    system: buildSystemPrompt(),
    user: JSON.stringify({
      message,
      selectedSelector,
      elementSnapshot,
      priorChanges: ledger.length,
    }),
  });

  const parsed = parseLlmJson(content) as { reply?: string; patch?: unknown };

  if (!parsed.patch) {
    return {
      reply:
        parsed.reply ??
        "I couldn't determine a DOM change from that request. Select an element and describe the edit.",
    };
  }

  const validated = parseDomPatch(parsed.patch);
  if (!validated.success) {
    return {
      reply:
        parsed.reply ??
        "I understood your request but couldn't produce a valid DOM patch. Try being more specific, e.g. change the text to \"Hello\".",
    };
  }

  return {
    reply: parsed.reply ?? `Applied ${validated.data.type} change.`,
    patch: validated.data,
  };
};

export const analyzeGraphqlImpact = async (
  ledger: ChangeRecord[],
  pageUrl: string,
): Promise<"none" | "query-only" | "schema-change"> => {
  if (useMockLlm) {
    const hasGraphqlHint = ledger.some(
      (r) =>
        r.intent.toLowerCase().includes("graphql") ||
        r.intent.toLowerCase().includes("query") ||
        r.intent.toLowerCase().includes("api"),
    );
    return hasGraphqlHint ? "query-only" : "none";
  }

  const llmConfig = getLlmConfig();
  const content = await completeJson(llmConfig, {
    system:
      'Analyze if UI changes require GraphQL schema/resolver changes. Return JSON: { "impact": "none" | "query-only" | "schema-change" }',
    user: JSON.stringify({ pageUrl, changes: ledger }),
  });

  const parsed = JSON.parse(content) as {
    impact: "none" | "query-only" | "schema-change";
  };

  return parsed.impact;
};
