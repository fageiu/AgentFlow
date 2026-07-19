"""检索 Golden Query 指标计算与报告。"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from statistics import mean
from typing import Protocol

import httpx

from .errors import KnowledgeNoMatchError
from .schemas import RetrievalCandidateTrace, SearchRequest, SearchResponse


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
    error_count: int = 0
    diagnosis_counts: dict[str, int] = field(default_factory=dict)
    cases: list[RetrievalEvaluationCase] = field(default_factory=list)


@dataclass(slots=True)
class RetrievalEvaluationCase:
    """单条 Golden Query 的真实阶段排名和命中诊断。"""

    case_id: str
    query: str
    expected_policy_ids: list[str]
    answerable: bool
    actual_policy_ids: list[str]
    fusion_ranking: list[dict[str, object]]
    reranked_ranking: list[dict[str, object]]
    recall_at_5: float | None
    reciprocal_rank: float | None
    no_answer_correct: bool | None
    duration_ms: int | None
    error: str | None = None
    failure_diagnostics: list[RetrievalFailureDiagnosis] = field(default_factory=list)


@dataclass(slots=True)
class RetrievalFailureDiagnosis:
    """解释目标政策是在召回、排序还是 Top-1 阶段丢失。"""

    category: str
    policy_id: str
    fusion_rank: int | None
    reranked_rank: int | None
    detail: str


def passes_targets(summary: RetrievalEvaluationSummary, profile: str = "full") -> bool:
    """完整模式坚持原始质量目标；CPU 快速模式单独约束可用性与在线延迟。"""
    if profile == "fast":
        return (
            summary.error_count == 0
            and summary.recall_at_5 >= 0.90
            and summary.mrr >= 0.78
            and summary.no_answer_accuracy >= 0.90
            and summary.p95_duration_ms <= 2000
        )
    return (
        summary.error_count == 0
        and summary.recall_at_5 >= 0.95
        and summary.mrr >= 0.85
        and summary.no_answer_accuracy >= 0.90
        and summary.reranker_top1_accuracy >= summary.fusion_top1_accuracy
        and summary.p95_duration_ms <= 2000
    )


class HttpSearchService:
    def __init__(self, base_url: str, *, timeout_seconds: float = 10) -> None:
        self.client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout_seconds,
        )

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


def classify_retrieval_failures(
    expected: set[str],
    actual: list[str],
    fusion_ranking: list[RetrievalCandidateTrace],
    reranked_ranking: list[RetrievalCandidateTrace],
) -> list[RetrievalFailureDiagnosis]:
    """基于真实阶段排名分类失败，禁止从最终 Top-K 反推召回过程。"""
    fusion_positions = _first_policy_positions(fusion_ranking)
    reranked_positions = _first_policy_positions(reranked_ranking)
    diagnostics: list[RetrievalFailureDiagnosis] = []
    for policy_id in sorted(expected.difference(actual)):
        fusion_rank = fusion_positions.get(policy_id)
        reranked_rank = reranked_positions.get(policy_id)
        if fusion_rank is None:
            category = "not_recalled"
            detail = "目标政策未进入融合候选池"
        else:
            category = "ranking_dropped"
            detail = "目标政策已召回，但未进入最终 Top-5"
        diagnostics.append(
            RetrievalFailureDiagnosis(
                category=category,
                policy_id=policy_id,
                fusion_rank=fusion_rank,
                reranked_rank=reranked_rank,
                detail=detail,
            )
        )

    if reranked_ranking and reranked_ranking[0].policy_id not in expected:
        fusion_top_is_correct = bool(fusion_ranking and fusion_ranking[0].policy_id in expected)
        diagnostics.append(
            RetrievalFailureDiagnosis(
                category="top1_regression" if fusion_top_is_correct else "top1_incorrect",
                policy_id=reranked_ranking[0].policy_id,
                fusion_rank=fusion_positions.get(reranked_ranking[0].policy_id),
                reranked_rank=1,
                detail=(
                    "排序阶段把正确的融合 Top-1 替换为非目标政策"
                    if fusion_top_is_correct
                    else "排序后的 Top-1 不属于目标政策"
                ),
            )
        )
    return diagnostics


def _first_policy_positions(ranking: list[RetrievalCandidateTrace]) -> dict[str, int]:
    positions: dict[str, int] = {}
    for item in ranking:
        positions.setdefault(item.policy_id, item.rank)
    return positions


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
    case_results: list[RetrievalEvaluationCase] = []
    error_count = 0

    for case in cases:
        expected = set(case["expected_policy_ids"])
        try:
            result = await service.search(
                SearchRequest(
                    query=case["query"],
                    keyword_hint=case.get("keyword_hint"),
                    top_k=10,
                    include_archived=case.get("include_archived", False),
                    include_diagnostics=True,
                )
            )
            actual = [item.policy_id for item in result.matches[:5]]
            durations.append(result.retrieval.duration_ms)
            case_recall: float | None = None
            case_reciprocal_rank: float | None = None
            no_answer_correct: bool | None = None
            if expected:
                case_recall = len(expected.intersection(actual)) / len(expected)
                recalls.append(case_recall)
                rank = next((index for index, policy_id in enumerate(actual, 1) if policy_id in expected), 0)
                case_reciprocal_rank = 1 / rank if rank else 0
                reciprocal_ranks.append(case_reciprocal_rank)
                fusion_ranking = result.retrieval.fusion_ranking
                reranked_ranking = result.retrieval.reranked_ranking
                fusion_top1_results.append(
                    bool(fusion_ranking and fusion_ranking[0].policy_id in expected)
                )
                reranker_top1_results.append(
                    bool(reranked_ranking and reranked_ranking[0].policy_id in expected)
                )
            else:
                no_answer_correct = False
                no_answer_results.append(False)
            failure_diagnostics = (
                classify_retrieval_failures(
                    expected,
                    actual,
                    result.retrieval.fusion_ranking,
                    result.retrieval.reranked_ranking,
                )
                if expected
                else []
            )
            case_results.append(
                RetrievalEvaluationCase(
                    case_id=str(case.get("id", case["query"])),
                    query=case["query"],
                    expected_policy_ids=case["expected_policy_ids"],
                    answerable=bool(case["answerable"]),
                    actual_policy_ids=actual,
                    fusion_ranking=[item.model_dump() for item in result.retrieval.fusion_ranking],
                    reranked_ranking=[item.model_dump() for item in result.retrieval.reranked_ranking],
                    recall_at_5=case_recall,
                    reciprocal_rank=case_reciprocal_rank,
                    no_answer_correct=no_answer_correct,
                    duration_ms=result.retrieval.duration_ms,
                    failure_diagnostics=failure_diagnostics,
                )
            )
        except KnowledgeNoMatchError:
            case_recall = None
            case_reciprocal_rank = None
            no_answer_correct = None
            if expected:
                case_recall = 0
                case_reciprocal_rank = 0
                recalls.append(case_recall)
                reciprocal_ranks.append(case_reciprocal_rank)
            else:
                no_answer_correct = True
                no_answer_results.append(True)
            case_results.append(
                RetrievalEvaluationCase(
                    case_id=str(case.get("id", case["query"])),
                    query=case["query"],
                    expected_policy_ids=case["expected_policy_ids"],
                    answerable=bool(case["answerable"]),
                    actual_policy_ids=[],
                    fusion_ranking=[],
                    reranked_ranking=[],
                    recall_at_5=case_recall,
                    reciprocal_rank=case_reciprocal_rank,
                    no_answer_correct=no_answer_correct,
                    duration_ms=None,
                    failure_diagnostics=(
                        classify_retrieval_failures(expected, [], [], []) if expected else []
                    ),
                )
            )
        except httpx.HTTPError as error:
            # 单条外部请求失败应进入报告并阻断门禁，不能丢弃此前已经完成的 Case。
            error_count += 1
            if expected:
                recalls.append(0)
                reciprocal_ranks.append(0)
                case_recall = 0.0
                case_reciprocal_rank = 0.0
                no_answer_correct = None
            else:
                no_answer_results.append(False)
                case_recall = None
                case_reciprocal_rank = None
                no_answer_correct = False
            case_results.append(
                RetrievalEvaluationCase(
                    case_id=str(case.get("id", case["query"])),
                    query=case["query"],
                    expected_policy_ids=case["expected_policy_ids"],
                    answerable=bool(case["answerable"]),
                    actual_policy_ids=[],
                    fusion_ranking=[],
                    reranked_ranking=[],
                    recall_at_5=case_recall,
                    reciprocal_rank=case_reciprocal_rank,
                    no_answer_correct=no_answer_correct,
                    duration_ms=None,
                    error=f"{type(error).__name__}: {error}",
                )
            )

    diagnosis_counts: dict[str, int] = {}
    for result in case_results:
        for diagnosis in result.failure_diagnostics:
            diagnosis_counts[diagnosis.category] = diagnosis_counts.get(diagnosis.category, 0) + 1

    return RetrievalEvaluationSummary(
        total=len(cases),
        recall_at_5=mean(recalls) if recalls else 0,
        mrr=mean(reciprocal_ranks) if reciprocal_ranks else 0,
        no_answer_accuracy=mean(no_answer_results) if no_answer_results else 0,
        fusion_top1_accuracy=mean(fusion_top1_results) if fusion_top1_results else 0,
        reranker_top1_accuracy=mean(reranker_top1_results) if reranker_top1_results else 0,
        average_duration_ms=mean(durations) if durations else 0,
        p95_duration_ms=percentile_95(durations),
        error_count=error_count,
        diagnosis_counts=diagnosis_counts,
        cases=case_results,
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
    parser.add_argument(
        "--request-timeout",
        type=float,
        default=float(os.getenv("RAG_EVAL_REQUEST_TIMEOUT_SECONDS", "10")),
        help="单条检索超时秒数；CPU 完整 Reranker 评测可提高该值",
    )
    parser.add_argument("--enforce-targets", action="store_true")
    parser.add_argument("--profile", choices=("full", "fast"), default="full")
    args = parser.parse_args()

    async def evaluate() -> RetrievalEvaluationSummary:
        service = HttpSearchService(args.base_url, timeout_seconds=args.request_timeout)
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
        if not passes_targets(summary, args.profile):
            raise SystemExit(1)


if __name__ == "__main__":
    run_cli()
