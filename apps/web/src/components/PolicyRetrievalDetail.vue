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

const primaryMatch = computed(() => result.value?.matches[0]);
const supportingMatches = computed(() => result.value?.matches.slice(1, 3) ?? []);
const additionalMatches = computed(() => result.value?.matches.slice(3) ?? []);
const rawOutput = computed(() => JSON.stringify(props.output, null, 2));
const retrievalModeLabel = computed(() =>
  result.value?.retrieval.rerankerApplied ? "Cross-encoder 重排" : "快速语义排序",
);

function percent(score: number | undefined) {
  return `${Math.round(Math.max(0, Math.min(1, score ?? 0)) * 100)}%`;
}

function scoreLabel(score: number | undefined) {
  return score == null ? "—" : score.toFixed(3);
}

function rankingStageLabel(match: PolicyKnowledgeMatch) {
  switch (match.rankingStage) {
    case "reranker":
      return "重排分";
    case "fast_semantic":
      return "语义主排";
    case "fusion_coverage":
      return "融合召回";
    case "fixture":
      return "Fixture";
    default:
      return "历史综合分";
  }
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
        <strong>政策依据</strong>
      </div>
      <div class="policy-ledger-summary">
        <span>{{ retrievalModeLabel }}</span>
        <span>{{ result.matches.length }} 条引用</span>
        <span>{{ result.retrieval.durationMs }} ms</span>
      </div>
    </header>

    <article v-if="primaryMatch" class="policy-primary">
      <div class="policy-primary-label">主要依据 · Top 1</div>
      <div class="policy-primary-title">
        <div>
          <strong>{{ primaryMatch.title }}</strong>
          <span>{{ primaryMatch.policyId }} · v{{ primaryMatch.citation.version }}</span>
        </div>
        <span class="policy-stage-score">
          <small>{{ rankingStageLabel(primaryMatch) }}</small>
          <b>{{ scoreLabel(primaryMatch.score) }}</b>
        </span>
      </div>
      <div class="score-track" aria-hidden="true">
        <span :style="{ width: percent(primaryMatch.score) }"></span>
      </div>
      <p>{{ primaryMatch.content }}</p>
      <footer>
        <span>{{ primaryMatch.citation.sourceName }}</span>
        <span>{{ location(primaryMatch) }}</span>
        <span>Node {{ primaryMatch.citation.nodeId.slice(0, 12) }}</span>
      </footer>
    </article>

    <section v-if="supportingMatches.length" class="policy-supporting" aria-label="相关政策依据">
      <div class="policy-section-label">相关依据</div>
      <ol>
        <li v-for="(match, index) in supportingMatches" :key="match.citation.nodeId">
          <span class="policy-rank">{{ String(index + 2).padStart(2, "0") }}</span>
          <div>
            <div class="policy-compact-title">
              <strong>{{ match.title }}</strong>
              <span class="policy-stage-score">
                <small>{{ rankingStageLabel(match) }}</small>
                <b>{{ scoreLabel(match.score) }}</b>
              </span>
            </div>
            <p>{{ match.content }}</p>
            <footer>
              <span>{{ match.policyId }} · v{{ match.citation.version }}</span>
              <span>{{ match.citation.sourceName }}</span>
              <span>{{ location(match) }}</span>
            </footer>
          </div>
        </li>
      </ol>
    </section>

    <details v-if="additionalMatches.length" class="policy-more">
      <summary>查看更多来源 <span>Top 4–{{ result.matches.length }}</span></summary>
      <ol>
        <li v-for="(match, index) in additionalMatches" :key="match.citation.nodeId">
          <span class="policy-rank">{{ String(index + 4).padStart(2, "0") }}</span>
          <div>
            <div class="policy-compact-title">
              <strong>{{ match.title }}</strong>
              <span class="policy-stage-score">
                <small>{{ rankingStageLabel(match) }}</small>
                <b>{{ scoreLabel(match.score) }}</b>
              </span>
            </div>
            <p>{{ match.content }}</p>
            <footer>
              <span>{{ match.policyId }} · v{{ match.citation.version }}</span>
              <span>{{ match.citation.sourceName }}</span>
              <span>{{ location(match) }}</span>
            </footer>
          </div>
        </li>
      </ol>
    </details>

    <details class="policy-debug">
      <summary>检索调试信息 <span>召回、融合与原始数据</span></summary>
      <dl class="retrieval-metrics">
        <div><dt>向量召回</dt><dd>{{ result.retrieval.vectorCandidates }}</dd></div>
        <div><dt>关键词召回</dt><dd>{{ result.retrieval.lexicalCandidates }}</dd></div>
        <div><dt>重排候选</dt><dd>{{ result.retrieval.rerankedCandidates }}</dd></div>
        <div><dt>最终引用</dt><dd>{{ result.matches.length }}</dd></div>
      </dl>
      <div class="policy-score-table">
        <div class="policy-score-head">
          <span>来源</span><span>排序阶段</span><span>Vector</span><span>Lexical</span><span>Fusion</span><span>Rerank</span>
        </div>
        <div v-for="(match, index) in result.matches" :key="match.citation.nodeId">
          <strong>#{{ index + 1 }} {{ match.title }}</strong>
          <span>{{ rankingStageLabel(match) }}</span>
          <span>{{ scoreLabel(match.vectorScore) }}</span>
          <span>{{ scoreLabel(match.lexicalScore) }}</span>
          <span>{{ scoreLabel(match.fusionScore) }}</span>
          <span>{{ scoreLabel(match.rerankScore) }}</span>
        </div>
      </div>
      <details class="policy-raw-output">
        <summary>查看原始 JSON</summary>
        <pre>{{ rawOutput }}</pre>
      </details>
    </details>
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
.policy-ledger-summary,
.policy-primary-title span,
.policy-ledger footer,
.policy-score-table {
  font-family: "Cascadia Code", "IBM Plex Mono", Consolas, monospace;
}
.policy-ledger-kicker { color: #4e786c; font-size: 8px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
.policy-ledger-summary { display: flex; gap: 6px; color: #315f53; font-size: 9px; font-weight: 700; }
.policy-ledger-summary span { padding: 3px 7px; border: 1px solid #cbded5; border-radius: 999px; background: #f8fbf9; }

.policy-primary { padding: 13px 15px 12px; border-bottom: 1px solid #dbe5df; background: #f9fcfa; }
.policy-primary-label,
.policy-section-label { margin-bottom: 7px; color: #4e786c; font-size: 8px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.policy-primary-title,
.policy-compact-title { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
.policy-primary-title > div { display: grid; gap: 2px; }
.policy-primary-title strong { color: #173f34; font-size: 12px; }
.policy-primary-title span { color: #688077; font-size: 8px; }
.policy-stage-score { display: grid; flex: 0 0 auto; justify-items: end; gap: 1px; }
.policy-stage-score small { color: #6f877e; font-family: "Cascadia Code", Consolas, monospace; font-size: 7px; font-weight: 700; white-space: nowrap; }
.policy-stage-score b { color: #1f5d4d; font-family: Georgia, serif; font-size: 15px; }
.score-track { height: 2px; margin: 8px 0; overflow: hidden; background: #dfe9e3; }
.score-track span { display: block; height: 100%; background: #37806c; }
.policy-primary p { display: -webkit-box; margin: 0; overflow: hidden; color: #40564f; font-size: 10px; line-height: 1.7; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.policy-ledger footer { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; color: #5f766e; font-size: 8px; }

.policy-supporting { padding: 11px 13px 8px; border-bottom: 1px solid #dbe5df; }
.policy-supporting ol,
.policy-more ol { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.policy-supporting li,
.policy-more li { display: grid; grid-template-columns: 27px 1fr; padding: 8px 0; border-top: 1px solid #e4ebe7; }
.policy-supporting li:first-child,
.policy-more li:first-child { border-top: 0; }
.policy-rank { padding-top: 1px; color: #88a098; font-family: Georgia, serif; font-size: 11px; }
.policy-compact-title strong { color: #29483f; font-size: 10px; }
.policy-compact-title .policy-stage-score b { font-size: 12px; }
.policy-supporting p,
.policy-more p { display: -webkit-box; margin: 4px 0 0; overflow: hidden; color: #53665f; font-size: 9px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }

.policy-more,
.policy-debug { border-bottom: 1px solid #dbe5df; }
.policy-debug { border-bottom: 0; background: #eef4f0; }
.policy-more > summary,
.policy-debug > summary,
.policy-raw-output > summary { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center; padding: 9px 13px; color: #315f53; cursor: pointer; font-size: 9px; font-weight: 800; list-style: none; }
.policy-more > summary::-webkit-details-marker,
.policy-debug > summary::-webkit-details-marker,
.policy-raw-output > summary::-webkit-details-marker { display: none; }
.policy-more > summary::after,
.policy-debug > summary::after,
.policy-raw-output > summary::after { content: ""; width: 6px; height: 6px; box-sizing: border-box; border: solid #789087; border-width: 0 1.5px 1.5px 0; transform: rotate(-45deg); transition: transform .15s ease; }
.policy-more[open] > summary::after,
.policy-debug[open] > summary::after,
.policy-raw-output[open] > summary::after { transform: rotate(45deg); }
.policy-more > summary span,
.policy-debug > summary span { color: #789087; font-family: "Cascadia Code", Consolas, monospace; font-size: 8px; font-weight: 600; }
.policy-more[open] > summary,
.policy-debug[open] > summary { border-bottom: 1px solid #dbe5df; }
.policy-more ol { padding: 2px 13px 7px; background: #f7faf8; }

.retrieval-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  border-bottom: 1px solid #dbe5df;
  background: #f7faf8;
}
.retrieval-metrics div { padding: 8px 10px; border-right: 1px solid #dbe5df; }
.retrieval-metrics div:last-child { border-right: 0; }
.retrieval-metrics dt { color: #6a8179; font-size: 8px; }
.retrieval-metrics dd { margin: 2px 0 0; color: #173f34; font-size: 14px; font-weight: 800; }

.policy-score-table { padding: 8px 11px 10px; background: #f7faf8; }
.policy-score-table > div { display: grid; grid-template-columns: minmax(150px, 1fr) 70px repeat(4, 55px); gap: 6px; padding: 6px 4px; border-bottom: 1px solid #e1e9e4; color: #647a72; font-size: 8px; }
.policy-score-table > div:last-child { border-bottom: 0; }
.policy-score-table strong { overflow: hidden; color: #29483f; text-overflow: ellipsis; white-space: nowrap; }
.policy-score-head { color: #789087 !important; font-weight: 800; text-transform: uppercase; }
.policy-raw-output { margin: 0 11px 11px; border: 1px solid #d9e4de; border-radius: 6px; background: #f9fbfa; }
.policy-raw-output > summary { grid-template-columns: 1fr auto; padding: 8px 10px; }
.policy-raw-output pre { max-height: 260px; margin: 0; overflow: auto; border-top: 1px solid #d9e4de; padding: 10px; color: #40564f; font-size: 8px; line-height: 1.55; white-space: pre-wrap; }

@media (max-width: 680px) {
  .retrieval-metrics { grid-template-columns: repeat(2, 1fr); }
  .retrieval-metrics div:nth-child(2) { border-right: 0; }
  .retrieval-metrics div:nth-child(-n + 2) { border-bottom: 1px solid #dbe5df; }
  .policy-score-table { overflow-x: auto; }
  .policy-score-table > div { min-width: 420px; }
}
</style>
