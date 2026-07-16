import type { ElementSnapshot } from "@directdom/shared";

const EXPLICIT_CSS_PATTERN =
  /\b([a-z-]+)\s*:\s*([^;,\n]+?)(?=\s*(?:;|,|$|\band\b))/gi;

const COLOR_NAME_TO_CSS: Record<string, string[]> = {
  blue: ["color: #436b93", "color: #375d81", "color: #2683a3"],
  "blue-500": ["color: #436b93"],
  "blue-600": ["color: #436b93"],
  red: ["color: #cc0000", "color: #950808"],
  green: ["color: #2e7d32", "color: #1b5e20"],
  gray: ["color: #444", "color: #555555", "color: #888888"],
  grey: ["color: #444", "color: #555555", "color: #888888"],
  black: ["color: #000", "color: #111"],
  white: ["color: #fff", "color: #fbfbfb"],
};

const addUnique = (rules: string[], rule: string): void => {
  const trimmed = rule.trim();
  if (!trimmed) return;
  if (!rules.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
    rules.push(trimmed);
  }
};

const extractExplicitCssRules = (message: string): string[] => {
  const rules: string[] = [];
  for (const match of message.matchAll(EXPLICIT_CSS_PATTERN)) {
    const property = match[1]?.trim();
    const value = match[2]?.trim();
    if (!property || !value) continue;
    // Skip prose that looks like "change: the color"
    if (value.split(/\s+/).length > 4) continue;
    addUnique(rules, `${property}: ${value}`);
  }
  return rules;
};

const extractColorRules = (message: string): string[] => {
  const rules: string[] = [];
  const isBackground = /background/i.test(message);
  const property = isBackground ? "background-color" : "color";

  const hex = message.match(/#[0-9a-fA-F]{3,8}\b/);
  if (hex) {
    addUnique(rules, `${property}: ${hex[0]}`);
  }

  const rgb = message.match(/rgba?\([^)]+\)/i);
  if (rgb) {
    addUnique(rules, `${property}: ${rgb[0]}`);
  }

  const named = message.match(
    /\b(?:color|text|background)\b[\s\S]{0,40}?\b(to|as)\s+([a-z0-9-]+)/i,
  );
  const colorToken = named?.[2]?.toLowerCase();
  if (colorToken && COLOR_NAME_TO_CSS[colorToken]) {
    for (const css of COLOR_NAME_TO_CSS[colorToken]) {
      if (isBackground) {
        addUnique(rules, css.replace(/^color:/, "background-color:"));
      } else {
        addUnique(rules, css);
      }
    }
  }

  return rules;
};

const extractLayoutRules = (message: string): string[] => {
  const rules: string[] = [];
  const lower = message.toLowerCase();

  if (/\bflex\b/.test(lower) || /\bflexbox\b/.test(lower)) {
    addUnique(rules, "display: flex");
  }
  if (/\bgrid\b/.test(lower)) {
    addUnique(rules, "display: grid");
  }
  if (/\brow\b/.test(lower) || /side[\s-]?by[\s-]?side/.test(lower)) {
    addUnique(rules, "flex-direction: row");
  }
  if (/\bcolumn\b/.test(lower) || /\bstack\b/.test(lower)) {
    addUnique(rules, "flex-direction: column");
  }
  if (/\bcenter\b/.test(lower) && /\balign\b/.test(lower)) {
    addUnique(rules, "align-items: center");
  }
  if (/\bcenter\b/.test(lower) && /\bjustify\b/.test(lower)) {
    addUnique(rules, "justify-content: center");
  }
  if (/\bhidden\b/.test(lower) || /\binvisible\b/.test(lower)) {
    addUnique(rules, "visibility: hidden");
  }
  if (/\bvisible\b/.test(lower)) {
    addUnique(rules, "visibility: visible");
  }

  const gapMatch = lower.match(/\bgap\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(px|rem)?/);
  if (gapMatch) {
    const unit = gapMatch[2] ?? "px";
    addUnique(rules, `gap: ${gapMatch[1]}${unit}`);
  }

  const paddingMatch = lower.match(
    /\bpadding\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(px|rem)?/,
  );
  if (paddingMatch) {
    const unit = paddingMatch[2] ?? "px";
    addUnique(rules, `padding: ${paddingMatch[1]}${unit}`);
  }

  const marginMatch = lower.match(
    /\bmargin\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(px|rem)?/,
  );
  if (marginMatch) {
    const unit = marginMatch[2] ?? "px";
    addUnique(rules, `margin: ${marginMatch[1]}${unit}`);
  }

  const opacityMatch = lower.match(/\bopacity\s+(?:of\s+)?(0?\.\d+|1(?:\.0+)?)/);
  if (opacityMatch) {
    addUnique(rules, `opacity: ${opacityMatch[1]}`);
  }

  return rules;
};

/**
 * Best-effort CSS rules for mcp-dibs-css translate_css.
 * Prefer explicit CSS / concrete values; named colors expand to known dibs hex candidates.
 */
export const inferCssRulesFromMessage = (
  message: string,
  _elementSnapshot?: ElementSnapshot,
): string[] => {
  const rules: string[] = [];

  for (const rule of extractExplicitCssRules(message)) {
    addUnique(rules, rule);
  }
  for (const rule of extractColorRules(message)) {
    addUnique(rules, rule);
  }
  for (const rule of extractLayoutRules(message)) {
    addUnique(rules, rule);
  }

  return rules;
};
