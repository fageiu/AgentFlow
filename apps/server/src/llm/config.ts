import type { LlmProvider } from "./types.js";
import { loadEnv } from "../env/loadEnv.js";

declare const process: {
  env: Record<string, string | undefined>;
};

/** LLM 运行配置，集中描述当前使用的模型服务、模型名和降级策略。 */
export interface LlmConfig {
  provider: LlmProvider;
  apiKey?: string;
  baseUrl: string;
  model: string;
  mock: boolean;
  fallbackOnError: boolean;
  requestTimeoutMs: number;
  maxRetries: number;
}

/** 将环境变量中的布尔字符串转换成 boolean，并提供默认值。 */
function readBoolean(value: string | undefined, fallback: boolean) {
  if (value == null) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readNonNegativeNumber(value: string | undefined, fallback: number) {
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * 读取 LLM 配置。
 * 支持 OpenAI-compatible、DeepSeek 和 Mock fallback，避免 executor 直接关心具体供应商。
 */
export function getLlmConfig(): LlmConfig {
  loadEnv();

  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY ?? deepseekApiKey;
  const provider = (process.env.LLM_PROVIDER as LlmProvider | undefined) ?? "openai-compatible";
  const defaultBaseUrl = deepseekApiKey ? "https://api.deepseek.com" : "https://api.openai.com/v1";
  const defaultModel = deepseekApiKey ? "deepseek-v4-flash" : "gpt-4o-mini";

  return {
    provider,
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL ?? process.env.LLM_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? defaultBaseUrl,
    model: process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? process.env.DEEPSEEK_MODEL ?? defaultModel,
    mock: readBoolean(process.env.LLM_MOCK, !apiKey),
    fallbackOnError: readBoolean(process.env.LLM_FALLBACK_ON_ERROR, true),
    requestTimeoutMs: readNonNegativeNumber(process.env.LLM_REQUEST_TIMEOUT_MS, 60_000),
    maxRetries: Math.floor(readNonNegativeNumber(process.env.LLM_MAX_RETRIES, 2)),
  };
}
