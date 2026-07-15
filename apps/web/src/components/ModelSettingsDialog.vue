<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { LlmConfigUpdate, LlmConnectionTestResult, LlmPublicConfig } from "@agentflow/shared";

const props = defineProps<{
  open: boolean;
  config?: LlmPublicConfig;
  busy: boolean;
  testing: boolean;
  saving: boolean;
  error: string;
  testResult?: LlmConnectionTestResult;
}>();

const emit = defineEmits<{
  close: [];
  test: [config: LlmConfigUpdate];
  save: [config: LlmConfigUpdate];
}>();

const provider = ref<LlmConfigUpdate["provider"]>("openai-compatible");
const baseUrl = ref("https://api.openai.com/v1");
const model = ref("gpt-4o-mini");
const apiKey = ref("");
const clearApiKey = ref(false);
const fallbackOnError = ref(true);
const requestTimeoutMs = ref(60_000);
const maxRetries = ref(2);

const isMockProvider = computed(() => provider.value === "mock");
const isLocked = computed(() => props.busy || props.testing || props.saving);
const sourceLabel = computed(() => props.config?.source === "runtime" ? "运行时配置" : "环境变量");

watch(
  () => [props.open, props.config] as const,
  ([open, config]) => {
    if (!open || !config) {
      return;
    }

    provider.value = config.provider;
    baseUrl.value = config.baseUrl;
    model.value = config.model;
    apiKey.value = "";
    clearApiKey.value = false;
    fallbackOnError.value = config.fallbackOnError;
    requestTimeoutMs.value = config.requestTimeoutMs;
    maxRetries.value = config.maxRetries;
  },
  { immediate: true },
);

/** 弹窗只提交用户输入的新密钥；留空时由后端继续使用已有密钥。 */
function createPayload(): LlmConfigUpdate {
  return {
    provider: provider.value,
    baseUrl: baseUrl.value.trim(),
    model: model.value.trim(),
    apiKey: apiKey.value.trim() || undefined,
    clearApiKey: clearApiKey.value,
    mock: isMockProvider.value,
    fallbackOnError: fallbackOnError.value,
    requestTimeoutMs: Number(requestTimeoutMs.value),
    maxRetries: Number(maxRetries.value),
  };
}

function applyPreset(preset: "openai" | "deepseek" | "mock") {
  if (preset === "openai") {
    provider.value = "openai-compatible";
    baseUrl.value = "https://api.openai.com/v1";
    model.value = "gpt-4o-mini";
  } else if (preset === "deepseek") {
    provider.value = "openai-compatible";
    baseUrl.value = "https://api.deepseek.com";
    model.value = "deepseek-chat";
  } else {
    provider.value = "mock";
    model.value = "mock-llm";
  }
}

function closeDialog() {
  if (!props.testing && !props.saving) {
    emit("close");
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="model-dialog-backdrop" @click.self="closeDialog" @keydown.esc="closeDialog">
      <section
        class="model-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-dialog-title"
      >
        <header class="model-dialog-header">
          <div>
            <span class="model-dialog-kicker">Model connection</span>
            <h2 id="model-dialog-title">模型设置</h2>
            <p>连接 OpenAI-compatible 服务，配置将在服务重启前持续生效。</p>
          </div>
          <button class="model-dialog-close" type="button" aria-label="关闭模型设置" @click="closeDialog">×</button>
        </header>

        <form class="model-dialog-form" @submit.prevent="emit('save', createPayload())">
          <div class="model-config-status">
            <span class="model-status-orb" :class="{ active: config?.apiKeyConfigured || config?.mock }"></span>
            <div>
              <small>当前来源</small>
              <strong>{{ sourceLabel }}</strong>
            </div>
            <span>{{ config?.apiKeyConfigured ? "密钥已配置" : config?.mock ? "Mock 模式" : "未配置密钥" }}</span>
          </div>

          <div class="model-presets" aria-label="常用模型预设">
            <button type="button" :disabled="isLocked" @click="applyPreset('openai')">OpenAI</button>
            <button type="button" :disabled="isLocked" @click="applyPreset('deepseek')">DeepSeek</button>
            <button type="button" :disabled="isLocked" @click="applyPreset('mock')">Mock</button>
          </div>

          <div class="model-field-grid">
            <label class="model-field">
              <span>Provider</span>
              <select v-model="provider" :disabled="isLocked">
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="mock">Mock（本地演示）</option>
              </select>
            </label>

            <label class="model-field">
              <span>模型名称</span>
              <input v-model="model" required maxlength="200" :disabled="isLocked" placeholder="gpt-4o-mini" />
            </label>
          </div>

          <label class="model-field model-field-wide">
            <span>Base URL</span>
            <input
              v-model="baseUrl"
              required
              type="url"
              maxlength="500"
              :disabled="isLocked || isMockProvider"
              placeholder="https://api.openai.com/v1"
            />
            <small>需填写 API 根地址，系统会自动请求 <code>/chat/completions</code>。</small>
          </label>

          <label class="model-field model-field-wide">
            <span>API Key</span>
            <input
              v-model="apiKey"
              type="password"
              autocomplete="new-password"
              maxlength="1000"
              :disabled="isLocked || isMockProvider || clearApiKey"
              :placeholder="config?.apiKeyConfigured ? '已配置；留空表示保持不变' : '输入模型服务 API Key'"
            />
            <small>密钥只发送到本机后端，不会回显或写入浏览器存储。</small>
          </label>

          <label v-if="config?.apiKeyConfigured && !isMockProvider" class="model-clear-key">
            <input v-model="clearApiKey" type="checkbox" :disabled="isLocked" />
            <span>清除后端当前使用的 API Key</span>
          </label>

          <div class="model-advanced">
            <label>
              <span>超时（毫秒）</span>
              <input v-model.number="requestTimeoutMs" type="number" min="1000" max="300000" step="1000" :disabled="isLocked" />
            </label>
            <label>
              <span>重试次数</span>
              <input v-model.number="maxRetries" type="number" min="0" max="10" :disabled="isLocked" />
            </label>
            <label class="model-switch">
              <input v-model="fallbackOnError" type="checkbox" :disabled="isLocked || isMockProvider" />
              <span><strong>失败时降级</strong><small>真实模型异常后使用 Mock</small></span>
            </label>
          </div>

          <p v-if="busy" class="model-dialog-notice">当前有任务正在执行或等待审批，结束后才能切换模型。</p>
          <p v-if="error" class="model-dialog-error">{{ error }}</p>
          <div v-if="testResult" class="model-test-result">
            <span>✓</span>
            <div>
              <strong>{{ testResult.message }}</strong>
              <small>{{ testResult.model }} · {{ testResult.latencyMs }}ms · {{ testResult.mode === "real" ? "真实调用" : "本地模拟" }}</small>
            </div>
          </div>

          <footer class="model-dialog-actions">
            <button class="ghost-button" type="button" :disabled="isLocked" @click="emit('test', createPayload())">
              {{ testing ? "正在测试…" : "测试连接" }}
            </button>
            <button type="submit" :disabled="isLocked || !model.trim() || !baseUrl.trim()">
              {{ saving ? "正在保存…" : "保存并应用" }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
