"""FastAPI 应用工厂。"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .admin import AdminOperations
from .api import router
from .config import RagSettings, get_settings
from .errors import KnowledgeError, knowledge_error_handler
from .health import ReadinessService
from .logging import configure_logging
from .retrieval import RetrievalService
from .runtime import initialize_runtime

logger = logging.getLogger(__name__)


def create_app(
    settings: RagSettings | None = None,
    readiness: ReadinessService | None = None,
    retrieval: RetrievalService | None = None,
    admin: AdminOperations | None = None,
    bootstrap: bool | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings.log_level)
    resolved_readiness = readiness or ReadinessService()
    should_bootstrap = bootstrap if bootstrap is not None else (
        settings is None and retrieval is None and admin is None
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        resources = None
        if should_bootstrap:
            resources = await initialize_runtime(app, resolved_settings, resolved_readiness)
        try:
            yield
        finally:
            if resources is not None:
                await resources.engine.dispose()

    app = FastAPI(title=resolved_settings.app_name, version="0.1.0", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.readiness = resolved_readiness
    app.state.retrieval = retrieval
    app.state.admin = admin
    app.add_exception_handler(KnowledgeError, knowledge_error_handler)  # type: ignore[arg-type]
    app.include_router(router)

    @app.middleware("http")
    async def request_context(request, call_next):  # type: ignore[no-untyped-def]
        started_at = time.perf_counter()
        request_id = request.headers.get("X-Request-Id") or uuid4().hex
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        logger.info(
            "knowledge_http_request",
            extra={
                "request_id": request_id,
                "run_id": request.headers.get("X-Agent-Run-Id"),
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - started_at) * 1000),
            },
        )
        return response

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
