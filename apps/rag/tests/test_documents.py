from pathlib import Path

import fitz
import pytest

from agentflow_rag.documents import parse_markdown, parse_pdf
from agentflow_rag.errors import KnowledgeDocumentInvalidError
from agentflow_rag.schemas import PolicyMetadata


def test_parse_markdown_preserves_policy_metadata(tmp_path: Path) -> None:
    path = tmp_path / "policy.md"
    path.write_text(
        """---
policy_id: P-test-001
keyword: refund
title: 测试退款政策
version: "1.0"
effective_date: "2026-01-01"
status: active
department: 测试部门
---

# 测试政策

这是用于验证 Markdown 元数据和正文解析的政策内容。正文需要足够长，
以确保测试覆盖真实文档的最小内容校验。该政策只用于自动化测试，不进入生产索引。
""",
        encoding="utf-8",
    )

    document = parse_markdown(path)
    assert document.metadata.policy_id == "P-test-001"
    assert document.metadata.status == "active"
    assert document.pages[0].page is None
    assert len(document.checksum) == 64


def test_parse_markdown_rejects_missing_frontmatter(tmp_path: Path) -> None:
    path = tmp_path / "invalid.md"
    path.write_text("没有 frontmatter 的普通正文", encoding="utf-8")

    with pytest.raises(KnowledgeDocumentInvalidError):
        parse_markdown(path)


def test_parse_pdf_preserves_page_number(tmp_path: Path) -> None:
    path = tmp_path / "policy.pdf"
    pdf = fitz.open()
    page = pdf.new_page()
    page.insert_text((72, 72), "AgentFlow policy page one")
    pdf.save(path)
    pdf.close()
    metadata = PolicyMetadata(
        policy_id="P-pdf-001",
        keyword="sla",
        title="PDF 政策",
        version="1.0",
        effective_date="2026-01-01",
        status="active",
        department="测试部门",
    )

    document = parse_pdf(path, metadata)
    assert document.pages[0].page == 1
    assert "AgentFlow" in document.pages[0].text
