<script setup lang="ts">
import { computed } from "vue";
import type { AgentErrorInfo } from "@agentflow/shared";
import { buildAgentErrorSummary } from "../utils/errors";

const props = defineProps<{
  error?: AgentErrorInfo;
  fallbackMessage?: string;
  compact?: boolean;
}>();

const summary = computed(() => buildAgentErrorSummary(props.error, props.fallbackMessage));
</script>

<template>
  <article v-if="summary" class="agent-error-summary" :class="{ compact }">
    <div>
      <span>具体原因</span>
      <strong>{{ summary.title }}</strong>
      <p>{{ summary.message }}</p>
    </div>

    <dl v-if="!compact && (summary.code || summary.category || summary.retryable != null)" class="agent-error-meta">
      <div v-if="summary.code">
        <dt>错误码</dt>
        <dd>{{ summary.code }}</dd>
      </div>
      <div v-if="summary.category">
        <dt>类型</dt>
        <dd>{{ summary.category }}</dd>
      </div>
      <div v-if="summary.retryable != null">
        <dt>可重试</dt>
        <dd>{{ summary.retryable ? "是" : "否" }}</dd>
      </div>
    </dl>

    <p class="agent-error-advice">{{ summary.advice }}</p>
  </article>
</template>
