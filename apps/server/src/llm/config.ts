import type { LlmProvider } from "./types.js";
import type { LlmConfigUpdate, LlmPublicConfig } from "@agentflow/shared";
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

let runtimeConfig: LlmConfig | undefined;

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
function getEnvironmentLlmConfig(): LlmConfig {
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

/** 当前进程统一读取运行时配置；未在界面保存时继续使用环境变量。 */
export function getLlmConfig(): LlmConfig {
  return runtimeConfig ?? getEnvironmentLlmConfig();
}

/** 返回给前端的配置必须脱敏，API Key 只暴露是否已经配置。 */
export function getPublicLlmConfig(): LlmPublicConfig {
  const config = getLlmConfig();

  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    mock: config.mock,
    fallbackOnError: config.fallbackOnError,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    apiKeyConfigured: Boolean(config.apiKey),
    source: runtimeConfig ? "runtime" : "environment",
  };
}

/** 生成待测试或待保存的完整配置；空密钥默认沿用当前后端密钥。 */
export function createLlmConfigCandidate(input: LlmConfigUpdate): LlmConfig {
  const current = getLlmConfig();
  const nextApiKey = input.clearApiKey
    ? undefined
    : input.apiKey?.trim() || current.apiKey;

  return {
    provider: input.provider,
    apiKey: nextApiKey,
    baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
    model: input.model.trim(),
    mock: input.provider === "mock" ? true : input.mock,
    fallbackOnError: input.fallbackOnError,
    requestTimeoutMs: input.requestTimeoutMs,
    maxRetries: input.maxRetries,
  };
}

/** 保存当前进程使用的模型配置，后续新发起的 Run 会读取该配置。 */
export function updateLlmConfig(input: LlmConfigUpdate): LlmPublicConfig {
  runtimeConfig = createLlmConfigCandidate(input);
  return getPublicLlmConfig();
}

/** 测试结束后恢复环境变量配置，避免运行时覆盖污染其他用例。 */
export function resetRuntimeLlmConfig() {
  runtimeConfig = undefined;
}
