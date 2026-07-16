"""校验 bundled 政策语料及检索 Golden Query 的最小质量门槛。"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

RAG_ROOT = Path(__file__).resolve().parents[1]
POLICY_ROOT = RAG_ROOT / "knowledge" / "policies"
QUERY_PATH = RAG_ROOT / "knowledge" / "evaluation" / "golden_queries.json"
REQUIRED_FIELDS = {
    "policy_id",
    "keyword",
    "title",
    "version",
    "effective_date",
    "status",
    "department",
}
REQUIRED_KEYWORDS = {
    "refund",
    "approval",
    "发票",
    "sla",
    "upgrade",
    "renewal-discount",
    "cancel",
    "duplicate-refund",
    "security",
}


def parse_frontmatter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
    if not match:
        raise ValueError(f"{path}: 缺少有效 frontmatter")

    metadata: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if not line.strip():
            continue
        key, separator, value = line.partition(":")
        if not separator:
            raise ValueError(f"{path}: 无法解析 frontmatter 行 {line!r}")
        metadata[key.strip()] = value.strip().strip('"')
    return metadata, match.group(2).strip()


def validate_documents() -> tuple[set[str], int]:
    files = sorted(POLICY_ROOT.rglob("*.md"))
    if len(files) < 20:
        raise ValueError(f"政策文档数量不足：{len(files)}，至少需要 20")

    policy_ids: set[str] = set()
    keywords: Counter[str] = Counter()
    active_versions: Counter[tuple[str, str]] = Counter()
    total_characters = 0

    for path in files:
        metadata, content = parse_frontmatter(path)
        missing = REQUIRED_FIELDS - metadata.keys()
        if missing:
            raise ValueError(f"{path}: 缺少字段 {sorted(missing)}")
        if metadata["status"] not in {"active", "archived"}:
            raise ValueError(f"{path}: status 必须是 active 或 archived")
        try:
            date.fromisoformat(metadata["effective_date"])
        except ValueError as error:
            raise ValueError(f"{path}: effective_date 格式错误") from error
        if len(content) < 80:
            raise ValueError(f"{path}: 正文过短，无法形成有意义的检索证据")

        policy_ids.add(metadata["policy_id"])
        keywords[metadata["keyword"]] += 1
        total_characters += len(content)
        if metadata["status"] == "active":
            active_versions[(metadata["policy_id"], metadata["version"])] += 1

    missing_keywords = REQUIRED_KEYWORDS - keywords.keys()
    if missing_keywords:
        raise ValueError(f"缺少业务领域：{sorted(missing_keywords)}")
    duplicates = [key for key, count in active_versions.items() if count > 1]
    if duplicates:
        raise ValueError(f"存在重复 active 政策版本：{duplicates}")
    if total_characters < 25_000:
        raise ValueError(f"政策正文规模不足：{total_characters}，至少需要 25000 个字符")

    return policy_ids, total_characters


def validate_queries(policy_ids: set[str]) -> int:
    queries = json.loads(QUERY_PATH.read_text(encoding="utf-8"))
    if not isinstance(queries, list) or len(queries) < 50:
        raise ValueError("Golden Query 至少需要 50 条")

    query_ids: set[str] = set()
    negative_count = 0
    for item in queries:
        query_id = item.get("id")
        if not isinstance(query_id, str) or not query_id:
            raise ValueError("Golden Query 缺少 id")
        if query_id in query_ids:
            raise ValueError(f"Golden Query id 重复：{query_id}")
        query_ids.add(query_id)
        if not isinstance(item.get("query"), str) or not item["query"].strip():
            raise ValueError(f"{query_id}: query 为空")

        expected = item.get("expected_policy_ids")
        answerable = item.get("answerable")
        if not isinstance(expected, list) or not isinstance(answerable, bool):
            raise ValueError(f"{query_id}: expected_policy_ids 或 answerable 类型错误")
        unknown = set(expected) - policy_ids
        if unknown:
            raise ValueError(f"{query_id}: 引用了不存在的政策 {sorted(unknown)}")
        if answerable != bool(expected):
            raise ValueError(f"{query_id}: answerable 与期望政策不一致")
        negative_count += int(not answerable)

    if negative_count < 5:
        raise ValueError("至少需要 5 条无答案问题")
    return len(queries)


def main() -> int:
    try:
        policy_ids, characters = validate_documents()
        query_count = validate_queries(policy_ids)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"语料校验失败：{error}", file=sys.stderr)
        return 1

    print(
        f"语料校验通过：{len(list(POLICY_ROOT.rglob('*.md')))} 篇文档，"
        f"{len(policy_ids)} 个政策 ID，{characters} 个正文字符，{query_count} 条 Golden Query。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
