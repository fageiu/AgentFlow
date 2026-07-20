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
    # ── ① 数据库连接 ──────────────────────────────────────────
    engine = create_engine(settings.database_url)                  # 创建异步 SQLAlchemy 引擎（连接池）
    sessions = create_session_factory(engine)                      # 创建 session 工厂，供后续所有 DB 操作使用
    readiness.set_database_probe(create_database_probe(engine))    # 注册数据库连通性探针
    if not await readiness.refresh_database():                     # 执行一次探针检查，不通则直接返回
        logger.error("knowledge_database_not_ready")
        return RuntimeResources(engine)

    # ── ② 模型加载 ────────────────────────────────────────────
    if not settings.load_models:                                   # 配置关闭模型加载（如纯运维模式）
        readiness.set_models_ready(False, "model_loading_disabled")
        return RuntimeResources(engine)

    try:
        settings.model_cache_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("HF_HOME", str(settings.model_cache_dir))
        os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(settings.model_cache_dir))
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding

        embed_model = await asyncio.to_thread(                     # 异步加载 bge-m3 embedding 模型
            HuggingFaceEmbedding,                                  # asyncio.to_thread 防止 GIL 阻塞事件循环
            model_name=settings.embedding_model,
            cache_folder=str(settings.model_cache_dir),
        )
        if settings.enable_reranker:                               # 完整模式：加载 cross-encoder 重排序模型
            reranker = LlamaIndexSentenceReranker(settings.reranker_model)
            await asyncio.to_thread(reranker.load, settings.rerank_top_n)  # 预加载，避免首次查询冷启动
            candidate_top_n = settings.rerank_top_n
        else:                                                      # CPU/演示模式：用无模型恒等重排序，节省显存
            # CPU 演示模式保留混合召回与分数契约，完整 BGE 重排由真实评测配置启用。
            reranker = FastFusionReranker()
            candidate_top_n = max(settings.vector_top_k, settings.lexical_top_k)
        readiness.set_models_ready(True)
    except Exception as error:                                     # 模型加载失败 → 标记 not ready，服务仍可启动
        readiness.set_models_ready(False, type(error).__name__)
        logger.exception("knowledge_model_initialization_failed")
        return RuntimeResources(engine)

    # ── ③ 索引初始化 ───────────────────────────────────────────
    try:
        # ③-1 创建 PGVectorStore（perform_setup=True 自动建 policy_nodes 表）
        vector_store = create_pg_vector_store(settings.database_url, settings.embedding_dimension)
        repository = SqlDocumentRepository(sessions)               # 文档元数据仓库（CRUD knowledge_documents 表）
        node_store = PostgresNodeStore(vector_store, sessions)      # 向量 + 词法双写入存储
        ingestion = IngestionService(
            repository,
            node_store,
            embed_model,                                           # 注入 embedding 模型，用于显式生成向量
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )
        # ③-2 词法检索源：BM25（内存）或 PostgreSQL tsvector（数据库表）
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
        # ③-3 自动索引内置语料（knowledge/policies/ 下的 Markdown）
        if settings.auto_ingest_bundled:
            results = await admin.reindex_bundled()                 # 幂等索引：checksum 不变则跳过
            logger.info(
                "bundled_policy_ingestion_completed",
                extra={
                    "document_count": len(results),
                    "node_count": sum(item.node_count for item in results),
                },
            )
        elif isinstance(lexical_source, LlamaIndexBM25Source):     # BM25 模式需要显式构建倒排索引
            await lexical_source.refresh()

        # ③-5 组装混合检索器（向量 + 词法 + RRF 融合）
        retriever = PolicyHybridRetriever(
            LlamaIndexVectorSource(vector_store, embed_model, sessions),  # 向量检索源
            lexical_source,                                                 # 词法检索源
            vector_top_k=settings.vector_top_k,
            lexical_top_k=settings.lexical_top_k,
            rrf_k=settings.rrf_k,
            fusion_top_n=candidate_top_n,
            deduplicate_documents=not settings.enable_reranker,
        )
        # ③-6 注册检索服务到 app.state，供 API 路由使用
        app.state.retrieval = RetrievalService(
            retriever,
            reranker,
            rerank_top_n=candidate_top_n,
            minimum_score=settings.minimum_score,
            minimum_rerank_score=settings.minimum_rerank_score,
            minimum_vector_score_without_reranker=settings.minimum_vector_score_without_reranker,
        )
        app.state.admin = admin
        # ③-7 查询已索引文档数，更新 readiness 状态
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
