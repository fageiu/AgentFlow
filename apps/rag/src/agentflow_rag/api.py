"""知识检索与文档管理 HTTP API。"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile

from .admin import AdminOperations, verify_admin_token
from .errors import KnowledgeIndexNotReadyError
from .retrieval import RetrievalService
from .schemas import PolicyMetadata, SearchRequest, SearchResponse

router = APIRouter(prefix="/v1")


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
    return await _retrieval(request).search(payload)


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
    return await _admin(request).upload(file.filename or "upload", content, metadata)


@router.post("/admin/documents/{document_id}/reindex", tags=["admin"])
async def reindex_document(
    document_id: str, request: Request, x_admin_token: str | None = Header(default=None)
):
    _require_admin(request, x_admin_token)
    return await _admin(request).reindex(document_id)


@router.delete("/admin/documents/{document_id}", tags=["admin"])
async def delete_document(
    document_id: str, request: Request, x_admin_token: str | None = Header(default=None)
):
    _require_admin(request, x_admin_token)
    return {"deleted": await _admin(request).delete(document_id)}


@router.post("/admin/reindex-bundled", tags=["admin"])
async def reindex_bundled(
    request: Request, x_admin_token: str | None = Header(default=None)
):
    _require_admin(request, x_admin_token)
    return {"results": await _admin(request).reindex_bundled()}
