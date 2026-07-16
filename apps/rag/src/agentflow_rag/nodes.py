"""使用 LlamaIndex 将政策 Document 转换为可追溯 Node。"""

from __future__ import annotations

import hashlib
import re

from llama_index.core import Document
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import BaseNode

from .schemas import ParsedPolicyDocument

HEADING_PATTERN = re.compile(r"(?m)^#{1,6}\s+(.+)$")


def _section_for_text(text: str) -> str | None:
    match = HEADING_PATTERN.search(text)
    return match.group(1).strip() if match else None


def build_document_ref_id(document: ParsedPolicyDocument) -> str:
    return f"{document.metadata.policy_id}:{document.metadata.version}:{document.checksum[:12]}"


def build_policy_nodes(
    document: ParsedPolicyDocument,
    *,
    chunk_size: int = 512,
    chunk_overlap: int = 80,
) -> list[BaseNode]:
    ref_doc_id = build_document_ref_id(document)
    llama_documents: list[Document] = []
    for page in document.pages:
        metadata = {
            **document.metadata.model_dump(mode="json"),
            "document_id": ref_doc_id,
            "source_name": document.source_name,
            "page": page.page,
        }
        llama_documents.append(Document(text=page.text, metadata=metadata, id_=ref_doc_id))

    splitter = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    nodes = splitter.get_nodes_from_documents(llama_documents, show_progress=False)
    for ordinal, node in enumerate(nodes):
        node.metadata["section"] = _section_for_text(node.text)
        node.metadata["ordinal"] = ordinal
        stable_input = f"{ref_doc_id}:{ordinal}:{node.text}".encode()
        node.id_ = hashlib.sha256(stable_input).hexdigest()
    return nodes
