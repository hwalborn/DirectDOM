import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ChangeRecord } from "@directdom/shared";
import {
  applyClassNameEdits,
  planClassNameTokenSwaps,
} from "./apply-classname-edits.js";

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

describe("planClassNameTokenSwaps", () => {
  it("maps same-category before token to incoming patch token", () => {
    const swaps = planClassNameTokenSwaps(
      baseRecord({
        target: {
          selector: "h2",
          reactFiberHint: "ProductTitle",
          boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        },
        before: { tagName: "H2", className: "dc-textSatan dc-truncate" },
        after: { tagName: "H2", className: "dc-textBlue600 dc-truncate" },
        patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
      }),
    );

    expect(swaps).toEqual([{ from: "textSatan", to: "textBlue600" }]);
  });
});

describe("applyClassNameEdits", () => {
  it("rewrites dibsCss token in the matched ProductTitle file", () => {
    const titlePath = join(
      FIXTURE_REPO,
      "packages/dibs-buyer-product-tile/src/ProductTitle.tsx",
    );
    const original = readFileSync(titlePath, "utf-8");
    expect(original).toContain("dibsCss.textSatan");

    try {
      const modified = applyClassNameEdits(FIXTURE_REPO, [
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
          after: {
            tagName: "H2",
            textContent: "Vintage chair",
            className: "dc-textBlue600 dc-truncate",
          },
          patch: { type: "className", value: "dc-textBlue600", mode: "merge" },
        }),
      ]);

      expect(modified.length).toBe(1);
      const updated = readFileSync(titlePath, "utf-8");
      expect(updated).toContain("dibsCss.textBlue600");
      expect(updated).not.toContain("dibsCss.textSatan");
    } finally {
      writeFileSync(titlePath, original, "utf-8");
    }
  });
});
