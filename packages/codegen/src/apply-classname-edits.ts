import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangeRecord } from "@directdom/shared";
import {
  getDibsCssClassCategory,
  stripDibsCssPrefix,
} from "@directdom/shared";
import { extractClassTokens, findCandidateFiles } from "./find-candidates.js";

export type ClassNameTokenSwap = {
  from: string;
  to: string;
};

/**
 * For a className merge patch, map replaced before-tokens → incoming tokens
 * when they share a dibs-css conflict category (e.g. textSatan → textBlue600).
 */
export const planClassNameTokenSwaps = (
  change: ChangeRecord,
): ClassNameTokenSwap[] => {
  if (change.patch.type !== "className") return [];

  const beforeTokens = (change.before.className ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map(stripDibsCssPrefix);
  const incomingTokens = change.patch.value
    .split(/\s+/)
    .filter(Boolean)
    .map(stripDibsCssPrefix);

  if (incomingTokens.length === 0) return [];

  const swaps: ClassNameTokenSwap[] = [];
  const usedBefore = new Set<string>();

  for (const incoming of incomingTokens) {
    const category = getDibsCssClassCategory(incoming);
    const replaced = beforeTokens.find(
      (token) =>
        !usedBefore.has(token) &&
        token !== incoming &&
        getDibsCssClassCategory(token) === category,
    );
    if (!replaced) continue;
    usedBefore.add(replaced);
    swaps.push({ from: replaced, to: incoming });
  }

  return swaps;
};

const applySwapsToContent = (
  content: string,
  swaps: ClassNameTokenSwap[],
): { content: string; replacements: number } => {
  let next = content;
  let replacements = 0;

  for (const { from, to } of swaps) {
    const patterns = [
      `dibsCss.${from}`,
      `styles.${from}`,
    ];
    for (const pattern of patterns) {
      if (!next.includes(pattern)) continue;
      const replacement = pattern.startsWith("dibsCss.")
        ? `dibsCss.${to}`
        : `styles.${to}`;
      const parts = next.split(pattern);
      if (parts.length > 1) {
        replacements += parts.length - 1;
        next = parts.join(replacement);
      }
    }
  }

  return { content: next, replacements };
};

/**
 * Deterministically apply className ledger patches when we can locate a strong
 * candidate file and map before→after dibsCss tokens in the same category.
 */
export const applyClassNameEdits = (
  repoPath: string,
  ledger: ChangeRecord[],
  pageUrl?: string,
): string[] => {
  const classChanges = ledger.filter((r) => r.patch.type === "className");
  if (classChanges.length === 0) return [];

  const candidates = findCandidateFiles(repoPath, classChanges, {
    pageUrl,
    maxCandidates: 5,
  });

  if (candidates.length === 0) {
    console.warn("[codegen] applyClassNameEdits: no candidates");
    return [];
  }

  console.log(
    `[codegen] applyClassNameEdits candidates: ${candidates
      .map((c) => `${c.path}(${c.score})`)
      .join(", ")}`,
  );

  const modified = new Set<string>();

  for (const change of classChanges) {
    const swaps = planClassNameTokenSwaps(change);
    if (swaps.length === 0) {
      console.warn(
        `[codegen] applyClassNameEdits: no token swaps for intent="${change.intent}" (need same-category before→after classes)`,
      );
      continue;
    }

    let applied = false;
    for (const candidate of candidates) {
      const absPath = join(repoPath, candidate.path);
      let content: string;
      try {
        content = readFileSync(absPath, "utf-8");
      } catch {
        continue;
      }

      const { content: next, replacements } = applySwapsToContent(content, swaps);
      if (replacements === 0) continue;

      writeFileSync(absPath, next, "utf-8");
      modified.add(absPath);
      applied = true;
      console.log(
        `[codegen] applyClassNameEdits: ${replacements} swap(s) in ${candidate.path} (${swaps
          .map((s) => `${s.from}→${s.to}`)
          .join(", ")})`,
      );
      break;
    }

    if (!applied) {
      console.warn(
        `[codegen] applyClassNameEdits: swaps planned (${swaps
          .map((s) => `${s.from}→${s.to}`)
          .join(", ")}) but not found in candidate sources`,
      );
    }
  }

  return [...modified];
};

export { extractClassTokens };
