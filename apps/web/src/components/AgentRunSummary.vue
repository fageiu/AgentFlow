<script setup lang="ts">
import { computed } from "vue";
import type { AgentRun } from "@agentflow/shared";
import { formatFinalResponseForDisplay } from "../utils/finalResponse";
import { getRunStatusLabel } from "../utils/labels";
import AgentErrorSummary from "./AgentErrorSummary.vue";

const props = defineProps<{
  run?: AgentRun;
  fallbackErrorMessage?: string;
  finalMessage?: string;
}>();

const compactFinalMessage = computed(() => formatFinalResponseForDisplay(props.finalMessage));

function getResultDescription(run: AgentRun | undefined, hasErrorMessage: boolean) {
  if (run?.status === "completed") {
    return "本次任务已完成，以下为精简后的处理结论。";
  }

  if (run?.status === "failed" || hasErrorMessage) {
    return "本次任务执行失败，失败原因和处理建议如下。";
  }

  if (run?.status === "cancelled") {
    return "本次任务已取消，可重试上一条任务。";
  }

  if (run?.status === "waiting_approval") {
    return "本次任务正在等待人工审批，审批完成后会继续执行。";
  }

  if (run?.status === "running") {
    return "Agent 正在执行任务，完成后会在这里汇总结果。";
  }

  return "本次任务的最终结果会在这里汇总。";
}
</script>

<template>
  <section v-if="props.run || fallbackErrorMessage || compactFinalMessage" class="agent-final-response">
    <div class="agent-final-header">
      <div>
        <span class="run-flow-kicker">Final Response</span>
        <strong>{{ getRunStatusLabel(props.run?.status) }}</strong>
        <p>{{ getResultDescription(props.run, Boolean(fallbackErrorMessage)) }}</p>
      </div>
    </div>

    <AgentErrorSummary
      v-if="props.run?.error || fallbackErrorMessage"
      :error="props.run?.error"
      :fallback-message="fallbackErrorMessage"
      compact
    />

    <p v-else-if="compactFinalMessage" class="agent-final-message">{{ compactFinalMessage }}</p>
  </section>
</template>
