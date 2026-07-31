import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { ChangeRecord } from "@directdom/shared";
import { stripDibsCssPrefix } from "@directdom/shared";
import { detectComponentStyleContext } from "./component-style-context.js";
import {
  findCandidateFiles,
  matchDataTnInSource,
  normalizeTnValue,
} from "./find-candidates.js";

export type StructuralEditResult = {
  modifiedPaths: string[];
  appliedChangeIds: string[];
};

const parseFiberHints = (raw: string | undefined): string[] => {
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

const findLineWithDataTn = (lines: string[], value: string): number | null => {
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

const findLineWithUniqueText = (
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

const findLineWithFiberComponent = (
  lines: string[],
  componentName: string,
): number | null => {
  const re = new RegExp(`<${componentName}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return null;
};

export type AnchorInsertPoint = {
  insertAtLine: number;
  reason: string;
};

/** Resolve where to insert JSX relative to the anchor element in source. */
export const findAnchorInsertLine = (
  content: string,
  change: ChangeRecord,
  relativePath: string,
): AnchorInsertPoint | null => {
  if (change.patch.type !== "insertElement") return null;

  const lines = content.split("\n");
  const position = change.patch.position;
  const fileStem = basename(relativePath, extname(relativePath));

  const dataTnValues = new Set<string>();
  const anchorSelector = change.anchor?.selector ?? "";
  for (const match of anchorSelector.matchAll(
    /\[(?:data-tn|data-testid)=["']([^"']+)["']\]/gi,
  )) {
    if (match[1]) dataTnValues.add(match[1]);
  }
  for (const key of ["data-tn", "data-testid"] as const) {
    const val = change.before.attributes?.[key];
    if (val) dataTnValues.add(val);
  }

  for (const value of dataTnValues) {
    const line = findLineWithDataTn(lines, value);
    if (line !== null) {
      const endLine = findJsxElementEndLine(lines, line);
      return {
        insertAtLine:
          position === "before"
            ? line
            : position === "inside"
              ? line + 1
              : endLine + 1,
        reason: `data-tn=${value}`,
      };
    }
  }

  for (const hint of parseFiberHints(change.anchor?.reactFiberHint)) {
    if (hint === fileStem) continue;
    const line = findLineWithFiberComponent(lines, hint);
    if (line !== null) {
      const endLine = findJsxElementEndLine(lines, line);
      return {
        insertAtLine:
          position === "before"
            ? line
            : position === "inside"
              ? line + 1
              : endLine + 1,
        reason: `fiber component <${hint}>`,
      };
    }
  }

  const textLine = findLineWithUniqueText(
    lines,
    change.before.textContent ?? "",
  );
  if (textLine !== null) {
    const endLine = findJsxElementEndLine(lines, textLine);
    return {
      insertAtLine:
        position === "before"
          ? textLine
          : position === "inside"
            ? textLine + 1
            : endLine + 1,
      reason: "unique anchor text",
    };
  }

  for (const hint of parseFiberHints(change.target.reactFiberHint)) {
    if (hint === fileStem) continue;
    const line = findLineWithFiberComponent(lines, hint);
    if (line !== null) {
      const endLine = findJsxElementEndLine(lines, line);
      return {
        insertAtLine:
          position === "before"
            ? line
            : position === "inside"
              ? line + 1
              : endLine + 1,
        reason: `target fiber <${hint}>`,
      };
    }
  }

  return null;
};

const convertClassAttr = (
  classValue: string,
  context: ReturnType<typeof detectComponentStyleContext>,
): string => {
  const tokens = classValue
    .split(/\s+/)
    .map(stripDibsCssPrefix)
    .filter(Boolean);
  if (tokens.length === 0) return "";

  if (!context.usesDibsCss) {
    return `className="${classValue}"`;
  }

  const refs = tokens.map((token) => `${context.dibsCssAlias}.${token}`);
  if (refs.length === 1) {
    return `className={${refs[0]}}`;
  }

  const cn = context.classNamesAlias ?? "classNames";
  return `className={${cn}(${refs.join(", ")})}`;
};

/** Convert rendered DOM HTML from the preview into ferrum JSX conventions. */
export const domHtmlToJsx = (
  html: string,
  context: ReturnType<typeof detectComponentStyleContext>,
): string => {
  let jsx = html.trim();

  jsx = jsx.replace(/\bclass=/g, "__CLASS__=");
  jsx = jsx.replace(
    /__CLASS__="([^"]*)"/g,
    (_, classes: string) => convertClassAttr(classes, context),
  );
  jsx = jsx.replace(
    /__CLASS__='([^']*)'/g,
    (_, classes: string) => convertClassAttr(classes, context),
  );

  for (const tag of ["br", "hr", "img", "input", "meta", "link"]) {
    jsx = jsx.replace(
      new RegExp(`<${tag}([^>/]*)(?<!/)>`, "gi"),
      `<${tag}$1 />`,
    );
  }

  return jsx;
};

const indentBlock = (block: string, indent: string): string => {
  const lines = block.split("\n");
  if (lines.length === 1) {
    return `${indent}${lines[0]}`;
  }
  return lines
    .map((line, index) => (index === 0 ? `${indent}${line}` : `${indent}${line}`))
    .join("\n");
};

export const insertJsxAtLine = (
  content: string,
  insertAtLine: number,
  jsx: string,
): string => {
  const lines = content.split("\n");
  const refLine = lines[Math.min(insertAtLine, lines.length - 1)] ?? "";
  const indent = refLine.match(/^(\s*)/)?.[1] ?? "            ";
  const inserted = indentBlock(jsx, indent);

  const next = [
    ...lines.slice(0, insertAtLine),
    inserted,
    ...lines.slice(insertAtLine),
  ];
  return next.join("\n");
};

const htmlForInsert = (change: ChangeRecord): string | null => {
  if (change.patch.type !== "insertElement") return null;
  return (
    change.patch.html?.trim() ||
    change.after.outerHTML?.trim() ||
    change.after.innerHTML?.trim() ||
    null
  );
};

/**
 * Deterministically apply insertElement ledger changes to the top-ranked
 * candidate file — locate the anchor in source and splice in converted JSX.
 */
export const applyStructuralEdits = (
  repoPath: string,
  ledger: ChangeRecord[],
  pageUrl?: string,
): StructuralEditResult => {
  const insertChanges = ledger.filter(
    (change): change is ChangeRecord & { patch: { type: "insertElement" } } =>
      change.patch.type === "insertElement",
  );
  if (insertChanges.length === 0) {
    return { modifiedPaths: [], appliedChangeIds: [] };
  }

  const modifiedPaths = new Set<string>();
  const appliedChangeIds: string[] = [];

  for (const change of insertChanges) {
    const html = htmlForInsert(change);
    if (!html) continue;

    const candidates = findCandidateFiles(repoPath, [change], {
      pageUrl,
      maxCandidates: 1,
    });
    if (candidates.length === 0) continue;

    const relativePath = candidates[0].path;
    const absPath = join(repoPath, relativePath);
    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const insertPoint = findAnchorInsertLine(content, change, relativePath);
    if (!insertPoint) {
      console.warn(
        `[codegen] applyStructuralEdits: could not locate anchor in ${relativePath} for change ${change.id}`,
      );
      continue;
    }

    const styleContext = detectComponentStyleContext(
      repoPath,
      relativePath,
      content,
    );
    const jsx = domHtmlToJsx(html, styleContext);
    const next = insertJsxAtLine(content, insertPoint.insertAtLine, jsx);

    if (next === content) continue;

    writeFileSync(absPath, next, "utf-8");
    modifiedPaths.add(absPath);
    appliedChangeIds.push(change.id);
    console.log(
      `[codegen] applyStructuralEdits: inserted JSX in ${relativePath} at line ${insertPoint.insertAtLine + 1} (${insertPoint.reason})`,
    );
  }

  return {
    modifiedPaths: [...modifiedPaths],
    appliedChangeIds,
  };
};
