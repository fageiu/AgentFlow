"""创建知识文档与中文词法索引表。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260716_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "knowledge_documents",
        sa.Column("id", sa.String(length=160), primary_key=True),
        sa.Column("policy_id", sa.String(length=100), nullable=False),
        sa.Column("keyword", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("version", sa.String(length=30), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("department", sa.String(length=200), nullable=False),
        sa.Column("source_name", sa.String(length=300), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("checksum", sa.String(length=64), nullable=False),
        sa.Column("index_status", sa.String(length=20), nullable=False),
        sa.Column("node_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text()),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("extra_metadata", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_knowledge_documents_policy_id", "knowledge_documents", ["policy_id"])
    op.create_index("ix_knowledge_documents_keyword", "knowledge_documents", ["keyword"])
    op.create_index("ix_knowledge_documents_status", "knowledge_documents", ["status"])
    op.create_index("ix_knowledge_documents_checksum", "knowledge_documents", ["checksum"])
    op.create_index("ix_knowledge_documents_index_status", "knowledge_documents", ["index_status"])
    op.create_index("ix_knowledge_documents_is_current", "knowledge_documents", ["is_current"])

    op.create_table(
        "knowledge_lexical_nodes",
        sa.Column("node_id", sa.String(length=64), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(length=160),
            sa.ForeignKey("knowledge_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("policy_id", sa.String(length=100), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("lexical_tokens", sa.Text(), nullable=False),
        sa.Column("node_metadata", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.create_index("ix_knowledge_lexical_nodes_document_id", "knowledge_lexical_nodes", ["document_id"])
    op.create_index("ix_knowledge_lexical_nodes_policy_id", "knowledge_lexical_nodes", ["policy_id"])
    op.execute(
        "CREATE INDEX ix_knowledge_lexical_nodes_fts "
        "ON knowledge_lexical_nodes USING GIN (to_tsvector('simple', lexical_tokens))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_knowledge_lexical_nodes_fts")
    op.drop_table("knowledge_lexical_nodes")
    op.drop_table("knowledge_documents")
