import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

loadDotenv({ path: resolve(monorepoRoot, ".env") });
loadDotenv({ path: resolve(monorepoRoot, ".env.local"), override: true });
