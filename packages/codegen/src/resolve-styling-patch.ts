import type { ChangeRecord } from "@directdom/shared";
import {
  getDibsCssClassCategory,
  inlineStyleRecordToCssDeclarations,
  stripDibsCssPrefix,
} from "@directdom/shared";
import {
  lookupDibsCssClassesByDeclarations,
  lookupDibsCssMatches,
} from "@directdom/shared/dibs-css-lookup";

export type StyleEditPlan = {
  incomingClasses: string[];
  inlineDeclarations: Record<string, string>;
  beforeTokens: string[];
};

const isStylingPatch = (change: ChangeRecord): boolean => {
  if (change.patch.type === "className") return true;
  if (change.patch.type === "inlineStyle") {
    return Object.keys(change.patch.value).length > 0;
  }
  return false;
};

const resolveIncomingClasses = (
  change: ChangeRecord,
  repoPath: string,
): string[] => {
  const patch = change.patch;
  const classes = new Set<string>();

  if (patch.type === "inlineStyle") {
    if (patch.sourceClassName) {
      classes.add(patch.sourceClassName);
    }

    const declarations = inlineStyleRecordToCssDeclarations(patch.value);
    for (const className of lookupDibsCssClassesByDeclarations(
      repoPath,
      declarations,
    )) {
      classes.add(className);
    }
  }

  if (patch.type === "className") {
    for (const token of patch.value.split(/\s+/).filter(Boolean)) {
      classes.add(stripDibsCssPrefix(token));
    }
  }

  return [...classes];
};

export const resolveStyleEditPlan = (
  change: ChangeRecord,
  repoPath: string,
): StyleEditPlan | null => {
  if (!isStylingPatch(change)) return null;

  const patch = change.patch;
  const beforeTokens = (change.before.className ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map(stripDibsCssPrefix);

  const incomingClasses = resolveIncomingClasses(change, repoPath);
  const inlineDeclarations =
    patch.type === "inlineStyle" ? { ...patch.value } : {};

  if (incomingClasses.length === 0 && Object.keys(inlineDeclarations).length === 0) {
    return null;
  }

  if (incomingClasses.length === 0 && Object.keys(inlineDeclarations).length > 0) {
    const declarations = inlineStyleRecordToCssDeclarations(inlineDeclarations);
    for (const className of lookupDibsCssClassesByDeclarations(
      repoPath,
      declarations,
    )) {
      incomingClasses.push(className);
    }
  }

  return {
    incomingClasses,
    inlineDeclarations,
    beforeTokens,
  };
};

export const pickPrimaryIncomingClass = (
  plan: StyleEditPlan,
  message?: string,
): string | null => {
  if (plan.incomingClasses.length === 0) return null;

  const lower = (message ?? "").toLowerCase();
  const ranked = [...plan.incomingClasses].sort((left, right) => {
    let leftScore = 0;
    let rightScore = 0;
    if (lower.includes(left.toLowerCase())) leftScore += 10;
    if (lower.includes(right.toLowerCase())) rightScore += 10;
    return rightScore - leftScore;
  });

  return ranked[0] ?? null;
};

export const findSwappableBeforeToken = (
  plan: StyleEditPlan,
  incomingClass: string,
): string | null => {
  const incomingCategory = getDibsCssClassCategory(incomingClass);

  return (
    plan.beforeTokens.find(
      (token) =>
        token !== incomingClass &&
        getDibsCssClassCategory(token) === incomingCategory,
    ) ?? null
  );
};

export const getDeclarationsForClass = (
  repoPath: string,
  className: string,
): Record<string, string> => {
  const matches = lookupDibsCssMatches(repoPath, [className]);
  const declarations: Record<string, string> = {};

  for (const match of matches) {
    const colon = match.originalCSS.indexOf(":");
    if (colon === -1) continue;
    const property = match.originalCSS.slice(0, colon).trim();
    const value = match.originalCSS
      .slice(colon + 1)
      .trim()
      .replace(/;$/, "");
    if (property) declarations[property] = value;
  }

  return declarations;
};
