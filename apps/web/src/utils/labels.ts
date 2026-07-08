import type { AgentRun } from "@agentflow/shared";

type UiStatus = AgentRun["status"] | "idle";

export function getRunStatusLabel(value: UiStatus | undefined) {
  const labels: Record<UiStatus, string> = {
    idle: "待执行",
    running: "执行中",
    waiting_approval: "待审批",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };

  return labels[value ?? "idle"];
}

export function getEvaluationStatusLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    passed: "通过",
    failed: "失败",
    error: "错误",
    running: "运行中",
    completed: "已完成",
    new: "新增",
    regressed: "回退",
    recovered: "恢复",
    unchanged_passed: "保持通过",
    unchanged_failed: "保持失败",
  };

  return labels[value ?? ""] ?? value ?? "未知";
}
