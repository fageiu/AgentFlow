"""RAG 服务运行配置。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class RagSettings(BaseSettings):
    """集中管理知识服务配置，避免在路由和检索模块读取环境变量。"""

    model_config = SettingsConfigDict(env_prefix="RAG_", env_file=".env", extra="ignore")

    app_name: str = "AgentFlow Policy Knowledge Service"
    environment: str = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql+asyncpg://agentflow:agentflow@127.0.0.1:5432/agentflow_rag"
    admin_token: SecretStr = Field(default=SecretStr("agentflow-local-admin"))
    model_cache_dir: Path = Path(".rag-models")
    upload_dir: Path = Path(".rag-data/uploads")
    bundled_policy_dir: Path = Path(__file__).resolve().parents[2] / "knowledge" / "policies"
    embedding_model: str = "BAAI/bge-m3"
    reranker_model: str = "BAAI/bge-reranker-v2-m3"
    enable_reranker: bool = True
    embedding_dimension: int = 1024
    chunk_size: int = 512
    chunk_overlap: int = 80
    vector_top_k: int = 20
    lexical_top_k: int = 20
    lexical_mode: Literal["postgres", "bm25"] = "bm25"
    rerank_top_n: int = 10
    result_top_k: int = 5
    # 普通融合结果和 CrossEncoder 重排结果使用不同的置信度口径。
    minimum_score: float = 0.35
    minimum_rerank_score: float = 0.35
    minimum_vector_score_without_reranker: float = 0.55
    rrf_k: int = 60
    max_upload_bytes: int = 10 * 1024 * 1024
    load_models: bool = True
    auto_ingest_bundled: bool = True

    @field_validator("chunk_overlap")
    @classmethod
    def validate_overlap(cls, value: int, info):  # type: ignore[no-untyped-def]
        chunk_size = info.data.get("chunk_size", 512)
        if value < 0 or value >= chunk_size:
            raise ValueError("chunk_overlap 必须大于等于 0 且小于 chunk_size")
        return value

    @field_validator(
        "minimum_score",
        "minimum_rerank_score",
        "minimum_vector_score_without_reranker",
    )
    @classmethod
    def validate_score(cls, value: float) -> float:
        if not 0 <= value <= 1:
            raise ValueError("检索分数阈值必须位于 0 到 1 之间")
        return value


@lru_cache(maxsize=1)
def get_settings() -> RagSettings:
    return RagSettings()
