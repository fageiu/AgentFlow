"""LlamaIndex 混合检索、RRF 融合、重排和结果映射。"""

from __future__ import annotations

import math
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import jieba
from llama_index.core import VectorStoreIndex
from llama_index.core.base.embeddings.base import BaseEmbedding
from llama_index.core.retrievers import BaseRetriever
from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode
from llama_index.vector_stores.postgres import PGVectorStore
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from .database import KnowledgeDocumentModel, KnowledgeLexicalNodeModel
from .errors import KnowledgeNoMatchError
from .schemas import (
    KnowledgeRetrievalMetrics,
    PolicyCitation,
    PolicyKnowledgeMatch,
    SearchRequest,
    SearchResponse,
)


class AsyncCandidateSource(Protocol):
    async def retrieve(
        self, query: str, top_k: int, *, include_archived: bool = False
    ) -> list[NodeWithScore]: ...


class CandidateReranker(Protocol):
    async def rerank(
        self, query: str, candidates: Sequence[NodeWithScore], top_n: int
    ) -> list[NodeWithScore]: ...


class LlamaIndexVectorSource:
    def __init__(
        self,
        vector_store: PGVectorStore,
        embed_model: BaseEmbedding,
        sessions: async_sessionmaker | None = None,
    ) -> None:
        self.index = VectorStoreIndex.from_vector_store(vector_store, embed_model=embed_model)
        self.sessions = sessions

    async def retrieve(
        self, query: str, top_k: int, *, include_archived: bool = False
    ) -> list[NodeWithScore]:
        retriever = self.index.as_retriever(similarity_top_k=top_k)
        candidates = await retriever.aretrieve(query)
        if include_archived:
            return candidates
        if self.sessions is None:
            return [item for item in candidates if item.node.metadata.get("status") == "active"]
        async with self.sessions() as session:
            current_ids = set(
                (
                    await session.scalars(
                        select(KnowledgeDocumentModel.id).where(
                            KnowledgeDocumentModel.status == "active",
                            KnowledgeDocumentModel.index_status == "indexed",
                            KnowledgeDocumentModel.is_current.is_(True),
                        )
                    )
                ).all()
            )
        return [item for item in candidates if item.node.metadata.get("document_id") in current_ids]


class PostgresLexicalSource:
    def __init__(self, sessions: async_sessionmaker) -> None:
        self.sessions = sessions

    async def retrieve(
        self, query: str, top_k: int, *, include_archived: bool = False
    ) -> list[NodeWithScore]:
        tokens = " ".join(jieba.cut_for_search(query))
        ts_query = func.plainto_tsquery("simple", tokens)
        document_filters = [KnowledgeDocumentModel.index_status == "indexed"]
        if not include_archived:
            document_filters.extend(
                [KnowledgeDocumentModel.status == "active", KnowledgeDocumentModel.is_current.is_(True)]
            )
        rank = func.ts_rank_cd(
            func.to_tsvector("simple", KnowledgeLexicalNodeModel.lexical_tokens), ts_query
        ).label("rank")
        statement = (
            select(KnowledgeLexicalNodeModel, rank)
            .join(
                KnowledgeDocumentModel,
                KnowledgeDocumentModel.id == KnowledgeLexicalNodeModel.document_id,
            )
            .where(*document_filters)
            .where(func.to_tsvector("simple", KnowledgeLexicalNodeModel.lexical_tokens).op("@@")(ts_query))
            .order_by(rank.desc())
            .limit(top_k)
        )
        async with self.sessions() as session:
            rows = (await session.execute(statement)).all()
        return [
            NodeWithScore(
                node=TextNode(id_=model.node_id, text=model.content, metadata=model.node_metadata),
                score=float(score),
            )
            for model, score in rows
        ]


class LlamaIndexSentenceReranker:
    """延迟导入 SentenceTransformer，保证健康检查和测试不触发模型下载。"""

    def __init__(self, model_name: str) -> None:
        from llama_index.postprocessor.sbert_rerank import SentenceTransformerRerank

        self.model_name = model_name
        self._postprocessor_type = SentenceTransformerRerank
        self._postprocessor = None

    def load(self, top_n: int = 10) -> None:
        """在 readiness 前显式加载模型，避免首次真实查询承担冷启动。"""
        if self._postprocessor is None:
            self._postprocessor = self._postprocessor_type(model=self.model_name, top_n=top_n)

    async def rerank(
        self, query: str, candidates: Sequence[NodeWithScore], top_n: int
    ) -> list[NodeWithScore]:
        self.load(top_n)
        return await self._postprocessor.apostprocess_nodes(list(candidates), query_str=query)


class IdentityReranker:
    async def rerank(
        self, query: str, candidates: Sequence[NodeWithScore], top_n: int
    ) -> list[NodeWithScore]:
        del query
        return list(candidates[:top_n])


@dataclass(slots=True)
class HybridRetrievalSnapshot:
    candidates: list[NodeWithScore]
    vector_count: int
    lexical_count: int


class PolicyHybridRetriever(BaseRetriever):
    """实现 LlamaIndex Retriever 接口，但由 FastAPI 使用异步 aretrieve。"""

    def __init__(
        self,
        vector_source: AsyncCandidateSource,
        lexical_source: AsyncCandidateSource,
        *,
        vector_top_k: int = 20,
        lexical_top_k: int = 20,
        rrf_k: int = 60,
        fusion_top_n: int = 10,
    ) -> None:
        super().__init__()
        self.vector_source = vector_source
        self.lexical_source = lexical_source
        self.vector_top_k = vector_top_k
        self.lexical_top_k = lexical_top_k
        self.rrf_k = rrf_k
        self.fusion_top_n = fusion_top_n
        self.keyword_hint: str | None = None
        self.include_archived = False
        self.last_snapshot = HybridRetrievalSnapshot([], 0, 0)

    def _retrieve(self, query_bundle: QueryBundle) -> list[NodeWithScore]:
        raise RuntimeError("PolicyHybridRetriever 只支持异步 aretrieve")

    async def _aretrieve(self, query_bundle: QueryBundle) -> list[NodeWithScore]:
        query = query_bundle.query_str
        vector = await self.vector_source.retrieve(
            query, self.vector_top_k, include_archived=self.include_archived
        )
        lexical = await self.lexical_source.retrieve(
            query, self.lexical_top_k, include_archived=self.include_archived
        )
        fused = reciprocal_rank_fusion(vector, lexical, self.rrf_k, self.keyword_hint)
        result = fused[: self.fusion_top_n]
        self.last_snapshot = HybridRetrievalSnapshot(result, len(vector), len(lexical))
        return result


def reciprocal_rank_fusion(
    vector: Sequence[NodeWithScore],
    lexical: Sequence[NodeWithScore],
    rrf_k: int = 60,
    keyword_hint: str | None = None,
) -> list[NodeWithScore]:
    by_id: dict[str, NodeWithScore] = {}
    scores: dict[str, float] = {}
    maximum = 2 / (rrf_k + 1)
    for candidates in (vector, lexical):
        for rank, candidate in enumerate(candidates, start=1):
            node_id = candidate.node.node_id
            by_id.setdefault(node_id, candidate)
            scores[node_id] = scores.get(node_id, 0) + 1 / (rrf_k + rank)
            score_key = "vector_score" if candidates is vector else "lexical_score"
            by_id[node_id].node.metadata[score_key] = candidate.score

    result: list[NodeWithScore] = []
    for node_id, raw_score in scores.items():
        candidate = by_id[node_id]
        normalized = raw_score / maximum
        if keyword_hint and candidate.node.metadata.get("keyword") == keyword_hint:
            normalized = min(1.0, normalized + 0.05)
        candidate.node.metadata["fusion_score"] = normalized
        result.append(NodeWithScore(node=candidate.node, score=normalized))
    return sorted(result, key=lambda item: item.score or 0, reverse=True)


def normalize_rerank_score(score: float | None) -> float:
    if score is None:
        return 0
    if 0 <= score <= 1:
        return score
    return 1 / (1 + math.exp(-max(-30, min(30, score))))


class RetrievalService:
    def __init__(
        self,
        retriever: PolicyHybridRetriever,
        reranker: CandidateReranker,
        *,
        rerank_top_n: int = 10,
        minimum_score: float = 0.35,
    ) -> None:
        self.retriever = retriever
        self.reranker = reranker
        self.rerank_top_n = rerank_top_n
        self.minimum_score = minimum_score

    async def search(self, request: SearchRequest) -> SearchResponse:
        started_at = time.perf_counter()
        self.retriever.keyword_hint = request.keyword_hint
        self.retriever.include_archived = request.include_archived
        fused = await self.retriever.aretrieve(request.query)
        reranked = await self.reranker.rerank(request.query, fused, self.rerank_top_n)
        matches = [self._to_match(candidate) for candidate in reranked]
        matches = [match for match in matches if match.score >= self.minimum_score][: request.top_k]
        if not matches:
            raise KnowledgeNoMatchError(query_length=len(request.query), threshold=self.minimum_score)
        snapshot = self.retriever.last_snapshot
        return SearchResponse(
            matches=matches,
            retrieval=KnowledgeRetrievalMetrics(
                vector_candidates=snapshot.vector_count,
                lexical_candidates=snapshot.lexical_count,
                reranked_candidates=len(reranked),
                duration_ms=round((time.perf_counter() - started_at) * 1000),
            ),
        )

    @staticmethod
    def _to_match(candidate: NodeWithScore) -> PolicyKnowledgeMatch:
        metadata = candidate.node.metadata
        score = normalize_rerank_score(candidate.score)
        return PolicyKnowledgeMatch(
            policy_id=str(metadata["policy_id"]),
            keyword=str(metadata["keyword"]),
            title=str(metadata["title"]),
            content=candidate.node.text,
            score=score,
            vector_score=_optional_score(metadata.get("vector_score")),
            lexical_score=_optional_score(metadata.get("lexical_score")),
            fusion_score=float(metadata.get("fusion_score", 0)),
            rerank_score=score,
            citation=PolicyCitation(
                document_id=str(metadata["document_id"]),
                node_id=candidate.node.node_id,
                source_name=str(metadata["source_name"]),
                version=str(metadata["version"]),
                section=metadata.get("section"),
                page=metadata.get("page"),
            ),
        )


def _optional_score(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) else None
