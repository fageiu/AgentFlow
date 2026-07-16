"""知识文档管理服务，负责文件边界、索引编排与文档生命周期。"""

from __future__ import annotations

import secrets
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from .database import KnowledgeDocumentModel
from .errors import KnowledgeDocumentInvalidError
from .ingestion import IngestionResult, IngestionService, NodeStore
from .schemas import DocumentSummary, PolicyMetadata


class AdminOperations(Protocol):
    async def list_documents(self) -> list[DocumentSummary]: ...

    async def upload(
        self, filename: str, content: bytes, metadata: PolicyMetadata | None
    ) -> IngestionResult: ...

    async def reindex(self, document_id: str) -> IngestionResult: ...

    async def delete(self, document_id: str) -> bool: ...

    async def reindex_bundled(self) -> list[IngestionResult]: ...


class KnowledgeAdminService:
    def __init__(
        self,
        sessions: async_sessionmaker,
        ingestion: IngestionService,
        node_store: NodeStore,
        upload_dir: Path,
        bundled_policy_dir: Path,
        *,
        max_upload_bytes: int,
    ) -> None:
        self.sessions = sessions
        self.ingestion = ingestion
        self.node_store = node_store
        self.upload_dir = upload_dir
        self.bundled_policy_dir = bundled_policy_dir
        self.max_upload_bytes = max_upload_bytes

    async def list_documents(self) -> list[DocumentSummary]:
        async with self.sessions() as session:
            models = (
                await session.execute(
                    select(KnowledgeDocumentModel).order_by(KnowledgeDocumentModel.updated_at.desc())
                )
            ).scalars()
            return [self._to_summary(model) for model in models]

    async def upload(
        self, filename: str, content: bytes, metadata: PolicyMetadata | None
    ) -> IngestionResult:
        suffix = Path(filename).suffix.lower()
        if suffix not in {".md", ".pdf"}:
            raise KnowledgeDocumentInvalidError("仅支持 Markdown 和 PDF", source=filename)
        if not content or len(content) > self.max_upload_bytes:
            raise KnowledgeDocumentInvalidError(
                "上传文件为空或超过大小限制", source=filename, max_bytes=self.max_upload_bytes
            )
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        safe_path = self.upload_dir / f"{uuid4().hex}{suffix}"
        safe_path.write_bytes(content)
        try:
            return await self.ingestion.ingest_file(safe_path, metadata)
        except Exception:
            safe_path.unlink(missing_ok=True)
            raise

    async def reindex(self, document_id: str) -> IngestionResult:
        model = await self._get_model(document_id)
        metadata = (
            self._metadata_from_model(model)
            if Path(model.source_path).suffix.lower() == ".pdf"
            else None
        )
        return await self.ingestion.ingest_file(Path(model.source_path), metadata)

    async def delete(self, document_id: str) -> bool:
        model = await self._get_model(document_id, required=False)
        if model is None:
            return False
        await self.node_store.delete_document(document_id)
        async with self.sessions.begin() as session:
            await session.execute(
                delete(KnowledgeDocumentModel).where(KnowledgeDocumentModel.id == document_id)
            )
        source_path = Path(model.source_path)
        if self._is_inside(source_path, self.upload_dir):
            source_path.unlink(missing_ok=True)
        return True

    async def reindex_bundled(self) -> list[IngestionResult]:
        results: list[IngestionResult] = []
        for path in sorted(self.bundled_policy_dir.rglob("*.md")):
            results.append(await self.ingestion.ingest_file(path))
        return results

    async def _get_model(
        self, document_id: str, *, required: bool = True
    ) -> KnowledgeDocumentModel | None:
        async with self.sessions() as session:
            model = await session.get(KnowledgeDocumentModel, document_id)
        if model is None and required:
            raise KnowledgeDocumentInvalidError("指定政策文档不存在", document_id=document_id)
        return model

    @staticmethod
    def _metadata_from_model(model: KnowledgeDocumentModel) -> PolicyMetadata:
        return PolicyMetadata(
            policy_id=model.policy_id,
            keyword=model.keyword,
            title=model.title,
            version=model.version,
            effective_date=model.effective_date,
            status=model.status,
            department=model.department,
        )

    @staticmethod
    def _to_summary(model: KnowledgeDocumentModel) -> DocumentSummary:
        return DocumentSummary(
            id=model.id,
            metadata=KnowledgeAdminService._metadata_from_model(model),
            source_name=model.source_name,
            checksum=model.checksum,
            index_status=model.index_status,
            node_count=model.node_count,
            error_message=model.error_message,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    @staticmethod
    def _is_inside(path: Path, parent: Path) -> bool:
        try:
            path.resolve().relative_to(parent.resolve())
            return True
        except ValueError:
            return False


def verify_admin_token(candidate: str | None, expected: str) -> bool:
    return bool(candidate) and secrets.compare_digest(candidate, expected)


class InMemoryAdminService:
    """API 契约测试替身，不参与真实 RAG 模式。"""

    def __init__(self, documents: Sequence[DocumentSummary] = ()) -> None:
        self.documents = list(documents)

    async def list_documents(self) -> list[DocumentSummary]:
        return self.documents

    async def upload(
        self, filename: str, content: bytes, metadata: PolicyMetadata | None
    ) -> IngestionResult:
        del filename, content, metadata
        return IngestionResult("doc-uploaded", "indexed", 3)

    async def reindex(self, document_id: str) -> IngestionResult:
        return IngestionResult(document_id, "unchanged", 3)

    async def delete(self, document_id: str) -> bool:
        del document_id
        return True

    async def reindex_bundled(self) -> list[IngestionResult]:
        return [IngestionResult("doc-bundled", "indexed", 5)]
