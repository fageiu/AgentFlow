import type {
  EvaluationCaseResult,
  EvaluationRegressionSummary,
  EvaluationRun,
  LlmTokenUsage,
} from "@agentflow/shared";
import { readPersistentState, writePersistentState } from "../storage/persistentState.js";
import { evaluationCases } from "./evaluationCases.js";

const evaluationRuns = new Map<string, EvaluationRun>();

for (const run of readPersistentState().evaluationRuns) {
  evaluationRuns.set(run.id, normalizeEvaluationRun(run));
}

function cloneEvaluationRun(run: EvaluationRun): EvaluationRun {
  return JSON.parse(JSON.stringify(run)) as EvaluationRun;
}

function createEmptyTokenUsage(): LlmTokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

function normalizeResult(result: EvaluationCaseResult): EvaluationCaseResult {
  const evaluationCase = evaluationCases.find((item) => item.id === result.caseId);
  const assertions = (result.assertions ?? []).map((assertion) => ({
    ...assertion,
    diagnosis: assertion.diagnosis ?? (assertion.passed ? "符合预期。" : `期望 ${assertion.expected}，实际 ${assertion.actual}。`),
  }));

  return {
    ...result,
    group: result.group ?? evaluationCase?.group ?? "safety",
    groupLabel: result.groupLabel ?? evaluationCase?.groupLabel ?? "未分组",
    assertions,
    failedAssertionCount: result.failedAssertionCount ?? assertions.filter((assertion) => !assertion.passed).length,
    toolNames: result.toolNames ?? [],
    executedToolNames: result.executedToolNames ?? [],
    toolCallCount: result.toolCallCount ?? result.executedToolNames?.length ?? 0,
    tokenUsage: result.tokenUsage ?? createEmptyTokenUsage(),
    modelNames: result.modelNames ?? [],
    approvalRequired: result.approvalRequired ?? false,
    regressionStatus: result.regressionStatus ?? "new",
  };
}

function normalizeRegression(run: EvaluationRun): EvaluationRegressionSummary {
  if (run.regression) {
    return run.regression;
  }

  return {
    comparedWithRunId: undefined,
    regressed: [],
    recovered: [],
    unchanged: [],
    newCases: run.results.map((result) => ({
      caseId: result.caseId,
      title: result.title,
      currentStatus: result.status,
      regressionStatus: "new",
    })),
  };
}

/** 兼容旧版持久化评测结果，补齐 Week 12 新增的诊断、分组和回归字段。 */
function normalizeEvaluationRun(run: EvaluationRun): EvaluationRun {
  const results = (run.results ?? []).map(normalizeResult);
  const regression = normalizeRegression({ ...run, results });
  const durationMs = run.summary.durationMs ?? results.reduce((total, result) => total + result.durationMs, 0);
  const totalToolCallCount = run.summary.totalToolCallCount ?? results.reduce((total, result) => total + result.toolCallCount, 0);
  const totalTokenCount = run.summary.totalTokenCount
    ?? results.reduce((total, result) => total + result.tokenUsage.totalTokens, 0);
  const modelNames = run.summary.modelNames ?? [...new Set(results.flatMap((result) => result.modelNames))];
  const failureReasons = run.summary.failureReasons ?? results
    .filter((result) => result.status !== "passed")
    .map((result) => result.assertions.find((assertion) => !assertion.passed)?.diagnosis ?? result.errorMessage ?? "未知失败原因");
  const groupSummaries = run.groupSummaries ?? [...new Map(results.map((result) => [result.group, result])).values()].map(
    (result) => ({
      group: result.group,
      label: result.groupLabel,
      total: results.filter((item) => item.group === result.group).length,
      passed: results.filter((item) => item.group === result.group && item.status === "passed").length,
      failed: results.filter((item) => item.group === result.group && item.status === "failed").length,
      error: results.filter((item) => item.group === result.group && item.status === "error").length,
    }),
  );

  return {
    ...run,
    config: run.config ?? {
      provider: "unknown",
      model: modelNames[0] ?? "unknown",
      promptVersion: "legacy",
      mock: false,
    },
    results,
    groupSummaries,
    regression,
    summary: {
      total: run.summary.total,
      passed: run.summary.passed,
      failed: run.summary.failed,
      error: run.summary.error,
      durationMs,
      averageDurationMs: run.summary.averageDurationMs ?? (results.length ? Math.round(durationMs / results.length) : 0),
      averageToolCallCount: run.summary.averageToolCallCount
        ?? (results.length ? Number((totalToolCallCount / results.length).toFixed(1)) : 0),
      totalToolCallCount,
      averageTokenCount: run.summary.averageTokenCount ?? (results.length ? Math.round(totalTokenCount / results.length) : 0),
      totalTokenCount,
      modelNames,
      failureReasons,
      regressed: run.summary.regressed ?? regression.regressed.length,
      recovered: run.summary.recovered ?? regression.recovered.length,
      unchanged: run.summary.unchanged ?? regression.unchanged.length,
      newCases: run.summary.newCases ?? regression.newCases.length,
    },
  };
}

function persistEvaluationRuns() {
  const state = readPersistentState();
  writePersistentState({
    ...state,
    evaluationRuns: [...evaluationRuns.values()].map(cloneEvaluationRun),
  });
}

/** 保存评测运行快照，评测页面刷新后仍可查看最近一次批量结果。 */
export function saveEvaluationRun(run: EvaluationRun) {
  evaluationRuns.set(run.id, normalizeEvaluationRun(run));
  persistEvaluationRuns();
  return normalizeEvaluationRun(run);
}

export function getEvaluationRun(runId: string) {
  const run = evaluationRuns.get(runId);
  return run ? cloneEvaluationRun(run) : undefined;
}

export function listEvaluationRuns() {
  return [...evaluationRuns.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(cloneEvaluationRun);
}

/** 清空评测运行历史，只移除 evaluationRuns，避免误删会话、trace 或审批记录。 */
export function clearEvaluationRuns() {
  evaluationRuns.clear();
  persistEvaluationRuns();
}
