import type { AgentRun, AgentRunSummary } from "@agentflow/shared";
import { readPersistentState, writePersistentState } from "../storage/persistentState.js";
import { deriveAgentOutcome } from "../agent/outcome.js";

const runs = new Map<string, AgentRun>();

for (const run of readPersistentState().runs) {
  runs.set(run.id, normalizeRecoveredRun(run));
}

/** 深拷贝运行快照，避免外部调用方修改仓库里保存的 trace。 */
function cloneRun(run: AgentRun): AgentRun {
  return JSON.parse(JSON.stringify(run)) as AgentRun;
}

function persistRuns() {
  const state = readPersistentState();
  writePersistentState({
    ...state,
    runs: [...runs.values()].map(cloneRun),
  });
}

/** 服务重启后没有 executor 继续推进旧 run，因此将执行中快照降级为可审计的失败记录。 */
function normalizeRecoveredRun(run: AgentRun): AgentRun {
  if (run.status !== "running" && run.status !== "waiting_approval") {
    const recoveredRun = cloneRun(run);
    // 每次加载都从可信 trace 重建 Outcome，自动补齐旧版本缺失的结构化结论。
    recoveredRun.outcome = deriveAgentOutcome(recoveredRun);
    return recoveredRun;
  }

  const recoveredRun: AgentRun = {
    ...cloneRun(run),
    status: "failed",
    completedAt: run.completedAt ?? new Date().toISOString(),
    steps: run.steps.map((step) => ({
      ...step,
      status: step.status === "running" ? "failed" : step.status,
    })),
  };

  recoveredRun.outcome = deriveAgentOutcome(recoveredRun);
  return recoveredRun;
}

/** 保存一次 Agent 运行记录，并立即写入本地持久化快照。 */
export function saveRun(run: AgentRun) {
  runs.set(run.id, cloneRun(run));
  persistRuns();
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
  persistRuns();
}
