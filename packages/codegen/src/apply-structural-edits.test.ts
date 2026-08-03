import { describe, expect, it } from "vitest";
import type { ChangeRecord } from "@directdom/shared";
import { findJsxElementEndLine } from "./jsx-source-location.js";
import {
  domHtmlToJsx,
  findAnchorInsertLine,
  insertJsxAtLine,
} from "./apply-structural-edits.js";
import { detectComponentStyleContext } from "./component-style-context.js";

const SAMPLE_SOURCE = `import classNames from "classnames";
import dibsCss from "dibs-css";
import { BulkActionResults } from "../BulkActionResults";
import { PublishedItemBanner } from "../PublishedItemBanner";

const DealerInventoryManager = () => (
    <SelectItemsProvider>
        <PublishedItemBanner viewer={viewer} />
        <BulkActionResults items={items} seller={seller} />
        {showViolationsBanner && (
            <div className={classNames(dibsCss.mbSmall, styles.violationsWrapper)}>
                <ViolationsBanner viewer={viewer} />
            </div>
        )}
        <DIMPagination items={items} />
    </SelectItemsProvider>
);

export default DealerInventoryManager;
`;

const baseRecord = (
  overrides: Partial<ChangeRecord> &
    Pick<ChangeRecord, "target" | "before" | "after" | "patch">,
): ChangeRecord => ({
  id: "change-1",
  timestamp: Date.now(),
  intent: "Add notice below bulk actions",
  confidence: "high",
  ...overrides,
});

const styleContext = detectComponentStyleContext(
  "/repo",
  "DealerInventoryManager.tsx",
  SAMPLE_SOURCE,
);

describe("findJsxElementEndLine", () => {
  const lines = SAMPLE_SOURCE.split("\n");

  it("returns same line for self-closing components", () => {
    const bulkLine = lines.findIndex((l) => l.includes("<BulkActionResults"));
    expect(findJsxElementEndLine(lines, bulkLine)).toBe(bulkLine);
  });
});

describe("findAnchorInsertLine", () => {
  it("inserts after BulkActionResults when anchor fiber matches", () => {
    const change = baseRecord({
      target: {
        selector: "div",
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
      anchor: {
        selector: "div",
        reactFiberHint: "BulkActionResults|DealerInventoryManager",
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
      before: { tagName: "DIV" },
      after: {
        tagName: "DIV",
        outerHTML:
          '<div class="dc-bgWhite dc-pSmall"><span class="dc-textSatan">Listings are ordered by latest modified date!!!</span></div>',
      },
      patch: {
        type: "insertElement",
        position: "after",
        mode: "html",
        html: '<div class="dc-bgWhite dc-pSmall"><span class="dc-textSatan">Listings are ordered by latest modified date!!!</span></div>',
      },
    });

    const point = findAnchorInsertLine(
      SAMPLE_SOURCE,
      change,
      "DealerInventoryManager.tsx",
    );

    expect(point).not.toBeNull();
    const lines = SAMPLE_SOURCE.split("\n");
    const bulkLine = lines.findIndex((l) => l.includes("<BulkActionResults"));
    expect(point?.insertAtLine).toBe(bulkLine + 1);
    expect(point?.reason).toContain("BulkActionResults");
  });
});

describe("domHtmlToJsx", () => {
  it("maps dc- classes to dibsCss and classNames", () => {
    const jsx = domHtmlToJsx(
      '<div class="dc-bgWhite dc-pSmall"><span class="dc-textSatan">Hello</span></div>',
      styleContext,
    );
    expect(jsx).toContain(
      "className={classNames(dibsCss.bgWhite, dibsCss.pSmall)}",
    );
    expect(jsx).toContain("className={dibsCss.textSatan}");
  });
});

describe("insertJsxAtLine", () => {
  it("preserves export default and inserts after BulkActionResults", () => {
    const change = baseRecord({
      target: {
        selector: "div",
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
      anchor: {
        selector: "div",
        reactFiberHint: "BulkActionResults|DealerInventoryManager",
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
      before: { tagName: "DIV" },
      after: {
        tagName: "DIV",
        outerHTML:
          '<div class="dc-bgWhite dc-pSmall"><span class="dc-textSatan">Notice</span></div>',
      },
      patch: {
        type: "insertElement",
        position: "after",
        mode: "html",
        html: '<div class="dc-bgWhite dc-pSmall"><span class="dc-textSatan">Notice</span></div>',
      },
    });

    const point = findAnchorInsertLine(
      SAMPLE_SOURCE,
      change,
      "DealerInventoryManager.tsx",
    );
    expect(point).not.toBeNull();

    const jsx = domHtmlToJsx(
      change.patch.type === "insertElement" ? (change.patch.html ?? "") : "",
      styleContext,
    );
    const next = insertJsxAtLine(SAMPLE_SOURCE, point!.insertAtLine, jsx);

    expect(next).toContain("export default DealerInventoryManager");
    expect(next).toMatch(
      /<BulkActionResults[^]*Notice[^]*showViolationsBanner/s,
    );
    expect(next).not.toMatch(/<DIMPagination[^]*Notice/s);
  });
});
