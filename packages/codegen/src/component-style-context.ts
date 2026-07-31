import { dirname, join, resolve } from "node:path";

export type CssModuleImport = {
  alias: string;
  importPath: string;
  absolutePath: string;
  relativePath: string;
};

export type ComponentStyleContext = {
  usesDibsCss: boolean;
  dibsCssAlias: string;
  /** Local binding for `import <name> from "classnames"` (e.g. classNames, classnames, cn). */
  classNamesAlias: string | null;
  cssModules: CssModuleImport[];
  /** styles.* tokens referenced in the component source */
  styleClassTokens: string[];
};

const DIBS_CSS_IMPORT_RE = /import\s+(dibsCss)\s+from\s+["']dibs-css["']/;
const CLASSNAMES_IMPORT_RE = /import\s+(\w+)\s+from\s+["']classnames["']/;
const CSS_MODULE_IMPORT_RE =
  /import\s+(\w+)\s+from\s+["']([^"']+\.module\.css)["']/g;
const STYLE_TOKEN_RE = /styles\.([A-Za-z_][\w]*)/g;

const relativeFromRepo = (repoPath: string, absolutePath: string): string =>
  absolutePath.replace(`${repoPath}/`, "").replace(/\\/g, "/");

/** Build a regex that matches `alias(...)` calls for the detected classnames import. */
export const buildClassNamesCallRe = (alias: string): RegExp =>
  new RegExp(`\\b${alias}\\s*\\(([^)]*)\\)`);

export const detectComponentStyleContext = (
  repoPath: string,
  componentRelativePath: string,
  content: string,
): ComponentStyleContext => {
  const dibsMatch = content.match(DIBS_CSS_IMPORT_RE);
  const classNamesMatch = content.match(CLASSNAMES_IMPORT_RE);
  const cssModules: CssModuleImport[] = [];
  const componentDir = dirname(join(repoPath, componentRelativePath));

  for (const match of content.matchAll(CSS_MODULE_IMPORT_RE)) {
    const alias = match[1];
    const importPath = match[2];
    if (!alias || !importPath) continue;

    const absolutePath = resolve(componentDir, importPath);
    cssModules.push({
      alias,
      importPath,
      absolutePath,
      relativePath: relativeFromRepo(repoPath, absolutePath),
    });
  }

  const styleClassTokens = new Set<string>();
  for (const match of content.matchAll(STYLE_TOKEN_RE)) {
    if (match[1]) styleClassTokens.add(match[1]);
  }

  return {
    usesDibsCss: Boolean(dibsMatch),
    dibsCssAlias: dibsMatch?.[1] ?? "dibsCss",
    classNamesAlias: classNamesMatch?.[1] ?? null,
    cssModules,
    styleClassTokens: [...styleClassTokens],
  };
};

export const extractStyleAliasTokens = (
  content: string,
  alias: string,
): string[] => {
  const tokens = new Set<string>();
  const pattern = new RegExp(`\\b${alias}\\.([A-Za-z_][\\w]*)`, "g");
  for (const match of content.matchAll(pattern)) {
    if (match[1]) tokens.add(match[1]);
  }
  return [...tokens];
};
