import { describe, it, expect } from "vitest";
import { inferRequestCategory, parsePatchFromMessage } from "./llm.js";

describe("inferRequestCategory", () => {
  it("detects duplicate requests", () => {
    expect(inferRequestCategory("duplicate this dropdown")).toBe(
      "structural-duplicate",
    );
  });

  it("detects new element additions", () => {
    expect(inferRequestCategory("add a filter button below this")).toBe(
      "structural-add",
    );
  });

  it("detects restructure requests", () => {
    expect(
      inferRequestCategory("wrap this in a flex row with two columns"),
    ).toBe("structural-restructure");
  });

  it("detects styling requests", () => {
    expect(inferRequestCategory("change the color to blue")).toBe("styling");
  });

  it("detects content requests", () => {
    expect(inferRequestCategory('change the text to "Hello"')).toBe("content");
  });
});

describe("parsePatchFromMessage", () => {
  it("parses change this to read ...", () => {
    const patch = parsePatchFromMessage(
      'Can we change this to read "HI, <company name>"?',
    );
    expect(patch).toEqual({
      type: "textContent",
      value: "HI, <company name>",
    });
  });

  it("parses change the text to ...", () => {
    const patch = parsePatchFromMessage('change the text to "Submit order"');
    expect(patch).toEqual({
      type: "textContent",
      value: "Submit order",
    });
  });

  it("parses color changes", () => {
    const patch = parsePatchFromMessage("change the color to blue-500");
    expect(patch?.type).toBe("className");
    if (patch?.type === "className") {
      expect(patch.value).toBe("dc-textBlue600");
    }
  });

  it("parses duplicate requests", () => {
    const patch = parsePatchFromMessage(
      'duplicate this dropdown and change the label to "Sort by price"',
    );
    expect(patch).toEqual({
      type: "insertElement",
      position: "after",
      mode: "clone",
      textContent: "Sort by price",
    });
  });
});
