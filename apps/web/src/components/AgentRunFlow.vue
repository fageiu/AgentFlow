<script setup lang="ts">
import { computed } from "vue";
import type { AgentPlanStep, AgentRun, AgentStep } from "@agentflow/shared";
import AgentStepDetail from "./AgentStepDetail.vue";
import { buildStepErrorSummary } from "../utils/errors";
import { buildCompactTraceItems, getStepPlan } from "../utils/trace";

type PlanProgressStatus = "completed" | "failed" | "rejected" | "skipped" | "cancelled" | "approval" | "running" | "current" | "pending";

interface PlanProgressItem {
  step: AgentPlanStep;
  status: PlanProgressStatus;
  approvalStep?: AgentStep;
  errorMessage?: string;
}

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
const planProgress = computed(() => {
  const planSteps: AgentPlanStep[] = [];
  let wasAdjusted = false;

  for (const traceStep of props.steps) {
    const planDetail = getStepPlan(traceStep);
    if (!planDetail) {
      continue;
    }

    if (traceStep.type !== "plan") {
      wasAdjusted = true;
    }

    for (const planStep of planDetail.plan.steps) {
      if (!planSteps.some((item) => item.allowedTools[0] === planStep.allowedTools[0])) {
        planSteps.push(planStep);
      }
    }
  }

  const items: PlanProgressItem[] = planSteps.map((planStep) => {
    const toolName = planStep.allowedTools[0];
    const executions = props.steps.filter((step) => step.toolName === toolName && (step.type === "tool_call" || step.type === "approval"));
    const latest = executions.at(-1);
    const approvalStep = [...executions].reverse().find((step) => step.approvalRequest?.status === "pending");

    if (approvalStep) {
      return { step: planStep, status: "approval", approvalStep };
    }
    if (latest?.approvalRequest?.status === "rejected") {
      return { step: planStep, status: props.status === "cancelled" ? "cancelled" : "rejected" };
    }
    if (latest?.status === "failed") {
      return {
        step: planStep,
        status: "failed",
        errorMessage: buildStepErrorSummary(latest)?.message ?? "该步骤未完成，请根据提示调整后重试。",
      };
    }
    if (latest?.status === "completed") {
      return { step: planStep, status: "completed" };
    }
    if (latest?.status === "running") {
      return { step: planStep, status: "running" };
    }
    return { step: planStep, status: "pending" };
  });

  // 审批拒绝后，依赖该动作的后续计划不能继续执行，须明确标记为跳过而非“待执行”。
  const rejectedIndex = items.findIndex((item) => item.status === "rejected");
  if (rejectedIndex >= 0 && props.status !== "running") {
    for (const item of items.slice(rejectedIndex + 1)) {
      if (item.status === "pending") {
        item.status = "skipped";
      }
    }
  }

  // 取消后已完成步骤保持原状态，尚未开始或仍在等待的步骤统一标记为未执行。
  if (props.status === "cancelled") {
    for (const item of items) {
      if (item.status === "pending" || item.status === "running" || item.status === "approval") {
        item.status = "cancelled";
      }
    }
  }

  if (props.status === "running") {
    const nextItem = items.find((item) => item.status === "pending");
    if (nextItem) {
      nextItem.status = "current";
    }
  }

  return {
    items,
    adjusted: wasAdjusted,
    completed: items.filter((item) => item.status === "completed").length,
    rejected: items.filter((item) => item.status === "rejected").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    cancelled: items.filter((item) => item.status === "cancelled").length,
  };
});

const visibleSteps = computed(() => {
  const plannedTools = new Set(planProgress.value.items.map((item) => item.step.allowedTools[0]));

  return compactItems.value.flatMap((item) => {
    if (item.kind !== "step") {
      return [];
    }

    const step = item.step;
    if (step.title === "读取工单上下文（用于制定计划）") {
      return [];
    }
    if (step.toolName && plannedTools.has(step.toolName)) {
      return [];
    }
    return [step];
  });
});

function getPlanMark(status: PlanProgressStatus) {
  return {
    completed: "✓",
    failed: "!",
    rejected: "×",
    skipped: "—",
    cancelled: "—",
    approval: "◆",
    running: "…",
    current: "›",
    pending: "○",
  }[status];
}

function getPlanStatusLabel(status: PlanProgressStatus) {
  return {
    completed: "已完成",
    failed: "需处理",
    rejected: "已拒绝",
    skipped: "已跳过",
    cancelled: "未执行",
    approval: "等待审批",
    running: "执行中",
    current: "下一步",
    pending: "待执行",
  }[status];
}
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
      <span v-if="planProgress.items.length">
        {{ planProgress.completed }} 已完成
        <template v-if="planProgress.rejected"> · {{ planProgress.rejected }} 已拒绝</template>
        <template v-if="planProgress.skipped"> · {{ planProgress.skipped }} 已跳过</template>
        <template v-if="planProgress.cancelled"> · {{ planProgress.cancelled }} 未执行</template>
      </span>
      <span v-else>{{ status === "running" ? "正在准备" : `${steps.length} 步` }}</span>
    </div>

    <div class="run-flow-list">
      <section v-if="planProgress.items.length" class="plan-progress-card" aria-label="处理方案进度">
        <div class="plan-progress-heading">
          <strong>{{ planProgress.adjusted ? "处理方案已调整" : "处理方案" }}</strong>
          <span>{{ planProgress.items.length }} 个步骤</span>
        </div>
        <ol class="plan-progress-list">
          <li
            v-for="item in planProgress.items"
            :key="item.step.id"
            class="plan-progress-item"
            :class="`plan-progress-${item.status}`"
          >
            <span class="plan-progress-mark">{{ getPlanMark(item.status) }}</span>
            <span class="plan-progress-title">{{ item.step.title }}</span>
            <small>{{ getPlanStatusLabel(item.status) }}</small>

            <div v-if="item.status === 'approval'" class="approval-actions inline plan-progress-controls">
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
            <p v-if="item.errorMessage" class="plan-progress-error">{{ item.errorMessage }}</p>
          </li>
        </ol>
      </section>

      <template v-for="(step, index) in visibleSteps" :key="step.id">
        <AgentStepDetail
          :step="step"
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
