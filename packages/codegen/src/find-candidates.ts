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
const SCORE_DATA_ATTR_FUZZY = 35;
const SCORE_APP_MATCH = 50;
const SCORE_TEXT = 40;
const SCORE_TEXT_PARTIAL = 28;
const SCORE_CONTENT_SNIPPET = 32;
const SCORE_CONTENT_SNIPPET_PARTIAL = 20;
const SCORE_NL_PHRASE = 40;
const SCORE_PATH_SEGMENT = 30;
const SCORE_CLASS_TOKEN = 25;
const SCORE_FIBER_PARTIAL = 20;
const SCORE_NL_TOKEN = 12;
const SCORE_STRUCTURAL_ANCHOR = 55;
const SCORE_COMPONENT_NAME = 70;

/** Minimum token-overlap ratio for fuzzy data-tn matching. */
const FUZZY_TN_TOKEN_OVERLAP = 0.55;
/** Max edit distance (as fraction of shorter string) for fuzzy data-tn. */
const FUZZY_TN_EDIT_RATIO = 0.25;

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
  /** Distinctive strings from inserted/swapped HTML for content search. */
  contentSnippets: string[];
  /** Component registry names from swapElement patches. */
  componentNames: string[];
  /** Parent/anchor context for structural insertions. */
  structuralAnchors: Array<{
    parentTagName?: string;
    parentClassName?: string;
    childTagSummary?: string;
    position?: "before" | "after" | "inside";
    anchorTagName?: string;
  }>;
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

/** Split kebab/camel/snake data-tn values into searchable tokens. */
export const tokenizeTnValue = (
  value: string,
  minLen = MIN_DATA_TN_PART_LEN,
): string[] => {
  const withSpaces = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ");
  return [
    ...new Set(
      withSpaces
        .split(/\s+/)
        .map((part) => normalizeTnValue(part))
        .filter((part) => part.length >= minLen),
    ),
  ];
};

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
};

const tokenOverlapRatio = (a: string[], b: string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const overlap = a.filter((token) => setB.has(token)).length;
  return overlap / Math.max(a.length, b.length);
};

const TN_TOKEN_ALIASES: Record<string, string[]> = {
  btn: ["button"],
  btns: ["buttons"],
  img: ["image"],
  imgs: ["images"],
  nav: ["navigation"],
};

const expandTnToken = (token: string): string[] => {
  const aliases = TN_TOKEN_ALIASES[token] ?? [];
  return [token, ...aliases];
};

const tokensRoughlyMatch = (a: string, b: string): boolean => {
  for (const at of expandTnToken(a)) {
    for (const bt of expandTnToken(b)) {
      if (at === bt || at.includes(bt) || bt.includes(at)) return true;
      if (at.length >= 3 && bt.length >= 3 && (at.startsWith(bt) || bt.startsWith(at))) {
        return true;
      }
    }
  }
  return false;
};

const fuzzyTokenOverlap = (valueTokens: string[], partTokens: string[]): number => {
  if (partTokens.length === 0) return 0;
  let matched = 0;
  for (const partToken of partTokens) {
    if (valueTokens.some((valueToken) => tokensRoughlyMatch(valueToken, partToken))) {
      matched++;
    }
  }
  return matched / partTokens.length;
};

export const isFuzzyTnMatch = (rawValue: string, rawPart: string): boolean => {
  const normValue = normalizeTnValue(rawValue);
  const normPart = normalizeTnValue(rawPart);
  if (normValue.length < MIN_DATA_TN_PART_LEN || normPart.length < MIN_DATA_TN_PART_LEN) {
    return false;
  }

  if (normValue.includes(normPart) || normPart.includes(normValue)) {
    return true;
  }

  const valueTokens = tokenizeTnValue(rawValue, 3);
  const partTokens = tokenizeTnValue(rawPart, 3);
  if (fuzzyTokenOverlap(valueTokens, partTokens) >= FUZZY_TN_TOKEN_OVERLAP) {
    return true;
  }
  if (tokenOverlapRatio(valueTokens, partTokens) >= FUZZY_TN_TOKEN_OVERLAP) {
    return true;
  }

  if (normPart.length > normValue.length * 2) return false;

  const maxLen = Math.max(normValue.length, normPart.length);
  const dist = levenshteinDistance(normValue, normPart);
  return dist / maxLen <= FUZZY_TN_EDIT_RATIO;
};

const stripDirectdomCopySuffix = (value: string): string =>
  value.replace(/-directdom-copy$/i, "");

/** Extract searchable text/class/tag snippets from rendered HTML. */
export const extractContentSnippets = (html: string | undefined): string[] => {
  if (!html?.trim()) return [];
  const snippets = new Set<string>();

  for (const match of html.matchAll(/>([^<]{3,80})</g)) {
    const text = match[1].trim();
    if (text && !/^\s*$/.test(text)) snippets.add(text);
  }

  for (const match of html.matchAll(/\bclass=["']([^"']+)["']/gi)) {
    for (const cls of match[1].split(/\s+/)) {
      const token = stripDibsCssPrefix(cls);
      if (token.length >= 3 && !LOW_SIGNAL_CLASS_TOKENS.has(token)) {
        snippets.add(token);
      }
    }
  }

  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b/gi)) {
    const tag = match[1].toLowerCase();
    if (!["div", "span", "section", "article"].includes(tag)) {
      snippets.add(tag);
    }
  }

  return [...snippets];
};

const pushDataAttr = (
  attrs: Array<{ name: string; value: string }>,
  name: string,
  value: string | undefined,
): void => {
  if (!value) return;
  const cleaned = stripDirectdomCopySuffix(value);
  if (!cleaned || attrs.some((a) => a.value === cleaned)) return;
  attrs.push({ name, value: cleaned });
};

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
): "exact" | "partial" | "fuzzy" | null => {
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

  let best: "partial" | "fuzzy" | null = null;

  for (const part of extractDataTnStaticParts(content)) {
    const normPart = normalizeTnValue(part);
    if (normPart.length < MIN_DATA_TN_PART_LEN) continue;

    if (normValue.includes(normPart)) {
      best = "partial";
      continue;
    }

    if (!best && isFuzzyTnMatch(value, part)) {
      best = "fuzzy";
    }
  }

  return best;
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
  const contentSnippets = new Set<string>();
  const componentNames = new Set<string>();
  const structuralAnchors: SearchSignals["structuralAnchors"] = [];

  for (const change of ledger) {
    const patch = change.patch;

    if (patch.type === "insertElement" && change.anchor) {
      for (const hint of parseFiberHints(change.anchor.reactFiberHint)) {
        fiberHints.add(hint);
      }
      for (const attr of extractDataAttrs(change.anchor.selector)) {
        pushDataAttr(dataAttrs, attr.name, attr.value);
      }
    }

    if (patch.type !== "insertElement") {
      for (const hint of parseFiberHints(change.target.reactFiberHint)) {
        fiberHints.add(hint);
      }
      for (const attr of extractDataAttrs(change.target.selector)) {
        pushDataAttr(dataAttrs, attr.name, attr.value);
      }
    }

    for (const attrName of ["data-tn", "data-testid"] as const) {
      pushDataAttr(dataAttrs, attrName, change.before.attributes?.[attrName]);
      if (patch.type === "insertElement") {
        pushDataAttr(dataAttrs, attrName, change.after.attributes?.[attrName]);
      }
    }

    if (patch.type === "insertElement") {
      structuralAnchors.push({
        parentTagName: change.before.parentTagName,
        parentClassName: change.before.parentClassName,
        childTagSummary: change.before.childTagSummary,
        position: patch.position,
        anchorTagName: change.before.tagName,
      });

      for (const snippet of extractContentSnippets(patch.html)) {
        contentSnippets.add(snippet);
      }
      for (const snippet of extractContentSnippets(change.after.outerHTML)) {
        contentSnippets.add(snippet);
      }
      for (const snippet of extractContentSnippets(change.after.innerHTML)) {
        contentSnippets.add(snippet);
      }
    }

    if (patch.type === "swapElement") {
      componentNames.add(patch.componentName);
      for (const snippet of extractContentSnippets(patch.html)) {
        contentSnippets.add(snippet);
      }
      for (const snippet of extractContentSnippets(change.after.outerHTML)) {
        contentSnippets.add(snippet);
      }
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
    contentSnippets: [...contentSnippets],
    componentNames: [...componentNames],
    structuralAnchors,
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
    } else if (match === "fuzzy") {
      contentScore += SCORE_DATA_ATTR_FUZZY;
    }
  }

  for (const text of signals.texts) {
    if (content.includes(text)) {
      contentScore += SCORE_TEXT;
    } else if (text.length >= MIN_TEXT_LEN + 2) {
      const normText = text.toLowerCase();
      const normContent = contentLower;
      if (
        normContent.includes(normText.slice(0, Math.max(MIN_TEXT_LEN, Math.floor(normText.length * 0.7)))) ||
        signals.nlPhrases.some((phrase) => normContent.includes(phrase) && normText.includes(phrase))
      ) {
        contentScore += SCORE_TEXT_PARTIAL;
      }
    }
  }

  for (const snippet of signals.contentSnippets) {
    if (snippet.length < MIN_TEXT_LEN) continue;
    if (content.includes(snippet)) {
      contentScore += SCORE_CONTENT_SNIPPET;
    } else if (
      contentLower.includes(snippet.toLowerCase()) ||
      content.includes(`dibsCss.${snippet}`)
    ) {
      contentScore += SCORE_CONTENT_SNIPPET_PARTIAL;
    }
  }

  for (const name of signals.componentNames) {
    if (
      content.includes(`<${name}`) ||
      content.includes(`<${name} `) ||
      content.includes(`import { ${name}`) ||
      content.includes(`import ${name}`) ||
      hasFiberExport(content, name)
    ) {
      contentScore += SCORE_COMPONENT_NAME;
    } else if (content.includes(name)) {
      contentScore += SCORE_FIBER_PARTIAL;
    }
  }

  for (const anchor of signals.structuralAnchors) {
    if (anchor.parentTagName && content.includes(`<${anchor.parentTagName.toLowerCase()}`)) {
      contentScore += SCORE_STRUCTURAL_ANCHOR / 3;
    }
    if (anchor.childTagSummary) {
      for (const tag of anchor.childTagSummary.split(/[,\s]+/).filter(Boolean)) {
        if (content.includes(`<${tag.toLowerCase()}`)) {
          contentScore += SCORE_STRUCTURAL_ANCHOR / 4;
        }
      }
    }
    for (const token of extractClassTokens(anchor.parentClassName)) {
      if (
        content.includes(`dibsCss.${token}`) ||
        content.includes(`styles.${token}`)
      ) {
        contentScore += SCORE_CLASS_TOKEN;
      }
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
  signals.nlTokens.length > 0 ||
  signals.contentSnippets.length > 0 ||
  signals.componentNames.length > 0 ||
  signals.structuralAnchors.length > 0;

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
export type StructuralCodegenHint = {
  changeId: string;
  operation: "insertElement" | "swapElement";
  position?: "before" | "after" | "inside";
  mode?: "clone" | "html";
  anchorSelector?: string;
  anchorFiberHint?: string;
  anchorTagName?: string;
  parentTagName?: string;
  parentClassName?: string;
  childTagSummary?: string;
  componentName?: string;
  newElementPreview?: string;
  intent: string;
};

/** Summarize structural ledger entries for codegen LLM injection context. */
export const buildStructuralCodegenHints = (
  ledger: ChangeRecord[],
): StructuralCodegenHint[] =>
  ledger
    .filter(
      (change): change is ChangeRecord & { patch: { type: "insertElement" | "swapElement" } } =>
        change.patch.type === "insertElement" ||
        change.patch.type === "swapElement",
    )
    .map((change) => {
      const base = {
        changeId: change.id,
        operation: change.patch.type,
        intent: change.intent,
        parentTagName: change.before.parentTagName,
        parentClassName: change.before.parentClassName,
        childTagSummary: change.before.childTagSummary,
        anchorTagName: change.before.tagName,
        anchorSelector: change.anchor?.selector,
        anchorFiberHint: change.anchor?.reactFiberHint,
      };

      if (change.patch.type === "insertElement") {
        return {
          ...base,
          position: change.patch.position,
          mode: change.patch.mode,
          newElementPreview: (
            change.patch.html ??
            change.after.outerHTML ??
            change.after.innerHTML
          )?.slice(0, 600),
        };
      }

      return {
        ...base,
        componentName: change.patch.componentName,
        newElementPreview: (
          change.patch.html ?? change.after.outerHTML
        )?.slice(0, 600),
      };
    });

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
    `[codegen] search signals: fiber=[${signals.fiberHints.join(", ")}] dataAttrs=${signals.dataAttrs.length} texts=${signals.texts.length} classTokens=[${signals.classTokens.slice(0, 8).join(", ")}] contentSnippets=[${signals.contentSnippets.slice(0, 6).join(", ")}] components=[${signals.componentNames.join(", ")}] structuralAnchors=${signals.structuralAnchors.length} nlPhrases=[${signals.nlPhrases.slice(0, 6).join(", ")}] segments=[${signals.pathSegments.join(", ")}]`,
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
