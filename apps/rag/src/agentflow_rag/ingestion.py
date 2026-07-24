"""政策索引编排与幂等版本切换。"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from llama_index.core.schema import BaseNode, MetadataMode

from .documents import parse_policy_file
from .nodes import build_document_ref_id, build_index_checksum, build_policy_nodes
from .schemas import ParsedPolicyDocument, PolicyMetadata


@dataclass(slots=True)
class StoredDocument:
    id: str
    checksum: str
    index_status: str
    node_count: int = 0


class DocumentRepository(Protocol):
    async def find_by_policy_version(self, policy_id: str, version: str) -> StoredDocument | None: ...

    async def begin_index(self, document: ParsedPolicyDocument, source_path: str) -> StoredDocument: ...

    async def complete_index(self, document_id: str, node_count: int) -> None: ...

    async def fail_index(self, document_id: str, message: str) -> None: ...


class NodeStore(Protocol):
    async def add(self, document_id: str, nodes: Sequence[BaseNode]) -> None: ...

    async def delete_document(self, document_id: str) -> None: ...


class EmbeddingModel(Protocol):
    """摄取流程只依赖 LlamaIndex Embedding 的异步批量接口。"""

    async def aget_text_embedding_batch(
        self,
        texts: list[str],
        *,
        show_progress: bool = False,
    ) -> list[list[float]]: ...


@dataclass(slots=True)
class InMemoryDocumentRepository:
    documents: dict[tuple[str, str], StoredDocument] = field(default_factory=dict)

    async def find_by_policy_version(self, policy_id: str, version: str) -> StoredDocument | None:
        return self.documents.get((policy_id, version))

    async def begin_index(self, document: ParsedPolicyDocument, source_path: str) -> StoredDocument:
        del source_path
        stored = StoredDocument(build_document_ref_id(document), document.checksum, "indexing")
        self.documents[(document.metadata.policy_id, document.metadata.version)] = stored
        return stored

    async def complete_index(self, document_id: str, node_count: int) -> None:
        stored = next(item for item in self.documents.values() if item.id == document_id)
        stored.index_status = "indexed"
        stored.node_count = node_count

    async def fail_index(self, document_id: str, message: str) -> None:
        del message
        stored = next(item for item in self.documents.values() if item.id == document_id)
        stored.index_status = "failed"


@dataclass(slots=True)
class InMemoryNodeStore:
    nodes: dict[str, list[BaseNode]] = field(default_factory=dict)

    async def add(self, document_id: str, nodes: Sequence[BaseNode]) -> None:
        self.nodes[document_id] = list(nodes)

    async def delete_document(self, document_id: str) -> None:
        self.nodes.pop(document_id, None)


@dataclass(slots=True)
class IngestionResult:
    document_id: str
    status: str
    node_count: int


class IngestionService:
    def __init__(
        self,
        repository: DocumentRepository,
        node_store: NodeStore,
        embedding_model: EmbeddingModel,
        *,
        chunk_size: int = 512,
        chunk_overlap: int = 80,
    ) -> None:
        self.repository = repository
        self.node_store = node_store
        self.embedding_model = embedding_model
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    async def ingest_file(self, path: Path, metadata: PolicyMetadata | None = None) -> IngestionResult:
        """索引单个文件"""
        source_document = parse_policy_file(path, metadata)
        # 索引指纹包含源文件、切块策略和参数，避免代码升级后继续复用旧 Node。
        document = source_document.model_copy(
            update={
                "checksum": build_index_checksum(
                    source_document.checksum,
                    chunk_size=self.chunk_size,
                    chunk_overlap=self.chunk_overlap,
                    cleaning_strategy=source_document.cleaning_strategy or "none",
                )
            }
        )
        # 1. 幂等检查：同一 policy_id+version 且索引指纹相同且已 indexed → 跳过
        existing = await self.repository.find_by_policy_version(
            document.metadata.policy_id, document.metadata.version
        )
        if existing and existing.checksum == document.checksum and existing.index_status == "indexed":
            # 不重复 Embedding，但重新校准 current 指针，可修复异常中断或旧版本逻辑留下的状态。
            await self.repository.complete_index(existing.id, existing.node_count)
            return IngestionResult(existing.id, "unchanged", existing.node_count)
        # 2. 开始索引
        stored = await self.repository.begin_index(document, str(path))
        try:
            # 3. 构建节点
            nodes = build_policy_nodes(
                document,
                chunk_size=self.chunk_size,
                chunk_overlap=self.chunk_overlap,
            )
            # 4. PGVectorStore 只负责持久化，写入前必须显式为每个 Node 生成向量。
            texts = [node.get_content(metadata_mode=MetadataMode.EMBED) for node in nodes]
            embeddings = await self.embedding_model.aget_text_embedding_batch(
                texts,
                show_progress=False,
            )
            if len(embeddings) != len(nodes):
                raise ValueError(
                    f"Embedding count mismatch: expected {len(nodes)}, got {len(embeddings)}"
                )
            for node, embedding in zip(nodes, embeddings, strict=True):
                node.embedding = embedding
            # 5. 存入向量库 + 词法表
            await self.node_store.add(stored.id, nodes)
            # 6. 标记索引完成（同时切换版本 is_current）
            await self.repository.complete_index(stored.id, len(nodes))
            if existing and existing.id != stored.id:
                await self.node_store.delete_document(existing.id)
        except Exception as error:
            # 失败时清理已写入的 Node
            await self.node_store.delete_document(stored.id)
            await self.repository.fail_index(stored.id, str(error))
            raise
        return IngestionResult(stored.id, "indexed", len(nodes))
