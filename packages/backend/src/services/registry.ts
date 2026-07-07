import type { ComponentRegistry } from "@directdom/shared";
import registryData from "../data/component-registry.json" with { type: "json" };

export const getRegistry = (): ComponentRegistry => registryData as ComponentRegistry;

export const findComponentByStoryId = (storyId: string) =>
  getRegistry().components.find((c) => c.storybookId === storyId);

export const isAllowedTailwindClass = (className: string): boolean => {
  const allowlist = getRegistry().tailwindAllowlist ?? [];
  if (allowlist.length === 0) return true;
  return className.split(/\s+/).every((cls) => {
    if (!cls) return true;
    return allowlist.some(
      (allowed) => cls === allowed || cls.startsWith(allowed.replace("*", "")),
    );
  });
};
