import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { ChangeRecord } from "@directdom/shared";
import { stripDibsCssPrefix } from "@directdom/shared";
import {
  preferredAppRoots,
  resolveFerrumAppsFromPageUrl,
  type PageUrlContext,
} from "./resolve-app.js";

export type CandidateFile = {
  path: string;
  score: number;
  content: string;
};

const SEARCH_ROOTS = ["apps", "packages", "src"];
const SKIP_DIRS = new Set([
  "node_modules",
  "__generated__",
  "__tests__",
  "dist",
  "build",
  ".git",
  "coverage",
]);
const SOURCE_EXT = new Set([".tsx", ".ts", ".jsx", ".js"]);
const SKIP_FILE_RE = /(?:\.(?:test|spec|stories)\.|_(?:test|spec)\.)/i;

/** Ultra-common dibs utilities — matching these alone floods candidates. */
const LOW_SIGNAL_CLASS_TOKENS = new Set([
  "flex",
  "flexRow",
  "flexCol",
  "flexWrap",
  "flex1",
  "block",
  "inline",
  "inlineBlock",
  "hidden",
  "relative",
  "absolute",
  "fixed",
  "sticky",
  "wFull",
  "hFull",
  "hFit",
  "wFit",
  "truncate",
  "overflowHidden",
  "overflowAuto",
  "pointer",
  "cursorPointer",
  "itemsCenter",
  "justifyCenter",
  "justifyBetween",
  "gap",
  "gapSmall",
  "gapMedium",
  "m0",
  "p0",
]);

const MAX_CANDIDATES = 8;
const MAX_FILE_CHARS = 40_000;
const MIN_TEXT_LEN = 3;

const SCORE_FIBER_FILENAME = 100;
const SCORE_FIBER_EXPORT = 80;
const SCORE_DATA_ATTR = 60;
const SCORE_APP_MATCH = 50;
const SCORE_TEXT = 40;
const SCORE_PATH_SEGMENT = 30;
const SCORE_CLASS_TOKEN = 25;
const SCORE_FIBER_PARTIAL = 20;

type SearchSignals = {
  fiberHints: string[];
  dataAttrs: Array<{ name: string; value: string }>;
  texts: string[];
  classTokens: string[];
  pathSegments: string[];
  matchedApps: string[];
};

export type FindCandidateOptions = {
  maxCandidates?: number;
  pageUrl?: string;
};

const shouldSkipDir = (name: string): boolean =>
  SKIP_DIRS.has(name) || name.startsWith(".");

const isSourceFile = (name: string): boolean => {
  if (SKIP_FILE_RE.test(name)) return false;
  return SOURCE_EXT.has(extname(name));
};

const walkSourceFiles = (dir: string, out: string[]): void => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (shouldSkipDir(entry)) continue;
      walkSourceFiles(fullPath, out);
      continue;
    }

    if (stat.isFile() && isSourceFile(entry)) {
      out.push(fullPath);
    }
  }
};

const collectSourceFiles = (
  repoPath: string,
  preferredRoots?: string[],
): string[] => {
  const files: string[] = [];
  const roots =
    preferredRoots && preferredRoots.length > 0
      ? preferredRoots
      : SEARCH_ROOTS.map((root) => join(repoPath, root)).filter(existsSync);

  for (const rootPath of roots) {
    walkSourceFiles(rootPath, files);
  }
  return files;
};

const extractDataAttrs = (
  selector: string,
): Array<{ name: string; value: string }> => {
  const attrs: Array<{ name: string; value: string }> = [];
  const pattern = /\[(data-(?:tn|testid))=["']([^"']+)["']\]/gi;
  for (const match of selector.matchAll(pattern)) {
    attrs.push({ name: match[1].toLowerCase(), value: match[2] });
  }
  return attrs;
};

export const extractClassTokens = (className: string | undefined): string[] => {
  if (!className) return [];
  return [
    ...new Set(
      className
        .split(/\s+/)
        .filter(Boolean)
        .map(stripDibsCssPrefix)
        .filter((token) => token.length >= 2)
        .filter((token) => !LOW_SIGNAL_CLASS_TOKENS.has(token)),
    ),
  ];
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

export const collectSearchSignals = (
  ledger: ChangeRecord[],
  pageContext?: PageUrlContext | null,
  matchedApps: string[] = [],
): SearchSignals => {
  const fiberHints = new Set<string>();
  const dataAttrs: Array<{ name: string; value: string }> = [];
  const texts = new Set<string>();
  const classTokens = new Set<string>();

  for (const change of ledger) {
    for (const hint of parseFiberHints(change.target.reactFiberHint)) {
      fiberHints.add(hint);
    }

    for (const attr of extractDataAttrs(change.target.selector)) {
      dataAttrs.push(attr);
    }

    for (const text of [
      change.before.textContent?.trim(),
      change.after.textContent?.trim(),
    ]) {
      if (text && text.length >= MIN_TEXT_LEN) {
        texts.add(text);
      }
    }

    for (const token of extractClassTokens(change.before.className)) {
      classTokens.add(token);
    }
    for (const token of extractClassTokens(change.after.className)) {
      classTokens.add(token);
    }
  }

  return {
    fiberHints: [...fiberHints],
    dataAttrs,
    texts: [...texts],
    classTokens: [...classTokens],
    pathSegments: pageContext?.pathSegments ?? [],
    matchedApps,
  };
};

const fileStem = (filePath: string): string =>
  basename(filePath, extname(filePath));

const hasFiberExport = (content: string, hint: string): boolean => {
  const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`export\\s+(?:const|function|class)\\s+${escaped}\\b`),
    new RegExp(`export\\s+default\\s+(?:function\\s+)?${escaped}\\b`),
    new RegExp(`export\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`),
  ];
  return patterns.some((re) => re.test(content));
};

const hasDataAttr = (
  content: string,
  attr: { name: string; value: string },
): boolean => {
  const { name, value } = attr;
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return (
    content.includes(`${name}="${value}"`) ||
    content.includes(`${name}='${value}'`) ||
    content.includes(`${camel}="${value}"`) ||
    content.includes(`${camel}='${value}'`)
  );
};

const scoreFile = (
  absPath: string,
  relPath: string,
  content: string,
  signals: SearchSignals,
): number => {
  let contentScore = 0;
  let locationScore = 0;
  const stem = fileStem(absPath);
  const relLower = relPath.toLowerCase();

  for (const hint of signals.fiberHints) {
    if (stem === hint || stem.toLowerCase() === hint.toLowerCase()) {
      contentScore += SCORE_FIBER_FILENAME;
    } else if (hasFiberExport(content, hint)) {
      contentScore += SCORE_FIBER_EXPORT;
    } else if (
      stem.toLowerCase().includes(hint.toLowerCase()) ||
      content.includes(hint)
    ) {
      contentScore += SCORE_FIBER_PARTIAL;
    }
  }

  for (const attr of signals.dataAttrs) {
    if (hasDataAttr(content, attr)) {
      contentScore += SCORE_DATA_ATTR;
    }
  }

  for (const text of signals.texts) {
    if (content.includes(text)) {
      contentScore += SCORE_TEXT;
    }
  }

  for (const token of signals.classTokens) {
    if (
      content.includes(`dibsCss.${token}`) ||
      content.includes(`styles.${token}`)
    ) {
      contentScore += SCORE_CLASS_TOKEN;
    }
  }

  for (const appName of signals.matchedApps) {
    if (relPath.startsWith(`apps/${appName}/`)) {
      locationScore += SCORE_APP_MATCH;
      break;
    }
  }

  for (const segment of signals.pathSegments) {
    if (relLower.includes(segment.toLowerCase())) {
      locationScore += SCORE_PATH_SEGMENT;
    }
  }

  const pathSegmentHits = signals.pathSegments.some((segment) =>
    relLower.includes(segment.toLowerCase()),
  );
  if (contentScore === 0 && !pathSegmentHits) {
    return 0;
  }

  return contentScore + locationScore;
};

const truncateContent = (content: string): string => {
  if (content.length <= MAX_FILE_CHARS) return content;
  return `${content.slice(0, MAX_FILE_CHARS)}\n/* … truncated for codegen prompt … */\n`;
};

const hasUsableSignals = (signals: SearchSignals): boolean =>
  signals.fiberHints.length > 0 ||
  signals.dataAttrs.length > 0 ||
  signals.texts.length > 0 ||
  signals.classTokens.length > 0 ||
  signals.pathSegments.length > 0 ||
  signals.matchedApps.length > 0;

const scoreRepoFiles = (
  repoPath: string,
  filePaths: string[],
  signals: SearchSignals,
  maxCandidates: number,
): CandidateFile[] => {
  const scored: CandidateFile[] = [];

  for (const absPath of filePaths) {
    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }

    const relPath = relative(repoPath, absPath).replace(/\\/g, "/");
    const score = scoreFile(absPath, relPath, content, signals);
    if (score <= 0) continue;

    scored.push({
      path: relPath,
      score,
      content: truncateContent(content),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, maxCandidates);
};

/**
 * Score source files in a cloned repo against ledger + pageUrl signals so the
 * LLM receives likely component targets instead of inventing paths.
 */
export const findCandidateFiles = (
  repoPath: string,
  ledger: ChangeRecord[],
  options?: FindCandidateOptions,
): CandidateFile[] => {
  if (ledger.length === 0) return [];

  const pageUrl = options?.pageUrl;
  const { context, matches } = pageUrl
    ? resolveFerrumAppsFromPageUrl(repoPath, pageUrl)
    : { context: null, matches: [] };

  const matchedApps = matches.map((m) => m.appName);
  if (matchedApps.length > 0) {
    console.log(
      `[codegen] pageUrl matched app(s): ${matches
        .map((m) => `${m.appName} (route ${m.route})`)
        .join(", ")}`,
    );
  } else if (pageUrl) {
    console.log(
      `[codegen] No ferrum app route matched for pageUrl=${pageUrl}; using path segments only.`,
    );
  }

  const signals = collectSearchSignals(ledger, context, matchedApps);
  console.log(
    `[codegen] search signals: fiber=[${signals.fiberHints.join(", ")}] dataAttrs=${signals.dataAttrs.length} texts=${signals.texts.length} classTokens=[${signals.classTokens.slice(0, 8).join(", ")}] segments=[${signals.pathSegments.join(", ")}]`,
  );

  if (!hasUsableSignals(signals)) return [];

  const maxCandidates = options?.maxCandidates ?? MAX_CANDIDATES;

  if (matchedApps.length > 0) {
    const scoped = scoreRepoFiles(
      repoPath,
      collectSourceFiles(repoPath, preferredAppRoots(repoPath, matchedApps)),
      signals,
      maxCandidates,
    );
    if (scoped.length > 0) return scoped;
  }

  return scoreRepoFiles(
    repoPath,
    collectSourceFiles(repoPath),
    signals,
    maxCandidates,
  );
};
