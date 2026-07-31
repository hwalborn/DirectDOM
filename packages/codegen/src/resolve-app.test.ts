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

  it("detects dealer host family on public hosts under /dealers", () => {
    const ctx = parsePageUrlContext(
      "https://qa.1stdibs.com/dealers/dashboard",
    );
    expect(ctx?.hostFamily).toBe("dealer");
    expect(ctx?.pathSegments).toEqual(
      expect.arrayContaining(["dealers", "dashboard"]),
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

  it("matches app-dealer-tools from /dealers/dashboard on a buyer host", () => {
    const { matches, context } = resolveFerrumAppsFromPageUrl(
      FIXTURE_REPO,
      "https://qa.1stdibs.com/dealers/dashboard",
    );
    expect(context?.hostFamily).toBe("dealer");
    expect(matches[0]?.appName).toBe("app-dealer-tools");
    expect(matches.some((m) => m.appName.startsWith("app-buyer-"))).toBe(false);
  });

  it("matches app-admin-inventory for /dealers/inventory-management on adminv2", () => {
    const { matches, context } = resolveFerrumAppsFromPageUrl(
      FIXTURE_REPO,
      "https://adminv2.qa.1stdibs.com/dealers/inventory-management",
    );
    expect(context?.hostFamily).toBe("dealer");
    expect(matches[0]?.appName).toBe("app-admin-inventory");
    expect(matches[0]?.route).toBe("/dealers/inventory-management");
    expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? 0);
  });
});
