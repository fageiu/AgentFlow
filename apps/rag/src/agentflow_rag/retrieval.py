"""LlamaIndex 混合检索、RRF 融合、重排和结果映射。"""

from __future__ import annotations

import asyncio
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
from llama_index.retrievers.bm25 import BM25Retriever
from llama_index.vector_stores.postgres import PGVectorStore
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from .database import KnowledgeDocumentModel, KnowledgeLexicalNodeModel
from .errors import KnowledgeNoMatchError
from .schemas import (
    KnowledgeRetrievalMetrics,
    PolicyCitation,
    PolicyKnowledgeMatch,
    RetrievalCandidateTrace,
    SearchRequest,
    SearchResponse,
)

LEXICAL_STOP_WORDS = {
    "不会",
    "什么",
    "可以",
    "只问",
    "如何",
    "应该",
    "是否",
    "标准",
    "查询",
    "规则",
    "处理",
    "多少",
    "政策",
    "怎么",
    "要求",
    "需要",
}


class AsyncCandidateSource(Protocol):
    async def retrieve(
        self, query: str, top_k: int, *, include_archived: bool = False
    ) -> list[NodeWithScore]: ...


class CandidateReranker(Protocol):
    enabled: bool

    async def rerank(
        self, query: str, candidates: Sequence[NodeWithScore], top_n: int
    ) -> list[NodeWithScore]: ...


class LlamaIndexVectorSource:
    """向量检索"""
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
    """中文词法检索"""
    def __init__(self, sessions: async_sessionmaker) -> None:
        self.sessions = sessions

    async def retrieve(
        self, query: str, top_k: int, *, include_archived: bool = False
    ) -> list[NodeWithScore]:
        # 长句用 OR 组合分词，避免 plainto_tsquery 的全词 AND 让中文同义问法零召回。
        ts_query = func.websearch_to_tsquery("simple", build_lexical_websearch_query(query))
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


class LlamaIndexBM25Source:
    """基于 jieba 预分词和 LlamaIndex BM25Retriever 的内存稀疏索引。"""

    def __init__(self, sessions: async_sessionmaker | None, *, similarity_top_k: int = 20) -> None:
        self.sessions = sessions
        self.similarity_top_k = similarity_top_k
        self._active_retriever: BM25Retriever | None = None
        self._all_retriever: BM25Retriever | None = None
        self._refresh_lock = asyncio.Lock()

    async def refresh(self) -> None:
        """从数据库构建新快照，全部成功后一次性替换，避免查询读到半成品。"""
        if self.sessions is None:
            raise RuntimeError("BM25 数据库会话未配置")
        async with self._refresh_lock:
            async with self.sessions() as session:
                rows = (
                    await session.execute(
                        select(KnowledgeLexicalNodeModel, KnowledgeDocumentModel)
                        .join(
                            KnowledgeDocumentModel,
                            KnowledgeDocumentModel.id == KnowledgeLexicalNodeModel.document_id,
                        )
                        .where(KnowledgeDocumentModel.index_status == "indexed")
                    )
                ).all()
            all_nodes = [self._to_text_node(node) for node, _document in rows]
            active_nodes = [
                self._to_text_node(node)
                for node, document in rows
                if document.status == "active" and document.is_current
            ]
            await self.replace_nodes(active_nodes, all_nodes)

    async def replace_nodes(
        self, active_nodes: Sequence[TextNode], all_nodes: Sequence[TextNode]
    ) -> None:
        """构建并原子替换有效版本与历史版本两份 BM25 快照。"""
        active, all_versions = await asyncio.gather(
            asyncio.to_thread(self._build_retriever, active_nodes),
            asyncio.to_thread(self._build_retriever, all_nodes),
        )
        self._active_retriever, self._all_retriever = active, all_versions

    async def retrieve(
        self, query: str, top_k: int, *, include_archived: bool = False
    ) -> list[NodeWithScore]:
        retriever = self._all_retriever if include_archived else self._active_retriever
        if retriever is None:
            return []
        # BM25Retriever 是同步 CPU 计算，放入工作线程避免阻塞 FastAPI 事件循环。
        results = await asyncio.to_thread(self._retrieve, retriever, query)
        return results[:top_k]

    def _build_retriever(self, nodes: Sequence[TextNode]) -> BM25Retriever | None:
        if not nodes:
            return None
        indexed_nodes: list[TextNode] = []
        for node in nodes:
            metadata = dict(node.metadata)
            metadata["bm25_original_content"] = node.text
            title = str(metadata.get("title", ""))
            searchable_text = " ".join(tokenize_lexical(f"{title} {node.text}")) or node.text
            indexed_nodes.append(
                TextNode(
                    id_=node.node_id,
                    text=searchable_text,
                    metadata=metadata,
                    # BM25 只索引 jieba 处理后的正文，Citation 元数据仅随结果透传。
                    excluded_embed_metadata_keys=[*metadata.keys()],
                )
            )
        return BM25Retriever.from_defaults(
            nodes=indexed_nodes,
            similarity_top_k=min(self.similarity_top_k, len(indexed_nodes)),
            language="en",
            skip_stemming=True,
            token_pattern=r"(?u)\b\w+\b",
        )

    @staticmethod
    def _retrieve(retriever: BM25Retriever, query: str) -> list[NodeWithScore]:
        tokenized_query = " ".join(tokenize_lexical(query)) or query
        results = retriever.retrieve(tokenized_query)
        restored: list[NodeWithScore] = []
        for result in results:
            if not result.score or result.score <= 0:
                continue
            metadata = dict(result.node.metadata)
            content = str(metadata.pop("bm25_original_content", result.node.text))
            restored.append(
                NodeWithScore(
                    node=TextNode(id_=result.node.node_id, text=content, metadata=metadata),
                    score=result.score,
                )
            )
        return restored

    @staticmethod
    def _to_text_node(model: KnowledgeLexicalNodeModel) -> TextNode:
        return TextNode(id_=model.node_id, text=model.content, metadata=model.node_metadata)


class LlamaIndexSentenceReranker:
    """延迟导入 SentenceTransformer，保证健康检查和测试不触发模型下载。"""

    enabled = True

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
        """cross-encoder 对 RRF 融合后的 Top-10 候选做逐对重打分"""
        self.load(top_n)
        return await self._postprocessor.apostprocess_nodes(list(candidates), query_str=query)


class IdentityReranker:
    enabled = False

    async def rerank(
        self, query: str, candidates: Sequence[NodeWithScore], top_n: int
    ) -> list[NodeWithScore]:
        del query
        return list(candidates[:top_n])


class FastFusionReranker:
    """CPU 在线模式以向量为主排序，RRF 只做小幅补召加分。"""

    enabled = False

    async def rerank(
        self, query: str, candidates: Sequence[NodeWithScore], top_n: int
    ) -> list[NodeWithScore]:
        del query
        rescored: list[NodeWithScore] = []
        for candidate in candidates:
            vector_score = _optional_score(candidate.node.metadata.get("vector_score")) or 0
            fusion_score = _optional_score(candidate.node.metadata.get("fusion_score")) or 0
            rescored.append(
                NodeWithScore(
                    node=candidate.node,
                    score=0.9 * vector_score + 0.1 * fusion_score,
                )
            )
        return sorted(rescored, key=lambda item: item.score or 0, reverse=True)[:top_n]


@dataclass(slots=True)
class HybridRetrievalSnapshot:
    candidates: list[NodeWithScore]
    vector_count: int
    lexical_count: int


class PolicyHybridRetriever(BaseRetriever):
    """混合检索，实现 LlamaIndex Retriever 接口，但由 FastAPI 使用异步 aretrieve。"""

    def __init__(
        self,
        vector_source: AsyncCandidateSource,
        lexical_source: AsyncCandidateSource,
        *,
        vector_top_k: int = 20,
        lexical_top_k: int = 20,
        rrf_k: int = 60,
        fusion_top_n: int = 10,
        deduplicate_documents: bool = False,
    ) -> None:
        super().__init__()
        self.vector_source = vector_source
        self.lexical_source = lexical_source
        self.vector_top_k = vector_top_k
        self.lexical_top_k = lexical_top_k
        self.rrf_k = rrf_k
        self.fusion_top_n = fusion_top_n
        self.deduplicate_documents = deduplicate_documents
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
        if self.deduplicate_documents:
            # Fast 模式在截断候选池前按文档去重，避免同一政策的多个 Node 挤掉其他政策。
            fused = deduplicate_document_candidates(fused)
        result = fused[: self.fusion_top_n]
        self.last_snapshot = HybridRetrievalSnapshot(result, len(vector), len(lexical))
        return result


def reciprocal_rank_fusion(
    vector: Sequence[NodeWithScore],
    lexical: Sequence[NodeWithScore],
    rrf_k: int = 60,
    keyword_hint: str | None = None,
) -> list[NodeWithScore]:
    """RRF 根据排名将向量检索和词法检索结果融合。"""
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


def deduplicate_document_candidates(
    candidates: Sequence[NodeWithScore],
) -> list[NodeWithScore]:
    """保留每个文档融合排名最高的 Node，并维持文档首次出现的顺序。"""
    result: list[NodeWithScore] = []
    seen_documents: set[str] = set()
    for candidate in candidates:
        document_id = str(candidate.node.metadata.get("document_id", candidate.node.node_id))
        if document_id in seen_documents:
            continue
        seen_documents.add(document_id)
        result.append(candidate)
    return result


def build_lexical_websearch_query(query: str) -> str:
    """将 jieba 结果转换为 PostgreSQL websearch OR 查询，并保持词序与去重。"""
    tokens = tokenize_lexical(query)
    return " OR ".join(tokens) or query


def tokenize_lexical(text: str) -> list[str]:
    """统一 BM25 与 PostgreSQL 基线的中文分词和停用词规则。"""
    return list(
        dict.fromkeys(
            token
            for raw_token in jieba.cut_for_search(text)
            if len(token := raw_token.strip()) >= 2 and token not in LEXICAL_STOP_WORDS
        )
    )


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
        minimum_rerank_score: float = 0.35,
        minimum_vector_score_without_reranker: float = 0.55,
    ) -> None:
        self.retriever = retriever
        self.reranker = reranker
        self.rerank_top_n = rerank_top_n
        self.minimum_score = minimum_score
        self.minimum_rerank_score = minimum_rerank_score
        self.minimum_vector_score_without_reranker = minimum_vector_score_without_reranker

    async def search(self, request: SearchRequest) -> SearchResponse:
        """检索具体实现"""
        started_at = time.perf_counter()
        self.retriever.keyword_hint = request.keyword_hint
        self.retriever.include_archived = request.include_archived
        fused = await self.retriever.aretrieve(request.query)
        if not self.reranker.enabled:
            maximum_vector_score = max(
                (_optional_score(item.node.metadata.get("vector_score")) or 0 for item in fused),
                default=0,
            )
            if maximum_vector_score < self.minimum_vector_score_without_reranker:
                raise KnowledgeNoMatchError(
                    query_length=len(request.query),
                    threshold=self.minimum_vector_score_without_reranker,
                )
        reranked = await self.reranker.rerank(request.query, fused, self.rerank_top_n)
        if self.reranker.enabled:
            matches = self._select_reranked_with_fusion_coverage(
                fused,
                reranked,
                request.top_k,
            )
            rejection_threshold = self.minimum_rerank_score
        else:
            matches = self._select_fast_with_fusion_coverage(
                fused,
                reranked,
                request.top_k,
            )
            rejection_threshold = self.minimum_score
        if not matches:
            raise KnowledgeNoMatchError(
                query_length=len(request.query),
                threshold=rejection_threshold,
            )
        snapshot = self.retriever.last_snapshot
        return SearchResponse(
            matches=matches,
            retrieval=KnowledgeRetrievalMetrics(
                vector_candidates=snapshot.vector_count,
                lexical_candidates=snapshot.lexical_count,
                reranked_candidates=len(reranked),
                duration_ms=round((time.perf_counter() - started_at) * 1000),
                reranker_applied=self.reranker.enabled,
                fusion_ranking=(
                    self._to_stage_ranking(fused, reranker_applied=False)
                    if request.include_diagnostics
                    else []
                ),
                reranked_ranking=(
                    self._to_stage_ranking(
                        reranked,
                        reranker_applied=self.reranker.enabled,
                    )
                    if request.include_diagnostics
                    else []
                ),
            ),
        )

    @staticmethod
    def _to_match(
        candidate: NodeWithScore,
        *,
        result_score: float | None = None,
        rerank_score: float | None = None,
    ) -> PolicyKnowledgeMatch:
        """将 NodeWithScore 映射为 PolicyKnowledgeMatch"""
        metadata = candidate.node.metadata
        score = normalize_rerank_score(candidate.score) if result_score is None else result_score
        return PolicyKnowledgeMatch(
            policy_id=str(metadata["policy_id"]),
            keyword=str(metadata["keyword"]),
            title=str(metadata["title"]),
            content=candidate.node.text,
            score=score,
            vector_score=_optional_score(metadata.get("vector_score")),
            lexical_score=_optional_score(metadata.get("lexical_score")),
            fusion_score=float(metadata.get("fusion_score", 0)),
            rerank_score=rerank_score,
            citation=PolicyCitation(
                document_id=str(metadata["document_id"]),
                node_id=candidate.node.node_id,
                source_name=str(metadata["source_name"]),
                version=str(metadata["version"]),
                section=metadata.get("section"),
                page=metadata.get("page"),
            ),
        )

    def _select_reranked_with_fusion_coverage(
        self,
        fused: Sequence[NodeWithScore],
        reranked: Sequence[NodeWithScore],
        top_k: int,
    ) -> list[PolicyKnowledgeMatch]:
        """Reranker 决定主证据，其余位置保留高置信融合候选的政策覆盖。"""
        if not reranked:
            return []
        rerank_scores = {
            item.node.node_id: normalize_rerank_score(item.score) for item in reranked
        }
        primary = reranked[0]
        primary_score = rerank_scores[primary.node.node_id]
        if primary_score < self.minimum_rerank_score:
            return []

        candidates = [
            self._to_match(
                primary,
                result_score=primary_score,
                rerank_score=primary_score,
            )
        ]
        for candidate in fused:
            if candidate.node.node_id == primary.node.node_id:
                continue
            fusion_score = _optional_score(candidate.node.metadata.get("fusion_score")) or 0
            candidates.append(
                self._to_match(
                    candidate,
                    result_score=fusion_score,
                    rerank_score=rerank_scores.get(candidate.node.node_id),
                )
            )
        return self._deduplicate_matches(
            candidates,
            minimum_score=self.minimum_score,
            top_k=top_k,
            preserve_first=True,
        )

    def _select_fast_with_fusion_coverage(
        self,
        fused: Sequence[NodeWithScore],
        ranked: Sequence[NodeWithScore],
        top_k: int,
    ) -> list[PolicyKnowledgeMatch]:
        """FastFusion 保留前两条强语义证据，其余位置按融合顺序保护多政策覆盖。"""
        if not ranked:
            return []
        ranked_primary = list(ranked[: min(2, top_k)])
        candidates = [
            self._to_match(item, result_score=normalize_rerank_score(item.score))
            for item in ranked_primary
        ]
        primary_node_ids = {item.node.node_id for item in ranked_primary}
        for candidate in fused:
            if candidate.node.node_id in primary_node_ids:
                continue
            fusion_score = _optional_score(candidate.node.metadata.get("fusion_score")) or 0
            candidates.append(self._to_match(candidate, result_score=fusion_score))
        return self._deduplicate_matches(
            candidates,
            minimum_score=self.minimum_score,
            top_k=top_k,
            preserve_first=True,
        )

    @staticmethod
    def _deduplicate_matches(
        matches: Sequence[PolicyKnowledgeMatch],
        *,
        minimum_score: float,
        top_k: int,
        preserve_first: bool = False,
    ) -> list[PolicyKnowledgeMatch]:
        """按文档去重，避免同一政策的多个分块挤占证据位置。"""
        selected: list[PolicyKnowledgeMatch] = []
        seen_documents: set[str] = set()
        for index, match in enumerate(matches):
            if match.citation.document_id in seen_documents:
                continue
            if match.score < minimum_score and not (preserve_first and index == 0):
                continue
            seen_documents.add(match.citation.document_id)
            selected.append(match)
            if len(selected) >= top_k:
                break
        return selected

    @staticmethod
    def _to_stage_ranking(
        candidates: Sequence[NodeWithScore],
        *,
        reranker_applied: bool,
    ) -> list[RetrievalCandidateTrace]:
        """在响应中冻结阶段排名，避免评测从最终结果反推原始顺序。"""
        ranking: list[RetrievalCandidateTrace] = []
        for rank, candidate in enumerate(candidates, start=1):
            metadata = candidate.node.metadata
            ranking.append(
                RetrievalCandidateTrace(
                    rank=rank,
                    policy_id=str(metadata["policy_id"]),
                    document_id=str(metadata["document_id"]),
                    node_id=candidate.node.node_id,
                    vector_score=_optional_score(metadata.get("vector_score")),
                    lexical_score=_optional_score(metadata.get("lexical_score")),
                    fusion_score=_optional_score(metadata.get("fusion_score")),
                    rerank_score=(
                        normalize_rerank_score(candidate.score) if reranker_applied else None
                    ),
                )
            )
        return ranking


def _optional_score(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) else None
