import type {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationGroupSummary,
  EvaluationRegressionItem,
  EvaluationRegressionStatus,
  EvaluationRegressionSummary,
  EvaluationRun,
  EvaluationRunSummary,
} from "@agentflow/shared";
import { runAgentTask } from "../agent/executor.js";
import { getLlmConfig } from "../llm/config.js";
import { getRun, listRuns } from "../trace/runStore.js";
import { getSandboxState, resetSandboxState } from "../tools/sandboxTools.js";
import { evaluationCases } from "./evaluationCases.js";
import { scoreEvaluationCase } from "./evaluationScorer.js";
import { listEvaluationRuns, saveEvaluationRun } from "./evaluationStore.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEvaluationRun(): EvaluationRun {
  const llmConfig = getLlmConfig();

  return {
    id: `eval-${Date.now()}`,
    status: "running",
    createdAt: new Date().toISOString(),
    config: {
      provider: llmConfig.provider,
      model: llmConfig.model,
      promptVersion: process.env.AGENTFLOW_PROMPT_VERSION ?? "default-tool-calling-v2",
      mock: llmConfig.mock,
    },
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      error: 0,
      durationMs: 0,
      averageDurationMs: 0,
      averageToolCallCount: 0,
      totalToolCallCount: 0,
      averageTokenCount: 0,
      totalTokenCount: 0,
      modelNames: [],
      failureReasons: [],
      regressed: 0,
      recovered: 0,
      unchanged: 0,
      newCases: 0,
    },
    groupSummaries: [],
    regression: {
      regressed: [],
      recovered: [],
      unchanged: [],
      newCases: [],
    },
    results: [],
  };
}

function summarize(results: EvaluationRun["results"], regression: EvaluationRegressionSummary): EvaluationRunSummary {
  const totalDurationMs = results.reduce((total, result) => total + result.durationMs, 0);
  const totalToolCallCount = results.reduce((total, result) => total + result.toolCallCount, 0);
  const totalTokenCount = results.reduce((total, result) => total + result.tokenUsage.totalTokens, 0);
  const modelNames = [...new Set(results.flatMap((result) => result.modelNames))];
  const failureReasons = results
    .filter((result) => result.status !== "passed")
    .map((result) => {
      const failedAssertion = result.assertions.find((assertion) => !assertion.passed);
      return failedAssertion ? `${result.title}：${failedAssertion.diagnosis}` : `${result.title}：${result.errorMessage ?? "未知失败原因"}`;
    });

  return {
    total: results.length,
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    error: results.filter((result) => result.status === "error").length,
    durationMs: totalDurationMs,
    averageDurationMs: results.length ? Math.round(totalDurationMs / results.length) : 0,
    averageToolCallCount: results.length ? Number((totalToolCallCount / results.length).toFixed(1)) : 0,
    totalToolCallCount,
    averageTokenCount: results.length ? Math.round(totalTokenCount / results.length) : 0,
    totalTokenCount,
    modelNames,
    failureReasons,
    regressed: regression.regressed.length,
    recovered: regression.recovered.length,
    unchanged: regression.unchanged.length,
    newCases: regression.newCases.length,
  };
}

function summarizeGroups(results: EvaluationCaseResult[]): EvaluationGroupSummary[] {
  const groups = new Map<string, EvaluationGroupSummary>();

  for (const result of results) {
    const summary = groups.get(result.group) ?? {
      group: result.group,
      label: result.groupLabel,
      total: 0,
      passed: 0,
      failed: 0,
      error: 0,
    };

    summary.total += 1;
    summary[result.status] += 1;
    groups.set(result.group, summary);
  }

  return [...groups.values()];
}

function findNewRun(beforeRunIds: Set<string>) {
  return listRuns()
    .map((summary) => getRun(summary.id))
    .find((run) => run && !beforeRunIds.has(run.id));
}

function findPreviousCompletedEvaluationRun() {
  return listEvaluationRuns().find((run) => run.status === "completed");
}

function getRegressionStatus(
  current: EvaluationCaseResult,
  previousRun: EvaluationRun | undefined,
): Pick<EvaluationCaseResult, "previousStatus" | "regressionStatus"> {
  const previousStatus = previousRun?.results.find((result) => result.caseId === current.caseId)?.status;

  if (!previousStatus) {
    return {
      previousStatus,
      regressionStatus: "new" satisfies EvaluationRegressionStatus,
    };
  }

  if (previousStatus === "passed" && current.status !== "passed") {
    return {
      previousStatus,
      regressionStatus: "regressed" satisfies EvaluationRegressionStatus,
    };
  }

  if (previousStatus !== "passed" && current.status === "passed") {
    return {
      previousStatus,
      regressionStatus: "recovered" satisfies EvaluationRegressionStatus,
    };
  }

  return {
    previousStatus,
    regressionStatus: current.status === "passed"
      ? "unchanged_passed" satisfies EvaluationRegressionStatus
      : "unchanged_failed" satisfies EvaluationRegressionStatus,
  };
}

function summarizeRegression(results: EvaluationCaseResult[], comparedWithRunId?: string): EvaluationRegressionSummary {
  const regression: EvaluationRegressionSummary = {
    comparedWithRunId,
    regressed: [],
    recovered: [],
    unchanged: [],
    newCases: [],
  };

  for (const result of results) {
    const item: EvaluationRegressionItem = {
      caseId: result.caseId,
      title: result.title,
      previousStatus: result.previousStatus,
      currentStatus: result.status,
      regressionStatus: result.regressionStatus,
    };

    if (result.regressionStatus === "regressed") {
      regression.regressed.push(item);
    } else if (result.regressionStatus === "recovered") {
      regression.recovered.push(item);
    } else if (result.regressionStatus === "new") {
      regression.newCases.push(item);
    } else {
      regression.unchanged.push(item);
    }
  }

  return regression;
}

/** 运行单条评测用例；失败 run 也会从 runStore 中回捞，保证评分结果仍能链接 trace。 */
async function runEvaluationCase(evaluationCase: EvaluationCase, previousRun: EvaluationRun | undefined) {
  resetSandboxState();

  const beforeRunIds = new Set(listRuns().map((run) => run.id));
  const startedAt = Date.now();
  let errorMessage: string | undefined;
  const repeat = Math.max(1, evaluationCase.repeat ?? 1);

  for (let index = 0; index < repeat; index += 1) {
    try {
      await runAgentTask(evaluationCase.task, evaluationCase.approvalMode ?? "approve");
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unknown evaluation execution error.";
      break;
    }
  }

  const run = findNewRun(beforeRunIds);
  const sandboxState = clone(getSandboxState());

  return scoreEvaluationCase({
    case: evaluationCase,
    durationMs: Date.now() - startedAt,
    errorMessage,
    previousStatus: previousRun?.results.find((result) => result.caseId === evaluationCase.id)?.status,
    run,
    sandboxState,
  });
}

/** 批量执行内置评测集，并把结果持久化为一个 EvaluationRun。 */
export async function runEvaluationSuite(caseIds?: string[]) {
  const selectedCases = caseIds?.length
    ? evaluationCases.filter((evaluationCase) => caseIds.includes(evaluationCase.id))
    : evaluationCases;
  const previousRun = findPreviousCompletedEvaluationRun();
  const evaluationRun = saveEvaluationRun(createEvaluationRun());

  for (const evaluationCase of selectedCases) {
    const result = await runEvaluationCase(evaluationCase, previousRun);
    const regression = getRegressionStatus(result, previousRun);
    result.previousStatus = regression.previousStatus;
    result.regressionStatus = regression.regressionStatus;
    evaluationRun.results.push(result);
    evaluationRun.regression = summarizeRegression(evaluationRun.results, previousRun?.id);
    evaluationRun.summary = summarize(evaluationRun.results, evaluationRun.regression);
    evaluationRun.groupSummaries = summarizeGroups(evaluationRun.results);
    saveEvaluationRun(evaluationRun);
  }

  evaluationRun.status = "completed";
  evaluationRun.completedAt = new Date().toISOString();
  evaluationRun.regression = summarizeRegression(evaluationRun.results, previousRun?.id);
  evaluationRun.summary = summarize(evaluationRun.results, evaluationRun.regression);
  evaluationRun.groupSummaries = summarizeGroups(evaluationRun.results);
  return saveEvaluationRun(evaluationRun);
}
