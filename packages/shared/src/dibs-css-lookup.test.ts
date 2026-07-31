import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  lookupDibsCssClassesByDeclarations,
  lookupDibsCssMatches,
} from "./dibs-css-lookup.js";

const FIXTURE_REPO = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "repo",
);

describe("lookupDibsCssMatches", () => {
  it("resolves dibs-css class keys to CSS declarations", () => {
    const matches = lookupDibsCssMatches(FIXTURE_REPO, [
      "textBlue600",
      "textSatan",
    ]);

    expect(
      matches.some(
        (match) =>
          match.className === "textBlue600" &&
          match.originalCSS.toLowerCase().includes("color"),
      ),
    ).toBe(true);
  });
});

describe("lookupDibsCssClassesByDeclarations", () => {
  it("reverse-resolves inline color declarations to dibs classes", () => {
    expect(
      lookupDibsCssClassesByDeclarations(FIXTURE_REPO, ["color: #436b93"]),
    ).toContain("textBlue600");
  });
});
