import { describe, expect, it } from "vitest";
import {
  filterRelevantDibsCssClasses,
  getDibsCssClassCategory,
  normalizeDibsCssClassNames,
  parseDibsCssClasses,
  resolveClassNameConflicts,
  stripDibsCssPrefix,
  toDibsCssDomClass,
} from "./dibs-css.js";

const SAMPLE_DTS = `
type css = {
    flex: string;
    textBlue600: string;
    bgBlue50: string;
    p4: string;
};
`;

describe("dibs-css helpers", () => {
  it("parses class keys from d.ts", () => {
    expect(parseDibsCssClasses(SAMPLE_DTS)).toEqual([
      "flex",
      "textBlue600",
      "bgBlue50",
      "p4",
    ]);
  });

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

  it("filters relevant classes from message and snapshot", () => {
    const classes = ["textBlue600", "bgBlue50", "flex", "hidden"];
    const relevant = filterRelevantDibsCssClasses({
      classes,
      message: "make the text blue",
      currentClassNames: "dc-flex dc-textBlue600",
    });

    expect(relevant).toContain("textBlue600");
    expect(relevant).toContain("flex");
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
});
