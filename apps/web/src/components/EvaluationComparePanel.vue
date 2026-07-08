<script setup lang="ts">
import type { EvaluationRun } from "@agentflow/shared";
import {
  formatRunTime,
  formatSignedCount,
  formatSignedDecimal,
  formatSignedDuration,
} from "../utils/format";
import { getEvaluationStatusLabel } from "../utils/labels";

type CompareMetric = {
  label: string;
  current: string;
  baseline: string;
  delta: number;
  deltaLabel: string;
  direction: "higher-better" | "lower-better";
};

type CaseComparison = {
  caseId: string;
  title: string;
  currentStatus: string;
  baselineStatus?: string;
  durationDeltaMs: number;
  toolDelta: number;
  tokenDelta: number;
  changed: boolean;
};

defineProps<{
  activeEvaluationRun?: EvaluationRun;
  comparisonEvaluationRun?: EvaluationRun;
  comparableEvaluationRuns: EvaluationRun[];
  selectedComparisonRunId: string;
  evaluationComparisonMetrics: CompareMetric[];
  evaluationCaseComparisons: CaseComparison[];
}>();

const emit = defineEmits<{
  "select-comparison-run": [runId: string];
}>();

function getDeltaClass(delta: number, direction: "higher-better" | "lower-better") {
  if (delta === 0) {
    return "neutral";
  }

  const improved = direction === "higher-better" ? delta > 0 : delta < 0;
  return improved ? "good" : "bad";
}

function handleComparisonRunChange(event: Event) {
  emit("select-comparison-run", (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="right-panel-content">
    <header class="workspace-header compact">
      <div>
        <p class="eyebrow muted">Evaluation Compare</p>
        <h2>评测对比</h2>
      </div>
    </header>

    <section v-if="activeEvaluationRun && comparisonEvaluationRun" class="evaluation-compare isolated" aria-label="评测对比">
      <div class="compare-header">
        <div>
          <span class="state-label">Prompt / Model Compare</span>
          <h3>当前结果 vs 基线结果</h3>
        </div>
        <label>
          <span>基线</span>
          <select :value="selectedComparisonRunId" aria-label="对比基线" @change="handleComparisonRunChange">
            <option v-for="run in comparableEvaluationRuns.slice(0, 8)" :key="run.id" :value="run.id">
              {{ formatRunTime(run.createdAt) }} · {{ run.config.model }}
            </option>
          </select>
        </label>
      </div>

      <div class="compare-configs">
        <div>
          <span>当前</span>
          <strong>{{ activeEvaluationRun.config.model }}</strong>
          <small>{{ activeEvaluationRun.config.promptVersion }}</small>
        </div>
        <div>
          <span>基线</span>
          <strong>{{ comparisonEvaluationRun.config.model }}</strong>
          <small>{{ comparisonEvaluationRun.config.promptVersion }}</small>
        </div>
      </div>

      <dl class="compare-metrics">
        <div v-for="metric in evaluationComparisonMetrics" :key="metric.label">
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.current }}</dd>
          <small :class="getDeltaClass(metric.delta, metric.direction)">
            {{ metric.deltaLabel }}
          </small>
          <span>基线 {{ metric.baseline }}</span>
        </div>
      </dl>

      <div class="compare-case-list">
        <article
          v-for="item in evaluationCaseComparisons"
          :key="item.caseId"
          class="compare-case-row"
          :class="{ changed: item.changed }"
        >
          <div>
            <span class="state-label">{{ item.caseId }}</span>
            <strong>{{ item.title }}</strong>
          </div>
          <div class="compare-case-status">
            <span :class="`eval-text-${item.baselineStatus ?? 'pending'}`">
              {{ getEvaluationStatusLabel(item.baselineStatus) }}
            </span>
            <span>→</span>
            <span :class="`eval-text-${item.currentStatus}`">
              {{ getEvaluationStatusLabel(item.currentStatus) }}
            </span>
          </div>
          <p>
            工具 {{ formatSignedDecimal(item.toolDelta) }} ·
            Token {{ formatSignedCount(item.tokenDelta) }} ·
            耗时 {{ formatSignedDuration(item.durationDeltaMs) }}
          </p>
        </article>
      </div>
    </section>

    <div v-else class="empty-state compact">至少需要两次评测记录才能进行对比。</div>
  </div>
</template>
