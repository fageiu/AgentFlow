from pathlib import Path

import httpx
import pytest

from agentflow_rag.errors import KnowledgeNoMatchError
from agentflow_rag.evaluation import (
    RetrievalEvaluationSummary,
    classify_retrieval_failures,
    evaluate_queries,
    passes_targets,
)
from agentflow_rag.schemas import (
    KnowledgeRetrievalMetrics,
    PolicyCitation,
    PolicyKnowledgeMatch,
    RetrievalCandidateTrace,
    SearchRequest,
    SearchResponse,
)


class FakeSearchService:
    async def search(self, request: SearchRequest) -> SearchResponse:
        if "午餐" in request.query:
            raise KnowledgeNoMatchError()
        match = PolicyKnowledgeMatch(
            policy_id="P-refund-001",
            keyword="refund",
            title="退款政策",
            content="退款政策正文",
            score=0.9,
            citation=PolicyCitation(
                document_id="doc",
                node_id="node",
                source_name="refund.md",
                version="1.0",
            ),
        )
        return SearchResponse(
            matches=[match],
            retrieval=KnowledgeRetrievalMetrics(
                vector_candidates=1,
                lexical_candidates=1,
                reranked_candidates=1,
                duration_ms=10,
                reranker_applied=True,
                fusion_ranking=[
                    RetrievalCandidateTrace(
                        rank=1,
                        policy_id="P-refund-001",
                        document_id="doc",
                        node_id="node",
                        fusion_score=0.8,
                    )
                ],
                reranked_ranking=[
                    RetrievalCandidateTrace(
                        rank=1,
                        policy_id="P-refund-001",
                        document_id="doc",
                        node_id="node",
                        fusion_score=0.8,
                        rerank_score=0.9,
                    )
                ],
            ),
        )


class TimeoutSearchService:
    async def search(self, request: SearchRequest) -> SearchResponse:
        raise httpx.ReadTimeout("reranker timed out", request=httpx.Request("POST", request.query))


@pytest.mark.asyncio
async def test_evaluation_calculates_recall_mrr_and_no_answer(tmp_path: Path) -> None:
    path = tmp_path / "queries.json"
    path.write_text(
        """[
          {"query":"如何退款","expected_policy_ids":["P-refund-001"],"answerable":true},
          {"query":"午餐是什么","expected_policy_ids":[],"answerable":false}
        ]""",
        encoding="utf-8",
    )

    summary = await evaluate_queries(FakeSearchService(), path)
    assert summary.recall_at_5 == 1
    assert summary.mrr == 1
    assert summary.no_answer_accuracy == 1
    assert summary.fusion_top1_accuracy == 1
    assert summary.reranker_top1_accuracy == 1
    assert len(summary.cases) == 2
    assert summary.cases[0].actual_policy_ids == ["P-refund-001"]
    assert summary.cases[0].fusion_ranking[0]["node_id"] == "node"
    assert summary.cases[0].reranked_ranking[0]["rerank_score"] == 0.9
    assert summary.cases[1].no_answer_correct is True


def test_fast_and_full_profiles_keep_separate_quality_gates() -> None:
    summary = RetrievalEvaluationSummary(
        total=50,
        recall_at_5=0.90,
        mrr=0.79,
        no_answer_accuracy=1.0,
        fusion_top1_accuracy=0.65,
        reranker_top1_accuracy=0.65,
        average_duration_ms=800,
        p95_duration_ms=1200,
    )

    assert passes_targets(summary, "fast") is True
    assert passes_targets(summary, "full") is False


def test_failure_diagnosis_distinguishes_recall_drop_and_top1_regression() -> None:
    fusion = [
        RetrievalCandidateTrace(
            rank=1,
            policy_id="P-expected",
            document_id="doc-expected",
            node_id="expected",
        ),
        RetrievalCandidateTrace(
            rank=2,
            policy_id="P-wrong",
            document_id="doc-wrong",
            node_id="wrong",
        ),
    ]
    reranked = [
        RetrievalCandidateTrace(
            rank=1,
            policy_id="P-wrong",
            document_id="doc-wrong",
            node_id="wrong",
        ),
        RetrievalCandidateTrace(
            rank=2,
            policy_id="P-expected",
            document_id="doc-expected",
            node_id="expected",
        ),
    ]

    diagnostics = classify_retrieval_failures(
        {"P-expected", "P-missing"},
        ["P-wrong"],
        fusion,
        reranked,
    )

    assert [item.category for item in diagnostics] == [
        "ranking_dropped",
        "not_recalled",
        "top1_regression",
    ]
    assert diagnostics[0].fusion_rank == 1
    assert diagnostics[1].fusion_rank is None


@pytest.mark.asyncio
async def test_evaluation_records_http_error_and_blocks_gate(tmp_path: Path) -> None:
    path = tmp_path / "queries.json"
    path.write_text(
        '[{"id":"timeout-01","query":"如何退款","expected_policy_ids":["P-refund-001"],'
        '"answerable":true}]',
        encoding="utf-8",
    )

    summary = await evaluate_queries(TimeoutSearchService(), path)

    assert summary.error_count == 1
    assert summary.cases[0].error == "ReadTimeout: reranker timed out"
    assert summary.recall_at_5 == 0
    assert passes_targets(summary, "fast") is False
