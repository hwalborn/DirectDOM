import type { ComponentRegistry } from "@directdom/shared";
import registryData from "../data/component-registry.json" with { type: "json" };

export const getRegistry = (): ComponentRegistry =>
  registryData as ComponentRegistry;
