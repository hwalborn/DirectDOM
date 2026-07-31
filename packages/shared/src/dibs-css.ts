export const DIBS_CSS_PREFIX = "dc-";

export const stripDibsCssPrefix = (className: string): string =>
  className.startsWith(DIBS_CSS_PREFIX)
    ? className.slice(DIBS_CSS_PREFIX.length)
    : className;

export const toDibsCssDomClass = (className: string): string => {
  const trimmed = className.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith(DIBS_CSS_PREFIX)
    ? trimmed
    : `${DIBS_CSS_PREFIX}${trimmed}`;
};

export const normalizeDibsCssClassNames = (classNames: string): string =>
  classNames.split(/\s+/).filter(Boolean).map(toDibsCssDomClass).join(" ");

const cssPropertyToCamelCase = (property: string): string =>
  property
    .trim()
    .toLowerCase()
    .replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());

/** Parse a single MCP/CSS declaration (e.g. "color: #436b93") for inlineStyle patches. */
export const cssDeclarationToInlineStyle = (
  declaration: string,
): Record<string, string> => {
  const colon = declaration.indexOf(":");
  if (colon === -1) return {};

  const property = declaration.slice(0, colon).trim();
  const value = declaration
    .slice(colon + 1)
    .trim()
    .replace(/;$/, "");
  if (!property || !value) return {};

  return { [cssPropertyToCamelCase(property)]: value };
};

export const mergeCssDeclarationsToInlineStyle = (
  declarations: string[],
): Record<string, string> => {
  const merged: Record<string, string> = {};
  for (const declaration of declarations) {
    Object.assign(merged, cssDeclarationToInlineStyle(declaration));
  }
  return merged;
};

export const cssPropertyToKebabCase = (property: string): string =>
  property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);

/** Convert inlineStyle patch values to CSS declarations (e.g. { color: "#436b93" } → "color: #436b93"). */
export const inlineStyleRecordToCssDeclarations = (
  value: Record<string, string>,
): string[] =>
  Object.entries(value).map(
    ([property, val]) => `${cssPropertyToKebabCase(property)}: ${val}`,
  );

const normalizeCssValue = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, "");

const rgbToHex = (value: string): string | null => {
  const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return null;

  const channels = [match[1], match[2], match[3]].map((channel) =>
    Number(channel).toString(16).padStart(2, "0"),
  );
  return `#${channels.join("")}`;
};

const canonicalizeCssColor = (value: string): string => {
  const rgb = rgbToHex(value);
  if (rgb) return rgb;
  const normalized = normalizeCssValue(value);
  return normalized.startsWith("#") ? normalized : normalized;
};

/** Loose equality for rgb()/hex CSS values. */
export const cssValuesMatch = (left: string, right: string): boolean =>
  canonicalizeCssColor(left) === canonicalizeCssColor(right);

/** Longest-match prefixes for mutually exclusive dibs-css utility classes. */
const CONFLICT_PREFIXES = [
  "minW",
  "minH",
  "maxW",
  "maxH",
  "text",
  "bg",
  "font",
  "border",
  "rounded",
  "flex",
  "grid",
  "gap",
  "px",
  "py",
  "pt",
  "pb",
  "pl",
  "pr",
  "ps",
  "pe",
  "mx",
  "my",
  "mt",
  "mb",
  "ml",
  "mr",
  "ms",
  "me",
  "p",
  "m",
  "w",
  "h",
  "leading",
  "tracking",
  "opacity",
  "shadow",
  "z",
] as const;

export const getDibsCssClassCategory = (className: string): string => {
  const key = stripDibsCssPrefix(className);
  const prefix = CONFLICT_PREFIXES.find(
    (candidate) =>
      key === candidate ||
      (key.startsWith(candidate) &&
        (key.length === candidate.length ||
          /[A-Z0-9]/.test(key[candidate.length] ?? ""))),
  );
  if (prefix) return prefix;

  const match = key.match(/^([a-z]+)/);
  return match?.[1] ?? key;
};

/** Remove existing classes that conflict with incoming classes (same category). */
export const resolveClassNameConflicts = (
  existingClassNames: string,
  newClassNames: string,
): string => {
  const existing = existingClassNames.split(/\s+/).filter(Boolean);
  const incoming = newClassNames.split(/\s+/).filter(Boolean);
  const incomingCategories = new Set(incoming.map(getDibsCssClassCategory));

  const kept = existing.filter(
    (cls) => !incomingCategories.has(getDibsCssClassCategory(cls)),
  );
  return [...kept, ...incoming].join(" ");
};

/** Convert tailwind-style kebab tokens to camelCase dibs-css keys (text-blue-500 -> textBlue500).
 * Even though our LLM is connected to the dibs-css MCP, it will often return tailwind-style class names somtimes
 * This is a fallback to get the correct class name for ferrum
 */
const tailwindTokenToCamelCase = (token: string): string =>
  token
    .split("-")
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");

const DIBS_CLASS_PREFIX_PATTERN = CONFLICT_PREFIXES.join("|");
const DIBS_CLASS_TOKEN_RE = new RegExp(
  `\\b(?:dc-)?(${DIBS_CLASS_PREFIX_PATTERN})[A-Z][a-zA-Z0-9]*\\b`,
  "g",
);

const tailwindColorToDibsClass = (
  prefix: string,
  color: string,
  shade: string,
): string =>
  `${prefix}${color.charAt(0).toUpperCase()}${color.slice(1).toLowerCase()}${shade}`;

/** Pull explicit dibs-css utility keys from user text (dc-textBlue600, text-blue-600, etc.). */
export const extractDibsCssClassNamesFromText = (text: string): string[] => {
  const classes = new Set<string>();

  for (const match of text.matchAll(DIBS_CLASS_TOKEN_RE)) {
    classes.add(stripDibsCssPrefix(match[0]));
  }

  for (const match of text.matchAll(/\b(text|bg)-([a-z]+)-(\d+)\b/gi)) {
    const [, prefix, color, shade] = match;
    if (!prefix || !color || !shade) continue;
    classes.add(tailwindColorToDibsClass(prefix.toLowerCase(), color, shade));
  }

  return [...classes];
};

/** Prefer MCP matches that align with tokens in the user's message. */
export const rankClassNamesForMessage = (
  message: string,
  classNames: string[],
): string[] => {
  const lower = message.toLowerCase();

  const scoreClass = (className: string): number => {
    let score = 0;
    const key = className.toLowerCase();
    const dom = toDibsCssDomClass(className).toLowerCase();

    if (lower.includes(key)) score += 100;
    if (lower.includes(dom)) score += 100;

    const shadeMatch = lower.match(/\b([a-z]+)-(\d+)\b/);
    if (shadeMatch) {
      const expected = `${shadeMatch[1]}${shadeMatch[2]}`;
      if (key.includes(expected)) score += 80;
    }

    if (/dealer[\s-]?primary/i.test(lower) && key.includes("dealerprimary")) {
      score += 90;
    }
    if (/dealer[\s-]?secondary/i.test(lower) && key.includes("dealersecondary")) {
      score += 90;
    }

    return score;
  };

  return [...classNames].sort(
    (left, right) => scoreClass(right) - scoreClass(left),
  );
};

const findClosestDibsCssClass = (
  token: string,
  allowedClasses: string[],
): string | null => {
  const stripped = stripDibsCssPrefix(token);
  if (allowedClasses.includes(stripped)) return stripped;

  const camel = tailwindTokenToCamelCase(stripped);
  if (allowedClasses.includes(camel)) return camel;

  const category = getDibsCssClassCategory(stripped);
  const categoryMatches = allowedClasses.filter(
    (cls) => getDibsCssClassCategory(cls) === category,
  );
  if (categoryMatches.length === 0) return null;

  const lower = stripped.toLowerCase();
  const exactInsensitive = categoryMatches.find(
    (cls) =>
      cls.toLowerCase() === lower || cls.toLowerCase() === camel.toLowerCase(),
  );
  if (exactInsensitive) return exactInsensitive;

  const shadeMatch = camel.match(/^([a-z]+)([A-Z][a-z]+)(\d+)$/);
  if (shadeMatch) {
    const [, prefix, colorName, shade] = shadeMatch;
    const expectedSuffix = `${colorName.toLowerCase()}${shade}`;
    const shadeMatches = categoryMatches.filter((cls) =>
      cls.toLowerCase().endsWith(expectedSuffix),
    );
    if (shadeMatches.length === 1) return shadeMatches[0];
    if (shadeMatches.length > 1) {
      const exactKey = `${prefix}${colorName}${shade}`;
      const exact = shadeMatches.find(
        (cls) => cls.toLowerCase() === exactKey.toLowerCase(),
      );
      if (exact) return exact;
    }
  }

  const partial = categoryMatches.find((cls) =>
    cls.toLowerCase().includes(lower.replace(/[^a-z0-9]/g, "")),
  );
  if (partial) return partial;

  return null;
};

export const resolveClassNamesToAllowlist = (
  classNames: string,
  allowedClasses: string[],
): { resolved: string; unresolved: string[] } => {
  const tokens = classNames.split(/\s+/).filter(Boolean);
  const resolvedTokens: string[] = [];
  const unresolved: string[] = [];

  for (const token of tokens) {
    const match = findClosestDibsCssClass(token, allowedClasses);
    if (match) {
      resolvedTokens.push(match);
    } else {
      unresolved.push(token);
    }
  }

  return {
    resolved: normalizeDibsCssClassNames(resolvedTokens.join(" ")),
    unresolved,
  };
};
