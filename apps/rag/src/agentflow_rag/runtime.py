"""生产 RAG 依赖装配与启动初始化。"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass

from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine

from .admin import KnowledgeAdminService
from .config import RagSettings
from .database import KnowledgeDocumentModel, create_database_probe, create_engine, create_session_factory
from .health import ReadinessService
from .ingestion import IngestionService
from .retrieval import (
    FastFusionReranker,
    LlamaIndexBM25Source,
    LlamaIndexSentenceReranker,
    LlamaIndexVectorSource,
    PolicyHybridRetriever,
    PostgresLexicalSource,
    RetrievalService,
)
from .stores import PostgresNodeStore, SqlDocumentRepository, create_pg_vector_store

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RuntimeResources:
    engine: AsyncEngine


async def _indexed_document_count(sessions) -> int:  # type: ignore[no-untyped-def]
    async with sessions() as session:
        value = await session.scalar(
            select(func.count()).select_from(KnowledgeDocumentModel).where(
                KnowledgeDocumentModel.index_status == "indexed"
            )
        )
    return int(value or 0)


async def initialize_runtime(
    app: FastAPI,
    settings: RagSettings,
    readiness: ReadinessService,
) -> RuntimeResources:
    """按数据库、模型、索引顺序初始化；失败时保留健康接口并标记 not ready。"""
    engine = create_engine(settings.database_url)
    sessions = create_session_factory(engine)
    readiness.set_database_probe(create_database_probe(engine))
    if not await readiness.refresh_database():
        logger.error("knowledge_database_not_ready")
        return RuntimeResources(engine)

    if not settings.load_models:
        readiness.set_models_ready(False, "model_loading_disabled")
        return RuntimeResources(engine)

    try:
        settings.model_cache_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("HF_HOME", str(settings.model_cache_dir))
        os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(settings.model_cache_dir))
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding

        embed_model = await asyncio.to_thread(
            HuggingFaceEmbedding,
            model_name=settings.embedding_model,
            cache_folder=str(settings.model_cache_dir),
        )
        if settings.enable_reranker:
            reranker = LlamaIndexSentenceReranker(settings.reranker_model)
            await asyncio.to_thread(reranker.load, settings.rerank_top_n)
            candidate_top_n = settings.rerank_top_n
        else:
            # CPU 演示模式保留混合召回与分数契约，完整 BGE 重排由真实评测配置启用。
            reranker = FastFusionReranker()
            candidate_top_n = max(settings.vector_top_k, settings.lexical_top_k)
        readiness.set_models_ready(True)
    except Exception as error:
        readiness.set_models_ready(False, type(error).__name__)
        logger.exception("knowledge_model_initialization_failed")
        return RuntimeResources(engine)

    try:
        vector_store = create_pg_vector_store(settings.database_url, settings.embedding_dimension)
        repository = SqlDocumentRepository(sessions)
        node_store = PostgresNodeStore(vector_store, sessions)
        ingestion = IngestionService(
            repository,
            node_store,
            embed_model,
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )
        lexical_source = (
            LlamaIndexBM25Source(sessions, similarity_top_k=settings.lexical_top_k)
            if settings.lexical_mode == "bm25"
            else PostgresLexicalSource(sessions)
        )
        admin = KnowledgeAdminService(
            sessions,
            ingestion,
            node_store,
            settings.upload_dir,
            settings.bundled_policy_dir,
            max_upload_bytes=settings.max_upload_bytes,
            lexical_index=lexical_source if isinstance(lexical_source, LlamaIndexBM25Source) else None,
        )
        if settings.auto_ingest_bundled:
            results = await admin.reindex_bundled()
            logger.info(
                "bundled_policy_ingestion_completed",
                extra={
                    "document_count": len(results),
                    "node_count": sum(item.node_count for item in results),
                },
            )
        elif isinstance(lexical_source, LlamaIndexBM25Source):
            await lexical_source.refresh()

        retriever = PolicyHybridRetriever(
            LlamaIndexVectorSource(vector_store, embed_model, sessions),
            lexical_source,
            vector_top_k=settings.vector_top_k,
            lexical_top_k=settings.lexical_top_k,
            rrf_k=settings.rrf_k,
            fusion_top_n=candidate_top_n,
        )
        app.state.retrieval = RetrievalService(
            retriever,
            reranker,
            rerank_top_n=candidate_top_n,
            minimum_score=settings.minimum_score,
            minimum_vector_score_without_reranker=settings.minimum_vector_score_without_reranker,
        )
        app.state.admin = admin
        indexed_count = await _indexed_document_count(sessions)
        readiness.set_index_ready(indexed_count > 0, None if indexed_count else "empty_index")
        logger.info(
            "knowledge_runtime_ready",
            extra={"document_count": indexed_count, "lexical_mode": settings.lexical_mode},
        )
    except Exception as error:
        readiness.set_index_ready(False, type(error).__name__)
        logger.exception("knowledge_index_initialization_failed")
    return RuntimeResources(engine)
