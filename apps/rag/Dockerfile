FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

RUN pip install --no-cache-dir uv==0.8.2
WORKDIR /app

COPY apps/rag/pyproject.toml apps/rag/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY apps/rag/src ./src
RUN uv sync --frozen --no-dev
COPY apps/rag/migrations ./migrations
COPY apps/rag/alembic.ini ./alembic.ini
COPY apps/rag/knowledge ./knowledge
COPY apps/rag/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
