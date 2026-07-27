const GENERIC_SEGMENTS = new Set([
  "internal",
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

const INTENT_NOISE =
  /^(please\s+)?(can you\s+)?(could you\s+)?(just\s+)?/i;

const titleCaseSegment = (segment: string): string => {
  if (segment === "dealers") return "Dealer";
  return segment
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

/**
 * Derive a short human surface label from a page URL
 * (e.g. /dealers/dashboard → "Dealer Dashboard").
 */
export const deriveSurfaceLabel = (pageUrl: string): string | null => {
  try {
    const { hostname, pathname } = new URL(pageUrl);
    const host = hostname.toLowerCase();
    const segments = pathname
      .split("/")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .filter((s) => !GENERIC_SEGMENTS.has(s))
      .filter((s) => !/^id-/i.test(s))
      .filter((s) => !/^\d+$/.test(s))
      .filter((s) => s.length >= 3);

    if (segments.length > 0) {
      return segments.slice(-2).map(titleCaseSegment).join(" ");
    }

    if (host.includes("adminv2")) return "Admin";
    if (/1stdibs\.com$/i.test(host)) return "Buyer";
    return null;
  } catch {
    return null;
  }
};

const cleanIntent = (intent: string): string => {
  const trimmed = intent.replace(INTENT_NOISE, "").trim();
  if (!trimmed) return "UI change";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

export type BuildChangeTitleParams = {
  pageUrl?: string;
  intents: string[];
  /** Prefer an explicit user-edited summary when present */
  summary?: string;
  maxLength?: number;
};

/**
 * Build a concise title for Jira / PR / commit from page surface + intents.
 * Example: "[Dealer Dashboard] Change Action Required font color (+2 more)"
 */
export const buildChangeTitle = (params: BuildChangeTitleParams): string => {
  const maxLength = params.maxLength ?? 100;
  const explicit = params.summary?.trim();
  if (explicit) return explicit.slice(0, maxLength);

  const intents = params.intents.map((i) => i.trim()).filter(Boolean);
  const primary = cleanIntent(intents[0] ?? "UI change");
  const extraCount = Math.max(0, intents.length - 1);
  const suffix = extraCount > 0 ? ` (+${extraCount} more)` : "";

  const surface = params.pageUrl
    ? deriveSurfaceLabel(params.pageUrl)
    : null;
  const withSurface = surface ? `[${surface}] ${primary}` : primary;
  const full = `${withSurface}${suffix}`;

  if (full.length <= maxLength) return full;

  const budget = maxLength - suffix.length;
  if (budget < 24) return full.slice(0, maxLength);
  return `${withSurface.slice(0, budget).trimEnd()}${suffix}`;
};

/**
 * Prefix a commit/PR title with a Jira key so GitHub↔Jira development
 * linking picks it up (e.g. "SELLA-123 Fix button color").
 * Does not double-prefix if the key is already present.
 */
export const withJiraTicketPrefix = (
  title: string,
  ticketKey?: string,
): string => {
  const key = ticketKey?.trim();
  if (!key) return title;

  const normalized = title.trim();
  const keyUpper = key.toUpperCase();
  const titleUpper = normalized.toUpperCase();
  if (
    titleUpper.startsWith(`${keyUpper} `) ||
    titleUpper.startsWith(`${keyUpper}:`) ||
    titleUpper === keyUpper
  ) {
    return normalized;
  }

  return `${key} ${normalized}`;
};
