"""SQLAlchemy 文档仓库与 LlamaIndex PGVectorStore 适配器。"""

from __future__ import annotations

from collections.abc import Sequence

import jieba
from llama_index.core.schema import BaseNode
from llama_index.vector_stores.postgres import PGVectorStore
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from .database import KnowledgeDocumentModel, KnowledgeLexicalNodeModel
from .ingestion import StoredDocument
from .schemas import ParsedPolicyDocument


class SqlDocumentRepository:
    def __init__(self, sessions: async_sessionmaker) -> None:
        self.sessions = sessions

    async def find_by_policy_version(self, policy_id: str, version: str) -> StoredDocument | None:
        async with self.sessions() as session:
            result = await session.execute(
                select(KnowledgeDocumentModel)
                .where(
                    KnowledgeDocumentModel.policy_id == policy_id,
                    KnowledgeDocumentModel.version == version,
                )
                .order_by(KnowledgeDocumentModel.updated_at.desc())
                .limit(1)
            )
            model = result.scalar_one_or_none()
            return (
                StoredDocument(model.id, model.checksum, model.index_status, model.node_count)
                if model
                else None
            )

    async def begin_index(self, document: ParsedPolicyDocument, source_path: str) -> StoredDocument:
        from .nodes import build_document_ref_id

        document_id = build_document_ref_id(document)
        metadata = document.metadata
        async with self.sessions.begin() as session:
            session.add(
                KnowledgeDocumentModel(
                    id=document_id,
                    policy_id=metadata.policy_id,
                    keyword=metadata.keyword,
                    title=metadata.title,
                    version=metadata.version,
                    effective_date=metadata.effective_date,
                    status=metadata.status,
                    department=metadata.department,
                    source_name=document.source_name,
                    source_path=source_path,
                    checksum=document.checksum,
                    index_status="indexing",
                    is_current=False,
                )
            )
        return StoredDocument(document_id, document.checksum, "indexing")

    async def complete_index(self, document_id: str, node_count: int) -> None:
        async with self.sessions.begin() as session:
            current = await session.get(KnowledgeDocumentModel, document_id)
            if current is None:
                raise RuntimeError(f"Knowledge document {document_id} disappeared during indexing")
            await session.execute(
                update(KnowledgeDocumentModel)
                .where(KnowledgeDocumentModel.policy_id == current.policy_id)
                .values(is_current=False)
            )
            current.index_status = "indexed"
            current.node_count = node_count
            current.error_message = None
            current.is_current = current.status == "active"

    async def fail_index(self, document_id: str, message: str) -> None:
        async with self.sessions.begin() as session:
            await session.execute(
                update(KnowledgeDocumentModel)
                .where(KnowledgeDocumentModel.id == document_id)
                .values(index_status="failed", error_message=message[:2000], is_current=False)
            )


def create_pg_vector_store(database_url: str, embed_dim: int) -> PGVectorStore:
    async_url = database_url
    sync_url = database_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
    return PGVectorStore.from_params(
        connection_string=sync_url,
        async_connection_string=async_url,
        table_name="policy_nodes",
        schema_name="public",
        embed_dim=embed_dim,
        hybrid_search=False,
        perform_setup=True,
        use_jsonb=True,
    )


class PostgresNodeStore:
    """向量 Node 与中文词法 Node 同步写入，任一失败都清理本次文档。"""

    def __init__(self, vector_store: PGVectorStore, sessions: async_sessionmaker) -> None:
        self.vector_store = vector_store
        self.sessions = sessions

    async def add(self, document_id: str, nodes: Sequence[BaseNode]) -> None:
        await self.vector_store.async_add(list(nodes))
        try:
            async with self.sessions.begin() as session:
                for node in nodes:
                    session.add(
                        KnowledgeLexicalNodeModel(
                            node_id=node.node_id,
                            document_id=document_id,
                            policy_id=str(node.metadata["policy_id"]),
                            content=node.text,
                            lexical_tokens=" ".join(jieba.cut_for_search(node.text)),
                            node_metadata=node.metadata,
                        )
                    )
        except Exception:
            await self.vector_store.adelete(document_id)
            raise

    async def delete_document(self, document_id: str) -> None:
        await self.vector_store.adelete(document_id)
        async with self.sessions.begin() as session:
            await session.execute(
                delete(KnowledgeLexicalNodeModel).where(
                    KnowledgeLexicalNodeModel.document_id == document_id
                )
            )

