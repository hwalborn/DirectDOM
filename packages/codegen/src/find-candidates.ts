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
  "dibs-css",
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

/** Common English / edit verbs that drown NL search. */
const NL_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "change",
  "color",
  "colours",
  "css",
  "font",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "make",
  "of",
  "on",
  "or",
  "please",
  "set",
  "should",
  "style",
  "styles",
  "text",
  "that",
  "the",
  "this",
  "to",
  "update",
  "use",
  "using",
  "with",
]);

const MAX_CANDIDATES = 8;
const MAX_FILE_CHARS = 40_000;
const MIN_TEXT_LEN = 3;
const MIN_NL_TOKEN_LEN = 4;
const MIN_DATA_TN_PART_LEN = 4;

const SCORE_FIBER_FILENAME = 100;
const SCORE_FIBER_EXPORT = 80;
const SCORE_DATA_ATTR = 60;
const SCORE_DATA_ATTR_PARTIAL = 45;
const SCORE_APP_MATCH = 50;
const SCORE_TEXT = 40;
const SCORE_NL_PHRASE = 40;
const SCORE_PATH_SEGMENT = 30;
const SCORE_CLASS_TOKEN = 25;
const SCORE_FIBER_PARTIAL = 20;
const SCORE_NL_TOKEN = 12;

type SearchSignals = {
  fiberHints: string[];
  dataAttrs: Array<{ name: string; value: string }>;
  texts: string[];
  classTokens: string[];
  pathSegments: string[];
  matchedApps: string[];
  /** Multi-word phrases from user intent (preferred NL matches). */
  nlPhrases: string[];
  /** Significant single tokens from user intent. */
  nlTokens: string[];
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

/** Lowercase alphanumeric only — bridges kebab ↔ camel for data-tn parts. */
export const normalizeTnValue = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Pull static string chunks from data-tn / dataTn assignments, including
 * template literals like `data-tn={`${prefix}-submitButton`}`.
 */
export const extractDataTnStaticParts = (content: string): string[] => {
  const parts: string[] = [];

  const pushClean = (raw: string): void => {
    const cleaned = raw.replace(/^[-_\s]+|[-_\s]+$/g, "");
    if (cleaned) parts.push(cleaned);
  };

  // data-tn="literal" | dataTn='literal'
  for (const match of content.matchAll(
    /\bdata-?tn\s*=\s*(["'])([^"']+)\1/gi,
  )) {
    pushClean(match[2]);
  }

  // data-tn={"literal"} | dataTn={'literal'}
  for (const match of content.matchAll(
    /\bdata-?tn\s*=\s*\{\s*(["'])([^"']+)\1\s*\}/gi,
  )) {
    pushClean(match[2]);
  }

  // data-tn={`static${expr}static`} — template body split on ${...}
  for (const match of content.matchAll(
    /\bdata-?tn\s*=\s*\{\s*`([^`]*)`\s*\}/gi,
  )) {
    for (const chunk of match[1].split(/\$\{[^}]+\}/)) {
      pushClean(chunk);
    }
  }

  // data-tn={foo + '-suffix'} / dataTn={bar + "-submit"}
  for (const match of content.matchAll(
    /\bdata-?tn\s*=\s*\{(?:(?!`)[^}]){0,200}?(["'])([^"'\\]+)\1(?:(?!`)[^}]){0,200}?\}/gi,
  )) {
    pushClean(match[2]);
  }

  return [...new Set(parts)];
};

/**
 * True when source has an exact data-tn/dataTn literal, or an interpolated
 * assignment whose static chunks appear inside the DOM value
 * (e.g. DOM `item-upload-submit-button` ↔ `${dataTn}-submitButton`).
 */
export const matchDataTnInSource = (
  content: string,
  attr: { name: string; value: string },
): "exact" | "partial" | null => {
  const { name, value } = attr;
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  if (
    content.includes(`${name}="${value}"`) ||
    content.includes(`${name}='${value}'`) ||
    content.includes(`${camel}="${value}"`) ||
    content.includes(`${camel}='${value}'`) ||
    content.includes(`${camel}={"${value}"}`) ||
    content.includes(`${camel}={'${value}'}`)
  ) {
    return "exact";
  }

  const normValue = normalizeTnValue(value);
  if (normValue.length < MIN_DATA_TN_PART_LEN) return null;

  for (const part of extractDataTnStaticParts(content)) {
    const normPart = normalizeTnValue(part);
    if (
      normPart.length >= MIN_DATA_TN_PART_LEN &&
      normValue.includes(normPart)
    ) {
      return "partial";
    }
  }

  return null;
};

/**
 * Turn a natural-language intent into searchable phrases + tokens.
 * Prefers multi-word phrases ("action required") over lone stopword-y tokens.
 */
export const extractNlSignals = (
  intent: string,
): { phrases: string[]; tokens: string[] } => {
  const phrases = new Set<string>();
  const tokens = new Set<string>();

  const trimmed = intent.trim();
  if (!trimmed) return { phrases: [], tokens: [] };

  for (const quoted of trimmed.matchAll(/["']([^"']{3,80})["']/g)) {
    phrases.add(quoted[1].trim().toLowerCase());
  }

  const words = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const isSignificant = (w: string): boolean =>
    w.length >= MIN_NL_TOKEN_LEN && !NL_STOPWORDS.has(w);

  // Only adjacent significant words become phrases — don't glue across stopwords
  // ("action required in the dealer dashboard" → "action required", "dealer dashboard").
  for (let i = 0; i < words.length - 1; i++) {
    if (isSignificant(words[i]) && isSignificant(words[i + 1])) {
      phrases.add(`${words[i]} ${words[i + 1]}`);
    }
  }
  for (let i = 0; i < words.length - 2; i++) {
    if (
      isSignificant(words[i]) &&
      isSignificant(words[i + 1]) &&
      isSignificant(words[i + 2])
    ) {
      phrases.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }

  for (const word of words) {
    if (isSignificant(word)) tokens.add(word);
  }

  return {
    phrases: [...phrases].filter((p) => p.length >= MIN_NL_TOKEN_LEN),
    tokens: [...tokens],
  };
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
  const nlPhrases = new Set<string>();
  const nlTokens = new Set<string>();

  for (const change of ledger) {
    for (const hint of parseFiberHints(change.target.reactFiberHint)) {
      fiberHints.add(hint);
    }

    for (const attr of extractDataAttrs(change.target.selector)) {
      dataAttrs.push(attr);
    }

    const attrTn = change.before.attributes?.["data-tn"];
    if (attrTn && !dataAttrs.some((a) => a.value === attrTn)) {
      dataAttrs.push({ name: "data-tn", value: attrTn });
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

    const nl = extractNlSignals(change.intent);
    for (const phrase of nl.phrases) nlPhrases.add(phrase);
    for (const token of nl.tokens) nlTokens.add(token);
  }

  return {
    fiberHints: [...fiberHints],
    dataAttrs,
    texts: [...texts],
    classTokens: [...classTokens],
    pathSegments: pageContext?.pathSegments ?? [],
    matchedApps,
    nlPhrases: [...nlPhrases],
    nlTokens: [...nlTokens],
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
  const contentLower = content.toLowerCase();

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
    const match = matchDataTnInSource(content, attr);
    if (match === "exact") {
      contentScore += SCORE_DATA_ATTR;
    } else if (match === "partial") {
      contentScore += SCORE_DATA_ATTR_PARTIAL;
    }
  }

  for (const text of signals.texts) {
    if (content.includes(text)) {
      contentScore += SCORE_TEXT;
    }
  }

  for (const phrase of signals.nlPhrases) {
    if (contentLower.includes(phrase) || relLower.includes(phrase.replace(/\s+/g, ""))) {
      contentScore += SCORE_NL_PHRASE;
    } else if (relLower.includes(phrase.replace(/\s+/g, "-"))) {
      contentScore += SCORE_NL_PHRASE;
    }
  }

  for (const token of signals.nlTokens) {
    const inPath =
      relLower.includes(token) || stem.toLowerCase().includes(token);
    const inContent = contentLower.includes(token);
    // Require a content hit, or a path hit when we also have other signals —
    // path-only token matches are too noisy alone.
    if (inContent || (inPath && contentScore > 0)) {
      contentScore += SCORE_NL_TOKEN;
    } else if (inPath) {
      locationScore += SCORE_NL_TOKEN;
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
  const nlPathHits = signals.nlTokens.some((token) =>
    relLower.includes(token),
  );
  if (contentScore === 0 && !pathSegmentHits && !nlPathHits) {
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
  signals.matchedApps.length > 0 ||
  signals.nlPhrases.length > 0 ||
  signals.nlTokens.length > 0;

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

  const maxRouteScore = matches[0]?.score ?? 0;
  const topRouteMatches =
    maxRouteScore > 0
      ? matches.filter((m) => m.score === maxRouteScore)
      : [];
  const matchedApps = topRouteMatches.map((m) => m.appName);

  if (topRouteMatches.length > 0) {
    console.log(
      `[codegen] pageUrl matched app(s): ${topRouteMatches
        .map((m) => `${m.appName} (route ${m.route}, score=${m.score})`)
        .join(", ")}`,
    );
    if (matches.length > topRouteMatches.length) {
      console.log(
        `[codegen] Ignored weaker route match(es): ${matches
          .filter((m) => m.score < maxRouteScore)
          .map((m) => `${m.appName} (${m.route})`)
          .join(", ")}`,
      );
    }
  } else if (pageUrl) {
    console.log(
      `[codegen] No ferrum app route matched for pageUrl=${pageUrl}; using path segments only.`,
    );
  }

  const signals = collectSearchSignals(ledger, context, matchedApps);
  console.log(
    `[codegen] search signals: fiber=[${signals.fiberHints.join(", ")}] dataAttrs=${signals.dataAttrs.length} texts=${signals.texts.length} classTokens=[${signals.classTokens.slice(0, 8).join(", ")}] nlPhrases=[${signals.nlPhrases.slice(0, 6).join(", ")}] segments=[${signals.pathSegments.join(", ")}]`,
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
