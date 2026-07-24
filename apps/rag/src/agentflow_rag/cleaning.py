"""政策正文的确定性清洗，保留页码和章节等引用边界。"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter

from .schemas import DocumentCleaningStats, PolicyPage

CLEANING_STRATEGY_VERSION = "policy-text-cleaning-v1"

_INVISIBLE_PATTERN = re.compile("[\u200b\u200c\u200d\u2060\ufeff]")
_EXCESSIVE_BLANK_LINES_PATTERN = re.compile(r"\n[ \t]*\n(?:[ \t]*\n)+")
_STANDALONE_PAGE_NUMBER_PATTERN = re.compile(
    r"^\s*(?:第\s*)?\d+\s*(?:页|/\s*\d+)?\s*$",
    re.IGNORECASE,
)
_LATIN_HYPHENATED_LINE_PATTERN = re.compile(r"(?<=[A-Za-z])-\n(?=[a-z])")
_MARKDOWN_BLOCK_PATTERN = re.compile(r"^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|)")
_SENTENCE_ENDINGS = frozenset("。！？；.!?;:：")


def _normalize_text(text: str) -> tuple[str, int]:
    """统一字符和换行，但不改变 Markdown 表格、列表及代码缩进。"""
    original = text
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ").replace("\u3000", " ")
    text = _INVISIBLE_PATTERN.sub("", text)
    text = "\n".join(line.rstrip() for line in text.splitlines())
    text = _EXCESSIVE_BLANK_LINES_PATTERN.sub("\n\n", text).strip()
    return text, max(0, len(original) - len(text))


def _deduplicate_adjacent_paragraphs(text: str) -> tuple[str, int]:
    """仅删除相邻的完全重复段落，避免误删跨章节的合法重复条款。"""
    paragraphs = re.split(r"\n{2,}", text)
    kept: list[str] = []
    removed = 0
    for paragraph in paragraphs:
        normalized = paragraph.strip()
        if not normalized:
            continue
        if kept and normalized == kept[-1]:
            removed += 1
            continue
        kept.append(normalized)
    return "\n\n".join(kept), removed


def _repair_pdf_line_breaks(text: str) -> tuple[str, int]:
    """保守修复 PDF 行内断行，显式结构和句末换行保持不变。"""
    text, hyphen_repairs = _LATIN_HYPHENATED_LINE_PATTERN.subn("", text)
    lines = text.splitlines()
    if len(lines) < 2:
        return text, hyphen_repairs

    repaired: list[str] = []
    joined_lines = hyphen_repairs
    for line in lines:
        current = line.strip()
        if not current:
            if repaired and repaired[-1] != "":
                repaired.append("")
            continue
        if (
            repaired
            and repaired[-1]
            and not _MARKDOWN_BLOCK_PATTERN.match(repaired[-1])
            and not _MARKDOWN_BLOCK_PATTERN.match(current)
            and repaired[-1][-1] not in _SENTENCE_ENDINGS
        ):
            separator = "" if _is_cjk_boundary(repaired[-1][-1], current[0]) else " "
            repaired[-1] = f"{repaired[-1]}{separator}{current}"
            joined_lines += 1
        else:
            repaired.append(current)
    return "\n".join(repaired).strip(), joined_lines


def _is_cjk_boundary(left: str, right: str) -> bool:
    return "\u3400" <= left <= "\u9fff" and "\u3400" <= right <= "\u9fff"


def _edge_line_candidates(text: str) -> tuple[str | None, str | None]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return None, None
    return lines[0], lines[-1]


def _repeated_pdf_edges(pages: list[PolicyPage]) -> set[str]:
    """识别至少 60% 页面重复且出现两次以上的精确页眉或页脚。"""
    if len(pages) < 2:
        return set()
    threshold = max(2, math.ceil(len(pages) * 0.6))
    headers: Counter[str] = Counter()
    footers: Counter[str] = Counter()
    for page in pages:
        header, footer = _edge_line_candidates(page.text)
        if header:
            headers[header] += 1
        if footer:
            footers[footer] += 1
    return {
        line
        for line, count in (*headers.items(), *footers.items())
        if count >= threshold and len(line) <= 200
    }


def _remove_pdf_edge_noise(text: str, repeated_edges: set[str]) -> tuple[str, int, int]:
    lines = text.splitlines()
    nonempty_indexes = [index for index, line in enumerate(lines) if line.strip()]
    if not nonempty_indexes:
        return "", 0, 0

    removed_headers_footers = 0
    removed_page_numbers = 0
    for index in {nonempty_indexes[0], nonempty_indexes[-1]}:
        stripped = lines[index].strip()
        if stripped in repeated_edges:
            lines[index] = ""
            removed_headers_footers += 1
        elif _STANDALONE_PAGE_NUMBER_PATTERN.fullmatch(stripped):
            lines[index] = ""
            removed_page_numbers += 1
    return "\n".join(lines).strip(), removed_headers_footers, removed_page_numbers


def clean_policy_pages(
    pages: list[PolicyPage],
    *,
    source_format: str,
) -> tuple[list[PolicyPage], DocumentCleaningStats]:
    """清洗政策页面并返回可随索引审计的统计信息。"""
    stats = DocumentCleaningStats(input_pages=len(pages))
    normalized_pages: list[PolicyPage] = []
    for page in pages:
        text, removed_characters = _normalize_text(page.text)
        stats.removed_characters += removed_characters
        normalized_pages.append(PolicyPage(text=text, page=page.page))

    repeated_edges = _repeated_pdf_edges(normalized_pages) if source_format == "pdf" else set()
    cleaned_pages: list[PolicyPage] = []
    for page in normalized_pages:
        text = page.text
        if source_format == "pdf":
            text, removed_edges, removed_page_numbers = _remove_pdf_edge_noise(
                text, repeated_edges
            )
            stats.removed_headers_footers += removed_edges
            stats.removed_page_numbers += removed_page_numbers
            text, repaired_line_breaks = _repair_pdf_line_breaks(text)
            stats.repaired_line_breaks += repaired_line_breaks

        text, removed_duplicates = _deduplicate_adjacent_paragraphs(text)
        stats.removed_duplicate_paragraphs += removed_duplicates
        if text:
            cleaned_pages.append(PolicyPage(text=text, page=page.page))
        else:
            stats.removed_empty_pages += 1

    stats.output_pages = len(cleaned_pages)
    return cleaned_pages, stats
