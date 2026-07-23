from pathlib import Path

import pytest

from agentflow_rag.ingestion import IngestionService, InMemoryDocumentRepository, InMemoryNodeStore


class FakeEmbeddingModel:
    """测试使用固定维度向量，避免下载真实 BGE 模型。"""

    async def aget_text_embedding_batch(
        self,
        texts: list[str],
        *,
        show_progress: bool = False,
    ) -> list[list[float]]:
        del show_progress
        return [[float(len(text)), 1.0, 0.0] for text in texts]


def write_policy(path: Path, content: str) -> None:
    path.write_text(
        f"""---
policy_id: P-test-ingest
keyword: refund
title: 索引测试政策
version: "1.0"
effective_date: "2026-01-01"
status: active
department: 测试部门
---

# 索引测试

{content}
""",
        encoding="utf-8",
    )


@pytest.mark.asyncio
async def test_ingestion_is_idempotent_for_same_checksum(tmp_path: Path) -> None:
    path = tmp_path / "policy.md"
    write_policy(path, "这是用于验证幂等导入的正文。" * 30)
    repository = InMemoryDocumentRepository()
    node_store = InMemoryNodeStore()
    service = IngestionService(
        repository,
        node_store,
        FakeEmbeddingModel(),
        chunk_size=128,
        chunk_overlap=16,
    )

    first = await service.ingest_file(path)
    second = await service.ingest_file(path)

    assert first.status == "indexed"
    assert second.status == "unchanged"
    assert second.node_count == first.node_count
    assert len(node_store.nodes) == 1
    assert all(node.embedding is not None for nodes in node_store.nodes.values() for node in nodes)


@pytest.mark.asyncio
async def test_changed_document_replaces_same_policy_version(tmp_path: Path) -> None:
    path = tmp_path / "policy.md"
    repository = InMemoryDocumentRepository()
    node_store = InMemoryNodeStore()
    service = IngestionService(
        repository,
        node_store,
        FakeEmbeddingModel(),
        chunk_size=128,
        chunk_overlap=16,
    )
    write_policy(path, "旧版本正文。" * 30)
    first = await service.ingest_file(path)

    write_policy(path, "修改后的正文，用来触发新的校验和与 Node。" * 30)
    second = await service.ingest_file(path)

    assert second.status == "indexed"
    assert second.document_id != first.document_id
    assert second.document_id in node_store.nodes
    assert first.document_id not in node_store.nodes


@pytest.mark.asyncio
async def test_chunking_configuration_change_rebuilds_unchanged_source(tmp_path: Path) -> None:
    path = tmp_path / "policy.md"
    write_policy(path, "同一份政策正文。" * 40)
    repository = InMemoryDocumentRepository()
    node_store = InMemoryNodeStore()
    first_service = IngestionService(
        repository,
        node_store,
        FakeEmbeddingModel(),
        chunk_size=128,
        chunk_overlap=16,
    )
    second_service = IngestionService(
        repository,
        node_store,
        FakeEmbeddingModel(),
        chunk_size=256,
        chunk_overlap=32,
    )

    first = await first_service.ingest_file(path)
    second = await second_service.ingest_file(path)

    assert first.status == "indexed"
    assert second.status == "indexed"
    assert second.document_id != first.document_id
    assert first.document_id not in node_store.nodes
