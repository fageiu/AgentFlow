"""知识文档、检索结果和管理接口共享 Schema。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

PolicyStatus = Literal["active", "archived"]
IndexStatus = Literal["pending", "indexing", "indexed", "failed"]


class PolicyMetadata(BaseModel):
    policy_id: str = Field(min_length=3, max_length=100)
    keyword: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=2, max_length=300)
    version: str = Field(pattern=r"^\d+\.\d+$")
    effective_date: date
    status: PolicyStatus
    department: str = Field(min_length=2, max_length=200)


class ParsedPolicyDocument(BaseModel):
    metadata: PolicyMetadata
    source_name: str
    checksum: str
    pages: list[PolicyPage]


class PolicyPage(BaseModel):
    text: str = Field(min_length=1)
    page: int | None = None


class DocumentSummary(BaseModel):
    id: str
    metadata: PolicyMetadata
    source_name: str
    checksum: str
    index_status: IndexStatus
    node_count: int = 0
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


class PolicyCitation(BaseModel):
    document_id: str
    node_id: str
    source_name: str
    version: str
    section: str | None = None
    page: int | None = None


class PolicyKnowledgeMatch(BaseModel):
    policy_id: str
    keyword: str
    title: str
    content: str
    snippet: str | None = None
    ranking_stage: Literal["reranker", "fast_semantic", "fusion_coverage"] = (
        "fusion_coverage"
    )
    score: float
    vector_score: float | None = None
    lexical_score: float | None = None
    fusion_score: float | None = None
    rerank_score: float | None = None
    citation: PolicyCitation


class RetrievalCandidateTrace(BaseModel):
    """记录候选在融合或重排阶段的真实位置与分数，供离线评测比较。"""

    rank: int = Field(ge=1)
    policy_id: str
    document_id: str
    node_id: str
    vector_score: float | None = None
    lexical_score: float | None = None
    fusion_score: float | None = None
    rerank_score: float | None = None


class KnowledgeRetrievalMetrics(BaseModel):
    vector_candidates: int
    lexical_candidates: int
    reranked_candidates: int
    duration_ms: int
    reranker_applied: bool = False
    fusion_ranking: list[RetrievalCandidateTrace] = Field(default_factory=list)
    reranked_ranking: list[RetrievalCandidateTrace] = Field(default_factory=list)


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    keyword_hint: str | None = Field(default=None, max_length=100)
    top_k: int = Field(default=5, ge=1, le=10)
    include_archived: bool = False
    include_diagnostics: bool = False


class SearchResponse(BaseModel):
    matches: list[PolicyKnowledgeMatch]
    retrieval: KnowledgeRetrievalMetrics
