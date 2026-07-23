import type { AgentPlan, AgentPlanStep, AgentStep } from "@agentflow/shared";
import { buildStepErrorSummary } from "./errors";

export interface ParsedStepDetail {
  raw: string;
  data?: Record<string, unknown>;
}

export type CompactTraceItem =
  | {
      kind: "plan" | "replan";
      step: AgentStep;
      plan: AgentPlan;
      observation?: string;
    }
  | {
      kind: "read_group";
      steps: AgentStep[];
    }
  | {
      kind: "step";
      step: AgentStep;
    };

const stepTypeLabels: Record<AgentStep["type"], string> = {
  plan: "计划",
  tool_call: "工具",
  observation: "观察",
  approval: "审批",
  final: "结果",
};

const stepStatusLabels: Record<NonNullable<AgentStep["status"]>, string> = {
  running: "执行中",
  completed: "完成",
  failed: "失败",
  cancelled: "取消",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentPlanStep(value: unknown): value is AgentPlanStep {
  return isPlainObject(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.objective === "string"
    && Array.isArray(value.allowedTools)
    && value.allowedTools.every((tool) => typeof tool === "string");
}

function isAgentPlan(value: unknown): value is AgentPlan {
  return isPlainObject(value)
    && value.version === 1
    && typeof value.summary === "string"
    && Array.isArray(value.steps)
    && value.steps.every(isAgentPlanStep);
}

function toCompactText(value: unknown): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} 项`;
  }

  if (isPlainObject(value)) {
    return Object.entries(value)
      .slice(0, 3)
      .map(([key, item]) => `${key}: ${toCompactText(item)}`)
      .join("，");
  }

  return String(value);
}

function truncateText(value: string, maxLength = 150) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function parseStepDetail(detail: string): ParsedStepDetail {
  try {
    const parsed = JSON.parse(detail) as unknown;
    return {
      raw: detail,
      data: isPlainObject(parsed) ? parsed : undefined,
    };
  } catch {
    return {
      raw: detail,
    };
  }
}

/** 从计划或重规划 observation 中提取结构化计划，供紧凑执行流展示。 */
export function getStepPlan(step: AgentStep) {
  const detail = parseStepDetail(step.detail).data;
  if (isAgentPlan(detail)) {
    return { plan: detail };
  }

  if (detail && isAgentPlan(detail.remainingPlan)) {
    return {
      plan: detail.remainingPlan,
      observation: typeof detail.observation === "string" ? detail.observation : undefined,
    };
  }

  return undefined;
}

const planningTicketContextTitles = new Set([
  "读取工单上下文（用于制定计划）",
  "读取工单详情（用于制定计划）",
]);

/**
 * 通过稳定的 toolCallId 识别 Planner 前的工单预读取步骤，并兼容没有该字段的历史 trace。
 * 避免前后端展示文案调整后，步骤被普通只读工具分组吞掉。
 */
export function isPlanningTicketContextStep(step: AgentStep) {
  const detail = parseStepDetail(step.detail).data;
  return step.type === "tool_call" && step.toolName === "getTicket"
    && (detail?.toolCallId === "planning-ticket-context" || planningTicketContextTitles.has(step.title));
}

/**
 * 将 trace 转换成面向业务用户的紧凑记录：连续只读核查合并，计划与重规划单独呈现。
 * 原始 AgentStep 仍保留在详情里，避免牺牲审计信息。
 */
export function buildCompactTraceItems(steps: AgentStep[]): CompactTraceItem[] {
  const items: CompactTraceItem[] = [];
  const readTools = new Set(["getTicket", "getCustomer", "getOrder", "searchPolicy"]);

  for (let index = 0; index < steps.length;) {
    const step = steps[index];
    const planDetail = getStepPlan(step);

    if (planDetail) {
      items.push({
        kind: step.type === "plan" ? "plan" : "replan",
        step,
        plan: planDetail.plan,
        observation: planDetail.observation,
      });
      index += 1;
      continue;
    }

    if (step.type === "tool_call" && step.status === "completed" && step.toolName && readTools.has(step.toolName)
      && !isPlanningTicketContextStep(step)) {
      const groupedSteps: AgentStep[] = [step];
      index += 1;

      while (index < steps.length) {
        const candidate = steps[index];
        if (candidate.type !== "tool_call" || candidate.status !== "completed" || !candidate.toolName
          || !readTools.has(candidate.toolName)) {
          break;
        }
        groupedSteps.push(candidate);
        index += 1;
      }

      items.push({ kind: "read_group", steps: groupedSteps });
      continue;
    }

    items.push({ kind: "step", step });
    index += 1;
  }

  return items;
}

export function getStepTypeLabel(type: AgentStep["type"]) {
  return stepTypeLabels[type];
}

export function getStepStatusLabel(status: AgentStep["status"]) {
  return status ? stepStatusLabels[status] : "待记录";
}

export function getStepSummary(step: AgentStep) {
  const errorSummary = buildStepErrorSummary(step);

  if (errorSummary) {
    return errorSummary.message;
  }

  // 将工具 trace 的 JSON 压缩成单行摘要，默认界面先展示业务含义，原始细节交给折叠区。
  const detail = parseStepDetail(step.detail);

  if (!detail.data) {
    return truncateText(step.detail);
  }

  if (isPlainObject(detail.data.retry)) {
    const retry = detail.data.retry;
    const attempt = retry.attempt ? `第 ${toCompactText(retry.attempt)} 次重试` : "准备重试";
    const retryToolName = retry.recoveryToolName ?? retry.toolName ?? retry.failedToolName;
    const toolName = retryToolName ? `工具 ${toCompactText(retryToolName)}` : "当前工具";
    const reason = retry.reason ? `原因 ${toCompactText(retry.reason)}` : "";

    return truncateText([attempt, toolName, reason].filter(Boolean).join(" · "));
  }

  const input = detail.data.input;
  const output = detail.data.output;
  const riskLevel = detail.data.riskLevel;
  const status = detail.data.status;
  const parts: string[] = [];

  if (step.type === "tool_call" && step.toolName) {
    parts.push(`调用 ${step.toolName}`);
  }

  if (riskLevel) {
    parts.push(`风险 ${toCompactText(riskLevel)}`);
  }

  if (status) {
    parts.push(`状态 ${toCompactText(status)}`);
  }

  if (input) {
    parts.push(`输入 ${toCompactText(input)}`);
  }

  if (output) {
    parts.push(`输出 ${toCompactText(output)}`);
  }

  return parts.length > 0 ? truncateText(parts.join(" · ")) : truncateText(step.detail);
}

export function shouldOpenStepDetail(step: AgentStep) {
  return step.status === "failed" || step.approvalRequest?.status === "pending";
}

export function getTraceSteps(steps: AgentStep[] | undefined) {
  return (steps ?? []).filter((step) => step.type !== "final");
}

export function getFinalStepMessage(steps: AgentStep[] | undefined) {
  return [...(steps ?? [])].reverse().find((step) => step.type === "final")?.detail;
}
