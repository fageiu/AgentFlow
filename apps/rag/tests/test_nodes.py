from datetime import date

from agentflow_rag.nodes import build_index_checksum, build_policy_nodes
from agentflow_rag.schemas import ParsedPolicyDocument, PolicyMetadata, PolicyPage


def make_document(text: str) -> ParsedPolicyDocument:
    return ParsedPolicyDocument(
        metadata=PolicyMetadata(
            policy_id="P-structure-001",
            keyword="sla",
            title="结构化切块测试政策",
            version="1.0",
            effective_date=date(2026, 1, 1),
            status="active",
            department="质量工程部",
        ),
        source_name="structure-policy.md",
        checksum="a" * 64,
        pages=[PolicyPage(text=text)],
    )


def test_markdown_headings_are_hard_chunk_boundaries() -> None:
    document = make_document(
        """# 企业服务政策

## 响应口径

企业版首次响应目标为三十分钟。首次响应不等于故障恢复。

## 补偿边界

补偿必须结合合同和月度可用率，由客户成功与财务共同确认。
"""
    )

    nodes = build_policy_nodes(document, chunk_size=256, chunk_overlap=32)

    assert len(nodes) == 2
    assert nodes[0].metadata["section"] == "响应口径"
    assert nodes[0].metadata["heading_path"] == ["企业服务政策", "响应口径"]
    assert "补偿边界" not in nodes[0].text
    assert nodes[1].metadata["section"] == "补偿边界"
    assert "响应口径" not in nodes[1].text


def test_oversized_markdown_section_is_recursively_split_with_same_parent() -> None:
    document = make_document(
        "# 企业服务政策\n\n## 事件处理\n\n"
        + "核心接口不可用时必须记录开始时间、影响范围并升级值班经理。" * 80
    )

    nodes = build_policy_nodes(document, chunk_size=128, chunk_overlap=16)

    assert len(nodes) > 1
    assert {node.metadata["section"] for node in nodes} == {"事件处理"}
    assert len({node.metadata["parent_id"] for node in nodes}) == 1


def test_index_checksum_changes_with_chunking_parameters() -> None:
    baseline = build_index_checksum("source", chunk_size=256, chunk_overlap=32)

    assert baseline == build_index_checksum("source", chunk_size=256, chunk_overlap=32)
    assert baseline != build_index_checksum("source", chunk_size=384, chunk_overlap=32)

