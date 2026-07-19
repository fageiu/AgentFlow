from collections.abc import Sequence

import pytest
from llama_index.core.schema import NodeWithScore, TextNode

from agentflow_rag.errors import KnowledgeNoMatchError
from agentflow_rag.retrieval import (
    FastFusionReranker,
    IdentityReranker,
    LlamaIndexBM25Source,
    PolicyHybridRetriever,
    RetrievalService,
    build_lexical_websearch_query,
    deduplicate_document_candidates,
    reciprocal_rank_fusion,
)
from agentflow_rag.schemas import SearchRequest


def candidate(node_id: str, policy_id: str, keyword: str, score: float) -> NodeWithScore:
    return NodeWithScore(
        node=TextNode(
            id_=node_id,
            text=f"{policy_id} 的政策正文",
            metadata={
                "policy_id": policy_id,
                "keyword": keyword,
                "title": f"{policy_id} 标题",
                "document_id": f"doc-{policy_id}",
                "source_name": f"{policy_id}.md",
                "version": "1.0",
                "status": "active",
            },
        ),
        score=score,
    )


class FakeSource:
    def __init__(self, candidates: Sequence[NodeWithScore]) -> None:
        self.candidates = list(candidates)

    async def retrieve(
        self, query: str, top_k: int, *, include_archived: bool = False
    ) -> list[NodeWithScore]:
        del query, include_archived
        return self.candidates[:top_k]


class FakeReranker:
    enabled = True

    def __init__(self, ordered_scores: list[tuple[str, float]]) -> None:
        self.ordered_scores = ordered_scores

    async def rerank(
        self, query: str, candidates: Sequence[NodeWithScore], top_n: int
    ) -> list[NodeWithScore]:
        del query
        by_id = {item.node.node_id: item for item in candidates}
        return [
            NodeWithScore(node=by_id[node_id].node, score=score)
            for node_id, score in self.ordered_scores[:top_n]
        ]


def test_rrf_deduplicates_candidates_and_combines_rank() -> None:
    shared = candidate("shared", "P-refund-001", "refund", 0.9)
    vector = [shared, candidate("vector", "P-other", "other", 0.8)]
    lexical = [shared, candidate("lexical", "P-invoice-001", "发票", 0.8)]

    fused = reciprocal_rank_fusion(vector, lexical)
    assert [item.node.node_id for item in fused][0] == "shared"
    assert len(fused) == 3


def test_document_candidates_are_deduplicated_before_fast_pool_truncation() -> None:
    first = candidate("refund-1", "P-refund", "refund", 0.9)
    duplicate = candidate("refund-2", "P-refund", "refund", 0.8)
    other = candidate("risk", "P-risk", "approval", 0.7)

    result = deduplicate_document_candidates([first, duplicate, other])

    assert [item.node.node_id for item in result] == ["refund-1", "risk"]


def test_wrong_keyword_hint_does_not_filter_semantic_result() -> None:
    upgrade = candidate("upgrade", "P-upgrade-001", "upgrade", 0.9)
    refund = candidate("refund", "P-refund-001", "refund", 0.8)

    fused = reciprocal_rank_fusion([upgrade], [upgrade, refund], keyword_hint="refund")
    assert fused[0].node.metadata["policy_id"] == "P-upgrade-001"
    assert {item.node.metadata["policy_id"] for item in fused} == {"P-upgrade-001", "P-refund-001"}


def test_lexical_query_uses_or_and_removes_duplicate_tokens() -> None:
    query = build_lexical_websearch_query("核心接口中断两小时如何处理")

    assert " OR " in query
    tokens = query.split(" OR ")
    assert len(tokens) == len(set(tokens))
    assert all(token.strip() for token in tokens)
    assert "如何" not in tokens
    assert all(len(token) >= 2 for token in tokens)


@pytest.mark.asyncio
async def test_retrieval_service_returns_citations_and_metrics() -> None:
    match = candidate("refund", "P-refund-001", "refund", 0.9)
    retriever = PolicyHybridRetriever(FakeSource([match]), FakeSource([match]))
    service = RetrievalService(retriever, IdentityReranker(), minimum_score=0.35)

    response = await service.search(SearchRequest(query="VIP 客户如何退款"))
    assert response.matches[0].citation.node_id == "refund"
    assert response.matches[0].policy_id == "P-refund-001"
    assert response.matches[0].rerank_score is None
    assert response.retrieval.vector_candidates == 1
    assert response.retrieval.lexical_candidates == 1


@pytest.mark.asyncio
async def test_retrieval_service_rejects_low_confidence_result() -> None:
    match = candidate("weak", "P-unrelated", "other", 0.1)
    retriever = PolicyHybridRetriever(FakeSource([match]), FakeSource([]))
    service = RetrievalService(retriever, IdentityReranker(), minimum_score=0.8)

    with pytest.raises(KnowledgeNoMatchError):
        await service.search(SearchRequest(query="公司食堂供应什么"))


@pytest.mark.asyncio
async def test_fast_mode_deduplicates_nodes_from_same_document() -> None:
    first = candidate("refund-1", "P-refund-001", "refund", 0.9)
    second = candidate("refund-2", "P-refund-001", "refund", 0.8)
    invoice = candidate("invoice", "P-invoice-001", "invoice", 0.7)
    retriever = PolicyHybridRetriever(FakeSource([first, second, invoice]), FakeSource([]))
    service = RetrievalService(retriever, IdentityReranker(), minimum_score=0.35)

    response = await service.search(SearchRequest(query="退款与发票政策"))

    assert [match.policy_id for match in response.matches] == ["P-refund-001", "P-invoice-001"]


@pytest.mark.asyncio
async def test_fast_fusion_reranker_prefers_stronger_vector_match() -> None:
    semantic = candidate("semantic", "P-sla-001", "sla", 0.7)
    semantic.node.metadata.update(vector_score=0.8, fusion_score=0.6)
    lexical = candidate("lexical", "P-other", "other", 0.9)
    lexical.node.metadata.update(vector_score=0.6, fusion_score=1.0)

    result = await FastFusionReranker().rerank("服务中断", [lexical, semantic], 2)

    assert [item.node.node_id for item in result] == ["semantic", "lexical"]


@pytest.mark.asyncio
async def test_fast_mode_keeps_semantic_top1_and_uses_fusion_coverage_after_it() -> None:
    semantic = candidate("semantic", "P-semantic", "sla", 0.9)
    lexical = candidate("lexical", "P-lexical", "approval", 0.8)
    retriever = PolicyHybridRetriever(
        FakeSource([semantic, lexical]),
        FakeSource([lexical]),
    )
    service = RetrievalService(retriever, FastFusionReranker(), minimum_score=0.35)

    response = await service.search(SearchRequest(query="语义主证据与覆盖", top_k=2))

    assert [item.policy_id for item in response.matches] == ["P-semantic", "P-lexical"]
    assert response.matches[0].score == pytest.approx(0.86, abs=0.01)
    assert response.matches[1].score == pytest.approx(0.82, abs=0.01)


@pytest.mark.asyncio
async def test_fast_mode_does_not_drop_strong_second_semantic_candidate() -> None:
    primary = candidate("primary", "P-primary", "general", 0.95)
    semantic_second = candidate("semantic-second", "P-expected", "approval", 0.9)
    lexical = [
        candidate(f"lexical-{index}", f"P-lexical-{index}", "other", 0.8 - index * 0.01)
        for index in range(5)
    ]
    retriever = PolicyHybridRetriever(
        FakeSource([primary, semantic_second, *lexical]),
        FakeSource(lexical),
    )
    service = RetrievalService(retriever, FastFusionReranker(), minimum_score=0.35)

    response = await service.search(SearchRequest(query="保留强语义次证据", top_k=5))

    assert response.matches[0].policy_id == "P-primary"
    assert response.matches[1].policy_id == "P-expected"
    assert len(response.matches) == 5


@pytest.mark.asyncio
async def test_full_mode_records_true_stage_rankings_and_preserves_fusion_coverage() -> None:
    fusion_primary = candidate("fusion-primary", "P-fusion", "general", 0.95)
    reranker_primary = candidate("reranker-primary", "P-reranked", "refund", 0.9)
    coverage = candidate("coverage", "P-coverage", "approval", 0.8)
    retriever = PolicyHybridRetriever(
        FakeSource([fusion_primary, reranker_primary, coverage]),
        FakeSource([fusion_primary, coverage]),
    )
    service = RetrievalService(
        retriever,
        FakeReranker(
            [
                ("reranker-primary", 0.92),
                ("fusion-primary", 0.75),
                ("coverage", 0.7),
            ]
        ),
        minimum_score=0.35,
        minimum_rerank_score=0.8,
    )

    response = await service.search(
        SearchRequest(query="退款审批依据", top_k=5, include_diagnostics=True)
    )

    assert [item.policy_id for item in response.matches] == [
        "P-reranked",
        "P-fusion",
        "P-coverage",
    ]
    assert response.matches[0].score == pytest.approx(0.92)
    assert response.matches[1].score == pytest.approx(1.0)
    assert response.retrieval.reranker_applied is True
    assert response.retrieval.fusion_ranking[0].node_id == "fusion-primary"
    assert response.retrieval.reranked_ranking[0].node_id == "reranker-primary"
    assert response.retrieval.reranked_ranking[0].rerank_score == pytest.approx(0.92)


@pytest.mark.asyncio
async def test_full_mode_uses_independent_reranker_rejection_threshold() -> None:
    match = candidate("refund", "P-refund", "refund", 0.95)
    retriever = PolicyHybridRetriever(FakeSource([match]), FakeSource([match]))
    service = RetrievalService(
        retriever,
        FakeReranker([("refund", 0.6)]),
        minimum_score=0.2,
        minimum_rerank_score=0.7,
    )

    with pytest.raises(KnowledgeNoMatchError) as error:
        await service.search(SearchRequest(query="退款政策"))

    assert error.value.details["threshold"] == 0.7


@pytest.mark.asyncio
async def test_bm25_source_uses_jieba_and_separates_archived_snapshot() -> None:
    active = candidate("refund-current", "P-refund-current", "refund", 0.9).node
    active.text = "VIP 客户可以申请退款并进入人工审批流程"
    archived = candidate("refund-archived", "P-refund-old", "refund", 0.8).node
    archived.text = "旧版特殊退款流程已经停止使用"
    archived.metadata["status"] = "archived"
    source = LlamaIndexBM25Source(None, similarity_top_k=5)
    await source.replace_nodes([active], [active, archived])

    current_results = await source.retrieve("旧版特殊", 5)
    historical_results = await source.retrieve("旧版特殊", 5, include_archived=True)

    assert current_results == []
    assert historical_results[0].node.node_id == "refund-archived"
    assert historical_results[0].node.text == archived.text
    assert "bm25_original_content" not in historical_results[0].node.metadata


@pytest.mark.asyncio
async def test_bm25_source_indexes_policy_title_without_leaking_it_into_content() -> None:
    approval = candidate("approval", "P-refund-approval", "refund", 0.9).node
    approval.text = "金额达到对应区间后由具备权限的负责人复核。"
    approval.metadata["title"] = "退款审批权限矩阵"
    source = LlamaIndexBM25Source(None, similarity_top_k=5)
    await source.replace_nodes([approval], [approval])

    results = await source.retrieve("退款审批矩阵", 5)

    assert results[0].node.node_id == "approval"
    assert results[0].node.text == approval.text
