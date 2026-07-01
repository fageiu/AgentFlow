import type { AgentRun, AgentRunSummary } from "@agentflow/shared";

const runs = new Map<string, AgentRun>();

/** 深拷贝运行快照，避免外部调用方修改仓库里保存的 trace。 */
function cloneRun(run: AgentRun): AgentRun {
  return JSON.parse(JSON.stringify(run)) as AgentRun;
}

/** 保存一次已完成或失败的 Agent 运行记录，当前阶段先使用进程内存作为轻量持久层。 */
export function saveRun(run: AgentRun) {
  runs.set(run.id, cloneRun(run));
}

/** 按 runId 读取完整 trace 明细，前端点击历史记录时会调用这个方法对应的接口。 */
export function getRun(runId: string): AgentRun | undefined {
  const run = runs.get(runId);
  return run ? cloneRun(run) : undefined;
}

/** 返回运行历史摘要，并按创建时间倒序排列，方便前端展示最近一次执行。 */
export function listRuns(): AgentRunSummary[] {
  return [...runs.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((run) => ({
      id: run.id,
      task: run.task,
      status: run.status,
      stepCount: run.steps.length,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    }));
}

/** 清空当前进程内的运行历史，主要用于本地 Demo 反复演示。 */
export function clearRuns() {
  runs.clear();
}
