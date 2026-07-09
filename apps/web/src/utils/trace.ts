import type { AgentStep } from "@agentflow/shared";
import { buildStepErrorSummary } from "./errors";

export interface ParsedStepDetail {
  raw: string;
  data?: Record<string, unknown>;
}

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
    const toolName = retry.toolName ? `工具 ${toCompactText(retry.toolName)}` : "当前工具";
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
