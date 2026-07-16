"""检索 Golden Query 指标计算与报告。"""

from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Protocol

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
    average_duration_ms: float


async def evaluate_queries(service: SearchService, query_path: Path) -> RetrievalEvaluationSummary:
    cases = json.loads(query_path.read_text(encoding="utf-8"))
    recalls: list[float] = []
    reciprocal_ranks: list[float] = []
    no_answer_results: list[bool] = []
    durations: list[int] = []

    for case in cases:
        expected = set(case["expected_policy_ids"])
        try:
            result = await service.search(
                SearchRequest(
                    query=case["query"],
                    keyword_hint=case.get("keyword_hint"),
                    top_k=5,
                    include_archived=case.get("include_archived", False),
                )
            )
            actual = [item.policy_id for item in result.matches]
            durations.append(result.retrieval.duration_ms)
            if expected:
                recalls.append(len(expected.intersection(actual)) / len(expected))
                rank = next((index for index, policy_id in enumerate(actual, 1) if policy_id in expected), 0)
                reciprocal_ranks.append(1 / rank if rank else 0)
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
        average_duration_ms=mean(durations) if durations else 0,
    )


def run_cli() -> None:
    parser = argparse.ArgumentParser(description="运行企业政策检索评测")
    parser.add_argument("--queries", type=Path, required=True)
    parser.parse_args()
    raise SystemExit("请通过应用依赖容器调用 evaluate_queries；CLI 连接配置将在部署阶段注入。")


if __name__ == "__main__":
    asyncio.run(asyncio.sleep(0))
    run_cli()

