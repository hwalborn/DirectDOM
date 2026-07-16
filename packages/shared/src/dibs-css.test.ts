import { describe, expect, it } from "vitest";
import {
  getDibsCssClassCategory,
  normalizeDibsCssClassNames,
  resolveClassNameConflicts,
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
});
