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
  classNames
    .split(/\s+/)
    .filter(Boolean)
    .map(toDibsCssDomClass)
    .join(" ");

export const parseDibsCssClasses = (dtsContent: string): string[] => {
  const classes: string[] = [];
  const pattern = /^\s+(\w+):\s*string;/gm;

  for (const match of dtsContent.matchAll(pattern)) {
    classes.push(match[1]);
  }

  return classes;
};

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

/** Convert tailwind-style kebab tokens to camelCase dibs-css keys (text-blue-500 -> textBlue500). */
export const tailwindTokenToCamelCase = (token: string): string =>
  token
    .split("-")
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");

export const findClosestDibsCssClass = (
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
    (cls) => cls.toLowerCase() === lower || cls.toLowerCase() === camel.toLowerCase(),
  );
  if (exactInsensitive) return exactInsensitive;

  const partial = categoryMatches.find((cls) =>
    cls.toLowerCase().includes(lower.replace(/[^a-z0-9]/g, "")),
  );
  if (partial) return partial;

  return categoryMatches[0] ?? null;
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

export const filterRelevantDibsCssClasses = (params: {
  classes: string[];
  message: string;
  currentClassNames?: string;
  limit?: number;
}): string[] => {
  const { classes, message, currentClassNames, limit = 60 } = params;
  const tokens = message
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

  const currentKeys = new Set(
    (currentClassNames ?? "")
      .split(/\s+/)
      .map(stripDibsCssPrefix)
      .filter(Boolean),
  );

  const scored = classes.map((className) => {
    const lower = className.toLowerCase();
    let score = 0;

    if (currentKeys.has(className)) {
      score += 10;
    }

    for (const token of tokens) {
      if (lower.includes(token)) {
        score += 3;
      }
    }

    if (/^(text|bg|font|p|m|flex|grid|border|rounded)/.test(className)) {
      score += 1;
    }

    return { className, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.className.localeCompare(b.className))
    .slice(0, limit)
    .map((entry) => entry.className);
};
