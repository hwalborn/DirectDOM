import { matchHostname } from "@directdom/shared";

declare const __API_URL__: string;

export const API_URL: string = __API_URL__;

export type MessageType =
  | "GET_TAB_CONTEXT"
  | "TAB_CONTEXT"
  | "START_PICKER"
  | "STOP_PICKER"
  | "ELEMENT_SELECTED"
  | "APPLY_PATCH"
  | "PATCH_APPLIED"
  | "UNDO_CHANGE"
  | "CHANGE_UNDONE"
  | "GET_LEDGER"
  | "LEDGER_UPDATE"
  | "SESSION_UPDATE";

export type ExtensionMessage =
  | { type: "GET_TAB_CONTEXT" }
  | {
      type: "TAB_CONTEXT";
      pageUrl: string;
      hostname: string;
      allowed: boolean;
      environment: string;
    }
  | { type: "START_PICKER" }
  | { type: "STOP_PICKER" }
  | {
      type: "ELEMENT_SELECTED";
      selector: string;
      snapshot: unknown;
      xpath?: string;
      reactFiberHint?: string;
      boundingBox?: unknown;
    }
  | { type: "APPLY_PATCH"; patch: unknown; intent: string; selector?: string }
  | { type: "PATCH_APPLIED"; changeRecord: unknown }
  | { type: "UNDO_CHANGE"; changeId: string }
  | { type: "CHANGE_UNDONE"; changeId: string }
  | { type: "GET_LEDGER" }
  | { type: "LEDGER_UPDATE"; ledger: unknown[] }
  | { type: "SESSION_UPDATE"; sessionId: string };

export class TabConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TabConnectionError";
  }
}

export const getActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
};

export const isTabAllowed = (url?: string): boolean => {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return matchHostname(hostname).allowed;
  } catch {
    return false;
  }
};

const getContentScriptFiles = (): string[] => {
  const manifest = chrome.runtime.getManifest();
  return manifest.content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];
};

const injectContentScript = async (tabId: number): Promise<void> => {
  const files = getContentScriptFiles();
  if (files.length === 0) {
    throw new TabConnectionError("No content script configured.");
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files,
  });
};

/** Fire-and-forget runtime message; ignores when no listener (e.g. side panel closed). */
export const safeRuntimeSend = (message: ExtensionMessage): void => {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
};

export const sendToActiveTab = async (
  message: ExtensionMessage,
): Promise<unknown> => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new TabConnectionError("No active tab found.");
  }

  if (!isTabAllowed(tab.url)) {
    throw new TabConnectionError(
      "DirectDOM only runs on 1stDibs pages. Focus your app tab (qa/stage/prod), not chrome:// or other sites.",
    );
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    try {
      await injectContentScript(tab.id);
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      throw new TabConnectionError(
        "Could not reach the page. Refresh the 1stDibs tab, then try again.",
      );
    }
  }
};

export const sendToBackground = async <T = unknown>(
  message: ExtensionMessage,
): Promise<T> => {
  return chrome.runtime.sendMessage(message) as Promise<T>;
};

export const getAuthToken = async (): Promise<string | null> => {
  const result = await chrome.storage.local.get("authToken");
  return (result.authToken as string) ?? null;
};

export const setAuthToken = async (token: string | null): Promise<void> => {
  if (token) {
    await chrome.storage.local.set({ authToken: token });
  } else {
    await chrome.storage.local.remove("authToken");
  }
};

export const apiFetch = async (
  path: string,
  options: RequestInit = {},
): Promise<Response> => {
  const token = await getAuthToken();
  const headers = new Headers(options.headers);
  if (options.body != null) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${API_URL}${path}`, { ...options, headers });
};
