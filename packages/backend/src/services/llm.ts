import type {
  ChangeRecord,
  DomPatch,
  ElementSnapshot,
} from "@directdom/shared";
import {
  normalizeDibsCssClassNames,
  parseDomPatch,
  resolveClassNamesToAllowlist,
  toDibsCssDomClass,
} from "@directdom/shared";
import { completeJson } from "@directdom/shared/llm";
import { getLlmConfig, useMockLlm } from "../config.js";
import {
  collectMatchedClassNames,
  formatTranslationForPrompt,
  translateCss,
  type DibsCssTranslationSummary,
} from "./dibs-css-mcp.js";
import { inferCssRulesFromMessage } from "./infer-css-rules.js";
import { getRegistry } from "./registry.js";

const HEX_COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b/;
const RGB_COLOR_PATTERN = /rgba?\([^)]+\)/i;

/** Mock-mode named color → dibs-css key when MCP is unavailable. */
const MOCK_COLOR_CLASS_FALLBACKS: Record<string, string> = {
  blue: "textBlue600",
  "blue-500": "textBlue600",
  "blue-600": "textBlue600",
  red: "textRed700",
  gray: "textGray800",
  grey: "textGray800",
};

const extractColorFromMessage = (message: string): string | null => {
  const hex = message.match(HEX_COLOR_PATTERN);
  if (hex) return hex[0];

  const rgb = message.match(RGB_COLOR_PATTERN);
  if (rgb) return rgb[0];

  return null;
};

const inferInlineStyleFromMessage = (
  message: string,
): Record<string, string> | null => {
  const explicitColor = extractColorFromMessage(message);
  if (explicitColor) {
    if (/background/i.test(message)) {
      return { backgroundColor: explicitColor };
    }
    return { color: explicitColor };
  }

  return null;
};

const isDuplicateIntent = (message: string): boolean =>
  /\b(duplicate|copy|clone|replicate)\b/i.test(message);

const isNewElementIntent = (message: string): boolean =>
  !isDuplicateIntent(message) &&
  /\b(add|insert|append|create|put|place|include)\b/i.test(message) &&
  /\b(button|input|field|link|heading|title|divider|separator|icon|label|checkbox|dropdown|select|image|img|paragraph|list|item|section|row|column|toolbar|banner|card|hr|badge|chip|tab|modal|menu)\b/i.test(
    message,
  );

const isRestructureIntent = (message: string): boolean =>
  /\b(wrap|unwrap|restructure|rearrange|reorganize|reorder|split|merge|convert|group|nest|move|layout|column|columns|row|rows|grid|stack|side.by.side|two.column|three.column)\b/i.test(
    message,
  );

const isStructuralIntent = (message: string): boolean =>
  isDuplicateIntent(message) ||
  isNewElementIntent(message) ||
  isRestructureIntent(message) ||
  /\b(remove|delete|sibling|below|above|next to|inside|within|before|after|prepend|append)\b/i.test(
    message,
  );

export type RequestCategory =
  | "styling"
  | "content"
  | "structural-duplicate"
  | "structural-add"
  | "structural-restructure"
  | "general";

export const inferRequestCategory = (message: string): RequestCategory => {
  if (isDuplicateIntent(message)) return "structural-duplicate";
  if (isRestructureIntent(message)) return "structural-restructure";
  if (isNewElementIntent(message)) return "structural-add";
  if (isStructuralIntent(message)) return "structural-add";
  if (
    /\b(color|font|bold|italic|underline|background|padding|margin|align|size|spacing|border|rounded|shadow|opacity|visible|hidden|width|height)\b/i.test(
      message,
    )
  ) {
    return "styling";
  }
  if (
    /\b(text|label|copy|title|say|read|display|href|url|link to|placeholder)\b/i.test(
      message,
    )
  ) {
    return "content";
  }
  return "general";
};

const inferInsertPosition = (
  message: string,
): "before" | "after" | "inside" => {
  if (
    /\b(inside|within|in the|into the|at the end of|append to)\b/i.test(message)
  ) {
    return "inside";
  }
  if (/\b(before|above|prepend|on top)\b/i.test(message)) {
    return "before";
  }
  return "after";
};

const REQUEST_CATEGORY_HINTS: Record<RequestCategory, string> = {
  styling:
    "This looks like a styling request — use className or inlineStyle on the selected element.",
  content:
    "This looks like a content request — use textContent or attribute on the selected element.",
  "structural-duplicate":
    'This looks like a duplicate request — use insertElement with mode "clone".',
  "structural-add":
    'This looks like a structural add — use insertElement. For a NEW element type (not a copy), use mode "html" with full outerHTML. Pick position based on where the user wants it.',
  "structural-restructure":
    "This looks like a restructure request — use swapElement with html to replace/wrap the selected element's markup, preserving inner content when appropriate. className alone cannot change DOM hierarchy.",
  general:
    "Classify the request first: styling → className/inlineStyle; content → textContent/attribute; structural → insertElement or swapElement.",
};

const buildStructuralContext = (snapshot?: ElementSnapshot): string => {
  if (!snapshot) return "";

  const parts: string[] = [`Selected tag: <${snapshot.tagName}>`];

  if (snapshot.parentTagName) {
    const parentClasses = snapshot.parentClassName
      ? ` class="${snapshot.parentClassName}"`
      : "";
    parts.push(`Parent: <${snapshot.parentTagName}${parentClasses}>`);
  }

  if (snapshot.childTagSummary) {
    parts.push(`Direct children: ${snapshot.childTagSummary}`);
  }

  if (snapshot.innerHTML) {
    parts.push(`Inner HTML (truncated): ${snapshot.innerHTML.slice(0, 500)}`);
  }

  return parts.join("\n");
};

const extractNewLabel = (message: string): string | null => {
  const quoted = extractQuotedValue(message);
  if (quoted) return quoted;

  const labelMatch = message.match(
    /(?:label|text|title)(?:\s+\w+){0,3}?\s+(?:to|as)\s+(.+)$/i,
  );
  return labelMatch?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
};

const refinePatch = (
  patch: DomPatch,
  message: string,
  mcpClassNames: string[] = [],
): DomPatch => {
  if (isDuplicateIntent(message)) {
    if (patch.type === "textContent") {
      return {
        type: "insertElement",
        position: "after",
        mode: "clone",
        textContent: patch.value,
      };
    }

    if (patch.type === "swapElement" && !patch.html) {
      return {
        type: "insertElement",
        position: "after",
        mode: "clone",
        textContent: extractNewLabel(message) ?? undefined,
      };
    }

    if (patch.type === "insertElement") {
      return {
        ...patch,
        position: patch.position ?? "after",
        mode: patch.mode ?? "clone",
        textContent: patch.textContent ?? extractNewLabel(message) ?? undefined,
      };
    }
  }

  if (patch.type === "insertElement" && isStructuralIntent(message)) {
    return {
      ...patch,
      position: patch.position ?? inferInsertPosition(message),
      mode:
        patch.mode ??
        (isDuplicateIntent(message) ? "clone" : "html"),
    };
  }

  const inlineFromMessage = inferInlineStyleFromMessage(message);
  if (inlineFromMessage) {
    return {
      type: "inlineStyle",
      value: inlineFromMessage,
      mode: "merge",
    };
  }

  if (patch.type !== "className") {
    return patch;
  }

  if (mcpClassNames.length > 0) {
    const { resolved, unresolved } = resolveClassNamesToAllowlist(
      patch.value,
      mcpClassNames,
    );

    if (unresolved.length === 0) {
      return {
        ...patch,
        value: resolved,
        mode: patch.mode ?? "merge",
      };
    }

    const preferred = mcpClassNames[0];
    if (preferred && unresolved.length === patch.value.split(/\s+/).filter(Boolean).length) {
      return {
        ...patch,
        value: toDibsCssDomClass(preferred),
        mode: patch.mode ?? "merge",
      };
    }

    return {
      ...patch,
      value: resolved || normalizeDibsCssClassNames(patch.value),
      mode: patch.mode ?? "merge",
    };
  }

  const inlineStyle: Record<string, string> = {};
  for (const token of patch.value.split(/\s+/).filter(Boolean)) {
    const stripped = token.replace(/^dc-/, "");
    if (HEX_COLOR_PATTERN.test(stripped) || RGB_COLOR_PATTERN.test(stripped)) {
      if (/background/i.test(message)) {
        inlineStyle.backgroundColor = stripped;
      } else {
        inlineStyle.color = stripped;
      }
    }
  }

  if (Object.keys(inlineStyle).length > 0) {
    return {
      type: "inlineStyle",
      value: inlineStyle,
      mode: "merge",
    };
  }

  return {
    ...patch,
    value: normalizeDibsCssClassNames(patch.value),
    mode: patch.mode ?? "merge",
  };
};

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
  if (isDuplicateIntent(message)) {
    return {
      type: "insertElement",
      position: "after",
      mode: "clone",
      textContent: extractNewLabel(message) ?? undefined,
    };
  }

  const quotedText = extractQuotedValue(message);
  if (
    quotedText &&
    /(?:change|update|set|make|read|say|display|show|can we)/i.test(message)
  ) {
    return { type: "textContent", value: quotedText };
  }

  const colorMatch = message.match(
    /(?:change|set).*?color.*?(?:to|as)\s+([#\w(),.%\s-]+)/i,
  );
  if (colorMatch) {
    const colorToken = colorMatch[1].trim();
    const explicitColor = extractColorFromMessage(colorToken) ?? colorToken;

    if (
      HEX_COLOR_PATTERN.test(explicitColor) ||
      RGB_COLOR_PATTERN.test(explicitColor)
    ) {
      return {
        type: "inlineStyle",
        value: { color: explicitColor },
        mode: "merge",
      };
    }

    const normalizedToken = colorToken.replace(/-/g, "");
    const textClass = `text${normalizedToken.charAt(0).toUpperCase()}${normalizedToken.slice(1)}`;
    const fallbackKey =
      MOCK_COLOR_CLASS_FALLBACKS[colorToken.toLowerCase()] ??
      MOCK_COLOR_CLASS_FALLBACKS[normalizedToken.toLowerCase()] ??
      textClass;

    return {
      type: "className",
      value: toDibsCssDomClass(fallbackKey),
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

const buildSystemPrompt = (params: {
  message: string;
  elementSnapshot?: ElementSnapshot;
  translation: DibsCssTranslationSummary | null;
}): string => {
  const registry = getRegistry();
  const mcpClassNames = collectMatchedClassNames(params.translation);
  const classHint =
    mcpClassNames.length > 0
      ? mcpClassNames.map(toDibsCssDomClass).join(", ")
      : "none from MCP — use inlineStyle for exact values, or the closest dc-* class only if you are certain it exists";

  const translationHint = formatTranslationForPrompt(params.translation);

  const currentClasses = params.elementSnapshot?.className ?? "none";
  const computedStyles = params.elementSnapshot?.computedStyles;
  const styleContext = computedStyles
    ? `Current computed styles: color=${computedStyles.color ?? "unknown"}, backgroundColor=${computedStyles.backgroundColor ?? "unknown"}, fontSize=${computedStyles.fontSize ?? "unknown"}`
    : "";

  const currentHtml = params.elementSnapshot?.outerHTML
    ? `Selected element outerHTML (truncated): ${params.elementSnapshot.outerHTML.slice(0, 800)}`
    : "";

  const structuralContext = buildStructuralContext(params.elementSnapshot);
  const requestCategory = inferRequestCategory(params.message);
  const categoryHint = REQUEST_CATEGORY_HINTS[requestCategory];

  const componentNames = registry.components.map((c) => c.name).join(", ");

  return `You are DirectDOM, an assistant that generates structured DOM patches for a React app using dibs-css.
Return JSON only: { "reply": string, "patch": DomPatch | null }

Ferrum uses dibs-css. In the live DOM, classes appear as dc-<camelCaseKey>.
Example: dibs-css key textBlue600 -> DOM class "dc-textBlue600".

Class lookup uses the mcp-dibs-css translate_css tool (CSS property/value → dibs utility class). Prefer MCP matches below; do not invent Tailwind-style names.

The patch.type field MUST be exactly one of: textContent, className, inlineStyle, attribute, insertElement, swapElement

REQUEST ROUTING (critical — classify the user's intent FIRST):
1. STYLING (colors, fonts, spacing, alignment, borders, visibility): className or inlineStyle on the SELECTED element only.
2. CONTENT (change visible text, label, link URL, placeholder): textContent or attribute on the SELECTED element only.
3. STRUCTURAL (add/remove/rearrange elements, change layout hierarchy, wrap/unwrap, split sections): insertElement or swapElement — NEVER use className/textContent/inlineStyle alone for structural goals.

Detected request category for this message: ${requestCategory}
→ ${categoryHint}

STRUCTURAL CHANGE RULES (critical):

A. ADDING elements — use insertElement:
- DUPLICATE / COPY the selected element → mode "clone", position "after" (default), "before", or "inside"
  - Set textContent when the duplicate needs a different label
- ADD a NEW element of a different type (button, input, heading, divider, link, etc.) → mode "html" with a complete single-root outerHTML string using dibs-css classes (dc-*)
  - Match the visual style of siblings/parent from the element context below
  - Example: { "type": "insertElement", "position": "after", "mode": "html", "html": "<button type=\\"button\\" class=\\"dc-textBlue600 dc-pSmall\\">Filter</button>" }
- Position guide: "before"/"above" → "before"; "after"/"below"/"next to" → "after"; "inside"/"within"/"at the end of" → "inside"

B. RESTRUCTURING the selected element — use swapElement with html (required for live DOM):
- REPLACE or WRAP the selected element's markup (change tag, wrap children in a flex/grid container, split into columns) → swapElement with html set to the new outerHTML
  - Preserve existing inner content by including it in the new html (use the innerHTML/outerHTML from context)
  - Set componentName to the closest design-system component (${componentNames}) or "div" for generic wrappers
  - swapElement WITHOUT html will NOT apply — always include html for structural swaps
- Example wrap in flex row: { "type": "swapElement", "componentName": "div", "html": "<div class=\\"dc-flex dc-flexRow dc-gap4\\">...existing children...</div>" }
- Example two-column layout: wrap content in a div with dc-flex dc-flexRow and column children

C. LAYOUT tips:
- To change flex direction, columns, or grouping, select the CONTAINER element (or use swapElement to wrap the selection)
- className on a leaf text node cannot create new sibling elements or columns — that requires insertElement or swapElement
- When adding multiple related elements (e.g. label + input), prefer one insertElement with html containing both, or multiple insertElement patches (return the most impactful single patch)

D. Design-system component swap:
- For swapping to Button, Input, Checkbox, etc.: swapElement with componentName, props, AND html representing the rendered output

ELEMENT CONTEXT:
${structuralContext || "No element selected — ask user to select an element first."}
${currentHtml}

STRUCTURAL EXAMPLES:
{ "reply": "Duplicated the dropdown below the original.", "patch": { "type": "insertElement", "position": "after", "mode": "clone" } }
{ "reply": "Duplicated with a new label.", "patch": { "type": "insertElement", "position": "after", "mode": "clone", "textContent": "Sort by price" } }
{ "reply": "Added a filter button below.", "patch": { "type": "insertElement", "position": "after", "mode": "html", "html": "<button type=\\"button\\" class=\\"dc-textBlue600\\">Filter</button>" } }
{ "reply": "Added a heading inside the section.", "patch": { "type": "insertElement", "position": "inside", "mode": "html", "html": "<h2 class=\\"dc-textGray800\\">Results</h2>" } }
{ "reply": "Wrapped content in a flex row.", "patch": { "type": "swapElement", "componentName": "div", "html": "<div class=\\"dc-flex dc-flexRow dc-gapMedium\\"><!-- preserved inner content --></div>" } }
{ "reply": "Split into two columns.", "patch": { "type": "swapElement", "componentName": "div", "html": "<div class=\\"dc-flex dc-flexRow dc-gapMedium\\"><div class=\\"dc-flex1\\">...</div><div class=\\"dc-flex1\\">...</div></div>" } }

STYLING RULES (critical):
1. Prefer dibs-css classes from the MCP matches below — pick the CLOSEST matching key, never invent tailwind-style names like text-blue-500.
2. For className patches, ALWAYS use mode "merge". The system removes conflicting classes in the same category (e.g. replacing textGray800 when adding textBlue600).
3. If the user requests an exact color (hex like #ff0000, rgb(), or a value with no matching dibs-css class), use inlineStyle instead:
   { "type": "inlineStyle", "value": { "color": "#ff0000" }, "mode": "merge" }
4. Do NOT use raw Tailwind classes. Map to dibs-css keys: text-blue-500 -> textBlue500 or the closest available text* class.
5. Element currently has classes: ${currentClasses}
${styleContext}

MCP STYLE TRANSLATION:
${translationHint}

CONTENT & STYLING EXAMPLES:
{ "reply": "Updated the button label.", "patch": { "type": "textContent", "value": "Submit order" } }
{ "reply": "Applied blue text.", "patch": { "type": "className", "value": "dc-textBlue600", "mode": "merge" } }
{ "reply": "Applied custom red.", "patch": { "type": "inlineStyle", "value": { "color": "#e63946" }, "mode": "merge" } }
{ "reply": "Updated the link.", "patch": { "type": "attribute", "name": "href", "value": "https://example.com" } }
{ "reply": "Swapped to the design-system button.", "patch": { "type": "swapElement", "componentName": "Button", "props": { "variant": "primary" }, "html": "<button type=\\"button\\" class=\\"dc-textBlue600 dc-pSmall\\">Submit</button>" } }
{ "reply": "Select an element first.", "patch": null }

Relevant dibs-css classes for this request: ${classHint}`;
};

export const generatePatch = async (params: {
  message: string;
  elementSnapshot?: ElementSnapshot;
  selectedSelector?: string;
  ledger: ChangeRecord[];
}): Promise<{ reply: string; patch?: DomPatch }> => {
  const { message, elementSnapshot, selectedSelector, ledger } = params;

  const cssRules = inferCssRulesFromMessage(message, elementSnapshot);
  const translation = await translateCss(cssRules);
  const mcpClassNames = collectMatchedClassNames(translation);

  if (useMockLlm) {
    if (!selectedSelector) {
      return {
        reply:
          "Please pick an element on the page first using the ⊕ button, then describe your change.",
      };
    }

    if (mcpClassNames.length > 0 && inferRequestCategory(message) === "styling") {
      const preferred = mcpClassNames.find((name) =>
        name.toLowerCase().startsWith("text"),
      ) ?? mcpClassNames[0];

      return {
        reply: `Applied className change to ${selectedSelector}.`,
        patch: {
          type: "className",
          value: toDibsCssDomClass(preferred),
          mode: "merge",
        },
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
      patch: refinePatch(validated.data, message, mcpClassNames),
    };
  }

  const llmConfig = getLlmConfig();

  const content = await completeJson(llmConfig, {
    system: buildSystemPrompt({ message, elementSnapshot, translation }),
    user: JSON.stringify({
      message,
      selectedSelector,
      elementSnapshot,
      priorChanges: ledger.length,
      mcpCssRules: cssRules,
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
        'I understood your request but couldn\'t produce a valid DOM patch. Try being more specific, e.g. change the text to "Hello".',
    };
  }

  return {
    reply: parsed.reply ?? `Applied ${validated.data.type} change.`,
    patch: refinePatch(validated.data, message, mcpClassNames),
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
