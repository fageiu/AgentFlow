"""知识检索与文档管理 HTTP API。"""

from __future__ import annotations

import logging
from datetime import date
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile

from .admin import AdminOperations, verify_admin_token
from .errors import KnowledgeIndexNotReadyError
from .retrieval import RetrievalService
from .schemas import PolicyMetadata, SearchRequest, SearchResponse

router = APIRouter(prefix="/v1")
logger = logging.getLogger(__name__)


def _retrieval(request: Request) -> RetrievalService:
    service = getattr(request.app.state, "retrieval", None)
    if service is None:
        raise KnowledgeIndexNotReadyError()
    return service


def _admin(request: Request) -> AdminOperations:
    service = getattr(request.app.state, "admin", None)
    if service is None:
        raise KnowledgeIndexNotReadyError("知识管理服务尚未就绪")
    return service


def _require_admin(request: Request, token: str | None) -> None:
    expected = request.app.state.settings.admin_token.get_secret_value()
    if not verify_admin_token(token, expected):
        raise HTTPException(status_code=401, detail="管理 Token 无效")


@router.post("/search", response_model=SearchResponse, tags=["search"])
async def search_policy(payload: SearchRequest, request: Request) -> SearchResponse:
    result = await _retrieval(request).search(payload)
    logger.info(
        "policy_search_completed",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "run_id": request.headers.get("X-Agent-Run-Id"),
            "document_ids": list(dict.fromkeys(item.citation.document_id for item in result.matches)),
            "node_ids": [item.citation.node_id for item in result.matches],
            "duration_ms": result.retrieval.duration_ms,
        },
    )
    return result


@router.get("/admin/documents", tags=["admin"])
async def list_documents(
    request: Request, x_admin_token: str | None = Header(default=None)
):
    _require_admin(request, x_admin_token)
    return await _admin(request).list_documents()


@router.post("/admin/documents", tags=["admin"])
async def upload_document(
    request: Request,
    file: Annotated[UploadFile, File()],
    policy_id: Annotated[str | None, Form()] = None,
    keyword: Annotated[str | None, Form()] = None,
    title: Annotated[str | None, Form()] = None,
    version: Annotated[str | None, Form()] = None,
    effective_date: Annotated[date | None, Form()] = None,
    status: Annotated[str | None, Form()] = None,
    department: Annotated[str | None, Form()] = None,
    x_admin_token: str | None = Header(default=None),
):
    _require_admin(request, x_admin_token)
    metadata = None
    if (file.filename or "").lower().endswith(".pdf"):
        metadata = PolicyMetadata(
            policy_id=policy_id,
            keyword=keyword,
            title=title,
            version=version,
            effective_date=effective_date,
            status=status,
            department=department,
        )
    content = await file.read()
    result = await _admin(request).upload(file.filename or "upload", content, metadata)
    logger.info(
        "policy_document_uploaded",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "document_id": result.document_id,
            "node_count": result.node_count,
        },
    )
    return result


@router.post("/admin/documents/{document_id}/reindex", tags=["admin"])
async def reindex_document(
    document_id: str, request: Request, x_admin_token: str | None = Header(default=None)
):
    _require_admin(request, x_admin_token)
    result = await _admin(request).reindex(document_id)
    logger.info(
        "policy_document_reindexed",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "document_id": result.document_id,
            "node_count": result.node_count,
        },
    )
    return result


@router.delete("/admin/documents/{document_id}", tags=["admin"])
async def delete_document(
    document_id: str, request: Request, x_admin_token: str | None = Header(default=None)
):
    _require_admin(request, x_admin_token)
    deleted = await _admin(request).delete(document_id)
    logger.info(
        "policy_document_deleted",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "document_id": document_id,
            "status": "deleted" if deleted else "not_found",
        },
    )
    return {"deleted": deleted}


@router.post("/admin/reindex-bundled", tags=["admin"])
async def reindex_bundled(
    request: Request, x_admin_token: str | None = Header(default=None)
):
    _require_admin(request, x_admin_token)
    results = await _admin(request).reindex_bundled()
    logger.info(
        "bundled_policy_reindex_requested",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "document_count": len(results),
            "node_count": sum(item.node_count for item in results),
        },
    )
    return {"results": results}
