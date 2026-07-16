from __future__ import annotations

import os
from datetime import date
from uuid import uuid4

import pytest
from llama_index.core.schema import NodeRelationship, RelatedNodeInfo, TextNode
from sqlalchemy import delete, select

from agentflow_rag.database import (
    KnowledgeDocumentModel,
    KnowledgeLexicalNodeModel,
    create_engine,
    create_session_factory,
)
from agentflow_rag.schemas import ParsedPolicyDocument, PolicyMetadata, PolicyPage
from agentflow_rag.stores import PostgresNodeStore, SqlDocumentRepository, create_pg_vector_store

DATABASE_URL = os.getenv("RAG_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="需要 RAG_TEST_DATABASE_URL 和 pgvector")


def make_document(policy_id: str, version: str, effective_date: date, status: str) -> ParsedPolicyDocument:
    checksum = f"{uuid4().hex}{uuid4().hex}"
    return ParsedPolicyDocument(
        metadata=PolicyMetadata(
            policy_id=policy_id,
            keyword="integration",
            title=f"集成测试政策 {version}",
            version=version,
            effective_date=effective_date,
            status=status,
            department="质量工程部",
        ),
        source_name=f"{policy_id}-{version}.md",
        checksum=checksum,
        pages=[PolicyPage(text="用于验证 PostgreSQL 版本切换和向量节点事务。")],
    )


@pytest.mark.asyncio
async def test_latest_active_version_is_current_independent_of_import_order() -> None:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    sessions = create_session_factory(engine)
    repository = SqlDocumentRepository(sessions)
    policy_id = f"POL-IT-{uuid4().hex[:10]}"
    try:
        v1 = await repository.begin_index(
            make_document(policy_id, "1.0", date(2025, 1, 1), "active"), "v1.md"
        )
        await repository.complete_index(v1.id, 1)
        archived = await repository.begin_index(
            make_document(policy_id, "0.9", date(2024, 1, 1), "archived"), "archived.md"
        )
        await repository.complete_index(archived.id, 1)
        v2 = await repository.begin_index(
            make_document(policy_id, "2.0", date(2026, 1, 1), "active"), "v2.md"
        )
        await repository.complete_index(v2.id, 1)

        async with sessions() as session:
            rows = (
                await session.scalars(
                    select(KnowledgeDocumentModel).where(
                        KnowledgeDocumentModel.policy_id == policy_id
                    )
                )
            ).all()
        current = [row for row in rows if row.is_current]
        assert [row.id for row in current] == [v2.id]
        assert next(row for row in rows if row.id == archived.id).is_current is False
    finally:
        async with sessions.begin() as session:
            await session.execute(
                delete(KnowledgeDocumentModel).where(KnowledgeDocumentModel.policy_id == policy_id)
            )
        await engine.dispose()


@pytest.mark.asyncio
async def test_pgvector_and_lexical_nodes_are_written_and_deleted_together() -> None:
    assert DATABASE_URL
    engine = create_engine(DATABASE_URL)
    sessions = create_session_factory(engine)
    repository = SqlDocumentRepository(sessions)
    vector_store = create_pg_vector_store(DATABASE_URL, 1024)
    node_store = PostgresNodeStore(vector_store, sessions)
    policy_id = f"POL-VECTOR-{uuid4().hex[:10]}"
    stored = await repository.begin_index(
        make_document(policy_id, "1.0", date(2026, 1, 1), "active"), "vector.md"
    )
    node_id = uuid4().hex
    node = TextNode(
        id_=node_id,
        text="企业政策向量与中文关键词索引必须保持一致。",
        embedding=[0.01] * 1024,
        metadata={
            "policy_id": policy_id,
            "keyword": "integration",
            "title": "向量集成测试",
            "document_id": stored.id,
            "source_name": "vector.md",
            "version": "1.0",
            "status": "active",
        },
        relationships={
            NodeRelationship.SOURCE: RelatedNodeInfo(node_id=stored.id),
        },
    )
    try:
        await node_store.add(stored.id, [node])
        await repository.complete_index(stored.id, 1)
        async with sessions() as session:
            lexical = await session.get(KnowledgeLexicalNodeModel, node_id)
        assert lexical is not None
        assert "政策" in lexical.lexical_tokens

        await node_store.delete_document(stored.id)
        async with sessions() as session:
            assert await session.get(KnowledgeLexicalNodeModel, node_id) is None
    finally:
        await node_store.delete_document(stored.id)
        async with sessions.begin() as session:
            await session.execute(
                delete(KnowledgeDocumentModel).where(KnowledgeDocumentModel.policy_id == policy_id)
            )
        await engine.dispose()
