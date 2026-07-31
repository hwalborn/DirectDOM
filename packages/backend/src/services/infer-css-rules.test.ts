import { describe, expect, it } from "vitest";
import {
  inferCssRulesFromMessage,
  inferDibsCssClassNamesFromMessage,
} from "./infer-css-rules.js";

describe("inferCssRulesFromMessage", () => {
  it("extracts explicit CSS rules", () => {
    expect(inferCssRulesFromMessage("set display: flex and opacity: 0.5")).toEqual(
      expect.arrayContaining(["display: flex", "opacity: 0.5"]),
    );
  });

  it("maps named colors to a single dibs hex candidate", () => {
    const rules = inferCssRulesFromMessage("change the color to blue");
    expect(rules).toEqual(["color: #436b93"]);
  });

  it("extracts explicit dibs-css class names from the message", () => {
    expect(inferDibsCssClassNamesFromMessage("apply textBlue600")).toEqual([
      "textBlue600",
    ]);
    expect(
      inferDibsCssClassNamesFromMessage("use dealer primary color"),
    ).toEqual(["textDealerprimary"]);
  });

  it("maps layout intents", () => {
    expect(inferCssRulesFromMessage("make this a flex row")).toEqual(
      expect.arrayContaining(["display: flex", "flex-direction: row"]),
    );
  });
});
