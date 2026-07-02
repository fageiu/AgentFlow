import type { ApprovalRequest } from "@agentflow/shared";

export type ApprovalDecision = {
  status: "approved" | "rejected";
  reason?: string;
};

type PendingApproval = {
  approval: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
};

const pendingApprovals = new Map<string, PendingApproval>();

/** 创建审批请求，并返回一个 Promise 让 executor 可以暂停等待用户决策。 */
export function createApprovalRequest(input: Omit<ApprovalRequest, "id" | "status" | "createdAt">) {
  const approval: ApprovalRequest = {
    ...input,
    id: `approval-${Date.now()}`,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  let resolveDecision!: (decision: ApprovalDecision) => void;
  const decision = new Promise<ApprovalDecision>((resolve) => {
    resolveDecision = resolve;
  });

  pendingApprovals.set(approval.id, {
    approval,
    resolve: resolveDecision,
  });

  return {
    approval,
    decision,
  };
}

/** 查询某个 run 当前等待中的审批，前端刷新或历史恢复时可按需扩展使用。 */
export function getPendingApprovalByRun(runId: string) {
  return [...pendingApprovals.values()].find((item) => item.approval.runId === runId)?.approval;
}

/** 处理批准/拒绝请求，并唤醒正在等待审批的 executor。 */
export function resolveApprovalForRun(runId: string, decision: ApprovalDecision) {
  const entry = [...pendingApprovals.values()].find((item) => item.approval.runId === runId);

  if (!entry) {
    return undefined;
  }

  const resolved: ApprovalRequest = {
    ...entry.approval,
    status: decision.status,
    reason: decision.reason,
    resolvedAt: new Date().toISOString(),
  };

  pendingApprovals.delete(entry.approval.id);
  entry.resolve(decision);

  return resolved;
}
