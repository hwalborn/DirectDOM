import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "DirectDOM",
  version: "0.1.0",
  description:
    "Chat-driven live DOM edits synced to JIRA, Google Docs, and GitHub PRs",
  permissions: ["activeTab", "sidePanel", "storage", "scripting"],
  host_permissions: [
    "*://*.1stdibs.com/*",
    "*://*.intranet.1stdibs.com/*",
    "http://localhost:3001/*",
  ],
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: [
        "*://*.1stdibs.com/*",
        "*://*.intranet.1stdibs.com/*",
      ],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  action: {
    default_title: "Open DirectDOM",
  },
  icons: {
    "16": "public/icon-16.png",
    "48": "public/icon-48.png",
    "128": "public/icon-128.png",
  },
};

export default manifest;
