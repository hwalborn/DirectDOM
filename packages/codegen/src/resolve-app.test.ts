import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parsePageUrlContext,
  resolveFerrumAppsFromPageUrl,
} from "./resolve-app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = join(__dirname, "__fixtures__", "repo");

describe("parsePageUrlContext", () => {
  it("detects admin host family and path segments", () => {
    const ctx = parsePageUrlContext(
      "https://adminv2.qa.1stdibs.com/internal/inventory-management/taxonomy",
    );
    expect(ctx?.hostFamily).toBe("admin");
    expect(ctx?.pathSegments).toEqual(
      expect.arrayContaining(["inventory-management", "taxonomy"]),
    );
  });

  it("detects buyer host family", () => {
    const ctx = parsePageUrlContext("https://www.1stdibs.com/furniture/tables/");
    expect(ctx?.hostFamily).toBe("buyer");
    expect(ctx?.pathSegments).toEqual(
      expect.arrayContaining(["furniture", "tables"]),
    );
  });
});

describe("resolveFerrumAppsFromPageUrl", () => {
  it("matches app-admin-inventory from /internal/inventory-management URL", () => {
    const { matches } = resolveFerrumAppsFromPageUrl(
      FIXTURE_REPO,
      "https://adminv2.qa.1stdibs.com/internal/inventory-management/creators-edit/123",
    );
    expect(matches[0]?.appName).toBe("app-admin-inventory");
    expect(matches[0]?.route).toBe("/internal/inventory-management");
  });
});
