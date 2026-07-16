#!/bin/sh
set -eu

# Compose 已等待数据库健康；迁移成功后才允许模型加载与 bundled 索引初始化。
alembic upgrade head
exec uvicorn agentflow_rag.main:app --host 0.0.0.0 --port 8000
