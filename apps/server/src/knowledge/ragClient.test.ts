import assert from "node:assert/strict";
import { test } from "node:test";
import { KnowledgeServiceError } from "../agent/errors.js";
import { searchPolicyKnowledge } from "./ragClient.js";

const originalFetch = globalThis.fetch;

function servicePayload() {
  return {
    matches: [
      {
        policy_id: "POL-REFUND-001",
        keyword: "refund",
        title: "企业退款审批政策",
        content: "高金额退款必须经过人工审批。",
        snippet: "高金额退款必须经过人工审批。",
        ranking_stage: "reranker",
        score: 0.91,
        fusion_score: 0.72,
        rerank_score: 0.91,
        citation: {
          document_id: "doc-1",
          node_id: "node-1",
          source_name: "refund-policy.md",
          version: "2.0",
          section: "审批规则",
        },
      },
    ],
    retrieval: {
      vector_candidates: 20,
      lexical_candidates: 12,
      reranked_candidates: 10,
      duration_ms: 86,
      reranker_applied: true,
    },
  };
}

test("Mock 模式可显式使用 Seed Policy 兼容 Fixture", async () => {
  const previousMode = process.env.RAG_MODE;
  process.env.RAG_MODE = "fixture";
  try {
    const result = await searchPolicyKnowledge({ keyword: "refund", query: "退款需要审批吗" });
    assert.equal(result.id, "P-refund-001");
    assert.equal(result.citation.version, "fixture");
    assert.equal(result.matches.length, 1);
  } finally {
    if (previousMode == null) delete process.env.RAG_MODE;
    else process.env.RAG_MODE = previousMode;
  }
});

test("Mock 政策种子与真实语料一致支持续费折扣专项规则", async () => {
  const previousMode = process.env.RAG_MODE;
  process.env.RAG_MODE = "fixture";
  try {
    const result = await searchPolicyKnowledge({
      keyword: "renewal-discount",
      query: "续费折扣没有按合同体现，应该如何复核？",
    });
    assert.equal(result.id, "P-renewal-002");
    assert.equal(result.matches[0]?.keyword, "renewal-discount");
    assert.equal(result.citation.version, "fixture");
  } finally {
    if (previousMode == null) delete process.env.RAG_MODE;
    else process.env.RAG_MODE = previousMode;
  }
});

test("RAG Client 映射 snake_case 响应并传递 Run ID", async () => {
  const previousMode = process.env.RAG_MODE;
  process.env.RAG_MODE = "service";
  let receivedRunId: string | null = null;
  globalThis.fetch = async (_input, init) => {
    receivedRunId = new Headers(init?.headers).get("X-Agent-Run-Id");
    return new Response(JSON.stringify(servicePayload()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await searchPolicyKnowledge(
      { keyword: "refund", query: "企业客户退款的审批规则" },
      { runId: "run-rag-1" },
    );
    assert.equal(receivedRunId, "run-rag-1");
    assert.equal(result.id, "POL-REFUND-001");
    assert.equal(result.snippet, "高金额退款必须经过人工审批。");
    assert.equal(result.matches[0]?.snippet, "高金额退款必须经过人工审批。");
    assert.equal(result.matches[0]?.rankingStage, "reranker");
    assert.equal(result.citation.sourceName, "refund-policy.md");
    assert.equal(result.retrieval.vectorCandidates, 20);
    assert.equal(result.retrieval.rerankerApplied, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousMode == null) delete process.env.RAG_MODE;
    else process.env.RAG_MODE = previousMode;
  }
});

test("RAG Client 对临时 5xx 只读重试一次", async () => {
  const previousMode = process.env.RAG_MODE;
  const previousRetries = process.env.RAG_MAX_RETRIES;
  process.env.RAG_MODE = "service";
  process.env.RAG_MAX_RETRIES = "1";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { code: "KNOWLEDGE_SERVICE_UNAVAILABLE", message: "temporary" } }), { status: 503 });
    }
    return new Response(JSON.stringify(servicePayload()), { status: 200 });
  };
  try {
    const result = await searchPolicyKnowledge({ keyword: "refund", query: "退款规则" });
    assert.equal(calls, 2);
    assert.equal(result.id, "POL-REFUND-001");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousMode == null) delete process.env.RAG_MODE;
    else process.env.RAG_MODE = previousMode;
    if (previousRetries == null) delete process.env.RAG_MAX_RETRIES;
    else process.env.RAG_MAX_RETRIES = previousRetries;
  }
});

test("无可靠结果映射为稳定知识错误且不降级 Fixture", async () => {
  const previousMode = process.env.RAG_MODE;
  process.env.RAG_MODE = "service";
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "KNOWLEDGE_NO_MATCH", message: "no reliable match" },
  }), { status: 404 });
  try {
    let thrown: unknown;
    try {
      await searchPolicyKnowledge({ keyword: "refund", query: "不存在的政策" });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof KnowledgeServiceError);
    assert.equal(thrown.agentError.code, "KNOWLEDGE_NO_MATCH");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousMode == null) delete process.env.RAG_MODE;
    else process.env.RAG_MODE = previousMode;
  }
});
