<script setup lang="ts">
import { computed } from "vue";
import type { AgentRun, AgentStep } from "@agentflow/shared";
import AgentStepDetail from "./AgentStepDetail.vue";
import { buildCompactTraceItems } from "../utils/trace";

const props = defineProps<{
  steps: AgentStep[];
  status?: AgentRun["status"] | "idle";
  messageId: string;
  resolvingApproval: boolean;
}>();

defineEmits<{
  resolveApproval: [action: "approve" | "reject", messageId: string];
}>();

const compactItems = computed(() => buildCompactTraceItems(props.steps));
const completedCount = computed(() => props.steps.filter((step) => step.status === "completed").length);
const streamingActivity = computed(() => {
  const lastStep = props.steps.at(-1);

  if (!lastStep) {
    return "正在制定处理方案";
  }

  if (lastStep.status === "failed") {
    return "正在处理异常并调整方案";
  }

  if (lastStep.type === "plan") {
    return "正在按方案核查业务信息";
  }

  if (lastStep.type === "observation") {
    return "正在根据执行观察继续处理";
  }

  return "正在执行下一步";
});
</script>

<template>
  <section class="run-flow embedded" aria-label="Agent 执行流程">
    <div class="run-flow-header">
      <div>
        <span class="run-flow-kicker">Agent activity</span>
        <strong>处理进度</strong>
      </div>
      <span>{{ status === "running" ? `${completedCount} 项已完成` : `${completedCount} / ${steps.length} 完成` }}</span>
    </div>

    <div class="run-flow-list">
      <template v-for="(item, index) in compactItems" :key="item.kind === 'read_group' ? item.steps[0]?.id : item.step.id">
        <details v-if="item.kind === 'plan' || item.kind === 'replan'" class="execution-plan" :open="item.kind === 'replan'">
          <summary>
            <span class="execution-plan-mark">{{ item.kind === "plan" ? "✓" : "↻" }}</span>
            <span>
              <strong>{{ item.kind === "plan" ? "已制定处理方案" : "已根据观察调整方案" }}</strong>
              <small>{{ item.kind === "plan" ? `${item.plan.steps.length} 个步骤` : "剩余步骤已更新" }}</small>
            </span>
          </summary>
          <p v-if="item.observation" class="execution-plan-observation">{{ item.observation }}</p>
          <p class="execution-plan-summary">{{ item.plan.summary }}</p>
          <ol class="execution-plan-list">
            <li v-for="planStep in item.plan.steps" :key="planStep.id">
              <span>{{ planStep.title }}</span>
              <small>{{ planStep.allowedTools.join(" · ") }}{{ planStep.requiresApproval ? " · 需审批" : "" }}</small>
            </li>
          </ol>
        </details>

        <details v-else-if="item.kind === 'read_group'" class="execution-read-group">
          <summary>
            <span class="execution-plan-mark">✓</span>
            <span><strong>已完成业务核查</strong><small>{{ item.steps.length }} 项读取</small></span>
          </summary>
          <ul>
            <li v-for="step in item.steps" :key="step.id">
              <span>{{ step.title }}</span><small>{{ step.toolName }}</small>
            </li>
          </ul>
        </details>

        <AgentStepDetail
          v-else
          :step="item.step"
          :index="index"
          :message-id="messageId"
          :resolving-approval="resolvingApproval"
          @resolve-approval="$emit('resolveApproval', $event, messageId)"
        />
      </template>

      <div v-if="status === 'running'" class="streaming-activity" role="status" aria-live="polite">
        <span class="streaming-cursor" aria-hidden="true"></span>
        <strong>{{ streamingActivity }}</strong>
        <small>流式执行中</small>
      </div>
    </div>
  </section>
</template>
