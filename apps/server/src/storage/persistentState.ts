import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentRun, ApprovalRequest, ConversationSession, EvaluationRun } from "@agentflow/shared";
import { StorageWriteError } from "../agent/errors.js";

interface PersistedState {
  version: 1;
  conversations: ConversationSession[];
  runs: AgentRun[];
  pendingApprovals: ApprovalRequest[];
  evaluationRuns: EvaluationRun[];
}

const emptyState: PersistedState = {
  version: 1,
  conversations: [],
  runs: [],
  pendingApprovals: [],
  evaluationRuns: [],
};

const dataFilePath = join(process.env.AGENTFLOW_DATA_DIR ?? join(process.cwd(), ".agentflow-data"), "server-state.json");
const RENAME_RETRY_LIMIT = 5;
let persistenceDegraded = false;
let lastPersistenceError: string | undefined;

function waitSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(tempFilePath: string, targetFilePath: string) {
  for (let attempt = 1; attempt <= RENAME_RETRY_LIMIT; attempt += 1) {
    try {
      renameSync(tempFilePath, targetFilePath);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      const canRetry = code === "EPERM" || code === "EBUSY";

      if (!canRetry || attempt === RENAME_RETRY_LIMIT) {
        throw error;
      }

      // Windows 下杀毒或文件索引可能短暂占用 JSON 文件，有限等待后重试可避免评测被偶发文件锁打断。
      waitSync(20 * attempt);
    }
  }
}

/** 读取本地 JSON 持久化快照；文件不存在或损坏时回退为空状态，保证 Demo 服务仍可启动。 */
export function readPersistentState(): PersistedState {
  if (!existsSync(dataFilePath)) {
    return cloneState(emptyState);
  }

  try {
    const rawState = readFileSync(dataFilePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(rawState) as Partial<PersistedState>;

    return {
      version: 1,
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      pendingApprovals: Array.isArray(parsed.pendingApprovals) ? parsed.pendingApprovals : [],
      evaluationRuns: Array.isArray(parsed.evaluationRuns) ? parsed.evaluationRuns : [],
    };
  } catch (error) {
    persistenceDegraded = true;
    lastPersistenceError = error instanceof Error ? error.message : String(error);
    console.warn("[persistent-state] Failed to read state file, starting with empty state.", error);
    return cloneState(emptyState);
  }
}

/** 原子写入本地 JSON 快照，避免进程中断时留下半截状态文件。 */
export function writePersistentState(state: PersistedState) {
  // 首次失败后保留各 Store 的内存状态，避免错误落盘流程再次抛错并覆盖原始异常。
  if (persistenceDegraded) {
    return false;
  }

  const tempFilePath = `${dataFilePath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

  try {
    mkdirSync(dirname(dataFilePath), { recursive: true });
    writeFileSync(tempFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameWithRetry(tempFilePath, dataFilePath);
    return true;
  } catch (error) {
    if (existsSync(tempFilePath)) {
      try {
        rmSync(tempFilePath, { force: true });
      } catch {
        // 临时文件清理失败不覆盖原始持久化异常。
      }
    }
    persistenceDegraded = true;
    lastPersistenceError = error instanceof Error ? error.message : String(error);
    throw new StorageWriteError(dataFilePath, { cause: error });
  }
}

/** 健康检查通过该状态暴露持久化降级，便于 Demo 和部署监控及时发现数据只保留在内存。 */
export function getPersistenceHealth() {
  return {
    ok: !persistenceDegraded,
    degraded: persistenceDegraded,
    path: dataFilePath,
    lastError: lastPersistenceError,
  };
}

/** 暴露当前数据文件位置，便于 README 和调试日志说明。 */
export function getPersistentStatePath() {
  return dataFilePath;
}

function cloneState(state: PersistedState): PersistedState {
  return JSON.parse(JSON.stringify(state)) as PersistedState;
}
