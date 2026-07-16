from fastapi import FastAPI
from fastapi.testclient import TestClient

from agentflow_rag.errors import KnowledgeError, KnowledgeNoMatchError, knowledge_error_handler


def test_knowledge_error_has_stable_payload() -> None:
    app = FastAPI()
    app.add_exception_handler(KnowledgeError, knowledge_error_handler)  # type: ignore[arg-type]

    @app.get("/error")
    async def raise_error() -> None:
        raise KnowledgeNoMatchError(query_hash="abc")

    response = TestClient(app).get("/error")
    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "KNOWLEDGE_NO_MATCH",
            "message": "没有检索到可靠的企业政策",
            "retryable": True,
            "details": {"query_hash": "abc"},
        }
    }
