import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DibsCssMatch = {
  className: string;
  originalCSS: string;
};

type ClassCssEntry = {
  className: string;
  originalCSS: string;
  normalizedCSS: string;
};

type StyleSystemMaps = {
  classToCss: Map<string, ClassCssEntry[]>;
  cssToClasses: Map<string, string[]>;
};

const styleSystemCache = new Map<string, StyleSystemMaps>();

/** Relative path from a ferrum (or ferrum-like) repo root to the generated style-system file. */
export const DIBS_CSS_STYLE_SYSTEM_RELATIVE_PATH =
  "packages/dibs-css/exports/dibs-css.module.d.css.ts";

/**
 * Read-only lookup against ferrum's generated dibs-css style system.
 *
 * Ferrum ships the full class ↔ CSS mapping in a generated TypeScript file
 * (`dibs-css.module.d.css.ts`). Each utility is a JSDoc block with an embedded
 * ```css``` example followed by `className: string` — not JSON or a simple map.
 *
 * mcp-dibs-css parses this file at startup. We mirror that with regex so backend
 * and codegen can resolve classes without spawning MCP (codegen runs on a clone
 * at submit time; backend uses this as a fallback when MCP is down or the class
 * name is already known).
 *
 * Both lookup directions share one parse pass:
 *   - class → CSS  (`lookupDibsCssMatches`) — preview inline styles, module edits
 *   - CSS → class    (`lookupDibsCssClassesByDeclarations`) — codegen reverse path
 */
const normalizeCssDeclaration = (css: string): string =>
  css
    .trim()
    .replace(/;$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();

export const getDibsCssStyleSystemPath = (repoPath: string): string =>
  join(repoPath, DIBS_CSS_STYLE_SYSTEM_RELATIVE_PATH);

const parseStyleSystem = (repoPath: string): StyleSystemMaps => {
  const classToCss = new Map<string, ClassCssEntry[]>();
  const cssToClasses = new Map<string, string[]>();
  const filePath = getDibsCssStyleSystemPath(repoPath);

  if (!existsSync(filePath)) {
    return { classToCss, cssToClasses };
  }

  const content = readFileSync(filePath, "utf-8");

  // Walk each `/** ... */ className: string` entry in the generated .d.ts file.
  const blockPattern = /\/\*\*\s*\n([\s\S]*?)\*\/\s*\n\s*(\w+):\s*string;/g;

  for (
    let match = blockPattern.exec(content);
    match !== null;
    match = blockPattern.exec(content)
  ) {
    const commentBlock = match[1];
    const className = match[2];
    if (!commentBlock || !className) continue;

    // Pull the ```css ... ``` fenced block out of the JSDoc comment.
    const cssBlockPattern = /```css\s*\n([\s\S]*?)\n\s*\*\s*```/;
    const cssMatch = commentBlock.match(cssBlockPattern);
    if (!cssMatch?.[1]) continue;

    // JSDoc lines are prefixed with ` * ` — strip those before parsing declarations.
    const cssContent = cssMatch[1].replace(/\s*\*\s*/g, "").trim();

    // A single utility can emit multiple declarations (e.g. margin + padding).
    const propertyPattern = /([a-zA-Z-]+)\s*:\s*([^;]+);/g;

    for (
      let propertyMatch = propertyPattern.exec(cssContent);
      propertyMatch !== null;
      propertyMatch = propertyPattern.exec(cssContent)
    ) {
      const property = propertyMatch[1]?.trim();
      const value = propertyMatch[2]?.trim();
      if (!property || !value) continue;

      const originalCSS = `${property}: ${value}`;
      const normalizedCSS = normalizeCssDeclaration(originalCSS);
      const entry: ClassCssEntry = { className, originalCSS, normalizedCSS };

      const classEntries = classToCss.get(className) ?? [];
      classEntries.push(entry);
      classToCss.set(className, classEntries);

      const classes = cssToClasses.get(normalizedCSS) ?? [];
      if (!classes.includes(className)) {
        classes.push(className);
        cssToClasses.set(normalizedCSS, classes);
      }
    }
  }

  return { classToCss, cssToClasses };
};

const getStyleSystemMaps = (repoPath: string): StyleSystemMaps => {
  const cached = styleSystemCache.get(repoPath);
  if (cached) return cached;

  const maps = parseStyleSystem(repoPath);
  styleSystemCache.set(repoPath, maps);
  return maps;
};

/** Forward lookup: dibs-css key → CSS declarations. */
export const lookupDibsCssMatches = (
  repoPath: string,
  classNames: string[],
): DibsCssMatch[] => {
  const { classToCss } = getStyleSystemMaps(repoPath);
  const matches: DibsCssMatch[] = [];

  for (const className of classNames) {
    const entries = classToCss.get(className);
    if (!entries?.length) continue;
    for (const entry of entries) {
      matches.push({
        className: entry.className,
        originalCSS: entry.originalCSS,
      });
    }
  }

  return matches;
};

/**
 * Reverse lookup: CSS declaration → candidate dibs-css keys.
 * Used when submit receives an inlineStyle patch without sourceClassName.
 */
export const lookupDibsCssClassesByDeclarations = (
  repoPath: string,
  declarations: string[],
): string[] => {
  const { cssToClasses } = getStyleSystemMaps(repoPath);
  const classNames = new Set<string>();

  for (const declaration of declarations) {
    const normalized = normalizeCssDeclaration(declaration);
    for (const className of cssToClasses.get(normalized) ?? []) {
      classNames.add(className);
    }
  }

  return [...classNames];
};

export const resetDibsCssLookupCache = (): void => {
  styleSystemCache.clear();
};
