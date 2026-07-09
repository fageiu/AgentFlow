<script setup lang="ts">
import type { AgentStep } from "@agentflow/shared";
import { buildStepErrorSummary } from "../utils/errors";

defineProps<{
  steps: AgentStep[];
  messageId: string;
  resolvingApproval: boolean;
}>();

defineEmits<{
  resolveApproval: [action: "approve" | "reject", messageId: string];
}>();

function getStepStatusLabel(status: AgentStep["status"]) {
  const labels: Record<NonNullable<AgentStep["status"]>, string> = {
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };

  return status ? labels[status] : "";
}
</script>

<template>
  <div class="timeline embedded">
    <article
      v-for="(step, index) in steps"
      :key="step.id"
      class="step-card"
      :class="[`step-${step.type}`, { 'step-failed': step.status === 'failed' }]"
    >
      <div class="step-index">{{ index + 1 }}</div>
      <div class="step-body">
        <div class="step-header">
          <div>
            <span class="step-type">{{ step.type.replace("_", " ") }}</span>
            <h3>{{ step.title }}</h3>
          </div>
          <div class="step-badges">
            <span
              v-if="step.status"
              class="step-status"
              :class="`step-status-${step.status}`"
            >
              {{ getStepStatusLabel(step.status) }}
            </span>
            <span v-if="step.durationMs != null" class="duration">{{ step.durationMs }}ms</span>
          </div>
        </div>

        <p v-if="step.toolName" class="tool-name">{{ step.toolName }}</p>

        <div v-if="buildStepErrorSummary(step)" class="step-error-summary">
          <strong>{{ buildStepErrorSummary(step)?.title }}</strong>
          <p>{{ buildStepErrorSummary(step)?.message }}</p>
          <small>{{ buildStepErrorSummary(step)?.advice }}</small>
        </div>

        <pre>{{ step.detail }}</pre>

        <div v-if="step.approvalRequest?.status === 'pending'" class="approval-actions">
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
  </div>
</template>
