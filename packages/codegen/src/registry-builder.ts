import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ComponentRegistry, ComponentRegistryEntry } from "@directdom/shared";
import { parseDibsCssClasses, STORYBOOK_BASE_URL } from "@directdom/shared";

export const parseStoriesFromRepo = (repoPath: string): ComponentRegistryEntry[] => {
  const components: ComponentRegistryEntry[] = [];
  const srcPath = join(repoPath, "src");

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.match(/\.stories\.(tsx|ts|jsx|js)$/)) continue;

      const content = readFileSync(fullPath, "utf-8");
      const titleMatch = content.match(/title:\s*['"]([^'"]+)['"]/);
      const componentName = entry.replace(/\.stories\.(tsx|ts|jsx|js)$/, "");
      const storyId = titleMatch
        ? titleMatch[1].toLowerCase().replace(/\s+/g, "-").replace(/\//g, "-") +
          `--${componentName.toLowerCase()}`
        : componentName.toLowerCase();

      const relativePath = fullPath
        .replace(repoPath + "/", "")
        .replace(/\.stories\.(tsx|ts|jsx|js)$/, "");

      components.push({
        name: componentName,
        importPath: `@/${relativePath}`,
        storybookId: storyId,
        storybookUrl: `${STORYBOOK_BASE_URL}/?path=/docs/${storyId}`,
      });
    }
  };

  walk(srcPath);
  return components;
};

export const mergeRegistry = (
  base: ComponentRegistry,
  fromRepo: ComponentRegistryEntry[],
): ComponentRegistry => {
  const byName = new Map(base.components.map((c) => [c.name, c]));

  for (const entry of fromRepo) {
    if (!byName.has(entry.name)) {
      byName.set(entry.name, entry);
    }
  }

  return {
    ...base,
    components: Array.from(byName.values()),
  };
};

export const parseTailwindAllowlist = (configPath: string): string[] => {
  try {
    const content = readFileSync(configPath, "utf-8");
    const safelistMatch = content.match(/safelist:\s*\[([\s\S]*?)\]/);
    if (safelistMatch) {
      return safelistMatch[1]
        .match(/['"]([^'"]+)['"]/g)
        ?.map((s) => s.replace(/['"]/g, "")) ?? [];
    }
  } catch {
    // fall through
  }
  return [];
};

export const parseDibsCssClassesFromRepo = (repoPath: string): string[] => {
  const dtsPath = join(
    repoPath,
    "packages/dibs-css/exports/dibs-css.module.d.css.ts",
  );
  const content = readFileSync(dtsPath, "utf-8");
  return parseDibsCssClasses(content);
};
