import { computed, type Ref } from "vue";
import type { EvaluationCase, EvaluationRun } from "@agentflow/shared";
import {
  formatCount,
  formatDuration,
  formatPercent,
  formatSignedCount,
  formatSignedDecimal,
  formatSignedDuration,
  formatSignedPercent,
} from "../utils/format";

export type EvaluationGroupFilter = EvaluationCase["group"] | "all";

type EvaluationCaseResult = EvaluationRun["results"][number];

function getEvaluationSuccessRate(run: EvaluationRun) {
  return run.summary.total ? (run.summary.passed / run.summary.total) * 100 : 0;
}

function createEvaluationCaseComparison(current: EvaluationCaseResult, baseline: EvaluationCaseResult | undefined) {
  const durationDeltaMs = current.durationMs - (baseline?.durationMs ?? 0);
  const toolDelta = current.toolCallCount - (baseline?.toolCallCount ?? 0);
  const tokenDelta = current.tokenUsage.totalTokens - (baseline?.tokenUsage.totalTokens ?? 0);

  return {
    caseId: current.caseId,
    title: current.title,
    currentStatus: current.status,
    baselineStatus: baseline?.status,
    durationDeltaMs,
    toolDelta,
    tokenDelta,
    changed: !baseline || baseline.status !== current.status || toolDelta !== 0 || tokenDelta !== 0,
  };
}

export function useEvaluationView(params: {
  evaluationCases: Ref<EvaluationCase[]>;
  evaluationRuns: Ref<EvaluationRun[]>;
  selectedEvaluationGroup: Ref<EvaluationGroupFilter>;
  selectedEvaluationCaseId: Ref<string>;
  selectedEvaluationRunId: Ref<string>;
  selectedComparisonRunId: Ref<string>;
}) {
  const latestEvaluationRun = computed(() => params.evaluationRuns.value[0]);
  const activeEvaluationRun = computed(() =>
    params.evaluationRuns.value.find((run) => run.id === params.selectedEvaluationRunId.value)
      ?? latestEvaluationRun.value,
  );
  const previousEvaluationRun = computed(() => {
    const activeIndex = params.evaluationRuns.value.findIndex((run) => run.id === activeEvaluationRun.value?.id);

    return activeIndex >= 0 ? params.evaluationRuns.value[activeIndex + 1] : undefined;
  });
  const comparableEvaluationRuns = computed(() =>
    params.evaluationRuns.value.filter((run) => run.id !== activeEvaluationRun.value?.id),
  );
  const comparisonEvaluationRun = computed(() =>
    comparableEvaluationRuns.value.find((run) => run.id === params.selectedComparisonRunId.value)
      ?? previousEvaluationRun.value
      ?? comparableEvaluationRuns.value[0],
  );
  const evaluationGroups = computed(() => {
    const groups = new Map<EvaluationCase["group"], string>();

    for (const evaluationCase of params.evaluationCases.value) {
      groups.set(evaluationCase.group, evaluationCase.groupLabel);
    }

    return [...groups.entries()].map(([value, label]) => ({
      value,
      label,
      count: params.evaluationCases.value.filter((evaluationCase) => evaluationCase.group === value).length,
    }));
  });
  const filteredEvaluationCases = computed(() =>
    params.selectedEvaluationGroup.value === "all"
      ? params.evaluationCases.value
      : params.evaluationCases.value.filter((evaluationCase) => evaluationCase.group === params.selectedEvaluationGroup.value),
  );
  const filteredEvaluationResults = computed(() => {
    const results = activeEvaluationRun.value?.results ?? [];

    return params.selectedEvaluationGroup.value === "all"
      ? results
      : results.filter((result) => result.group === params.selectedEvaluationGroup.value);
  });
  const selectedEvaluationResult = computed(() =>
    filteredEvaluationResults.value.find((result) => result.caseId === params.selectedEvaluationCaseId.value)
      ?? filteredEvaluationResults.value.find((result) => result.status !== "passed")
      ?? filteredEvaluationResults.value[0],
  );
  const activeEvaluationGroupSummary = computed(() => {
    if (!activeEvaluationRun.value) {
      return undefined;
    }

    if (params.selectedEvaluationGroup.value === "all") {
      return activeEvaluationRun.value.summary;
    }

    return activeEvaluationRun.value.groupSummaries.find((summary) =>
      summary.group === params.selectedEvaluationGroup.value,
    );
  });
  const selectedEvaluationCaseIds = computed(() => filteredEvaluationCases.value.map((evaluationCase) => evaluationCase.id));
  const evaluationComparisonMetrics = computed(() => {
    const current = activeEvaluationRun.value;
    const baseline = comparisonEvaluationRun.value;

    if (!current || !baseline) {
      return [];
    }

    return [
      {
        label: "成功率",
        current: formatPercent(getEvaluationSuccessRate(current)),
        baseline: formatPercent(getEvaluationSuccessRate(baseline)),
        delta: getEvaluationSuccessRate(current) - getEvaluationSuccessRate(baseline),
        deltaLabel: formatSignedPercent(getEvaluationSuccessRate(current) - getEvaluationSuccessRate(baseline)),
        direction: "higher-better" as const,
      },
      {
        label: "平均耗时",
        current: formatDuration(current.summary.averageDurationMs),
        baseline: formatDuration(baseline.summary.averageDurationMs),
        delta: current.summary.averageDurationMs - baseline.summary.averageDurationMs,
        deltaLabel: formatSignedDuration(current.summary.averageDurationMs - baseline.summary.averageDurationMs),
        direction: "lower-better" as const,
      },
      {
        label: "平均工具",
        current: String(current.summary.averageToolCallCount),
        baseline: String(baseline.summary.averageToolCallCount),
        delta: current.summary.averageToolCallCount - baseline.summary.averageToolCallCount,
        deltaLabel: formatSignedDecimal(current.summary.averageToolCallCount - baseline.summary.averageToolCallCount),
        direction: "lower-better" as const,
      },
      {
        label: "平均 Token",
        current: formatCount(current.summary.averageTokenCount),
        baseline: formatCount(baseline.summary.averageTokenCount),
        delta: current.summary.averageTokenCount - baseline.summary.averageTokenCount,
        deltaLabel: formatSignedCount(current.summary.averageTokenCount - baseline.summary.averageTokenCount),
        direction: "lower-better" as const,
      },
    ];
  });
  const evaluationCaseComparisons = computed(() => {
    const current = activeEvaluationRun.value;
    const baseline = comparisonEvaluationRun.value;

    if (!current || !baseline) {
      return [];
    }

    const baselineResults = new Map(baseline.results.map((result) => [result.caseId, result]));
    const currentResults = params.selectedEvaluationGroup.value === "all"
      ? current.results
      : current.results.filter((result) => result.group === params.selectedEvaluationGroup.value);

    return currentResults.map((result) => createEvaluationCaseComparison(result, baselineResults.get(result.caseId)))
      .sort((left, right) => Number(right.changed) - Number(left.changed));
  });

  return {
    activeEvaluationRun,
    previousEvaluationRun,
    comparableEvaluationRuns,
    comparisonEvaluationRun,
    evaluationGroups,
    filteredEvaluationCases,
    selectedEvaluationResult,
    activeEvaluationGroupSummary,
    selectedEvaluationCaseIds,
    evaluationComparisonMetrics,
    evaluationCaseComparisons,
  };
}
