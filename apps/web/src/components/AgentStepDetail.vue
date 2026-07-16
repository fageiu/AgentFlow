<script setup lang="ts">
import { computed } from "vue";
import type { AgentStep } from "@agentflow/shared";
import PolicyRetrievalDetail from "./PolicyRetrievalDetail.vue";
import { buildStepErrorSummary } from "../utils/errors";
import {
  getStepStatusLabel,
  getStepSummary,
  parseStepDetail,
} from "../utils/trace";

const props = defineProps<{
  step: AgentStep;
  index: number;
  messageId: string;
  resolvingApproval: boolean;
}>();

defineEmits<{
  resolveApproval: [action: "approve" | "reject", messageId: string];
}>();

const errorSummary = computed(() => buildStepErrorSummary(props.step));
const summary = computed(() => getStepSummary(props.step));
const isPendingApproval = computed(() => props.step.approvalRequest?.status === "pending");
const shouldShowSummary = computed(() => Boolean(errorSummary.value)
  || Boolean(props.step.fallback)
  || isPendingApproval.value
  || props.step.status !== "completed");
const toolDetail = computed(() => {
  if (props.step.type !== "tool_call") {
    return undefined;
  }
  const data = parseStepDetail(props.step.detail).data;
  return data ? {
    input: data.input,
    output: data.output,
    riskLevel: typeof data.riskLevel === "string" ? data.riskLevel : undefined,
  } : undefined;
});

function formatToolPayload(value: unknown) {
  if (value == null) return "暂无";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

const statusMark = computed(() => {
  if (isPendingApproval.value) {
    return "◆";
  }

  const marks: Record<NonNullable<AgentStep["status"]>, string> = {
    running: "…",
    completed: "✓",
    failed: "!",
    cancelled: "—",
  };

  return props.step.status ? marks[props.step.status] : "○";
});

const approvalPreview = computed(() => {
  const input = props.step.approvalRequest?.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "请确认该高风险业务操作。";
  }

  const values = input as Record<string, unknown>;
  return [
    values.orderId ? `订单 ${values.orderId}` : "",
    values.amount != null ? `金额 ¥${values.amount}` : "",
    values.reason ? String(values.reason) : "",
  ].filter(Boolean).join(" · ");
});
</script>

<template>
  <article
    class="run-flow-step cli-trace-row"
    :class="[`run-flow-step-${step.type}`, `run-flow-step-${step.status ?? 'pending'}`]"
  >
    <div class="run-flow-rail">
      <span class="run-flow-dot">{{ statusMark }}</span>
    </div>

    <div class="run-flow-step-main">
      <div class="run-flow-step-line">
          <div class="run-flow-step-title">
            <strong>{{ step.title }}</strong>
        </div>

        <div class="run-flow-step-meta">
          <span v-if="step.toolName" class="run-flow-tool">{{ step.toolName }}</span>
          <span v-if="step.fallback" class="run-flow-fallback">Mock 降级</span>
          <span class="run-flow-state">{{ getStepStatusLabel(step.status) }}</span>
          <span v-if="step.durationMs != null">{{ step.durationMs }}ms</span>
        </div>
      </div>

      <p v-if="shouldShowSummary" class="run-flow-step-summary">{{ summary }}</p>

      <details v-if="toolDetail" class="plan-tool-detail standalone-tool-detail">
        <summary>
          <span>工具调用</span>
          <small>{{ step.toolName }}<template v-if="step.durationMs != null"> · {{ step.durationMs }}ms</template></small>
        </summary>
        <dl class="plan-tool-meta">
          <div>
            <dt>工具</dt>
            <dd>{{ step.toolName }}</dd>
          </div>
          <div v-if="toolDetail.riskLevel">
            <dt>风险</dt>
            <dd>{{ toolDetail.riskLevel }}</dd>
          </div>
        </dl>
        <div class="plan-tool-payload">
          <strong>输入</strong>
          <pre>{{ formatToolPayload(toolDetail.input) }}</pre>
        </div>
        <PolicyRetrievalDetail
          v-if="step.toolName === 'searchPolicy'"
          :output="toolDetail.output"
        />
        <div class="plan-tool-payload">
          <strong>{{ step.toolName === 'searchPolicy' ? '原始输出' : '输出' }}</strong>
          <pre>{{ formatToolPayload(toolDetail.output) }}</pre>
        </div>
      </details>

      <p v-if="step.fallback" class="run-flow-fallback-notice">
        {{ step.fallback.provider }}/{{ step.fallback.model }} 调用失败，本步骤已使用 Mock 结果。
      </p>

      <p v-if="isPendingApproval" class="approval-preview">{{ approvalPreview }}</p>

      <div v-if="errorSummary" class="step-error-summary compact">
        <strong>{{ errorSummary.title }}</strong>
        <p>{{ errorSummary.message }}</p>
        <small>{{ errorSummary.advice }}</small>
      </div>

      <div v-if="isPendingApproval" class="approval-actions inline">
        <button
          type="button"
          class="approve-button"
          :disabled="resolvingApproval"
          @click="$emit('resolveApproval', 'approve', messageId)"
        >
          批准
        </button>
        <button
          type="button"
          class="reject-button"
          :disabled="resolvingApproval"
          @click="$emit('resolveApproval', 'reject', messageId)"
        >
          拒绝
        </button>
      </div>
    </div>
  </article>
</template>
