from pathlib import Path

import pytest

from agentflow_rag.errors import KnowledgeNoMatchError
from agentflow_rag.evaluation import evaluate_queries
from agentflow_rag.schemas import (
    KnowledgeRetrievalMetrics,
    PolicyCitation,
    PolicyKnowledgeMatch,
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
            ),
        )


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

