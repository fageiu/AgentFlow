<script setup lang="ts">
import type { AgentStep } from "@agentflow/shared";

defineProps<{
  steps: AgentStep[];
  messageId: string;
  resolvingApproval: boolean;
}>();

defineEmits<{
  resolveApproval: [action: "approve" | "reject", messageId: string];
}>();
</script>

<template>
  <div class="timeline embedded">
    <article
      v-for="(step, index) in steps"
      :key="step.id"
      class="step-card"
      :class="`step-${step.type}`"
    >
      <div class="step-index">{{ index + 1 }}</div>
      <div class="step-body">
        <div class="step-header">
          <div>
            <span class="step-type">{{ step.type.replace("_", " ") }}</span>
            <h3>{{ step.title }}</h3>
          </div>
          <span v-if="step.durationMs != null" class="duration">{{ step.durationMs }}ms</span>
        </div>

        <p v-if="step.toolName" class="tool-name">{{ step.toolName }}</p>
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
