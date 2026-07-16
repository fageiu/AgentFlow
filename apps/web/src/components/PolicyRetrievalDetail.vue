<script setup lang="ts">
import { computed } from "vue";
import type { PolicyKnowledgeMatch, PolicySearchResult } from "@agentflow/shared";

const props = defineProps<{ output: unknown }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPolicyMatch(value: unknown): value is PolicyKnowledgeMatch {
  if (!isRecord(value) || !isRecord(value.citation)) return false;
  return typeof value.policyId === "string"
    && typeof value.title === "string"
    && typeof value.content === "string"
    && typeof value.score === "number"
    && typeof value.citation.nodeId === "string"
    && typeof value.citation.sourceName === "string"
    && typeof value.citation.version === "string";
}

const result = computed(() => {
  if (!isRecord(props.output) || !Array.isArray(props.output.matches) || !isRecord(props.output.retrieval)) {
    return undefined;
  }
  const matches = props.output.matches.filter(isPolicyMatch);
  if (!matches.length) return undefined;
  return { ...(props.output as unknown as PolicySearchResult), matches };
});

function percent(score: number | undefined) {
  return `${Math.round(Math.max(0, Math.min(1, score ?? 0)) * 100)}%`;
}

function scoreLabel(score: number | undefined) {
  return score == null ? "—" : score.toFixed(3);
}

function location(match: PolicyKnowledgeMatch) {
  return [
    match.citation.section ? `章节：${match.citation.section}` : undefined,
    match.citation.page != null ? `第 ${match.citation.page} 页` : undefined,
  ].filter(Boolean).join(" · ") || "文档正文";
}
</script>

<template>
  <section v-if="result" class="policy-ledger" aria-label="政策检索证据">
    <header class="policy-ledger-head">
      <div>
        <span class="policy-ledger-kicker">Retrieval evidence</span>
        <strong>政策检索证据</strong>
      </div>
      <span class="policy-ledger-time">{{ result.retrieval.durationMs }} ms</span>
    </header>

    <dl class="retrieval-metrics">
      <div><dt>向量召回</dt><dd>{{ result.retrieval.vectorCandidates }}</dd></div>
      <div><dt>关键词召回</dt><dd>{{ result.retrieval.lexicalCandidates }}</dd></div>
      <div><dt>重排候选</dt><dd>{{ result.retrieval.rerankedCandidates }}</dd></div>
      <div><dt>最终引用</dt><dd>{{ result.matches.length }}</dd></div>
    </dl>

    <ol class="policy-match-list">
      <li v-for="(match, index) in result.matches" :key="match.citation.nodeId" class="policy-match">
        <div class="policy-rank">{{ String(index + 1).padStart(2, "0") }}</div>
        <div class="policy-match-main">
          <div class="policy-match-title">
            <div>
              <strong>{{ match.title }}</strong>
              <span>{{ match.policyId }} · v{{ match.citation.version }}</span>
            </div>
            <b>{{ scoreLabel(match.score) }}</b>
          </div>
          <div class="score-track" aria-hidden="true">
            <span :style="{ width: percent(match.score) }"></span>
          </div>
          <p>{{ match.content }}</p>
          <footer>
            <span>{{ match.citation.sourceName }}</span>
            <span>{{ location(match) }}</span>
            <span>Node {{ match.citation.nodeId.slice(0, 12) }}</span>
          </footer>
          <div class="score-breakdown">
            <span>vector {{ scoreLabel(match.vectorScore) }}</span>
            <span>lexical {{ scoreLabel(match.lexicalScore) }}</span>
            <span>fusion {{ scoreLabel(match.fusionScore) }}</span>
            <span>rerank {{ scoreLabel(match.rerankScore) }}</span>
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.policy-ledger {
  margin: 9px 0 7px;
  border: 1px solid #cbd8d2;
  border-radius: 8px;
  overflow: hidden;
  color: #213b34;
  background: #f4f8f5;
  box-shadow: inset 3px 0 #2f6f5d;
}

.policy-ledger-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 11px 13px 9px 15px;
  border-bottom: 1px solid #dbe5df;
  background: linear-gradient(110deg, #edf5f0 0%, #f8faf8 70%);
}

.policy-ledger-head > div { display: grid; gap: 2px; }
.policy-ledger-head strong { font-size: 12px; letter-spacing: .02em; }
.policy-ledger-kicker,
.policy-ledger-time,
.policy-match-title span,
.policy-match footer,
.score-breakdown {
  font-family: "Cascadia Code", "IBM Plex Mono", Consolas, monospace;
}
.policy-ledger-kicker { color: #4e786c; font-size: 8px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
.policy-ledger-time { color: #315f53; font-size: 10px; font-weight: 700; }

.retrieval-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  border-bottom: 1px solid #dbe5df;
}
.retrieval-metrics div { padding: 8px 10px; border-right: 1px solid #dbe5df; }
.retrieval-metrics div:last-child { border-right: 0; }
.retrieval-metrics dt { color: #6a8179; font-size: 8px; }
.retrieval-metrics dd { margin: 2px 0 0; color: #173f34; font-size: 14px; font-weight: 800; }

.policy-match-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.policy-match { display: grid; grid-template-columns: 34px 1fr; border-bottom: 1px solid #dbe5df; }
.policy-match:last-child { border-bottom: 0; }
.policy-rank { padding-top: 13px; color: #88a098; font-family: Georgia, serif; font-size: 13px; text-align: center; }
.policy-match-main { min-width: 0; padding: 11px 13px 12px 2px; }
.policy-match-title { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
.policy-match-title > div { display: grid; gap: 2px; }
.policy-match-title strong { color: #173f34; font-size: 11px; }
.policy-match-title span { color: #688077; font-size: 8px; }
.policy-match-title b { color: #1f5d4d; font-family: Georgia, serif; font-size: 15px; }
.score-track { height: 2px; margin: 8px 0; overflow: hidden; background: #dfe9e3; }
.score-track span { display: block; height: 100%; background: #37806c; }
.policy-match p { max-height: 54px; margin: 0; overflow: hidden; color: #40564f; font-size: 10px; line-height: 1.7; }
.policy-match footer { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; color: #5f766e; font-size: 8px; }
.score-breakdown { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 6px; color: #789087; font-size: 7px; text-transform: uppercase; }

@media (max-width: 680px) {
  .retrieval-metrics { grid-template-columns: repeat(2, 1fr); }
  .retrieval-metrics div:nth-child(2) { border-right: 0; }
  .retrieval-metrics div:nth-child(-n + 2) { border-bottom: 1px solid #dbe5df; }
}
</style>
