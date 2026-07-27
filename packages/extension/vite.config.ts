import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  plugins: [crx({ manifest })],
  define: {
    __API_URL__: JSON.stringify(
      // Points to BE server url
      process.env.VITE_API_URL ?? "http://localhost:3001",
    ),
  },
});
