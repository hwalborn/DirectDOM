import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  mergeCssDeclarationsToInlineStyle,
} from "@directdom/shared";
import { lookupDibsCssMatches } from "@directdom/shared/dibs-css-lookup";

const FIXTURE_REPO = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../shared/src/__fixtures__/repo",
);

describe("inline style preview helpers", () => {
  it("builds inline color styles from explicit dibs class names", () => {
    const matches = lookupDibsCssMatches(FIXTURE_REPO, ["textBlue600"]);
    const inlineValue = mergeCssDeclarationsToInlineStyle(
      matches.map((match) => match.originalCSS),
    );

    expect(inlineValue.color).toBe("#436b93");
  });

  it("builds inline color styles for prior className ledger changes", () => {
    const matches = lookupDibsCssMatches(FIXTURE_REPO, ["textBlue600"]);
    const inlineValue = mergeCssDeclarationsToInlineStyle(
      matches.map((match) => match.originalCSS),
    );

    expect(inlineValue.color).toBe("#436b93");
  });
});
