<script setup lang="ts">
import { computed } from "vue";
import type { AgentPlanStep, AgentRun, AgentStep } from "@agentflow/shared";
import AgentStepDetail from "./AgentStepDetail.vue";
import PolicyRetrievalDetail from "./PolicyRetrievalDetail.vue";
import { buildStepErrorSummary } from "../utils/errors";
import { buildCompactTraceItems, getStepPlan, parseStepDetail } from "../utils/trace";

type PlanProgressStatus = "completed" | "failed" | "rejected" | "skipped" | "cancelled" | "approval" | "running" | "current" | "pending";

interface PlanProgressItem {
  step: AgentPlanStep;
  status: PlanProgressStatus;
  approvalStep?: AgentStep;
  executionStep?: AgentStep;
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
const toolBusinessTitles: Record<string, string> = {
  listTickets: "查询全部工单",
  searchTickets: "按条件筛选工单",
  getTicket: "读取工单详情",
  getCustomer: "核查客户信息",
  getOrder: "核查订单信息",
  searchPolicy: "检索适用业务规则",
  createRefund: "创建退款申请",
  updateTicketStatus: "同步工单状态",
};

/** 历史计划可能使用“执行 toolName”兜底标题，展示时统一转换为业务动作。 */
function getPlanStepTitle(step: AgentPlanStep) {
  const toolName = step.allowedTools[0];
  const fallbackTitle = toolBusinessTitles[toolName];
  return !step.title.trim() || step.title.trim() === `执行 ${toolName}`
    ? fallbackTitle ?? step.title
    : step.title;
}

const planProgress = computed(() => {
  const planSteps: AgentPlanStep[] = [];
  let wasAdjusted = false;

  for (const traceStep of props.steps) {
    const planDetail = getStepPlan(traceStep);
    if (!planDetail) {
      continue;
    }

    // 只有执行器明确产生的失败恢复重规划才算“方案已调整”；Action Planner 的正常动作补充不属于 Replan。
    if (traceStep.title.includes("重规划")) {
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
      return { step: planStep, status: "approval", approvalStep, executionStep: approvalStep };
    }
    if (latest?.approvalRequest?.status === "rejected") {
      return {
        step: planStep,
        status: props.status === "cancelled" ? "cancelled" : "rejected",
        executionStep: latest,
      };
    }
    if (latest?.status === "failed") {
      return {
        step: planStep,
        status: "failed",
        executionStep: latest,
        errorMessage: buildStepErrorSummary(latest)?.message ?? "该步骤未完成，请根据提示调整后重试。",
      };
    }
    if (latest?.status === "completed") {
      return { step: planStep, status: "completed", executionStep: latest };
    }
    if (latest?.status === "running") {
      return { step: planStep, status: "running", executionStep: latest };
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

/** Planner 前的工单预读取不属于计划本身，但必须按真实时间顺序显示在方案卡片之前。 */
const planningContextSteps = computed(() => compactItems.value.flatMap((item) =>
  item.kind === "step" && item.step.title === "读取工单上下文（用于制定计划）"
    ? [item.step]
    : [],
));
const completedActivityCount = computed(() => planProgress.value.completed
  + planningContextSteps.value.filter((step) => step.status === "completed").length);

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

function getToolCallDetail(item: PlanProgressItem) {
  const step = item.executionStep;
  const data = step ? parseStepDetail(step.detail).data : undefined;
  const output = data?.output;
  const operation = output && typeof output === "object" && !Array.isArray(output)
    ? (output as Record<string, unknown>).operation
    : undefined;

  return {
    toolName: step?.toolName ?? item.step.allowedTools[0],
    riskLevel: typeof data?.riskLevel === "string"
      ? data.riskLevel
      : step?.approvalRequest?.riskLevel,
    input: data?.input ?? step?.approvalRequest?.input,
    output,
    operation: typeof operation === "string" ? operation : undefined,
    durationMs: step?.durationMs,
  };
}

function formatToolPayload(value: unknown) {
  if (value == null) {
    return "暂无";
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function shouldOpenToolDetail(item: PlanProgressItem) {
  return item.status === "failed" || item.status === "rejected" || item.status === "approval";
}
const streamingActivity = computed(() => {
  const lastStep = props.steps.at(-1);
  const activeItem = planProgress.value.items.find((item) =>
    item.status === "approval" || item.status === "running" || item.status === "current",
  );

  if (!lastStep) {
    return "正在制定处理方案";
  }

  if (lastStep.status === "failed") {
    return "正在处理异常并调整方案";
  }

  // 单工单任务会先读取上下文再调用 Planner；计划返回前不能误显示为“执行下一步”。
  if (planProgress.value.items.length === 0) {
    return lastStep.title === "读取工单上下文（用于制定计划）"
      ? "正在根据工单上下文制定处理方案"
      : "正在制定处理方案";
  }

  if (activeItem?.status === "approval") {
    return `等待人工审批：${getPlanStepTitle(activeItem.step)}`;
  }

  if (activeItem) {
    return `正在${getPlanStepTitle(activeItem.step)}`;
  }

  if (planProgress.value.items.length > 0
    && planProgress.value.items.every((item) => item.status === "completed")) {
    return "正在汇总处理结论";
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
        {{ completedActivityCount }} 已完成
        <template v-if="planProgress.rejected"> · {{ planProgress.rejected }} 已拒绝</template>
        <template v-if="planProgress.skipped"> · {{ planProgress.skipped }} 已跳过</template>
        <template v-if="planProgress.cancelled"> · {{ planProgress.cancelled }} 未执行</template>
      </span>
      <span v-else>{{ status === "running" ? "正在准备" : `${steps.length} 步` }}</span>
    </div>

    <div class="run-flow-list">
      <template v-for="(step, index) in planningContextSteps" :key="step.id">
        <AgentStepDetail
          :step="step"
          :index="index"
          :message-id="messageId"
          :resolving-approval="resolvingApproval"
          @resolve-approval="$emit('resolveApproval', $event, messageId)"
        />
      </template>

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
            <span class="plan-progress-title-block">
              <span class="plan-progress-title">{{ getPlanStepTitle(item.step) }}</span>
              <small>{{ item.step.allowedTools[0] }}</small>
            </span>
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

            <details
              v-if="item.executionStep"
              class="plan-tool-detail"
              :open="shouldOpenToolDetail(item)"
            >
              <summary>
                <span>工具调用</span>
                <small>
                  {{ getToolCallDetail(item).toolName }}
                  <template v-if="getToolCallDetail(item).durationMs != null">
                    · {{ getToolCallDetail(item).durationMs }}ms
                  </template>
                </small>
              </summary>
              <dl class="plan-tool-meta">
                <div>
                  <dt>工具</dt>
                  <dd>{{ getToolCallDetail(item).toolName }}</dd>
                </div>
                <div v-if="getToolCallDetail(item).riskLevel">
                  <dt>风险</dt>
                  <dd>{{ getToolCallDetail(item).riskLevel }}</dd>
                </div>
                <div v-if="getToolCallDetail(item).operation">
                  <dt>结果类型</dt>
                  <dd>{{ getToolCallDetail(item).operation }}</dd>
                </div>
              </dl>
              <div class="plan-tool-payload">
                <strong>输入</strong>
                <pre>{{ formatToolPayload(getToolCallDetail(item).input) }}</pre>
              </div>
              <PolicyRetrievalDetail
                v-if="getToolCallDetail(item).toolName === 'searchPolicy'"
                :output="getToolCallDetail(item).output"
              />
              <div class="plan-tool-payload">
                <strong>{{ getToolCallDetail(item).toolName === 'searchPolicy' ? '原始输出' : '输出' }}</strong>
                <pre>{{ formatToolPayload(getToolCallDetail(item).output) }}</pre>
              </div>
            </details>
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
