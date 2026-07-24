"""Markdown/PDF 政策解析与内容校验。"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import fitz
import yaml
from pydantic import ValidationError

from .cleaning import CLEANING_STRATEGY_VERSION, clean_policy_pages
from .errors import KnowledgeDocumentInvalidError
from .schemas import ParsedPolicyDocument, PolicyMetadata, PolicyPage

FRONTMATTER_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)


def content_checksum(content: bytes, metadata: PolicyMetadata) -> str:
    digest = hashlib.sha256()
    digest.update(content)
    digest.update(metadata.model_dump_json().encode("utf-8"))
    return digest.hexdigest()


def parse_markdown(path: Path) -> ParsedPolicyDocument:
    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise KnowledgeDocumentInvalidError("Markdown 必须是可读取的 UTF-8 文件", source=path.name) from error

    match = FRONTMATTER_PATTERN.match(text)
    if not match:
        raise KnowledgeDocumentInvalidError("Markdown 缺少有效 frontmatter", source=path.name)
    try:
        metadata = PolicyMetadata.model_validate(yaml.safe_load(match.group(1)))
    except (yaml.YAMLError, ValidationError, TypeError) as error:
        raise KnowledgeDocumentInvalidError("Markdown frontmatter 校验失败", source=path.name) from error

    body = match.group(2).strip()
    if len(body) < 80:
        raise KnowledgeDocumentInvalidError("政策正文过短", source=path.name)
    pages, cleaning_stats = clean_policy_pages(
        [PolicyPage(text=body)],
        source_format="markdown",
    )
    return ParsedPolicyDocument(
        metadata=metadata,
        source_name=path.name,
        checksum=content_checksum(raw, metadata),
        pages=pages,
        cleaning_strategy=CLEANING_STRATEGY_VERSION,
        cleaning_stats=cleaning_stats,
    )


def parse_pdf(path: Path, metadata: PolicyMetadata) -> ParsedPolicyDocument:
    try:
        raw = path.read_bytes()
        pdf = fitz.open(stream=raw, filetype="pdf")
    except (OSError, fitz.FileDataError) as error:
        raise KnowledgeDocumentInvalidError("PDF 文件无法解析", source=path.name) from error

    pages: list[PolicyPage] = []
    try:
        for index, page in enumerate(pdf, start=1):
            text = page.get_text("text").strip()
            if text:
                pages.append(PolicyPage(text=text, page=index))
    finally:
        pdf.close()
    if not pages:
        raise KnowledgeDocumentInvalidError("PDF 没有可提取文本，首期不支持扫描件 OCR", source=path.name)
    pages, cleaning_stats = clean_policy_pages(pages, source_format="pdf")
    if not pages:
        raise KnowledgeDocumentInvalidError("PDF 清洗后没有有效正文", source=path.name)

    return ParsedPolicyDocument(
        metadata=metadata,
        source_name=path.name,
        checksum=content_checksum(raw, metadata),
        pages=pages,
        cleaning_strategy=CLEANING_STRATEGY_VERSION,
        cleaning_stats=cleaning_stats,
    )


def parse_policy_file(path: Path, metadata: PolicyMetadata | None = None) -> ParsedPolicyDocument:
    """解析政策文件"""
    suffix = path.suffix.lower()
    if suffix == ".md":
        return parse_markdown(path)
    if suffix == ".pdf" and metadata is not None:
        return parse_pdf(path, metadata)
    if suffix == ".pdf":
        raise KnowledgeDocumentInvalidError("上传 PDF 必须提供政策元数据", source=path.name)
    raise KnowledgeDocumentInvalidError("仅支持 Markdown 和 PDF", source=path.name)
