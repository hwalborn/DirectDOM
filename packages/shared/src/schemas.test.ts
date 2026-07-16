import { describe, expect, it } from "vitest";
import { normalizeDomPatch, parseDomPatch } from "./schemas.js";

describe("normalizeDomPatch", () => {
  it("maps text alias to textContent", () => {
    expect(normalizeDomPatch({ type: "text", value: "Hello" })).toEqual({
      type: "textContent",
      value: "Hello",
    });
  });

  it("maps style alias with string value to className", () => {
    expect(
      normalizeDomPatch({ type: "style", value: "text-blue-500" }),
    ).toEqual({
      type: "className",
      value: "text-blue-500",
    });
  });

  it("maps style alias with object value to inlineStyle", () => {
    expect(
      normalizeDomPatch({ type: "style", value: { color: "#ff0000" } }),
    ).toEqual({
      type: "inlineStyle",
      value: { color: "#ff0000" },
    });
  });

  it("maps duplicate alias to insertElement", () => {
    expect(
      normalizeDomPatch({ type: "duplicate", position: "after", mode: "clone" }),
    ).toEqual({
      type: "insertElement",
      position: "after",
      mode: "clone",
    });
  });

  it("infers swapElement from component field", () => {
    expect(
      normalizeDomPatch({ component: "Button", props: { variant: "primary" } }),
    ).toEqual({
      type: "swapElement",
      component: "Button",
      componentName: "Button",
      props: { variant: "primary" },
    });
  });

  it("infers attribute from name and value", () => {
    expect(normalizeDomPatch({ name: "href", value: "https://example.com" })).toEqual({
      type: "attribute",
      name: "href",
      value: "https://example.com",
    });
  });
});

describe("parseDomPatch", () => {
  it("accepts normalized LLM output", () => {
    const result = parseDomPatch({ type: "text", value: "Submit" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ type: "textContent", value: "Submit" });
    }
  });

  it("normalizes class patches to dibs-css DOM class names", () => {
    const result = parseDomPatch({
      type: "className",
      value: "textBlue600 dc-bgBlue50",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: "className",
        value: "dc-textBlue600 dc-bgBlue50",
        mode: "merge",
      });
    }
  });

  it("rejects unknown patch types", () => {
    const result = parseDomPatch({ type: "foo", random: 1 });
    expect(result.success).toBe(false);
  });
});
