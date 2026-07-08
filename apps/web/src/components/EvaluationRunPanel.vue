<script setup lang="ts">
import type { EvaluationCase, EvaluationGroupSummary, EvaluationRun, EvaluationRunSummary } from "@agentflow/shared";
import { formatCount, formatDuration, formatRunTime } from "../utils/format";
import { getEvaluationStatusLabel } from "../utils/labels";

type EvaluationGroupFilter = EvaluationCase["group"] | "all";
type EvaluationCaseResult = EvaluationRun["results"][number];
type EvaluationGroupOption = {
  value: EvaluationCase["group"];
  label: string;
  count: number;
};

const props = defineProps<{
  evaluationError: string;
  evaluationCases: EvaluationCase[];
  evaluationGroups: EvaluationGroupOption[];
  filteredEvaluationCases: EvaluationCase[];
  evaluationRuns: EvaluationRun[];
  activeEvaluationRun?: EvaluationRun;
  activeEvaluationGroupSummary?: EvaluationRunSummary | EvaluationGroupSummary;
  previousEvaluationRun?: EvaluationRun;
  selectedEvaluationGroup: EvaluationGroupFilter;
  selectedEvaluationRunId: string;
  selectedEvaluationResult?: EvaluationCaseResult;
  isRunningEvaluation: boolean;
  clearingEvaluationRuns: boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  clear: [];
  run: [];
  "select-group": [group: EvaluationGroupFilter];
  "select-run": [runId: string];
  "select-case": [caseId: string];
}>();

function getEvaluationCase(caseId: string) {
  return props.evaluationCases.find((evaluationCase) => evaluationCase.id === caseId);
}

function getResultForCase(caseId: string) {
  return props.activeEvaluationRun?.results.find((result) => result.caseId === caseId);
}

function handleRunChange(event: Event) {
  emit("select-run", (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="right-panel-content">
    <header class="evaluation-toolbar">
      <div class="evaluation-title">
        <p class="eyebrow muted">Evaluation</p>
        <h2>评测系统</h2>
        <small>{{ evaluationCases.length }} golden tasks</small>
      </div>
      <button class="evaluation-primary-action" type="button" :disabled="isRunningEvaluation" @click="$emit('run')">
        <span>
          {{ isRunningEvaluation ? "评测中" : selectedEvaluationGroup === "all" ? "全量评测" : "运行本组" }}
        </span>
      </button>
    </header>

    <div class="evaluation-utility-actions" aria-label="评测操作">
      <button class="ghost-button" type="button" @click="$emit('refresh')">刷新</button>
      <button
        class="ghost-button danger"
        type="button"
        :disabled="isRunningEvaluation || clearingEvaluationRuns || evaluationRuns.length === 0"
        @click="$emit('clear')"
      >
        {{ clearingEvaluationRuns ? "清空中" : "清空" }}
      </button>
    </div>

    <p v-if="evaluationError" class="error-text">{{ evaluationError }}</p>

    <div class="evaluation-filter-grid" aria-label="评测分组">
      <button
        type="button"
        class="filter-chip"
        :class="{ active: selectedEvaluationGroup === 'all' }"
        @click="$emit('select-group', 'all')"
      >
        <span>全部</span>
        <strong>{{ evaluationCases.length }}</strong>
      </button>
      <button
        v-for="group in evaluationGroups"
        :key="group.value"
        type="button"
        class="filter-chip"
        :class="{ active: selectedEvaluationGroup === group.value }"
        @click="$emit('select-group', group.value)"
      >
        <span>{{ group.label }}</span>
        <strong>{{ group.count }}</strong>
      </button>
    </div>

    <div v-if="activeEvaluationRun" class="evaluation-result">
      <div class="evaluation-run-bar">
        <label>
          <span>结果</span>
          <select :value="selectedEvaluationRunId" aria-label="评测运行记录" @change="handleRunChange">
            <option v-for="run in evaluationRuns.slice(0, 8)" :key="run.id" :value="run.id">
              {{ formatRunTime(run.createdAt) }} · {{ run.config.model }} · {{ run.summary.passed }}/{{ run.summary.total }}
            </option>
          </select>
        </label>
        <span class="duration">{{ formatDuration(activeEvaluationRun.summary.durationMs) }}</span>
      </div>

      <dl class="evaluation-summary">
        <div>
          <dt>通过</dt>
          <dd>{{ activeEvaluationGroupSummary?.passed ?? 0 }}</dd>
        </div>
        <div>
          <dt>失败</dt>
          <dd>{{ activeEvaluationGroupSummary?.failed ?? 0 }}</dd>
        </div>
        <div>
          <dt>错误</dt>
          <dd>{{ activeEvaluationGroupSummary?.error ?? 0 }}</dd>
        </div>
        <div>
          <dt>总数</dt>
          <dd>{{ activeEvaluationGroupSummary?.total ?? 0 }}</dd>
        </div>
      </dl>

      <dl class="evaluation-metrics">
        <div>
          <dt>平均耗时</dt>
          <dd>{{ formatDuration(activeEvaluationRun.summary.averageDurationMs) }}</dd>
        </div>
        <div>
          <dt>平均工具</dt>
          <dd>{{ activeEvaluationRun.summary.averageToolCallCount }}</dd>
        </div>
        <div>
          <dt>平均 Token</dt>
          <dd>{{ formatCount(activeEvaluationRun.summary.averageTokenCount) }}</dd>
        </div>
        <div>
          <dt>总 Token</dt>
          <dd>{{ formatCount(activeEvaluationRun.summary.totalTokenCount) }}</dd>
        </div>
      </dl>

      <div class="evaluation-config">
        <span>{{ activeEvaluationRun.config.provider }}</span>
        <span>{{ activeEvaluationRun.config.model }}</span>
        <span>{{ activeEvaluationRun.config.promptVersion }}</span>
        <span>{{ activeEvaluationRun.config.mock ? "Mock" : "Real" }}</span>
      </div>

      <div class="regression-strip">
        <span :class="{ hot: activeEvaluationRun.summary.regressed > 0 }">
          回退 {{ activeEvaluationRun.summary.regressed }}
        </span>
        <span>恢复 {{ activeEvaluationRun.summary.recovered }}</span>
        <span>新增 {{ activeEvaluationRun.summary.newCases }}</span>
        <small v-if="previousEvaluationRun">对比 {{ formatRunTime(previousEvaluationRun.createdAt) }}</small>
        <small v-else>暂无上一轮基线</small>
      </div>

      <div v-if="activeEvaluationRun.summary.failureReasons.length" class="failure-reasons">
        <span class="state-label">失败原因</span>
        <p v-for="reason in activeEvaluationRun.summary.failureReasons.slice(0, 3)" :key="reason">
          {{ reason }}
        </p>
      </div>

      <div class="evaluation-case-list">
        <button
          v-for="evaluationCase in filteredEvaluationCases"
          :key="evaluationCase.id"
          type="button"
          class="evaluation-case-row"
          :class="[
            getResultForCase(evaluationCase.id) ? `eval-${getResultForCase(evaluationCase.id)?.status}` : '',
            { active: selectedEvaluationResult?.caseId === evaluationCase.id },
          ]"
          @click="$emit('select-case', evaluationCase.id)"
        >
          <div>
            <span class="state-label">{{ evaluationCase.id }}</span>
            <strong>{{ evaluationCase.title }}</strong>
          </div>
          <span class="case-status" :class="`eval-text-${getResultForCase(evaluationCase.id)?.status ?? 'pending'}`">
            {{ getEvaluationStatusLabel(getResultForCase(evaluationCase.id)?.status) }}
          </span>
        </button>
      </div>

      <article v-if="selectedEvaluationResult" class="evaluation-detail">
        <div class="step-header">
          <div>
            <span class="step-type">{{ selectedEvaluationResult.groupLabel }}</span>
            <h3>{{ selectedEvaluationResult.title }}</h3>
          </div>
          <span class="case-status" :class="`eval-text-${selectedEvaluationResult.status}`">
            {{ getEvaluationStatusLabel(selectedEvaluationResult.status) }}
          </span>
        </div>

        <p>{{ getEvaluationCase(selectedEvaluationResult.caseId)?.description }}</p>

        <dl class="evaluation-detail-meta">
          <div>
            <dt>Run</dt>
            <dd>{{ selectedEvaluationResult.runId || "未生成" }}</dd>
          </div>
          <div>
            <dt>耗时</dt>
            <dd>{{ formatDuration(selectedEvaluationResult.durationMs) }}</dd>
          </div>
          <div>
            <dt>回归</dt>
            <dd>{{ getEvaluationStatusLabel(selectedEvaluationResult.regressionStatus) }}</dd>
          </div>
          <div>
            <dt>失败断言</dt>
            <dd>{{ selectedEvaluationResult.failedAssertionCount }}</dd>
          </div>
          <div>
            <dt>工具次数</dt>
            <dd>{{ selectedEvaluationResult.toolCallCount }}</dd>
          </div>
          <div>
            <dt>Token</dt>
            <dd>{{ formatCount(selectedEvaluationResult.tokenUsage.totalTokens) }}</dd>
          </div>
        </dl>

        <p v-if="selectedEvaluationResult.errorMessage" class="error-text">
          {{ selectedEvaluationResult.errorMessage }}
        </p>

        <div class="tool-trace">
          <span class="state-label">工具轨迹</span>
          <p>{{ selectedEvaluationResult.toolNames.length ? selectedEvaluationResult.toolNames.join(" → ") : "无工具调用" }}</p>
        </div>

        <div class="assertion-list">
          <div
            v-for="assertion in selectedEvaluationResult.assertions"
            :key="assertion.id"
            class="assertion-row"
            :class="{ failed: !assertion.passed }"
          >
            <span>{{ assertion.passed ? "通过" : "失败" }}</span>
            <strong>{{ assertion.label }}</strong>
            <small>期望 {{ assertion.expected }} · 实际 {{ assertion.actual }}</small>
            <p>{{ assertion.diagnosis }}</p>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="evaluation-empty-state">
      <strong>暂无评测结果</strong>
      <span>等待首次评测运行</span>
    </div>
  </div>
</template>
