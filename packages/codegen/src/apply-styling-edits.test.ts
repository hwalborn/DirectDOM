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

      expect(modified.modifiedPaths).toContain(cssPath);
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

      expect(modified.modifiedPaths).toContain(titlePath);
      const updated = readFileSync(titlePath, "utf-8");
      expect(updated).toContain(
        "classnames(dibsCss.truncate, dibsCss.textBlue600)",
      );
      expect(updated).not.toContain("classNames(");
    } finally {
      writeFileSync(titlePath, original, "utf-8");
    }
  });

  it("adds inline style when no dibs-css class matches", () => {
    const titlePath = join(
      FIXTURE_REPO,
      "packages/dibs-buyer-product-tile/src/ProductTitleLowercase.tsx",
    );
    const original = readFileSync(titlePath, "utf-8");

    try {
      const result = applyStylingEdits(FIXTURE_REPO, [
        baseRecord({
          id: "custom-inline-style",
          intent: "make text a custom coral",
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
            computedStyles: { color: "rgb(255, 99, 71)" },
          },
          patch: {
            type: "inlineStyle",
            value: { color: "#ff6347" },
            mode: "merge",
          },
        }),
      ]);

      expect(result.appliedChangeIds).toContain("custom-inline-style");
      expect(result.modifiedPaths).toContain(titlePath);
      const updated = readFileSync(titlePath, "utf-8");
      expect(updated).toContain("style={{ color: '#ff6347' }}");
    } finally {
      writeFileSync(titlePath, original, "utf-8");
    }
  });

  it("applies multiple styling changes to the same target independently", () => {
    const titlePath = join(
      FIXTURE_REPO,
      "packages/dibs-buyer-product-tile/src/ProductTitle.tsx",
    );
    const original = readFileSync(titlePath, "utf-8");

    try {
      const result = applyStylingEdits(FIXTURE_REPO, [
        baseRecord({
          id: "change-color",
          target: {
            selector: '[data-tn="product-title"]',
            reactFiberHint: "ProductTitle",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: {
            tagName: "H2",
            textContent: "Vintage chair",
            className: "dc-textSatan dc-truncate dc-textBlue600",
          },
          after: {
            tagName: "H2",
            textContent: "Vintage chair",
            className: "dc-textBlue600 dc-truncate dc-textBlue600",
          },
          patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
        }),
        baseRecord({
          id: "change-custom-padding",
          intent: "add custom top padding",
          target: {
            selector: '[data-tn="product-title"]',
            reactFiberHint: "ProductTitle",
            boundingBox: { x: 0, y: 0, width: 10, height: 10 },
          },
          before: {
            tagName: "H2",
            textContent: "Vintage chair",
            className: "dc-textBlue600 dc-truncate dc-textBlue600",
          },
          after: {
            tagName: "H2",
            textContent: "Vintage chair",
            className: "dc-textBlue600 dc-truncate dc-textBlue600",
            computedStyles: { paddingTop: "12px" },
          },
          patch: {
            type: "inlineStyle",
            value: { paddingTop: "12px" },
            mode: "merge",
          },
        }),
      ]);

      expect(result.appliedChangeIds).toEqual([
        "change-color",
        "change-custom-padding",
      ]);
      const updated = readFileSync(titlePath, "utf-8");
      expect(updated).toContain("dibsCss.textBlue600");
      expect(updated).not.toContain("dibsCss.textSatan");
      expect(updated).toContain("paddingTop: 12px");
    } finally {
      writeFileSync(titlePath, original, "utf-8");
    }
  });
});
