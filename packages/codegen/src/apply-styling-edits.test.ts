import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChangeRecord } from "@directdom/shared";
import { applyStylingEdits } from "./apply-styling-edits.js";
import { updateCssRuleProperties } from "./apply-css-module-edits.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = join(__dirname, "__fixtures__", "repo");

const baseRecord = (
  overrides: Partial<ChangeRecord> &
    Pick<ChangeRecord, "target" | "before" | "after" | "patch">,
): ChangeRecord => ({
  id: "change-1",
  timestamp: Date.now(),
  intent: "make text blue",
  confidence: "high",
  ...overrides,
});

describe("apply-css-module-edits", () => {
  it("updates a property inside a css module rule", () => {
    const updated = updateCssRuleProperties(
      ".title { color: #ff0000; }",
      "title",
      { color: "#436b93" },
    );
    expect(updated?.content).toContain("color: #436b93");
  });
});

describe("applyStylingEdits", () => {
  it("updates css module color when preview used inline style", () => {
    const tsxPath = join(
      FIXTURE_REPO,
      "packages/dibs-buyer-product-tile/src/ProductTitle.module.tsx",
    );
    const cssPath = join(
      FIXTURE_REPO,
      "packages/dibs-buyer-product-tile/src/ProductTitle.module.css",
    );
    const originalCss = readFileSync(cssPath, "utf-8");

    try {
      const modified = applyStylingEdits(FIXTURE_REPO, [
        baseRecord({
          target: {
            selector: '[data-tn="product-title-module"]',
            reactFiberHint: "ProductTitleWithModule",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: {
            tagName: "H2",
            className: "dc-truncate",
            computedStyles: { color: "rgb(255, 0, 0)" },
          },
          after: {
            tagName: "H2",
            className: "dc-truncate",
            computedStyles: { color: "rgb(67, 107, 147)" },
          },
          patch: {
            type: "inlineStyle",
            value: { color: "#436b93" },
            mode: "merge",
            sourceClassName: "textBlue600",
          },
        }),
      ]);

      expect(modified).toContain(cssPath);
      expect(readFileSync(cssPath, "utf-8")).toContain("color: #436b93");
      expect(readFileSync(tsxPath, "utf-8")).toContain("styles.title");
    } finally {
      writeFileSync(cssPath, originalCss, "utf-8");
    }
  });

  it("appends dibsCss classes using the detected classnames import alias", () => {
    const titlePath = join(
      FIXTURE_REPO,
      "packages/dibs-buyer-product-tile/src/ProductTitleLowercase.tsx",
    );
    const original = readFileSync(titlePath, "utf-8");
    expect(original).toContain("classnames(dibsCss.truncate)");

    try {
      const modified = applyStylingEdits(FIXTURE_REPO, [
        baseRecord({
          target: {
            selector: '[data-tn="product-title-lowercase"]',
            reactFiberHint: "ProductTitleLowercase",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: {
            tagName: "H2",
            className: "dc-truncate",
          },
          after: {
            tagName: "H2",
            className: "dc-truncate",
            computedStyles: { color: "rgb(67, 107, 147)" },
          },
          patch: {
            type: "inlineStyle",
            value: { color: "#436b93" },
            mode: "merge",
            sourceClassName: "textBlue600",
          },
        }),
      ]);

      expect(modified).toContain(titlePath);
      const updated = readFileSync(titlePath, "utf-8");
      expect(updated).toContain(
        "classnames(dibsCss.truncate, dibsCss.textBlue600)",
      );
      expect(updated).not.toContain("classNames(");
    } finally {
      writeFileSync(titlePath, original, "utf-8");
    }
  });
});
