"""FastAPI 应用工厂。"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .admin import AdminOperations
from .api import router
from .config import RagSettings, get_settings
from .errors import KnowledgeError, knowledge_error_handler
from .health import ReadinessService
from .logging import configure_logging
from .retrieval import RetrievalService


def create_app(
    settings: RagSettings | None = None,
    readiness: ReadinessService | None = None,
    retrieval: RetrievalService | None = None,
    admin: AdminOperations | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings.log_level)
    resolved_readiness = readiness or ReadinessService()

    app = FastAPI(title=resolved_settings.app_name, version="0.1.0")
    app.state.settings = resolved_settings
    app.state.readiness = resolved_readiness
    app.state.retrieval = retrieval
    app.state.admin = admin
    app.add_exception_handler(KnowledgeError, knowledge_error_handler)  # type: ignore[arg-type]
    app.include_router(router)

    @app.get("/healthz", tags=["health"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", tags=["health"])
    async def readyz() -> JSONResponse:
        await resolved_readiness.refresh_database()
        state = resolved_readiness.state
        return JSONResponse(
            status_code=200 if state.ready else 503,
            content={
                "status": "ready" if state.ready else "not_ready",
                "checks": {
                    "database": state.database_ready,
                    "models": state.models_ready,
                    "index": state.index_ready,
                },
                "details": state.details,
            },
        )

    return app
