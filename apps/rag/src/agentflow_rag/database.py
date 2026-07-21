"""PostgreSQL 连接、文档元数据和中文词法 Node 模型。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class KnowledgeDocumentModel(Base):
    """文档元数据表"""
    __tablename__ = "knowledge_documents"

    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    policy_id: Mapped[str] = mapped_column(String(100), index=True)
    keyword: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[str] = mapped_column(String(300))
    version: Mapped[str] = mapped_column(String(30))
    effective_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), index=True)
    department: Mapped[str] = mapped_column(String(200))
    source_name: Mapped[str] = mapped_column(String(300))
    source_path: Mapped[str] = mapped_column(Text)
    checksum: Mapped[str] = mapped_column(String(64), index=True)
    index_status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    node_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    extra_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class KnowledgeLexicalNodeModel(Base):
    """中文词法索引表, 一个node一条记录"""
    __tablename__ = "knowledge_lexical_nodes"

    node_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        String(160), ForeignKey("knowledge_documents.id", ondelete="CASCADE"), index=True
    )
    policy_id: Mapped[str] = mapped_column(String(100), index=True)
    content: Mapped[str] = mapped_column(Text)
    lexical_tokens: Mapped[str] = mapped_column(Text)
    node_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


def create_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, pool_pre_ping=True)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker:
    return async_sessionmaker(engine, expire_on_commit=False)


def create_database_probe(engine: AsyncEngine):  # type: ignore[no-untyped-def]
    async def probe() -> bool:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True

    return probe
