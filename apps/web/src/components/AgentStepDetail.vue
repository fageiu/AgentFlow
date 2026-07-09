<script setup lang="ts">
import { computed } from "vue";
import type { AgentStep } from "@agentflow/shared";
import { buildStepErrorSummary } from "../utils/errors";
import {
  getStepStatusLabel,
  getStepSummary,
  getStepTypeLabel,
  parseStepDetail,
  shouldOpenStepDetail,
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

const parsedDetail = computed(() => parseStepDetail(props.step.detail));
const errorSummary = computed(() => buildStepErrorSummary(props.step));
const summary = computed(() => getStepSummary(props.step));
const isDetailOpen = computed(() => shouldOpenStepDetail(props.step));
</script>

<template>
  <article
    class="run-flow-step"
    :class="[`run-flow-step-${step.type}`, `run-flow-step-${step.status ?? 'pending'}`]"
  >
    <div class="run-flow-rail">
      <span class="run-flow-dot">{{ index + 1 }}</span>
    </div>

    <div class="run-flow-step-main">
      <div class="run-flow-step-line">
        <div class="run-flow-step-title">
          <span>{{ getStepTypeLabel(step.type) }}</span>
          <strong>{{ step.title }}</strong>
        </div>

        <div class="run-flow-step-meta">
          <span v-if="step.toolName" class="run-flow-tool">{{ step.toolName }}</span>
          <span class="run-flow-state">{{ getStepStatusLabel(step.status) }}</span>
          <span v-if="step.durationMs != null">{{ step.durationMs }}ms</span>
        </div>
      </div>

      <p class="run-flow-step-summary">{{ summary }}</p>

      <div v-if="errorSummary" class="step-error-summary compact">
        <strong>{{ errorSummary.title }}</strong>
        <p>{{ errorSummary.message }}</p>
        <small>{{ errorSummary.advice }}</small>
      </div>

      <details class="run-flow-detail" :open="isDetailOpen">
        <summary>查看原始细节</summary>

        <dl v-if="parsedDetail.data" class="run-flow-detail-grid">
          <div v-if="parsedDetail.data.toolCallId">
            <dt>Tool Call</dt>
            <dd>{{ parsedDetail.data.toolCallId }}</dd>
          </div>
          <div v-if="parsedDetail.data.riskLevel">
            <dt>风险等级</dt>
            <dd>{{ parsedDetail.data.riskLevel }}</dd>
          </div>
          <div v-if="step.modelName">
            <dt>模型</dt>
            <dd>{{ step.modelName }}</dd>
          </div>
          <div v-if="step.tokenUsage">
            <dt>Token</dt>
            <dd>{{ step.tokenUsage.totalTokens }}</dd>
          </div>
        </dl>

        <pre>{{ step.detail }}</pre>
      </details>

      <div v-if="step.approvalRequest?.status === 'pending'" class="approval-actions inline">
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
