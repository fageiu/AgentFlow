"""检索 Golden Query 指标计算与报告。"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import mean
from typing import Protocol

import httpx

from .errors import KnowledgeNoMatchError
from .schemas import SearchRequest, SearchResponse


class SearchService(Protocol):
    async def search(self, request: SearchRequest) -> SearchResponse: ...


@dataclass(slots=True)
class RetrievalEvaluationSummary:
    total: int
    recall_at_5: float
    mrr: float
    no_answer_accuracy: float
    fusion_top1_accuracy: float
    reranker_top1_accuracy: float
    average_duration_ms: float
    p95_duration_ms: float


class HttpSearchService:
    def __init__(self, base_url: str) -> None:
        self.client = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=10)

    async def search(self, request: SearchRequest) -> SearchResponse:
        response = await self.client.post("/v1/search", json=request.model_dump())
        if response.status_code == 404:
            payload = response.json()
            if payload.get("error", {}).get("code") == "KNOWLEDGE_NO_MATCH":
                raise KnowledgeNoMatchError()
        response.raise_for_status()
        return SearchResponse.model_validate(response.json())

    async def close(self) -> None:
        await self.client.aclose()


def percentile_95(values: list[int]) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * 0.95 + 0.999) - 1))
    return float(ordered[index])


async def evaluate_queries(service: SearchService, query_path: Path) -> RetrievalEvaluationSummary:
    # Golden Query 文件读取属于阻塞 I/O，避免占用检索服务事件循环。
    query_text = await asyncio.to_thread(query_path.read_text, encoding="utf-8")
    cases = json.loads(query_text)
    recalls: list[float] = []
    reciprocal_ranks: list[float] = []
    no_answer_results: list[bool] = []
    fusion_top1_results: list[bool] = []
    reranker_top1_results: list[bool] = []
    durations: list[int] = []

    for case in cases:
        expected = set(case["expected_policy_ids"])
        try:
            result = await service.search(
                SearchRequest(
                    query=case["query"],
                    keyword_hint=case.get("keyword_hint"),
                    top_k=10,
                    include_archived=case.get("include_archived", False),
                )
            )
            actual = [item.policy_id for item in result.matches[:5]]
            durations.append(result.retrieval.duration_ms)
            if expected:
                recalls.append(len(expected.intersection(actual)) / len(expected))
                rank = next((index for index, policy_id in enumerate(actual, 1) if policy_id in expected), 0)
                reciprocal_ranks.append(1 / rank if rank else 0)
                reranker_top1_results.append(bool(actual and actual[0] in expected))
                fusion_top = max(
                    result.matches,
                    key=lambda item: item.fusion_score if item.fusion_score is not None else item.score,
                )
                fusion_top1_results.append(fusion_top.policy_id in expected)
            else:
                no_answer_results.append(False)
        except KnowledgeNoMatchError:
            if expected:
                recalls.append(0)
                reciprocal_ranks.append(0)
            else:
                no_answer_results.append(True)

    return RetrievalEvaluationSummary(
        total=len(cases),
        recall_at_5=mean(recalls) if recalls else 0,
        mrr=mean(reciprocal_ranks) if reciprocal_ranks else 0,
        no_answer_accuracy=mean(no_answer_results) if no_answer_results else 0,
        fusion_top1_accuracy=mean(fusion_top1_results) if fusion_top1_results else 0,
        reranker_top1_accuracy=mean(reranker_top1_results) if reranker_top1_results else 0,
        average_duration_ms=mean(durations) if durations else 0,
        p95_duration_ms=percentile_95(durations),
    )


def run_cli() -> None:
    parser = argparse.ArgumentParser(description="运行企业政策检索评测")
    default_queries = Path(__file__).resolve().parents[2] / "knowledge" / "evaluation" / "golden_queries.json"
    parser.add_argument("--queries", type=Path, default=default_queries)
    parser.add_argument(
        "--base-url",
        default=os.getenv("RAG_EVAL_BASE_URL", "http://127.0.0.1:8000"),
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--enforce-targets", action="store_true")
    args = parser.parse_args()

    async def evaluate() -> RetrievalEvaluationSummary:
        service = HttpSearchService(args.base_url)
        try:
            return await evaluate_queries(service, args.queries)
        finally:
            await service.close()

    summary = asyncio.run(evaluate())
    payload = json.dumps(asdict(summary), ensure_ascii=False, indent=2)
    print(payload)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    if args.enforce_targets:
        passed = (
            summary.recall_at_5 >= 0.95
            and summary.mrr >= 0.85
            and summary.no_answer_accuracy >= 0.90
            and summary.reranker_top1_accuracy >= summary.fusion_top1_accuracy
            and summary.p95_duration_ms <= 2000
        )
        if not passed:
            raise SystemExit(1)


if __name__ == "__main__":
    run_cli()
