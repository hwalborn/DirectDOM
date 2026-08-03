import { basename, extname } from "node:path";
import type { ChangeRecord } from "@directdom/shared";
import {
  matchDataTnInSource,
  normalizeTnValue,
} from "./find-candidates.js";

export type DataTnMatchMode = "exact" | "fuzzy";

export const parseFiberHints = (raw: string | undefined): string[] => {
  if (!raw?.trim()) return [];
  return raw
    .split(/[|>]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((name) => !/^[a-z]/.test(name))
    .filter((name) => !/^(ForwardRef|Memo|Anonymous|Fragment)\b/.test(name));
};

/** Last line index (inclusive) of a JSX element starting at `startLine`. */
export const findJsxElementEndLine = (
  lines: string[],
  startLine: number,
): number => {
  const opening = lines[startLine] ?? "";
  const trimmed = opening.trim();

  if (/<[A-Za-z][^>]*\/>\s*$/.test(trimmed)) {
    return startLine;
  }

  const pascalMatch = opening.match(/<([A-Z][A-Za-z0-9]*)/);
  if (pascalMatch) {
    const name = pascalMatch[1];
    for (let i = startLine; i < lines.length; i++) {
      if (lines[i].includes(`</${name}>`)) return i;
      if (i > startLine && new RegExp(`<${name}\\b[^>]*\\/>`).test(lines[i])) {
        return i;
      }
    }
    return startLine;
  }

  const htmlMatch = opening.match(/<([a-z][a-z0-9]*)/);
  if (htmlMatch) {
    const tag = htmlMatch[1];
    let depth = 0;
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      const openCount =
        line.match(new RegExp(`<${tag}(?:\\s|>|/)`, "g"))?.length ?? 0;
      const closeCount =
        (line.match(new RegExp(`</${tag}>`, "g"))?.length ?? 0) +
        (line.match(new RegExp(`<${tag}[^>]*/>`, "g"))?.length ?? 0);
      if (openCount > 0) depth += openCount;
      if (closeCount > 0) depth -= closeCount;
      if (depth <= 0 && i >= startLine) return i;
    }
  }

  return startLine;
};

export const findLineWithExactDataTn = (
  lines: string[],
  value: string,
): number | null => {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes(`data-tn="${value}"`) ||
      line.includes(`dataTn="${value}"`) ||
      line.includes(`data-tn='${value}'`) ||
      line.includes(`data-testid="${value}"`) ||
      line.includes(`data-testid='${value}'`)
    ) {
      return i;
    }
  }
  return null;
};

export const findLineWithDataTn = (
  lines: string[],
  value: string,
): number | null => {
  const normValue = normalizeTnValue(value);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes(`data-tn="${value}"`) ||
      line.includes(`dataTn="${value}"`) ||
      line.includes(`data-tn='${value}'`)
    ) {
      return i;
    }
    const chunk = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
    if (matchDataTnInSource(chunk, { name: "data-tn", value })) {
      return i;
    }
    if (normValue.length >= 4 && normalizeTnValue(line).includes(normValue)) {
      return i;
    }
  }
  return null;
};

export const findLineWithUniqueText = (
  lines: string[],
  text: string,
): number | null => {
  const trimmed = text.trim();
  if (trimmed.length < 4) return null;

  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(trimmed)) hits.push(i);
  }
  return hits.length === 1 ? hits[0] : null;
};

export const findLineWithFiberComponent = (
  lines: string[],
  componentName: string,
): number | null => {
  const re = new RegExp(`<${componentName}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return null;
};

export const collectDataTnValuesFromSelector = (
  selector: string,
  attributes?: Record<string, string | undefined>,
): Set<string> => {
  const values = new Set<string>();
  for (const match of selector.matchAll(
    /\[(?:data-tn|data-testid)=["']([^"']+)["']\]/gi,
  )) {
    if (match[1]) values.add(match[1]);
  }
  for (const key of ["data-tn", "data-testid"] as const) {
    const val = attributes?.[key];
    if (val) values.add(val);
  }
  return values;
};

export type JsxElementLocator = {
  dataTnValues?: Iterable<string>;
  fiberHints?: string[];
  textContent?: string;
  dataTnMatch?: DataTnMatchMode;
};

export const findJsxElementStartLine = (
  lines: string[],
  relativePath: string,
  locator: JsxElementLocator,
): number | null => {
  const fileStem = basename(relativePath, extname(relativePath));
  const matchDataTn =
    locator.dataTnMatch === "fuzzy"
      ? findLineWithDataTn
      : findLineWithExactDataTn;

  if (locator.dataTnValues) {
    for (const value of locator.dataTnValues) {
      const line = matchDataTn(lines, value);
      if (line !== null) return line;
    }
  }

  for (const hint of locator.fiberHints ?? []) {
    if (hint === fileStem) continue;
    const line = findLineWithFiberComponent(lines, hint);
    if (line !== null) return line;
  }

  if (locator.textContent) {
    const textLine = findLineWithUniqueText(lines, locator.textContent);
    if (textLine !== null) return textLine;
  }

  return null;
};

export const findTargetJsxStartLine = (
  content: string,
  change: ChangeRecord,
  relativePath: string,
): number | null => {
  const lines = content.split("\n");
  return findJsxElementStartLine(lines, relativePath, {
    dataTnValues: collectDataTnValuesFromSelector(
      change.target.selector,
      change.before.attributes,
    ),
    fiberHints: parseFiberHints(change.target.reactFiberHint),
    textContent: change.before.textContent ?? "",
    dataTnMatch: "exact",
  });
};

export const findOpeningTagEndLine = (
  lines: string[],
  startLine: number,
): number => {
  for (let i = startLine; i < Math.min(lines.length, startLine + 20); i++) {
    if (lines[i].includes(">")) return i;
  }
  return startLine;
};
