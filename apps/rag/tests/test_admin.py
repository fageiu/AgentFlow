from pathlib import Path

import pytest

from agentflow_rag.admin import KnowledgeAdminService
from agentflow_rag.ingestion import IngestionResult


class SuccessfulIngestion:
    async def ingest_file(self, path: Path, metadata=None) -> IngestionResult:  # type: ignore[no-untyped-def]
        del path, metadata
        return IngestionResult("doc-uploaded", "indexed", 3)


class UnusedNodeStore:
    async def delete_document(self, document_id: str) -> None:
        del document_id


class FailingLexicalIndex:
    async def refresh(self) -> None:
        raise RuntimeError("bm25 refresh failed")


@pytest.mark.asyncio
async def test_upload_keeps_source_file_when_bm25_refresh_fails(tmp_path: Path) -> None:
    upload_dir = tmp_path / "uploads"
    service = KnowledgeAdminService(
        sessions=None,  # type: ignore[arg-type]
        ingestion=SuccessfulIngestion(),  # type: ignore[arg-type]
        node_store=UnusedNodeStore(),  # type: ignore[arg-type]
        upload_dir=upload_dir,
        bundled_policy_dir=tmp_path / "policies",
        max_upload_bytes=1024,
        lexical_index=FailingLexicalIndex(),
    )

    with pytest.raises(RuntimeError, match="bm25 refresh failed"):
        await service.upload("policy.md", b"valid policy source", None)

    assert len(list(upload_dir.glob("*.md"))) == 1
