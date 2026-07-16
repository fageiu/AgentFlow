from pathlib import Path

from fastapi.testclient import TestClient
from llama_index.core.schema import NodeWithScore, TextNode

from agentflow_rag.admin import InMemoryAdminService
from agentflow_rag.app import create_app
from agentflow_rag.config import RagSettings
from agentflow_rag.retrieval import IdentityReranker, PolicyHybridRetriever, RetrievalService


class FakeSource:
    async def retrieve(self, query: str, top_k: int, *, include_archived: bool = False):
        del query, top_k, include_archived
        node = TextNode(
            id_="node-refund",
            text="VIP 客户在订单完成三十天内可以申请退款，所有退款必须人工审批。",
            metadata={
                "policy_id": "P-refund-001",
                "keyword": "refund",
                "title": "VIP 客户退款管理办法",
                "document_id": "doc-refund",
                "source_name": "refund.md",
                "version": "2.0",
                "status": "active",
                "section": "受理条件",
            },
        )
        return [NodeWithScore(node=node, score=0.9)]


def create_client(tmp_path: Path) -> TestClient:
    settings = RagSettings(
        load_models=False,
        admin_token="test-admin-token",
        upload_dir=tmp_path / "uploads",
    )
    retriever = PolicyHybridRetriever(FakeSource(), FakeSource())
    retrieval = RetrievalService(retriever, IdentityReranker())
    return TestClient(
        create_app(
            settings=settings,
            retrieval=retrieval,
            admin=InMemoryAdminService(),
        )
    )


def test_search_returns_policy_citation(tmp_path: Path) -> None:
    response = create_client(tmp_path).post("/v1/search", json={"query": "VIP 客户如何退款"})
    assert response.status_code == 200
    assert response.json()["matches"][0]["policy_id"] == "P-refund-001"
    assert response.json()["matches"][0]["citation"]["section"] == "受理条件"
    assert response.json()["matches"][0]["vector_score"] == 0.9
    assert response.json()["matches"][0]["lexical_score"] == 0.9
    assert response.headers["X-Request-Id"]


def test_admin_requires_token(tmp_path: Path) -> None:
    client = create_client(tmp_path)
    assert client.get("/v1/admin/documents").status_code == 401
    assert client.get(
        "/v1/admin/documents", headers={"X-Admin-Token": "test-admin-token"}
    ).status_code == 200


def test_markdown_upload_and_management_contract(tmp_path: Path) -> None:
    client = create_client(tmp_path)
    headers = {"X-Admin-Token": "test-admin-token"}
    response = client.post(
        "/v1/admin/documents",
        headers=headers,
        files={"file": ("policy.md", b"---\npolicy_id: P-test\n---\nbody", "text/markdown")},
    )
    assert response.status_code == 200
    assert response.json() == {"document_id": "doc-uploaded", "status": "indexed", "node_count": 3}
    assert client.post("/v1/admin/documents/doc-uploaded/reindex", headers=headers).status_code == 200
    assert client.delete("/v1/admin/documents/doc-uploaded", headers=headers).json() == {"deleted": True}
    bundled = client.post("/v1/admin/reindex-bundled", headers=headers)
    assert bundled.json()["results"][0]["document_id"] == "doc-bundled"


def test_search_returns_not_ready_without_service(tmp_path: Path) -> None:
    settings = RagSettings(load_models=False, upload_dir=tmp_path / "uploads")
    response = TestClient(create_app(settings=settings)).post(
        "/v1/search", json={"query": "VIP 客户如何退款"}
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "KNOWLEDGE_INDEX_NOT_READY"
