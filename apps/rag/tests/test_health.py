from fastapi.testclient import TestClient

from agentflow_rag.app import create_app
from agentflow_rag.config import RagSettings
from agentflow_rag.health import ReadinessService


def test_default_bundled_policy_path_exists() -> None:
    settings = RagSettings(load_models=False)
    assert settings.bundled_policy_dir.is_dir()
    assert len(list(settings.bundled_policy_dir.rglob("*.md"))) >= 20


def test_health_is_independent_from_readiness(tmp_path) -> None:
    settings = RagSettings(load_models=False, upload_dir=tmp_path / "uploads")
    client = TestClient(create_app(settings=settings, readiness=ReadinessService()))

    assert client.get("/healthz").json() == {"status": "ok"}
    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["checks"] == {"database": False, "models": False, "index": False}


def test_readiness_reports_all_dependencies(tmp_path) -> None:
    async def database_probe() -> bool:
        return True

    readiness = ReadinessService(database_probe)
    readiness.set_models_ready(True)
    readiness.set_index_ready(True)
    settings = RagSettings(load_models=False, upload_dir=tmp_path / "uploads")
    client = TestClient(create_app(settings=settings, readiness=readiness))

    response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_readiness_contains_safe_dependency_diagnostic(tmp_path) -> None:
    async def failing_probe() -> bool:
        raise RuntimeError("database password must not be exposed")

    readiness = ReadinessService(failing_probe)
    settings = RagSettings(load_models=False, upload_dir=tmp_path / "uploads")
    client = TestClient(create_app(settings=settings, readiness=readiness))

    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["details"] == {"database": "RuntimeError"}
    assert "password" not in response.text
