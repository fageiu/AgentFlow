from pathlib import Path

import pytest

from agentflow_rag.ingestion import IngestionService, InMemoryDocumentRepository, InMemoryNodeStore


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
    service = IngestionService(repository, node_store, chunk_size=128, chunk_overlap=16)

    first = await service.ingest_file(path)
    second = await service.ingest_file(path)

    assert first.status == "indexed"
    assert second.status == "unchanged"
    assert second.node_count == first.node_count
    assert len(node_store.nodes) == 1


@pytest.mark.asyncio
async def test_changed_document_replaces_same_policy_version(tmp_path: Path) -> None:
    path = tmp_path / "policy.md"
    repository = InMemoryDocumentRepository()
    node_store = InMemoryNodeStore()
    service = IngestionService(repository, node_store, chunk_size=128, chunk_overlap=16)
    write_policy(path, "旧版本正文。" * 30)
    first = await service.ingest_file(path)

    write_policy(path, "修改后的正文，用来触发新的校验和与 Node。" * 30)
    second = await service.ingest_file(path)

    assert second.status == "indexed"
    assert second.document_id != first.document_id
    assert second.document_id in node_store.nodes
    assert first.document_id not in node_store.nodes
