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
