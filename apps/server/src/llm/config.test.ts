import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLlmConfigCandidate,
  getPublicLlmConfig,
  resetRuntimeLlmConfig,
  updateLlmConfig,
} from "./config.js";

test("模型配置接口只暴露密钥配置状态，并在空密钥时保留现有密钥", () => {
  const previousApiKey = process.env.LLM_API_KEY;
  const previousMock = process.env.LLM_MOCK;
  process.env.LLM_API_KEY = "environment-secret";
  process.env.LLM_MOCK = "false";
  resetRuntimeLlmConfig();

  try {
    const candidate = createLlmConfigCandidate({
      provider: "openai-compatible",
      baseUrl: "https://provider.example/v1/",
      model: "test-model",
      mock: false,
      fallbackOnError: true,
      requestTimeoutMs: 30_000,
      maxRetries: 1,
    });

    assert.equal(candidate.apiKey, "environment-secret");
    assert.equal(candidate.baseUrl, "https://provider.example/v1");

    const publicConfig = updateLlmConfig({
      provider: "openai-compatible",
      baseUrl: candidate.baseUrl,
      model: candidate.model,
      mock: false,
      fallbackOnError: true,
      requestTimeoutMs: 30_000,
      maxRetries: 1,
    });

    assert.equal(publicConfig.apiKeyConfigured, true);
    assert.equal(publicConfig.source, "runtime");
    assert.equal("apiKey" in getPublicLlmConfig(), false);
  } finally {
    resetRuntimeLlmConfig();
    if (previousApiKey == null) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousApiKey;
    if (previousMock == null) delete process.env.LLM_MOCK;
    else process.env.LLM_MOCK = previousMock;
  }
});
