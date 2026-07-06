import type { AgentRun } from "@agentflow/shared";

export interface RunCancelRequest {
  runId: string;
  reason: string;
  requestedAt: string;
}

export class AgentRunCancelledError extends Error {
  constructor(public readonly cancellation: RunCancelRequest) {
    super(cancellation.reason);
    this.name = "AgentRunCancelledError";
  }
}

const cancelledRuns = new Map<string, RunCancelRequest>();

/** 记录一次取消请求；executor 会在步骤边界读取该标记并停止后续执行。 */
export function requestRunCancel(runId: string, reason = "用户取消执行"): RunCancelRequest {
  const cancellation: RunCancelRequest = {
    runId,
    reason,
    requestedAt: new Date().toISOString(),
  };

  cancelledRuns.set(runId, cancellation);
  return cancellation;
}

/** 查询某个 run 是否已经被请求取消。 */
export function getRunCancel(runId: string) {
  return cancelledRuns.get(runId);
}

/** 如果 run 已被取消，则抛出专用错误，让 streamAgentTask 统一转成 run_cancelled 事件。 */
export function throwIfRunCancelled(run: AgentRun) {
  const cancellation = getRunCancel(run.id);

  if (cancellation) {
    throw new AgentRunCancelledError(cancellation);
  }
}

/** run 正常结束或已发出取消事件后清理取消标记，避免影响同 id 之外的后续逻辑。 */
export function clearRunCancel(runId: string) {
  cancelledRuns.delete(runId);
}
