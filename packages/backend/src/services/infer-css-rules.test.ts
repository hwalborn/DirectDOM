import { describe, expect, it } from "vitest";
import { inferCssRulesFromMessage } from "./infer-css-rules.js";

describe("inferCssRulesFromMessage", () => {
  it("extracts explicit CSS rules", () => {
    expect(inferCssRulesFromMessage("set display: flex and opacity: 0.5")).toEqual(
      expect.arrayContaining(["display: flex", "opacity: 0.5"]),
    );
  });

  it("maps named colors to dibs hex candidates", () => {
    const rules = inferCssRulesFromMessage("change the color to blue");
    expect(rules.some((rule) => rule.startsWith("color:"))).toBe(true);
  });

  it("maps layout intents", () => {
    expect(inferCssRulesFromMessage("make this a flex row")).toEqual(
      expect.arrayContaining(["display: flex", "flex-direction: row"]),
    );
  });
});
