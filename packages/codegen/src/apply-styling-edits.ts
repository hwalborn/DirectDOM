import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangeRecord } from "@directdom/shared";
import {
  cssPropertyToKebabCase,
  cssValuesMatch,
  getDibsCssClassCategory,
} from "@directdom/shared";
import {
  pickModuleClassForDeclarations,
  parseCssRuleBlock,
  getCssRuleProperty,
  updateCssRuleProperties,
} from "./apply-css-module-edits.js";
import {
  buildClassNamesCallRe,
  detectComponentStyleContext,
  extractStyleAliasTokens,
} from "./component-style-context.js";
import { findCandidateFiles } from "./find-candidates.js";
import {
  applyInlineStyleToJsxContent,
} from "./apply-inline-style-to-jsx.js";
import { findTargetJsxStartLine } from "./jsx-source-location.js";
import {
  findSwappableBeforeToken,
  pickPrimaryIncomingClass,
  resolveStyleEditPlan,
} from "./resolve-styling-patch.js";

export type StylingEditResult = {
  modifiedPaths: string[];
  appliedChangeIds: string[];
};

export type ClassNameTokenSwap = {
  from: string;
  to: string;
};

const SINGLE_CLASSNAME_RE = /className=\{([^{}]+)\}/;

const applyAliasSwapsToContent = (
  content: string,
  alias: string,
  swaps: ClassNameTokenSwap[],
): { content: string; replacements: number } => {
  let next = content;
  let replacements = 0;

  for (const { from, to } of swaps) {
    const pattern = `${alias}.${from}`;
    if (!next.includes(pattern)) continue;
    const parts = next.split(pattern);
    replacements += parts.length - 1;
    next = parts.join(`${alias}.${to}`);
  }

  return { content: next, replacements };
};

const addAliasClassToContent = (
  content: string,
  alias: string,
  className: string,
  classNamesAlias: string | null,
): { content: string; replacements: number } => {
  const token = `${alias}.${className}`;
  if (content.includes(token)) {
    return { content, replacements: 0 };
  }

  if (classNamesAlias) {
    const classNamesCallRe = buildClassNamesCallRe(classNamesAlias);
    const classNamesMatch = content.match(classNamesCallRe);
    if (classNamesMatch?.[1] !== undefined) {
      const insertion = classNamesMatch[1].trim().endsWith(",")
        ? ` ${token}`
        : `, ${token}`;
      const next = content.replace(
        classNamesCallRe,
        `${classNamesAlias}(${classNamesMatch[1]}${insertion})`,
      );
      return { content: next, replacements: 1 };
    }
  }

  const singleMatch = content.match(SINGLE_CLASSNAME_RE);
  if (singleMatch?.[1]?.includes(`${alias}.`)) {
    const wrapAlias = classNamesAlias ?? "classNames";
    const next = content.replace(
      SINGLE_CLASSNAME_RE,
      `className={${wrapAlias}(${singleMatch[1].trim()}, ${token})}`,
    );
    return { content: next, replacements: 1 };
  }

  return { content, replacements: 0 };
};

export const planTokenSwaps = (
  change: ChangeRecord,
  repoPath: string,
): ClassNameTokenSwap[] => {
  const plan = resolveStyleEditPlan(change, repoPath);
  if (!plan) return [];

  const incoming = pickPrimaryIncomingClass(plan, change.intent);
  if (!incoming) return [];

  const from = findSwappableBeforeToken(plan, incoming);
  if (!from) return [];

  return [{ from, to: incoming }];
};

const planClassAdditions = (
  change: ChangeRecord,
  repoPath: string,
): string[] => {
  const plan = resolveStyleEditPlan(change, repoPath);
  if (!plan) return [];

  const incoming = pickPrimaryIncomingClass(plan, change.intent);
  if (!incoming) return [];

  const from = findSwappableBeforeToken(plan, incoming);
  if (from) return [];

  return [incoming];
};

const isStylingChange = (change: ChangeRecord): boolean =>
  change.patch.type === "className" ||
  change.patch.type === "inlineStyle";

const applyModulePropertyUpdates = (
  repoPath: string,
  componentPath: string,
  componentContent: string,
  change: ChangeRecord,
  plan: NonNullable<ReturnType<typeof resolveStyleEditPlan>>,
): string[] => {
  if (Object.keys(plan.inlineDeclarations).length === 0) return [];

  const context = detectComponentStyleContext(
    repoPath,
    componentPath,
    componentContent,
  );
  const modified = new Set<string>();

  for (const cssModule of context.cssModules) {
    let cssContent: string;
    try {
      cssContent = readFileSync(cssModule.absolutePath, "utf-8");
    } catch {
      continue;
    }

    const moduleTokens = extractStyleAliasTokens(
      componentContent,
      cssModule.alias,
    );
    if (moduleTokens.length === 0) continue;

    const relevantTokens = moduleTokens.filter((token) => {
      const category = getDibsCssClassCategory(token);
      return plan.beforeTokens.some(
        (beforeToken) => getDibsCssClassCategory(beforeToken) === category,
      );
    });

    const targetTokens =
      relevantTokens.length > 0 ? relevantTokens : moduleTokens;

    const className = pickModuleClassForDeclarations(
      cssContent,
      targetTokens,
      plan.inlineDeclarations,
      change.before.computedStyles,
    );
    if (!className) continue;

    const kebabDeclarations = Object.fromEntries(
      Object.entries(plan.inlineDeclarations).map(([property, value]) => [
        cssPropertyToKebabCase(property),
        value,
      ]),
    );

    const updated = updateCssRuleProperties(
      cssContent,
      className,
      kebabDeclarations,
    );
    if (!updated || updated.replacements === 0) continue;

    writeFileSync(cssModule.absolutePath, updated.content, "utf-8");
    modified.add(cssModule.absolutePath);
    console.log(
      `[codegen] applyStylingEdits: updated ${cssModule.relativePath} .${className} (${Object.keys(kebabDeclarations).join(", ")})`,
    );
  }

  return [...modified];
};

const moduleControlsInlineDeclarations = (
  cssContent: string,
  moduleTokens: string[],
  declarations: Record<string, string>,
  beforeComputed?: Record<string, string | undefined>,
): boolean => {
  for (const token of moduleTokens) {
    const block = parseCssRuleBlock(cssContent, token);
    if (!block) continue;

    for (const [property, value] of Object.entries(declarations)) {
      const kebab = cssPropertyToKebabCase(property);
      const existing = getCssRuleProperty(block.body, kebab);
      if (existing === null) continue;

      const beforeValue = beforeComputed?.[property];
      if (!beforeValue || cssValuesMatch(existing, beforeValue)) {
        return true;
      }
      if (cssValuesMatch(existing, value)) {
        return true;
      }
    }
  }

  return false;
};

const shouldPreferModuleCss = (
  context: ReturnType<typeof detectComponentStyleContext>,
  componentContent: string,
  plan: NonNullable<ReturnType<typeof resolveStyleEditPlan>>,
  change: ChangeRecord,
): boolean => {
  if (context.cssModules.length === 0) return false;
  if (!context.usesDibsCss) return true;

  for (const cssModule of context.cssModules) {
    let cssContent: string;
    try {
      cssContent = readFileSync(cssModule.absolutePath, "utf-8");
    } catch {
      continue;
    }

    const moduleTokens = extractStyleAliasTokens(
      componentContent,
      cssModule.alias,
    );
    if (moduleTokens.length === 0) continue;

    if (
      moduleControlsInlineDeclarations(
        cssContent,
        moduleTokens,
        plan.inlineDeclarations,
        change.before.computedStyles,
      )
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Apply styling ledger changes to ferrum source: dibsCss token swaps/additions,
 * CSS module property updates when a .module.css file controls the style, or
 * inline style={{ ... }} on the JSX element when no dibs-css class applies.
 */
export const applyStylingEdits = (
  repoPath: string,
  ledger: ChangeRecord[],
  pageUrl?: string,
): StylingEditResult => {
  const stylingChanges = ledger.filter(isStylingChange);
  if (stylingChanges.length === 0) {
    return { modifiedPaths: [], appliedChangeIds: [] };
  }

  const candidates = findCandidateFiles(repoPath, stylingChanges, {
    pageUrl,
    maxCandidates: 5,
  });

  if (candidates.length === 0) {
    console.warn("[codegen] applyStylingEdits: no candidates");
    return { modifiedPaths: [], appliedChangeIds: [] };
  }

  console.log(
    `[codegen] applyStylingEdits candidates: ${candidates
      .map((candidate) => `${candidate.path}(${candidate.score})`)
      .join(", ")}`,
  );

  const modified = new Set<string>();
  const appliedChangeIds: string[] = [];

  for (const change of stylingChanges) {
    const plan = resolveStyleEditPlan(change, repoPath);
    if (!plan) continue;

    const swaps = planTokenSwaps(change, repoPath);
    const additions = planClassAdditions(change, repoPath);
    const isCustomInlinePatch =
      change.patch.type === "inlineStyle" && !change.patch.sourceClassName;
    let applied = false;

    for (const candidate of candidates) {
      const absPath = join(repoPath, candidate.path);
      let content: string;
      try {
        content = readFileSync(absPath, "utf-8");
      } catch {
        continue;
      }

      if (!findTargetJsxStartLine(content, change, candidate.path)) {
        continue;
      }

      const context = detectComponentStyleContext(
        repoPath,
        candidate.path,
        content,
      );

      if (isCustomInlinePatch) {
        const inlineStyled = applyInlineStyleToJsxContent(
          content,
          change,
          candidate.path,
          plan.inlineDeclarations,
        );
        if (inlineStyled.replacements > 0) {
          writeFileSync(absPath, inlineStyled.content, "utf-8");
          modified.add(absPath);
          applied = true;
          console.log(
            `[codegen] applyStylingEdits: added inline style in ${candidate.path} (${Object.entries(plan.inlineDeclarations)
              .map(([property, value]) => `${property}: ${value}`)
              .join(", ")})`,
          );
        }
        if (applied) break;
        continue;
      }

      if (
        shouldPreferModuleCss(context, content, plan, change) &&
        Object.keys(plan.inlineDeclarations).length > 0
      ) {
        const moduleModified = applyModulePropertyUpdates(
          repoPath,
          candidate.path,
          content,
          change,
          plan,
        );
        for (const file of moduleModified) {
          modified.add(file);
          applied = true;
        }
        if (applied) break;
      }

      let replacements = 0;
      let next = content;

      if (context.usesDibsCss) {
        const alias = context.dibsCssAlias;
        if (swaps.length > 0) {
          const swapped = applyAliasSwapsToContent(next, alias, swaps);
          next = swapped.content;
          replacements += swapped.replacements;
        }

        for (const className of additions) {
          const added = addAliasClassToContent(
            next,
            alias,
            className,
            context.classNamesAlias,
          );
          next = added.content;
          replacements += added.replacements;
        }
      }

      for (const cssModule of context.cssModules) {
        if (swaps.length > 0) {
          const swapped = applyAliasSwapsToContent(
            next,
            cssModule.alias,
            swaps,
          );
          next = swapped.content;
          replacements += swapped.replacements;
        }
      }

      if (replacements > 0) {
        writeFileSync(absPath, next, "utf-8");
        modified.add(absPath);
        applied = true;
        console.log(
          `[codegen] applyStylingEdits: ${replacements} update(s) in ${candidate.path} (${[
            ...swaps.map((swap) => `${swap.from}→${swap.to}`),
            ...additions.map((className) => `+${className}`),
          ].join(", ")})`,
        );
      }

      if (
        !applied &&
        !isCustomInlinePatch &&
        context.cssModules.length > 0 &&
        Object.keys(plan.inlineDeclarations).length > 0
      ) {
        const moduleModified = applyModulePropertyUpdates(
          repoPath,
          candidate.path,
          content,
          change,
          plan,
        );
        for (const file of moduleModified) {
          modified.add(file);
          applied = true;
        }
      }

      if (applied) break;
    }

    if (applied) {
      appliedChangeIds.push(change.id);
    } else {
      console.warn(
        `[codegen] applyStylingEdits: could not apply intent="${change.intent}"`,
      );
    }
  }

  return {
    modifiedPaths: [...modified],
    appliedChangeIds,
  };
};

/** @deprecated Use applyStylingEdits */
export const applyClassNameEdits = applyStylingEdits;
