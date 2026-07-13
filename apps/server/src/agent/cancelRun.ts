import type { AgentRun } from "@agentflow/shared";
import { resolveApprovalForRun } from "../approval/approvalStore.js";
import { getRun } from "../trace/runStore.js";
import { requestRunCancel, type RunCancelRequest } from "./runControl.js";

export type CancelAgentRunResult =
  | { status: "accepted"; cancellation: RunCancelRequest; approvalResolved: boolean }
  | { status: "already_cancelled"; run: AgentRun }
  | { status: "not_found" }
  | { status: "not_cancellable"; run: AgentRun };

/**
 * 校验 run 生命周期后提交取消请求；等待审批的 run 会先拒绝审批，唤醒暂停中的 executor。
 * 已取消状态按幂等成功处理，其他终态拒绝再次取消。
 */
export function cancelAgentRun(runId: string, reason = "用户取消执行"): CancelAgentRunResult {
  const run = getRun(runId);

  if (!run) {
    return { status: "not_found" };
  }

  if (run.status === "cancelled") {
    return { status: "already_cancelled", run };
  }

  if (run.status === "completed" || run.status === "failed") {
    return { status: "not_cancellable", run };
  }

  const cancellation = requestRunCancel(runId, reason);
  const approval = resolveApprovalForRun(runId, {
    status: "rejected",
    reason: cancellation.reason,
  });

  return {
    status: "accepted",
    cancellation,
    approvalResolved: Boolean(approval),
  };
}
