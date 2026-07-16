import { z } from "zod";

const LlmProviderSchema = z.enum(["anthropic", "openai"]);
type LlmProvider = z.infer<typeof LlmProviderSchema>;

const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
};

export type LlmConfig = {
  provider: LlmProvider;
  model: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
};

export const resolveLlmConfig = (params: {
  provider?: string;
  model?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}): LlmConfig => {
  const parsedProvider = LlmProviderSchema.safeParse(params.provider);
  const provider = parsedProvider.success ? parsedProvider.data : "openai";

  return {
    provider,
    model: params.model?.trim() || DEFAULT_LLM_MODELS[provider],
    anthropicApiKey: params.anthropicApiKey,
    openaiApiKey: params.openaiApiKey,
  };
};

export const hasLlmApiKey = (config: LlmConfig): boolean => {
  if (config.provider === "anthropic") {
    return Boolean(config.anthropicApiKey?.trim());
  }
  return Boolean(config.openaiApiKey?.trim());
};
