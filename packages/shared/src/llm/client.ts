import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { LlmConfig } from "./types.js";

export type LlmJsonCompletionParams = {
  system: string;
  user: string;
};

const JSON_SYSTEM_SUFFIX =
  "\n\nRespond with valid JSON only. Do not wrap the response in markdown code fences.";

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

const getAnthropicClient = (apiKey: string): Anthropic => {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
};

const getOpenAiClient = (apiKey: string): OpenAI => {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
};

const completeJsonWithAnthropic = async (
  config: LlmConfig,
  params: LlmJsonCompletionParams,
): Promise<string> => {
  const apiKey = config.anthropicApiKey?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = getAnthropicClient(apiKey);
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system: `${params.system}${JSON_SYSTEM_SUFFIX}`,
    messages: [{ role: "user", content: params.user }],
  });

  const block = response.content.find((item) => item.type === "text");
  return block?.type === "text" ? block.text : "{}";
};

const completeJsonWithOpenAi = async (
  config: LlmConfig,
  params: LlmJsonCompletionParams,
): Promise<string> => {
  const apiKey = config.openaiApiKey?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const client = getOpenAiClient(apiKey);
  const response = await client.chat.completions.create({
    model: config.model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
  });

  return response.choices[0]?.message?.content ?? "{}";
};

export const completeJson = async (
  config: LlmConfig,
  params: LlmJsonCompletionParams,
): Promise<string> => {
  if (config.provider === "openai") {
    return completeJsonWithOpenAi(config, params);
  }
  return completeJsonWithAnthropic(config, params);
};
