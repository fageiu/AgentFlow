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

type RunControl = {
  controller: AbortController;
  cancellation?: RunCancelRequest;
};

const runControls = new Map<string, RunControl>();

/** run 启动时注册独立控制器，使取消请求既能停止步骤推进，也能中断进行中的模型请求。 */
export function registerRunControl(runId: string) {
  const existing = runControls.get(runId);
  if (existing) {
    return existing.controller.signal;
  }

  const control: RunControl = {
    controller: new AbortController(),
  };
  runControls.set(runId, control);
  return control.controller.signal;
}

/** 记录一次取消请求；executor 会在步骤边界读取该标记并停止后续执行。 */
export function requestRunCancel(runId: string, reason = "用户取消执行"): RunCancelRequest {
  const control = runControls.get(runId) ?? {
    controller: new AbortController(),
  };
  if (control.cancellation) {
    return control.cancellation;
  }

  const cancellation: RunCancelRequest = {
    runId,
    reason,
    requestedAt: new Date().toISOString(),
  };

  control.cancellation = cancellation;
  runControls.set(runId, control);
  // 使用专用错误作为 abort reason，保证 fetch 中断后仍进入统一的 cancelled 分支。
  control.controller.abort(new AgentRunCancelledError(cancellation));
  return cancellation;
}

/** 查询某个 run 是否已经被请求取消。 */
export function getRunCancel(runId: string) {
  return runControls.get(runId)?.cancellation;
}

/** Provider 通过该信号把 run 级取消传递给底层 fetch。 */
export function getRunAbortSignal(runId: string) {
  return registerRunControl(runId);
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
  runControls.delete(runId);
}
