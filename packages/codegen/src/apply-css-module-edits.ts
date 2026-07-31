import { cssPropertyToKebabCase, cssValuesMatch } from "@directdom/shared";

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const parseCssRuleBlock = (
  content: string,
  className: string,
): { start: number; end: number; body: string } | null => {
  const pattern = new RegExp(
    `\\.${escapeRegExp(className)}\\s*\\{([^}]*)\\}`,
    "s",
  );
  const match = content.match(pattern);
  if (!match || match.index === undefined) return null;

  const fullMatch = match[0];
  const body = match[1] ?? "";
  return {
    start: match.index,
    end: match.index + fullMatch.length,
    body,
  };
};

export const getCssRuleProperty = (
  ruleBody: string,
  property: string,
): string | null => {
  const pattern = new RegExp(
    `${escapeRegExp(property)}\\s*:\\s*([^;]+);`,
    "i",
  );
  const match = ruleBody.match(pattern);
  return match?.[1]?.trim() ?? null;
};

export const updateCssRuleProperties = (
  content: string,
  className: string,
  declarations: Record<string, string>,
): { content: string; replacements: number } | null => {
  const block = parseCssRuleBlock(content, className);
  if (!block) return null;

  let body = block.body;
  let replacements = 0;

  for (const [property, value] of Object.entries(declarations)) {
    const kebab = cssPropertyToKebabCase(property);
    const existing = getCssRuleProperty(body, kebab);
    const declaration = `${kebab}: ${value};`;

    if (existing !== null) {
      const pattern = new RegExp(
        `${escapeRegExp(kebab)}\\s*:\\s*[^;]+;`,
        "i",
      );
      if (!cssValuesMatch(existing, value)) {
        body = body.replace(pattern, declaration);
        replacements += 1;
      }
    } else {
      body = `${body.trim()}\n    ${declaration}\n`;
      replacements += 1;
    }
  }

  if (replacements === 0) return null;

  const nextRule = `.${className} {${body}}`;
  const nextContent =
    content.slice(0, block.start) + nextRule + content.slice(block.end);

  return { content: nextContent, replacements };
};

export const pickModuleClassForDeclarations = (
  cssContent: string,
  classNames: string[],
  declarations: Record<string, string>,
  beforeComputed?: Record<string, string | undefined>,
): string | null => {
  const declarationEntries = Object.entries(declarations);
  if (declarationEntries.length === 0) return classNames[0] ?? null;

  let bestClass: string | null = null;
  let bestScore = -1;

  for (const className of classNames) {
    const block = parseCssRuleBlock(cssContent, className);
    if (!block) continue;

    let score = 0;
    for (const [property, value] of declarationEntries) {
      const kebab = cssPropertyToKebabCase(property);
      const existing = getCssRuleProperty(block.body, kebab);
      if (existing !== null) {
        score += 2;
        const beforeValue = beforeComputed?.[property];
        if (beforeValue && cssValuesMatch(existing, beforeValue)) {
          score += 5;
        }
        if (cssValuesMatch(existing, value)) {
          score -= 3;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestClass = className;
    }
  }

  return bestClass ?? classNames[0] ?? null;
};
