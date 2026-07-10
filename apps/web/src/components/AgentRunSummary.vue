<script setup lang="ts">
import { computed } from "vue";
import type { AgentRun } from "@agentflow/shared";
import { splitFinalResponseForDisplay } from "../utils/finalResponse";
import { getRunStatusLabel } from "../utils/labels";
import AgentErrorSummary from "./AgentErrorSummary.vue";

const props = defineProps<{
  run?: AgentRun;
  fallbackErrorMessage?: string;
  finalMessage?: string;
}>();

const conclusionLines = computed(() => splitFinalResponseForDisplay(props.finalMessage));
const visibleConclusionLines = computed(() => conclusionLines.value.slice(0, 3));
const hiddenConclusionLines = computed(() => conclusionLines.value.slice(3));
const hasError = computed(() => Boolean(props.run?.error || props.fallbackErrorMessage));

function getResultDescription(run: AgentRun | undefined) {
  if (run?.status === "cancelled") {
    return "本次任务已取消，可重试上一条任务。";
  }

  if (run?.status === "waiting_approval") {
    return "本次任务正在等待人工审批，审批完成后会继续执行。";
  }

  if (run?.status === "running") {
    return "Agent 正在执行任务，完成后会在这里汇总结果。";
  }

  return "等待执行完成后在此汇总业务结论。";
}
</script>

<template>
  <section v-if="props.run || fallbackErrorMessage || conclusionLines.length" class="agent-final-response">
    <div class="agent-final-header">
      <div>
        <span class="run-flow-kicker">Outcome</span>
        <strong>{{ hasError ? "处理结果" : "处理结论" }}</strong>
      </div>
      <span class="agent-final-status" :class="`status-${props.run?.status ?? 'idle'}`">{{ getRunStatusLabel(props.run?.status) }}</span>
    </div>

    <AgentErrorSummary
      v-if="hasError"
      :error="props.run?.error"
      :fallback-message="fallbackErrorMessage"
      compact
    />

    <p v-else-if="props.run?.status !== 'completed'" class="agent-final-description">{{ getResultDescription(props.run) }}</p>

    <div v-else-if="conclusionLines.length" class="agent-final-message">
      <p v-for="line in visibleConclusionLines" :key="line">{{ line }}</p>
      <details v-if="hiddenConclusionLines.length" class="agent-final-more">
        <summary>展开完整结论（{{ hiddenConclusionLines.length }} 项）</summary>
        <p v-for="line in hiddenConclusionLines" :key="line">{{ line }}</p>
      </details>
    </div>
  </section>
</template>
