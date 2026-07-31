import { describe, expect, it } from "vitest";
import {
  cssDeclarationToInlineStyle,
  extractDibsCssClassNamesFromText,
  getDibsCssClassCategory,
  normalizeDibsCssClassNames,
  rankClassNamesForMessage,
  resolveClassNameConflicts,
  resolveClassNamesToAllowlist,
  stripDibsCssPrefix,
  toDibsCssDomClass,
} from "./dibs-css.js";

describe("dibs-css helpers", () => {
  it("adds dc- prefix for DOM classes", () => {
    expect(toDibsCssDomClass("textBlue600")).toBe("dc-textBlue600");
    expect(toDibsCssDomClass("dc-textBlue600")).toBe("dc-textBlue600");
  });

  it("normalizes class lists", () => {
    expect(normalizeDibsCssClassNames("flex textBlue600 dc-bgBlue50")).toBe(
      "dc-flex dc-textBlue600 dc-bgBlue50",
    );
  });

  it("strips dc- prefix", () => {
    expect(stripDibsCssPrefix("dc-textBlue600")).toBe("textBlue600");
  });

  it("categorizes dibs-css classes for conflict detection", () => {
    expect(getDibsCssClassCategory("dc-textBlue600")).toBe("text");
    expect(getDibsCssClassCategory("dc-textGray800")).toBe("text");
    expect(getDibsCssClassCategory("dc-bgBlue50")).toBe("bg");
    expect(getDibsCssClassCategory("dc-p4")).toBe("p");
  });

  it("replaces conflicting classes when merging", () => {
    expect(
      resolveClassNameConflicts(
        "dc-flex dc-textGray800 dc-p4",
        "dc-textBlue600",
      ),
    ).toBe("dc-flex dc-p4 dc-textBlue600");
  });

  it("extracts explicit dibs-css class names from text", () => {
    expect(extractDibsCssClassNamesFromText("use dc-textBlue600")).toEqual([
      "textBlue600",
    ]);
    expect(extractDibsCssClassNamesFromText("change to text-blue-700")).toEqual(
      ["textBlue700"],
    );
  });

  it("ranks MCP matches using message context", () => {
    const ranked = rankClassNamesForMessage("use dealer primary color", [
      "textBlue600",
      "textDealerprimary",
    ]);
    expect(ranked[0]).toBe("textDealerprimary");
  });

  it("parses MCP CSS declarations into inline style records", () => {
    expect(cssDeclarationToInlineStyle("color: #436b93")).toEqual({
      color: "#436b93",
    });
    expect(cssDeclarationToInlineStyle("background-color: #fff")).toEqual({
      backgroundColor: "#fff",
    });
  });

  it("does not guess an unrelated class when shade is missing from allowlist", () => {
    const result = resolveClassNamesToAllowlist("textBlue500", [
      "textBlue600",
      "textBlue700",
    ]);
    expect(result.unresolved).toContain("textBlue500");
    expect(result.resolved).toBe("");
  });
});
