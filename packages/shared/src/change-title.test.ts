import { describe, expect, it } from "vitest";
import {
  buildChangeTitle,
  deriveSurfaceLabel,
  withJiraTicketPrefix,
} from "./change-title.js";

describe("deriveSurfaceLabel", () => {
  it("labels dealer dashboard from path", () => {
    expect(
      deriveSurfaceLabel("https://qa.1stdibs.com/dealers/dashboard"),
    ).toBe("Dealer Dashboard");
  });

  it("labels inventory management from admin path", () => {
    expect(
      deriveSurfaceLabel(
        "https://adminv2.qa.1stdibs.com/internal/inventory-management/taxonomy",
      ),
    ).toBe("Inventory Management Taxonomy");
  });

  it("falls back to Admin when path is empty", () => {
    expect(deriveSurfaceLabel("https://adminv2.qa.1stdibs.com/")).toBe(
      "Admin",
    );
  });
});

describe("buildChangeTitle", () => {
  it("builds surface + intent title", () => {
    expect(
      buildChangeTitle({
        pageUrl: "https://qa.1stdibs.com/dealers/dashboard",
        intents: [
          "change the font color of the action required to dealer primary blue",
        ],
      }),
    ).toBe(
      "[Dealer Dashboard] Change the font color of the action required to dealer primary blue",
    );
  });

  it("appends (+N more) for multiple intents", () => {
    expect(
      buildChangeTitle({
        pageUrl: "https://qa.1stdibs.com/dealers/dashboard",
        intents: ["Update heading color", "Widen the banner", "Fix padding"],
      }),
    ).toBe("[Dealer Dashboard] Update heading color (+2 more)");
  });

  it("prefers an explicit summary", () => {
    expect(
      buildChangeTitle({
        pageUrl: "https://qa.1stdibs.com/dealers/dashboard",
        intents: ["ignored"],
        summary: "SELLA polish pass",
      }),
    ).toBe("SELLA polish pass");
  });
});

describe("withJiraTicketPrefix", () => {
  it("prefixes the ticket key", () => {
    expect(withJiraTicketPrefix("Fix button color", "SELLA-123")).toBe(
      "SELLA-123 Fix button color",
    );
  });

  it("does not double-prefix", () => {
    expect(
      withJiraTicketPrefix("SELLA-123 Fix button color", "SELLA-123"),
    ).toBe("SELLA-123 Fix button color");
  });

  it("returns title unchanged without a key", () => {
    expect(withJiraTicketPrefix("Fix button color")).toBe("Fix button color");
  });
});
