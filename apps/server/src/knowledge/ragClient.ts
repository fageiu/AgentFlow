import type {
  KnowledgeRetrievalMetrics,
  PolicyCitation,
  PolicyKnowledgeMatch,
  PolicySearchResult,
} from "@agentflow/shared";
import { KnowledgeServiceError, type KnowledgeErrorCode } from "../agent/errors.js";
import { loadEnv } from "../env/loadEnv.js";
import { getLlmConfig } from "../llm/config.js";
import { searchPolicy as searchPolicyFixture } from "../tools/sandboxTools.js";

declare const process: { env: Record<string, string | undefined> };

export interface PolicySearchInput {
  keyword: string;
  query?: string;
}

export interface RagRequestContext {
  runId?: string;
  signal?: AbortSignal;
}

interface RagConfig {
  mode: "service" | "fixture";
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

interface ErrorPayload {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** Mock 评测显式使用兼容 Fixture；真实模型默认必须访问独立知识服务。 */
export function getRagConfig(): RagConfig {
  loadEnv();
  const configuredMode = process.env.RAG_MODE;
  const mode = configuredMode === "fixture" || (configuredMode == null && getLlmConfig().mock)
    ? "fixture"
    : "service";
  return {
    mode,
    baseUrl: (process.env.RAG_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
    timeoutMs: nonNegativeInteger(process.env.RAG_REQUEST_TIMEOUT_MS, 3_000),
    maxRetries: nonNegativeInteger(process.env.RAG_MAX_RETRIES, 1),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new KnowledgeServiceError("KNOWLEDGE_DOCUMENT_INVALID", `RAG response is missing ${key}.`, { key });
  }
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseCitation(value: unknown): PolicyCitation {
  const record = asRecord(value);
  if (!record) {
    throw new KnowledgeServiceError("KNOWLEDGE_DOCUMENT_INVALID", "RAG response is missing citation.");
  }
  return {
    documentId: requiredString(record, "document_id"),
    nodeId: requiredString(record, "node_id"),
    sourceName: requiredString(record, "source_name"),
    version: requiredString(record, "version"),
    section: typeof record.section === "string" ? record.section : undefined,
    page: optionalNumber(record, "page"),
  };
}

function parseMatch(value: unknown): PolicyKnowledgeMatch {
  const record = asRecord(value);
  if (!record || typeof record.score !== "number" || !Number.isFinite(record.score)) {
    throw new KnowledgeServiceError("KNOWLEDGE_DOCUMENT_INVALID", "RAG response contains an invalid match.");
  }
  return {
    policyId: requiredString(record, "policy_id"),
    keyword: requiredString(record, "keyword"),
    title: requiredString(record, "title"),
    content: requiredString(record, "content"),
    snippet: optionalString(record, "snippet"),
    rankingStage: (
      record.ranking_stage === "reranker"
      || record.ranking_stage === "fast_semantic"
      || record.ranking_stage === "fusion_coverage"
    ) ? record.ranking_stage : undefined,
    score: record.score,
    vectorScore: optionalNumber(record, "vector_score"),
    lexicalScore: optionalNumber(record, "lexical_score"),
    fusionScore: optionalNumber(record, "fusion_score"),
    rerankScore: optionalNumber(record, "rerank_score"),
    citation: parseCitation(record.citation),
  };
}

function parseRetrieval(value: unknown): KnowledgeRetrievalMetrics {
  const record = asRecord(value);
  const keys = ["vector_candidates", "lexical_candidates", "reranked_candidates", "duration_ms"] as const;
  if (!record || keys.some((key) => typeof record[key] !== "number")) {
    throw new KnowledgeServiceError("KNOWLEDGE_DOCUMENT_INVALID", "RAG response contains invalid retrieval metrics.");
  }
  return {
    vectorCandidates: record.vector_candidates as number,
    lexicalCandidates: record.lexical_candidates as number,
    rerankedCandidates: record.reranked_candidates as number,
    durationMs: record.duration_ms as number,
    rerankerApplied: typeof record.reranker_applied === "boolean"
      ? record.reranker_applied
      : undefined,
  };
}

/** 解析rag搜索结果 */
function parseSearchResult(value: unknown, requestedKeyword: string): PolicySearchResult {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.matches) || record.matches.length === 0) {
    throw new KnowledgeServiceError("KNOWLEDGE_DOCUMENT_INVALID", "RAG response does not contain matches.");
  }
  const matches = record.matches.map(parseMatch);
  const top = matches[0];
  return {
    id: top.policyId,
    keyword: top.keyword,
    title: top.title,
    content: top.content,
    snippet: top.snippet,
    matchedKeyword: top.keyword,
    requestedKeyword,
    score: top.score,
    citation: top.citation,
    matches,
    retrieval: parseRetrieval(record.retrieval),
  };
}

/** mock模式使用本地沙箱数据 */
function fixtureResult(keyword: string): PolicySearchResult {
  const policy = searchPolicyFixture(keyword);
  const citation: PolicyCitation = {
    documentId: `fixture:${policy.id}`,
    nodeId: `fixture:${policy.id}:1`,
    sourceName: "sandbox-seed-policy",
    version: "fixture",
  };
  const match: PolicyKnowledgeMatch = {
    policyId: policy.id,
    keyword: policy.keyword,
    title: policy.title,
    content: policy.content,
    snippet: policy.content,
    rankingStage: "fixture",
    score: 1,
    fusionScore: 1,
    rerankScore: 1,
    citation,
  };
  return {
    id: policy.id,
    keyword: policy.keyword,
    title: policy.title,
    content: policy.content,
    snippet: policy.content,
    matchedKeyword: policy.matchedKeyword,
    requestedKeyword: keyword,
    score: 1,
    citation,
    matches: [match],
    retrieval: {
      vectorCandidates: 1,
      lexicalCandidates: 1,
      rerankedCandidates: 1,
      durationMs: 0,
      rerankerApplied: false,
    },
  };
}

/** 将远程错误代码映射到本地错误代码 */
function mapRemoteCode(status: number, code: string | undefined): KnowledgeErrorCode {
  if (code === "KNOWLEDGE_INDEX_NOT_READY" || status === 503 && code?.includes("INDEX")) return "KNOWLEDGE_INDEX_NOT_READY";
  if (code === "KNOWLEDGE_NO_MATCH" || status === 404) return "KNOWLEDGE_NO_MATCH";
  if (code === "KNOWLEDGE_DOCUMENT_INVALID" || status === 422) return "KNOWLEDGE_DOCUMENT_INVALID";
  return "KNOWLEDGE_SERVICE_UNAVAILABLE";
}

function createAttemptSignal(externalSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("RAG request timeout")), timeoutMs);
  const abort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    },
  };
}

/** 访问 RAG 搜索接口；只对网络错误和 5xx 做一次有界重试。 */
async function requestService(input: PolicySearchInput, context: RagRequestContext, config: RagConfig) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const attemptSignal = createAttemptSignal(context.signal, config.timeoutMs);
    try {
      const response = await fetch(`${config.baseUrl}/v1/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(context.runId ? { "X-Agent-Run-Id": context.runId } : {}),
        },
        body: JSON.stringify({ query: input.query ?? input.keyword, keyword_hint: input.keyword, top_k: 5 }),
        signal: attemptSignal.signal,
      });
      const payload = await response.json().catch(() => undefined) as ErrorPayload | undefined;
      if (response.ok) return parseSearchResult(payload, input.keyword);

      const remote = payload?.error;
      const code = mapRemoteCode(response.status, remote?.code);
      const error = new KnowledgeServiceError(code, remote?.message ?? `RAG request failed with ${response.status}.`, {
        status: response.status,
        attempt,
        ...remote?.details,
      });
      if (response.status < 500 || attempt === config.maxRetries) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof KnowledgeServiceError) throw error;
      if (context.signal?.aborted) throw error;
      lastError = error;
      if (attempt === config.maxRetries) {
        throw new KnowledgeServiceError("KNOWLEDGE_SERVICE_UNAVAILABLE", "RAG request failed.", {
          attempt,
          timeoutMs: config.timeoutMs,
        }, { cause: error });
      }
    } finally {
      attemptSignal.cleanup();
    }
  }
  throw lastError;
}

/** searchPolicy 唯一入口：Fixture 只允许显式 Mock，真实模式禁止静默降级。 */
export async function searchPolicyKnowledge(input: PolicySearchInput, context: RagRequestContext = {}) {
  const config = getRagConfig();
  return config.mode === "fixture"
    ? fixtureResult(input.keyword)
    : requestService(input, context, config);
}
