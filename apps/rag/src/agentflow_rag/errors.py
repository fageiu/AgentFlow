"""知识服务稳定错误模型及 FastAPI 映射。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


@dataclass(slots=True)
class KnowledgeError(Exception):
    code: str
    message: str
    status_code: int = 500
    retryable: bool = False
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        Exception.__init__(self, self.message)


class KnowledgeServiceUnavailableError(KnowledgeError):
    def __init__(self, message: str = "知识服务暂时不可用", **details: Any) -> None:
        super().__init__("KNOWLEDGE_SERVICE_UNAVAILABLE", message, 503, True, details)


class KnowledgeIndexNotReadyError(KnowledgeError):
    def __init__(self, message: str = "知识索引尚未就绪", **details: Any) -> None:
        super().__init__("KNOWLEDGE_INDEX_NOT_READY", message, 503, True, details)


class KnowledgeNoMatchError(KnowledgeError):
    def __init__(self, message: str = "没有检索到可靠的企业政策", **details: Any) -> None:
        super().__init__("KNOWLEDGE_NO_MATCH", message, 404, True, details)


class KnowledgeDocumentInvalidError(KnowledgeError):
    def __init__(self, message: str = "政策文档无效", **details: Any) -> None:
        super().__init__("KNOWLEDGE_DOCUMENT_INVALID", message, 422, False, details)


async def knowledge_error_handler(_request: Request, error: KnowledgeError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={
            "error": {
                "code": error.code,
                "message": error.message,
                "retryable": error.retryable,
                "details": error.details,
            }
        },
    )
