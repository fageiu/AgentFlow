<script setup lang="ts">
import { computed } from "vue";
import type { AgentRun } from "@agentflow/shared";
import { buildBusinessConclusion, getTicketRequirement } from "../utils/finalResponse";
import { getRunStatusLabel } from "../utils/labels";
import { buildAgentErrorSummary } from "../utils/errors";

const props = defineProps<{
  run?: AgentRun;
  fallbackErrorMessage?: string;
  finalMessage?: string;
}>();

const isCancelled = computed(() => props.run?.status === "cancelled");
const hasError = computed(() => props.run?.status === "failed"
  && Boolean(props.run.error || props.fallbackErrorMessage));
const errorSummary = computed(() => buildAgentErrorSummary(props.run?.error, props.fallbackErrorMessage));
const ticketRequirement = computed(() => getTicketRequirement(props.run?.steps));
const conclusionSections = computed(() => {
  const task = props.run?.task ?? "未提供工单任务";

  if (isCancelled.value) {
    return [
      { label: "工单需求" as const, value: ticketRequirement.value ?? task },
      { label: "处理结果" as const, value: "本次执行已由用户取消，Agent 已停止推进后续步骤。" },
      { label: "处理依据" as const, value: "用户主动终止任务，不属于执行异常；取消前已完成的动作仍保留在 Trace 中。" },
      { label: "下一步" as const, value: "可检查已完成步骤和业务状态后，重试上一条任务。" },
    ];
  }

  if (hasError.value) {
    return [
      { label: "工单需求" as const, value: ticketRequirement.value ?? task },
      { label: "处理结果" as const, value: `未完成：${errorSummary.value?.message ?? "执行过程中发生错误。"}` },
      { label: "处理依据" as const, value: errorSummary.value?.title ?? "执行 trace 中出现失败步骤。" },
      { label: "下一步" as const, value: errorSummary.value?.advice ?? "请修正问题后重新发起处理。" },
    ];
  }

  return buildBusinessConclusion(task, props.finalMessage, ticketRequirement.value);
});

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
  <section v-if="props.run || fallbackErrorMessage || conclusionSections.length" class="agent-final-response">
    <div class="agent-final-header">
      <div>
        <span class="run-flow-kicker">Outcome</span>
        <strong>{{ hasError || isCancelled ? "处理结果" : "处理结论" }}</strong>
      </div>
      <span class="agent-final-status" :class="`status-${props.run?.status ?? 'idle'}`">{{ getRunStatusLabel(props.run?.status) }}</span>
    </div>

    <p v-if="!hasError && !isCancelled && props.run?.status !== 'completed'" class="agent-final-description">{{ getResultDescription(props.run) }}</p>

    <p v-if="(props.run?.metrics?.fallbackCount ?? 0) > 0" class="agent-fallback-warning">
      本次运行有 {{ props.run?.metrics?.fallbackCount }} 次模型调用降级为 Mock，结果不代表真实模型表现。
    </p>

    <dl class="agent-conclusion-grid">
      <div v-for="section in conclusionSections" :key="section.label">
        <dt>{{ section.label }}</dt>
        <dd>{{ section.value }}</dd>
      </div>
    </dl>
  </section>
</template>
