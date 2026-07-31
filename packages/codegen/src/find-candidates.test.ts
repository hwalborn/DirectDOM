import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChangeRecord } from "@directdom/shared";
import {
  buildStructuralCodegenHints,
  collectSearchSignals,
  extractContentSnippets,
  extractDataTnStaticParts,
  extractNlSignals,
  findCandidateFiles,
  matchDataTnInSource,
  isFuzzyTnMatch,
  normalizeTnValue,
  tokenizeTnValue,
} from "./find-candidates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = join(__dirname, "__fixtures__", "repo");

const baseRecord = (
  overrides: Partial<ChangeRecord> &
    Pick<ChangeRecord, "target" | "before" | "patch">,
): ChangeRecord => ({
  id: "change-1",
  timestamp: Date.now(),
  intent: "test",
  after: overrides.after ?? overrides.before,
  confidence: "high",
  ...overrides,
});

describe("collectSearchSignals", () => {
  it("extracts fiber hint, text, class tokens, and data-tn", () => {
    const signals = collectSearchSignals([
      baseRecord({
        target: {
          selector: '[data-tn="product-title"]',
          reactFiberHint: "ProductTitle",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: {
          tagName: "H2",
          textContent: "Vintage chair",
          className: "dc-textSatan dc-truncate",
        },
        patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
      }),
    ]);

    expect(signals.fiberHints).toEqual(["ProductTitle"]);
    expect(signals.texts).toEqual(["Vintage chair"]);
    expect(signals.classTokens).toEqual(expect.arrayContaining(["textSatan"]));
    expect(signals.classTokens).not.toContain("truncate");
    expect(signals.dataAttrs).toEqual([
      { name: "data-tn", value: "product-title" },
    ]);
  });

  it("parses pipe-separated fiber chains", () => {
    const signals = collectSearchSignals([
      baseRecord({
        target: {
          selector: "h2",
          reactFiberHint: "ProductTitle|ProductDetails|div",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: { tagName: "H2" },
        patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
      }),
    ]);

    expect(signals.fiberHints).toEqual(["ProductTitle", "ProductDetails"]);
  });

  it("extracts NL phrases from intent", () => {
    const signals = collectSearchSignals([
      baseRecord({
        intent:
          "Change the font color of the action required in the dealer dashboard to dealer primary blue",
        target: {
          selector: "h2",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: { tagName: "H2" },
        patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
      }),
    ]);

    expect(signals.nlPhrases).toEqual(
      expect.arrayContaining(["action required", "dealer dashboard"]),
    );
    expect(signals.nlTokens).toEqual(
      expect.arrayContaining(["action", "required", "dealer", "dashboard"]),
    );
  });
});

describe("extractNlSignals", () => {
  it("prefers multi-word phrases over stopwords", () => {
    const { phrases, tokens } = extractNlSignals(
      'Update "Action Required" heading color',
    );
    expect(phrases).toEqual(expect.arrayContaining(["action required"]));
    expect(tokens).not.toContain("update");
    expect(tokens).not.toContain("color");
  });
});

describe("isFuzzyTnMatch", () => {
  it("matches abbreviated btn to button suffix", () => {
    expect(isFuzzyTnMatch("upload-submit-btn", "submitButton")).toBe(true);
  });
});

describe("matchDataTnInSource", () => {
  it("matches exact literals", () => {
    expect(
      matchDataTnInSource('data-tn="product-title"', {
        name: "data-tn",
        value: "product-title",
      }),
    ).toBe("exact");
  });

  it("matches interpolated template suffix against DOM value", () => {
    const source = "data-tn={`${dataTn}-submitButton`}";
    expect(
      matchDataTnInSource(source, {
        name: "data-tn",
        value: "item-upload-submit-button",
      }),
    ).toBe("partial");
    expect(normalizeTnValue("submitButton")).toBe("submitbutton");
  });

  it("does not match unrelated static parts", () => {
    const source = "data-tn={`${dataTn}-cancelLink`}";
    expect(
      matchDataTnInSource(source, {
        name: "data-tn",
        value: "item-upload-submit-button",
      }),
    ).toBeNull();
  });

  it("fuzzy-matches token-overlap on abbreviated DOM values", () => {
    const source = "data-tn={`${dataTn}-submitButton`}";
    expect(extractDataTnStaticParts(source)).toEqual(
      expect.arrayContaining(["submitButton"]),
    );
    expect(
      matchDataTnInSource(source, {
        name: "data-tn",
        value: "upload-submit-btn",
      }),
    ).toBe("fuzzy");
  });

  it("fuzzy-matches minor typos in data-tn", () => {
    const source = 'data-tn="product-title"';
    expect(
      matchDataTnInSource(source, {
        name: "data-tn",
        value: "product-titel",
      }),
    ).toBe("fuzzy");
  });
});

describe("tokenizeTnValue", () => {
  it("splits kebab and camel segments", () => {
    expect(tokenizeTnValue("item-upload-submitButton")).toEqual(
      expect.arrayContaining(["item", "upload", "submit", "button"]),
    );
  });
});

describe("extractContentSnippets", () => {
  it("pulls text, classes, and component tags from HTML", () => {
    const snippets = extractContentSnippets(
      '<button class="dc-textBlue600 dc-pSmall">Filter results</button>',
    );
    expect(snippets).toEqual(
      expect.arrayContaining(["Filter results", "textBlue600", "pSmall", "button"]),
    );
  });
});

describe("collectSearchSignals for insertElement", () => {
  it("prefers anchor fiber hint and parent context over inserted target", () => {
    const signals = collectSearchSignals([
      baseRecord({
        target: {
          selector: "button.dc-directdom-copy",
          reactFiberHint: "Anonymous",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        anchor: {
          selector: '[data-tn="inventory-toolbar"]',
          reactFiberHint: "InventoryToolbar",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: {
          tagName: "DIV",
          parentTagName: "SECTION",
          parentClassName: "dc-flexCol",
          childTagSummary: "button, span",
        },
        after: {
          tagName: "BUTTON",
          outerHTML:
            '<button class="dc-textBlue600">Filter</button>',
        },
        patch: {
          type: "insertElement",
          position: "after",
          mode: "html",
          html: '<button class="dc-textBlue600">Filter</button>',
        },
      }),
    ]);

    expect(signals.fiberHints).toEqual(["InventoryToolbar"]);
    expect(signals.fiberHints).not.toContain("Anonymous");
    expect(signals.dataAttrs).toEqual(
      expect.arrayContaining([{ name: "data-tn", value: "inventory-toolbar" }]),
    );
    expect(signals.contentSnippets).toEqual(
      expect.arrayContaining(["Filter", "textBlue600", "button"]),
    );
    expect(signals.structuralAnchors).toEqual([
      expect.objectContaining({
        position: "after",
        parentTagName: "SECTION",
        anchorTagName: "DIV",
      }),
    ]);
  });
});

describe("buildStructuralCodegenHints", () => {
  it("summarizes insert anchor context for codegen", () => {
    const hints = buildStructuralCodegenHints([
      baseRecord({
        intent: "Add a filter button below the toolbar",
        target: {
          selector: "button",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        anchor: {
          selector: '[data-tn="inventory-toolbar"]',
          reactFiberHint: "InventoryToolbar",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: { tagName: "DIV", parentTagName: "SECTION" },
        after: { tagName: "BUTTON", outerHTML: '<button>Filter</button>' },
        patch: {
          type: "insertElement",
          position: "after",
          mode: "html",
          html: '<button class="dc-textBlue600">Filter</button>',
        },
      }),
    ]);

    expect(hints[0]).toEqual(
      expect.objectContaining({
        operation: "insertElement",
        position: "after",
        anchorFiberHint: "InventoryToolbar",
        anchorSelector: '[data-tn="inventory-toolbar"]',
        parentTagName: "SECTION",
      }),
    );
  });
});

describe("findCandidateFiles", () => {
  it("ranks ProductTitle highest by fiber hint", () => {
    const candidates = findCandidateFiles(FIXTURE_REPO, [
      baseRecord({
        target: {
          selector: "h2",
          reactFiberHint: "ProductTitle",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: { tagName: "H2" },
        patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
      }),
    ]);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.path).toContain("ProductTitle.tsx");
    expect(candidates[0]?.score).toBeGreaterThanOrEqual(100);
  });

  it("ranks ProductTitle highest by text content", () => {
    const candidates = findCandidateFiles(FIXTURE_REPO, [
      baseRecord({
        target: {
          selector: "h2",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: {
          tagName: "H2",
          textContent: "Vintage chair",
        },
        patch: {
          type: "textContent",
          value: "Modern chair",
        },
      }),
    ]);

    expect(candidates[0]?.path).toContain("ProductTitle.tsx");
  });

  it("ranks ProductTitle highest by dibsCss class token", () => {
    const candidates = findCandidateFiles(FIXTURE_REPO, [
      baseRecord({
        target: {
          selector: "h2",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: {
          tagName: "H2",
          className: "dc-textSatan",
        },
        patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
      }),
    ]);

    expect(candidates[0]?.path).toContain("ProductTitle.tsx");
  });

  it("ranks ProductTitle highest by data-tn selector", () => {
    const candidates = findCandidateFiles(FIXTURE_REPO, [
      baseRecord({
        target: {
          selector: '[data-tn="product-title"]',
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: { tagName: "H2" },
        patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
      }),
    ]);

    expect(candidates[0]?.path).toContain("ProductTitle.tsx");
  });

  it("returns empty when ledger has no searchable signals", () => {
    const candidates = findCandidateFiles(FIXTURE_REPO, [
      baseRecord({
        target: {
          selector: "div",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: { tagName: "DIV" },
        patch: { type: "className", value: "dc-flex", mode: "merge" },
      }),
    ]);

    expect(candidates).toEqual([]);
  });

  it("prefers the app matched from pageUrl when ranking", () => {
    const candidates = findCandidateFiles(
      FIXTURE_REPO,
      [
        baseRecord({
          target: {
            selector: '[data-tn="inventory-toolbar"]',
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: { tagName: "DIV" },
          patch: { type: "className", value: "dc-flexRow", mode: "merge" },
        }),
      ],
      {
        pageUrl:
          "https://adminv2.qa.1stdibs.com/internal/inventory-management/taxonomy",
      },
    );

    expect(candidates[0]?.path).toContain("InventoryToolbar.tsx");
    expect(candidates[0]?.path).toContain("app-admin-inventory");
    expect(candidates[0]?.path).toContain("inventory-management");
    expect(candidates[0]?.score).toBeGreaterThanOrEqual(60);
  });

  it("can rank by URL path segments when ledger signals are weak", () => {
    const candidates = findCandidateFiles(
      FIXTURE_REPO,
      [
        baseRecord({
          target: {
            selector: "div",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: { tagName: "DIV", className: "dc-doesNotExistAnywhere" },
          patch: { type: "className", value: "dc-flex", mode: "merge" },
        }),
      ],
      {
        pageUrl:
          "https://adminv2.qa.1stdibs.com/internal/inventory-management/taxonomy",
      },
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.path).toContain("app-admin-inventory");
  });

  it("finds ActionRequiredBanner from dealer dashboard URL + NL intent", () => {
    const candidates = findCandidateFiles(
      FIXTURE_REPO,
      [
        baseRecord({
          intent:
            "Change the font color of the action required in the dealer dashboard to dealer primary blue",
          target: {
            selector: "h2",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: { tagName: "H2", textContent: "Action Required" },
          patch: {
            type: "className",
            value: "dc-textDealerPrimary",
            mode: "merge",
          },
        }),
      ],
      {
        pageUrl: "https://qa.1stdibs.com/dealers/dashboard",
      },
    );

    expect(candidates[0]?.path).toContain("ActionRequiredBanner.tsx");
    expect(candidates[0]?.path).toContain("app-dealer-tools");
  });

  it("finds SubmitButton via interpolated data-tn suffix", () => {
    const candidates = findCandidateFiles(
      FIXTURE_REPO,
      [
        baseRecord({
          target: {
            selector: '[data-tn="item-upload-submit-button"]',
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: { tagName: "BUTTON" },
          patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
        }),
      ],
      {
        pageUrl: "https://qa.1stdibs.com/dealers/dashboard",
      },
    );

    expect(candidates[0]?.path).toContain("SubmitButton.tsx");
  });

  it("finds InventoryToolbar when inserting relative to anchor, not inserted node", () => {
    const candidates = findCandidateFiles(
      FIXTURE_REPO,
      [
        baseRecord({
          intent: "Add filter button below toolbar",
          target: {
            selector: "button",
            reactFiberHint: "Anonymous",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          anchor: {
            selector: '[data-tn="inventory-toolbar"]',
            reactFiberHint: "InventoryToolbar",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: {
            tagName: "DIV",
            parentTagName: "SECTION",
          },
          after: {
            tagName: "BUTTON",
            outerHTML:
              '<button class="dc-textBlue600">Filter listings</button>',
          },
          patch: {
            type: "insertElement",
            position: "after",
            mode: "html",
            html: '<button class="dc-textBlue600">Filter listings</button>',
          },
        }),
      ],
      {
        pageUrl:
          "https://adminv2.qa.1stdibs.com/internal/inventory-management/taxonomy",
      },
    );

    expect(candidates[0]?.path).toContain("InventoryToolbar.tsx");
  });

  it("finds DealerInventoryManager for dealer DIM URL, not dealer-tools advertising", () => {
    const candidates = findCandidateFiles(
      FIXTURE_REPO,
      [
        baseRecord({
          target: {
            selector: "h2",
            reactFiberHint: "DealerInventoryManager",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: {
            tagName: "H2",
            textContent: "Listings",
            className: "dc-sassyFontBodySmallHeavy",
          },
          patch: {
            type: "className",
            value: "dc-textDealerPrimary",
            mode: "merge",
          },
        }),
      ],
      {
        pageUrl:
          "https://adminv2.qa.1stdibs.com/dealers/inventory-management",
      },
    );

    expect(candidates[0]?.path).toContain("DealerInventoryManager.tsx");
    expect(candidates[0]?.path).toContain("app-admin-inventory");
    expect(candidates[0]?.path).not.toContain("AdAnalyticsPage");
  });
});
