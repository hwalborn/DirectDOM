import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type PageUrlContext = {
  hostname: string;
  pathname: string;
  /** adminv2 hosts → admin; 1stdibs.com → buyer */
  hostFamily: "admin" | "buyer" | "unknown";
  /** Meaningful pathname segments for path scoring */
  pathSegments: string[];
};

export type FerrumAppMatch = {
  appName: string;
  route: string;
  score: number;
};

const SKIP_ROUTE_SCAN_DIRS = new Set([
  "node_modules",
  "__generated__",
  "__tests__",
  "dist",
  "build",
  ".git",
  "coverage",
]);

const GENERIC_SEGMENTS = new Set([
  "internal",
  "dealers",
  "mobile",
  "my",
  "id",
  "www",
  "qa",
  "stage",
  "preview",
  "new",
  "edit",
  "form",
  "page",
  "index",
  "api",
  "v1",
  "v2",
  "en",
  "de",
  "fr",
  "it",
]);

const parsePageUrl = (pageUrl: string): PageUrlContext | null => {
  try {
    const url = new URL(pageUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = decodeURIComponent(url.pathname || "/");

    let hostFamily: PageUrlContext["hostFamily"] = "unknown";
    if (hostname.includes("adminv2")) {
      hostFamily = "admin";
    } else if (
      /^(qa|stage)(\.intranet)?\.1stdibs\.com$/.test(hostname) ||
      /^(www\.)?1stdibs\.com$/.test(hostname)
    ) {
      hostFamily = "buyer";
    }

    const pathSegments = pathname
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !GENERIC_SEGMENTS.has(s.toLowerCase()))
      .filter((s) => !/^id-/i.test(s))
      .filter((s) => !/^\d+$/.test(s))
      .filter((s) => s.length >= 3)
      .map((s) => s.toLowerCase());

    return { hostname, pathname, hostFamily, pathSegments };
  } catch {
    return null;
  }
};

export const parsePageUrlContext = parsePageUrl;

const walkServerFiles = (dir: string, out: string[]): void => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (SKIP_ROUTE_SCAN_DIRS.has(entry) || entry.startsWith(".")) continue;
      walkServerFiles(fullPath, out);
      continue;
    }

    if (
      stat.isFile() &&
      /\.(js|jsx|ts|tsx)$/.test(entry) &&
      !/(?:test|spec)\./i.test(entry) &&
      !/_spec\./i.test(entry)
    ) {
      out.push(fullPath);
    }
  }
};

const extractRoutesFromSource = (content: string): string[] => {
  const routes: string[] = [];

  // route: '/path' | route: "/path"
  for (const match of content.matchAll(
    /\broute\s*:\s*(['"])(\/[^'"]+)\1/g,
  )) {
    routes.push(match[2]);
  }

  // route: ['/a', '/b'] or route: ["/a", "/b"]
  for (const match of content.matchAll(/\broute\s*:\s*\[([\s\S]*?)\]/g)) {
    for (const inner of match[1].matchAll(/['"](\/[^'"]+)['"]/g)) {
      routes.push(inner[1]);
    }
  }

  return routes;
};

const routeMatchesPathname = (route: string, pathname: string): boolean => {
  // Strip optional regex-ish bits used in ferrum: (-new)?, :param, *
  const pattern = route
    .replace(/\\/g, "\\\\")
    .replace(/\([^)]*\)\?/g, "")
    .replace(/:[A-Za-z0-9_]+[?]?/g, "[^/]+")
    .replace(/\*/g, ".*")
    .replace(/\?/g, "");

  try {
    const re = new RegExp(`^${pattern}(?:/|$)`, "i");
    return re.test(pathname);
  } catch {
    return pathname === route || pathname.startsWith(`${route}/`);
  }
};

const listAppNames = (repoPath: string): string[] => {
  const appsDir = join(repoPath, "apps");
  if (!existsSync(appsDir)) return [];
  try {
    return readdirSync(appsDir).filter((name) => {
      if (name.startsWith(".")) return false;
      return existsSync(join(appsDir, name, "package.json"));
    });
  } catch {
    return [];
  }
};

const appMatchesHostFamily = (
  appName: string,
  hostFamily: PageUrlContext["hostFamily"],
): boolean => {
  if (hostFamily === "unknown") return true;
  if (hostFamily === "admin") {
    return (
      appName.startsWith("app-admin-") || appName.startsWith("app-dealer-")
    );
  }
  return appName.startsWith("app-buyer-");
};

/**
 * Infer which ferrum app(s) own a page by matching pathname against
 * route declarations under each app's src/server directory.
 */
export const resolveFerrumAppsFromPageUrl = (
  repoPath: string,
  pageUrl: string,
): { context: PageUrlContext | null; matches: FerrumAppMatch[] } => {
  const context = parsePageUrl(pageUrl);
  if (!context) {
    return { context: null, matches: [] };
  }

  const matches: FerrumAppMatch[] = [];

  for (const appName of listAppNames(repoPath)) {
    if (!appMatchesHostFamily(appName, context.hostFamily)) continue;

    const serverDir = join(repoPath, "apps", appName, "src", "server");
    if (!existsSync(serverDir)) continue;

    const files: string[] = [];
    walkServerFiles(serverDir, files);

    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue;
      }

      for (const route of extractRoutesFromSource(content)) {
        if (!routeMatchesPathname(route, context.pathname)) continue;
        matches.push({
          appName,
          route,
          score: route.length,
        });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score || a.appName.localeCompare(b.appName));

  // Deduplicate by app, keeping longest route match
  const byApp = new Map<string, FerrumAppMatch>();
  for (const match of matches) {
    if (!byApp.has(match.appName)) {
      byApp.set(match.appName, match);
    }
  }

  return { context, matches: [...byApp.values()] };
};

export const preferredAppRoots = (
  repoPath: string,
  appNames: string[],
): string[] => {
  const roots: string[] = [];
  for (const appName of appNames) {
    const appRoot = join(repoPath, "apps", appName);
    if (existsSync(appRoot)) roots.push(appRoot);
  }
  const packagesRoot = join(repoPath, "packages");
  if (existsSync(packagesRoot)) roots.push(packagesRoot);
  return roots;
};

export const relativePosix = (repoPath: string, absPath: string): string =>
  relative(repoPath, absPath).replace(/\\/g, "/");
