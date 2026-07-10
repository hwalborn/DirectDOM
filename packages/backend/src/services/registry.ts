import type { ComponentRegistry } from "@directdom/shared";
import {
  normalizeDibsCssClassNames,
  stripDibsCssPrefix,
  toDibsCssDomClass,
} from "@directdom/shared";
import registryData from "../data/component-registry.json" with { type: "json" };

export const getRegistry = (): ComponentRegistry => registryData as ComponentRegistry;

export const findComponentByStoryId = (storyId: string) =>
  getRegistry().components.find((c) => c.storybookId === storyId);

export const getDibsCssClassKeys = (): string[] =>
  getRegistry().dibsCssClasses ?? [];

export const isAllowedDibsCssClass = (className: string): boolean => {
  const allowlist = getDibsCssClassKeys();
  if (allowlist.length === 0) return true;

  const key = stripDibsCssPrefix(className);
  return allowlist.includes(key);
};

export const isAllowedDibsCssClassNames = (classNames: string): boolean =>
  classNames
    .split(/\s+/)
    .filter(Boolean)
    .every(isAllowedDibsCssClass);

export const formatDibsCssClassesForDom = (classNames: string): string =>
  normalizeDibsCssClassNames(classNames);

export const formatDibsCssClassForPrompt = (classKey: string): string =>
  toDibsCssDomClass(classKey);
