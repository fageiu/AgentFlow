"""使用 LlamaIndex 将政策 Document 转换为可追溯 Node。"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import BaseNode, TextNode

from .schemas import ParsedPolicyDocument

CHUNKING_STRATEGY_VERSION = "markdown-section-recursive-v1"
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


@dataclass(frozen=True, slots=True)
class MarkdownSection:
    """保留标题层级的 Markdown 语义章节。"""

    heading_path: tuple[tuple[int, str], ...]
    body: str

    @property
    def section(self) -> str | None:
        return self.heading_path[-1][1] if self.heading_path else None

    @property
    def text(self) -> str:
        headings = "\n\n".join(f"{'#' * level} {title}" for level, title in self.heading_path)
        return "\n\n".join(part for part in (headings, self.body) if part).strip()


def _split_markdown_sections(text: str) -> list[MarkdownSection]:
    """按 Markdown 标题建立强边界，禁止一个检索节点横跨不同章节。"""
    sections: list[MarkdownSection] = []
    heading_stack: list[tuple[int, str]] = []
    current_path: tuple[tuple[int, str], ...] = ()
    body_lines: list[str] = []

    def flush() -> None:
        body = "\n".join(body_lines).strip()
        if body:
            sections.append(MarkdownSection(current_path, body))
        body_lines.clear()

    for line in text.splitlines():
        match = HEADING_PATTERN.match(line.strip())
        if not match:
            body_lines.append(line)
            continue

        flush()
        level = len(match.group(1))
        title = match.group(2).strip()
        while heading_stack and heading_stack[-1][0] >= level:
            heading_stack.pop()
        heading_stack.append((level, title))
        current_path = tuple(heading_stack)

    flush()
    return sections or [MarkdownSection((), text.strip())]


def build_index_checksum(source_checksum: str, *, chunk_size: int, chunk_overlap: int) -> str:
    """将切块策略和参数纳入索引指纹，策略升级后自动重建旧节点。"""
    payload = (
        f"{source_checksum}:{CHUNKING_STRATEGY_VERSION}:{chunk_size}:{chunk_overlap}"
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def build_document_ref_id(document: ParsedPolicyDocument) -> str:
    return f"{document.metadata.policy_id}:{document.metadata.version}:{document.checksum[:12]}"


def build_policy_nodes(
    document: ParsedPolicyDocument,
    *,
    chunk_size: int = 512,
    chunk_overlap: int = 80,
) -> list[BaseNode]:
    ref_doc_id = build_document_ref_id(document)
    # 先按页面和 Markdown 章节建立父级语义边界；超长章节才交给 SentenceSplitter。
    splitter = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    nodes: list[BaseNode] = []
    for page_index, page in enumerate(document.pages):
        for section_index, section in enumerate(_split_markdown_sections(page.text)):
            heading_titles = [title for _, title in section.heading_path]
            parent_seed = (
                f"{ref_doc_id}:{page_index}:{section_index}:{'/'.join(heading_titles)}"
            ).encode()
            parent_id = hashlib.sha256(parent_seed).hexdigest()
            metadata = {
                **document.metadata.model_dump(mode="json"),
                "document_id": ref_doc_id,
                "source_name": document.source_name,
                "page": page.page,
                "section": section.section,
                "heading_path": heading_titles,
                "parent_id": parent_id,
                "chunking_strategy": CHUNKING_STRATEGY_VERSION,
            }
            # 先只按正文计算 token，再显式附加元数据，避免较长章节路径挤占切分预算。
            for chunk_text in splitter.split_text(section.text):
                nodes.append(TextNode(text=chunk_text, metadata=dict(metadata)))

    # Node ID 同时绑定索引指纹、顺序和正文，保证重复摄取稳定且策略升级可追踪。
    for ordinal, node in enumerate(nodes):
        node.metadata["ordinal"] = ordinal
        stable_input = f"{ref_doc_id}:{ordinal}:{node.text}".encode()
        node.id_ = hashlib.sha256(stable_input).hexdigest()
    return nodes
