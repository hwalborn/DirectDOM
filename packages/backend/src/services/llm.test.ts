import { describe, it, expect } from "vitest";
import { parsePatchFromMessage } from "./llm.js";

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
    expect(patch?.value).toBe("dc-textBlue600");
  });
});
