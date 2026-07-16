import "./load-env.js";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasLlmApiKey,
  resolveLlmConfig,
  type LlmConfig,
} from "@directdom/shared/llm";

const monorepoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const defaultFerrumRoot = resolve(monorepoRoot, "../ferrum");

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  /** Ferrum checkout used to spawn mcp-dibs-css (stdio). */
  ferrumRoot: resolve(process.env.FERRUM_ROOT ?? defaultFerrumRoot),
  llm: {
    provider: process.env.LLM_PROVIDER ?? "openai",
    model: process.env.LLM_MODEL ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ??
      "http://localhost:3001/auth/google/callback",
    docTemplateId: process.env.GOOGLE_DOC_TEMPLATE_ID ?? "",
  },
  jira: {
    baseUrl: process.env.JIRA_BASE_URL ?? "https://1stdibs.atlassian.net",
    email: process.env.JIRA_EMAIL ?? "",
    apiToken: process.env.JIRA_API_TOKEN ?? "",
  },
  github: {
    token: process.env.GITHUB_TOKEN ?? "",
    org: process.env.GITHUB_ORG ?? "",
    createPr: process.env.GITHUB_CREATE_PR !== "false",
  },
  redisUrl: process.env.REDIS_URL ?? "",
  reposDir:
    process.env.REPOS_DIR ?? join(monorepoRoot, "packages/backend/repos"),
};

export const getLlmConfig = (): LlmConfig =>
  resolveLlmConfig({
    provider: config.llm.provider,
    model: config.llm.model,
    anthropicApiKey: config.llm.anthropicApiKey,
    openaiApiKey: config.llm.openaiApiKey,
  });
export const useMockLlm = !hasLlmApiKey(getLlmConfig());
export const useMockIntegrations =
  !config.jira.apiToken && !config.github.token;
