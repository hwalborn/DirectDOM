import type { Environment } from "./schemas.js";

const ALLOWLIST_PATTERNS: Array<{
  pattern: RegExp;
  environment: Environment;
}> = [
  {
    pattern: /^adminv2\.qa\.intranet\.1stdibs\.com$/,
    environment: "qa",
  },
  {
    pattern: /^adminv2\.stage\.intranet\.1stdibs\.com$/,
    environment: "stage",
  },
  {
    pattern: /^adminv2\.qa\.1stdibs\.com$/,
    environment: "qa",
  },
  {
    pattern: /^adminv2\.stage\.1stdibs\.com$/,
    environment: "stage",
  },
  {
    pattern: /^qa\.intranet\.1stdibs\.com$/,
    environment: "qa",
  },
  {
    pattern: /^stage\.intranet\.1stdibs\.com$/,
    environment: "stage",
  },
  {
    pattern: /^qa\.1stdibs\.com$/,
    environment: "qa",
  },
  {
    pattern: /^stage\.1stdibs\.com$/,
    environment: "stage",
  },
  {
    pattern: /^adminv2\.1stdibs\.com$/,
    environment: "prod",
  },
  {
    pattern: /^1stdibs\.com$/,
    environment: "prod",
  },
  {
    pattern: /^www\.1stdibs\.com$/,
    environment: "prod",
  },
];

export const matchHostname = (
  hostname: string,
): { allowed: boolean; environment: Environment } => {
  const normalized = hostname.toLowerCase();

  for (const { pattern, environment } of ALLOWLIST_PATTERNS) {
    if (pattern.test(normalized)) {
      return { allowed: true, environment };
    }
  }

  return { allowed: false, environment: "unknown" };
};

export const isProdEnvironment = (environment: Environment): boolean =>
  environment === "prod";

export const STORYBOOK_BASE_URL =
  "https://adminv2.1stdibs.com/internal/style-guide";

export { ALLOWLIST_PATTERNS };
