import { matchHostname } from "@directdom/shared";
import type { ExtensionMessage } from "../lib/messaging";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => undefined);

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === "GET_TAB_CONTEXT") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.url) {
          sendResponse({ allowed: false, environment: "unknown" });
          return;
        }
        try {
          const url = new URL(tab.url);
          const { allowed, environment } = matchHostname(url.hostname);
          sendResponse({
            type: "TAB_CONTEXT",
            pageUrl: tab.url,
            hostname: url.hostname,
            allowed,
            environment,
          });
        } catch {
          sendResponse({ allowed: false, environment: "unknown" });
        }
      });
      return true;
    }

    return false;
  },
);

console.info("[DirectDOM] Background service worker started");
