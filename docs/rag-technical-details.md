# AgentFlow RAG 知识服务 — 技术文档与面试准备

> 本文档聚焦于 AgentFlow 项目中 **Python RAG 知识服务**（`apps/rag/`）的技术实现细节、架构设计决策和面试准备。
> 相关源码路径：`apps/rag/src/agentflow_rag/`
>
> 阅读本文前建议先通读 [architecture.md](architecture.md) 了解整体项目架构。

---

## 目录

1. [服务定位与架构概览](#1-服务定位与架构概览)
2. [技术栈](#2-技术栈)
3. [项目结构速览](#3-项目结构速览)
4. [配置系统](#4-配置系统)
5. [数据模型与数据库设计](#5-数据模型与数据库设计)
6. [文档解析与预处理](#6-文档解析与预处理)
7. [索引管线详解](#7-索引管线详解)
8. [混合检索流水线（核心）](#8-混合检索流水线核心)
9. [BM25 关键词检索实现](#9-bm25-关键词检索实现)
10. [错误模型与服务韧性](#10-错误模型与服务韧性)
11. [评测系统](#11-评测系统)
12. [启动与依赖装配](#12-启动与依赖装配)
13. [REST API 契约](#13-rest-api-契约)
14. [面试高频问题与答题策略](#14-面试高频问题与答题策略)
15. [简历项目描述建议](#15-简历项目描述建议)

---

## 1. 服务定位与架构概览

### 1.1 定位

AgentFlow RAG 服务是一个**独立部署的 Python FastAPI 服务**，负责企业政策知识库的文档管理、索引构建和混合检索。

它与 TypeScript Agent 服务通过 HTTP 解耦：

```
Agent Executor → searchPolicy 工具 → HTTP POST /v1/search → RAG 服务
```

进入 RAG 前，`apps/server/src/agent/policyQuery.ts` 会把单工单任务改写成独立、可读的政策问题。
工单标题和描述用于提取业务意图；工单 ID、客户/订单 ID、状态、优先级以及序列化 JSON
只保留在 Trace 和业务上下文中，不参与向量或词法相关性计算。模型已提供明确自然语言问题时
保留原问题；只有泛化指令或序列化上下文才触发确定性改写。

### 1.2 为什么独立成服务而不是内嵌

| 考量 | 说明 |
|------|------|
| **模型资源隔离** | bge-m3 + bge-reranker-v2-m3 需要 GPU/显存，不干扰 Agent 业务进程 |
| **语言栈匹配** | Python 生态的 LlamaIndex、HuggingFace Transformers、jieba 分词远超 Node.js |
| **独立扩缩容** | RAG 可单独水平扩展，与 Agent 进程解耦 |
| **独立健康检查** | `healthz/readyz` 端点不干扰 Agent 服务 |

### 1.3 模块关系（RAG 内部）

```
FastAPI App (app.py)
  │
  ├─ /v1/search → RetrievalService.search()
  │     ├─ PolicyHybridRetriever (向量 + 词法 + RRF 融合)
  │     │     ├─ LlamaIndexVectorSource (bge-m3 → PGVectorStore)
  │     │     └─ PostgresLexicalSource (jieba → PG FTS) 或 LlamaIndexBM25Source
  │     └─ CandidateReranker (bge-reranker-v2-m3 / FastFusionReranker)
  │
  ├─ /admin/* → KnowledgeAdminService
  │     └─ IngestionService → build_policy_nodes → PostgresNodeStore
  │
  ├─ /healthz → {"status": "ok"}
  └─ /readyz → readiness checks (database / models / index)
```

---

## 2. 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| **框架** | FastAPI + uvicorn | HTTP API 服务 |
| **ORM** | SQLAlchemy (async) + Alembic | 数据库管理与迁移 |
| **向量数据库** | PostgreSQL + pgvector | 向量存储与相似度搜索 |
| **向量模型** | BAAI/bge-m3 (1024 维) | 文本 embedding |
| **重排序模型** | BAAI/bge-reranker-v2-m3 | cross-encoder 精排 |
| **检索框架** | LlamaIndex | 向量检索、文档分块、Node 管理 |
| **中文分词** | jieba | 中文分词用于 BM25/全文搜索 |
| **全文搜索** | PostgreSQL tsvector / LlamaIndex BM25 | 词法检索 |
| **文档解析** | PyMuPDF (fitz) | PDF 文本提取 |
| **序列化** | Pydantic v2 | Schema 校验与序列化 |
| **配置** | Pydantic Settings | 环境变量管理 |

---

## 3. 项目结构速览

```
apps/rag/
├── src/agentflow_rag/
│   ├── main.py              # 进程入口（uvicorn.run）
│   ├── app.py               # FastAPI 应用工厂 + 中间件
│   ├── api.py               # HTTP 路由（/v1/search + admin CRUD）
│   ├── config.py            # Pydantic 配置（RagSettings）
│   ├── runtime.py           # 依赖装配与启动初始化（关键函数 initialize_runtime）
│   ├── database.py          # SQLAlchemy ORM 模型
│   ├── schemas.py           # Pydantic 请求/响应 Schema
│   ├── retrieval.py         # 混合检索 + RRF 融合 + 重排序（核心文件）
│   ├── ingestion.py         # 索引编排与幂等版本切换
│   ├── stores.py            # PostgreSQL 文档仓库 + 向量/词法 Node 写入
│   ├── nodes.py             # LlamaIndex Document → Node 转换（分块+稳定 ID）
│   ├── documents.py         # Markdown/PDF 解析 + 校验
│   ├── admin.py             # 管理服务（上传/删除/重新索引）
│   ├── errors.py            # 稳定错误模型 + FastAPI 异常处理器
│   ├── health.py            # Readiness 探针
│   └── evaluation.py        # 检索质量评测（Recall/MRR 等）
├── knowledge/
│   ├── policies/            # 内置语料（23 篇 Markdown）
│   └── evaluation/          # Golden Queries 评测集
├── migrations/              # Alembic 迁移
├── tests/                   # pytest 测试套件
├── Dockerfile
└── pyproject.toml
```

---

## 4. 配置系统

统一通过 `RagSettings`（Pydantic Settings）管理，所有环境变量加 `RAG_` 前缀：

```python
class RagSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RAG_", env_file=".env", extra="ignore")
```

### 关键配置项

| 配置项 | 默认值 | 含义 |
|--------|--------|------|
| `embedding_model` | `BAAI/bge-m3` | 向量模型，1024 维 |
| `reranker_model` | `BAAI/bge-reranker-v2-m3` | 重排序模型 |
| `lexical_mode` | `"bm25"` | 词法检索模式：`bm25`（内存 BM25，默认）或 `postgres`（PostgreSQL 全文搜索基线） |
| `chunk_size` | 512 | 单个章节二次切分的 token 硬上限 |
| `chunk_overlap` | 80 | 仅超长章节二次切分时使用的 token 重叠 |
| `vector_top_k` | 20 | 向量检索候选数 |
| `lexical_top_k` | 20 | 词法检索候选数 |
| `rerank_top_n` | 10 | 重排序保留数 |
| `result_top_k` | 5 | 最终返回 Top-K |
| `minimum_score` | 0.35 | 结果得分阈值 |
| `minimum_rerank_score` | 0.0 | 重排序后最低得分 |
| `rrf_k` | 60 | RRF 融合参数 |
| `enable_reranker` | true | 是否启用 cross-encoder 重排序 |
| `auto_ingest_bundled` | true | 启动时自动索引内置语料 |
| `load_models` | true | 是否加载模型（设为 false 则只做数据库操作） |

### Pydantic 校验

```python
@field_validator("chunk_overlap")
def validate_overlap(cls, value, info):
    chunk_size = info.data.get("chunk_size", 512)
    if value < 0 or value >= chunk_size:
        raise ValueError("chunk_overlap 必须大于等于 0 且小于 chunk_size")

@field_validator("minimum_score")
def validate_score(cls, value):
    if not 0 <= value <= 1:
        raise ValueError("minimum_score 必须位于 0 到 1 之间")
```

---

## 5. 数据模型与数据库设计

### 5.1 三张表的分工

| 表名 | 管理方式 | 存储内容 | 用途 |
|------|----------|----------|------|
| `policy_nodes` | PGVectorStore（自动建表） | 向量 embedding + node text + JSON metadata | **向量检索** |
| `knowledge_documents` | SQLAlchemy ORM | 文档元数据（policy_id、版本、状态、checksum 等） | **文档生命周期管理** |
| `knowledge_lexical_nodes` | SQLAlchemy ORM | 分词文本 + jieba 词法 tokens + GIN 全文索引 | **词法/BM25 检索** |

### 5.2 knowledge_documents 表

```python
class KnowledgeDocumentModel(Base):
    __tablename__ = "knowledge_documents"

    id: str              # "{policy_id}:{version}:{checksum[:12]}" 复合主键，稳定可追溯
    policy_id: str       # 政策 ID（如 "P-refund-001"），索引
    keyword: str         # 政策关键词（如 "refund"），索引
    version: str         # 语义版本号（如 "2.0"）
    effective_date: date # 生效日期，用于版本切换
    status: str          # "active" | "archived"，索引
    checksum: str        # 内容 + 元数据 SHA256，用于幂等判断，索引
    index_status: str    # "pending" | "indexing" | "indexed" | "failed"，索引
    is_current: bool     # 是否当前生效版本，索引（关键字段）
    source_path: str     # 源文件路径
    node_count: int      # 索引后的 Node 数量
```

**版本切换逻辑**（`stores.py` 中 `complete_index()`）：
1. 先将同 policy_id 的所有文档设 `is_current=False`
2. 再 SQL 查询选出 `status="active" AND index_status="indexed"` 中 `effective_date DESC, version DESC, updated_at DESC` 的第一条
3. 将其设为 `is_current=True`

### 5.3 knowledge_lexical_nodes 表

```python
class KnowledgeLexicalNodeModel(Base):
    __tablename__ = "knowledge_lexical_nodes"

    node_id: str         # SHA256 稳定 ID（主键）
    document_id: str     # 外键 → knowledge_documents.id（CASCADE 删除）
    policy_id: str       # 索引
    content: str         # 节点原文
    lexical_tokens: str  # jieba 分词结果（空格连接）
    node_metadata: JSON  # 完整元数据（含 policy_id、keyword、source_name 等）
```

**关键索引**：GIN 索引 `to_tsvector('simple', lexical_tokens)` 用于 PostgreSQL 全文搜索。

### 5.4 id 设计原则

| ID 字段 | 生成方式 | 特性 |
|---------|----------|------|
| `document.id` | `{policy_id}:{version}:{checksum[:12]}` | 同一内容产生相同 ID，幂等更新 |
| `node.id` | `SHA256({document_id}:{ordinal}:{node.text})` | 稳定 Node ID，重复索引不产生重复 |

**幂等性三层保障**：
1. `(policy_id, version)` 确定文档线
2. `checksum` 变化才重新索引
3. 稳定 ID 确保重复写入幂等

---

## 6. 文档解析与预处理

### 6.1 Markdown 解析（`parse_markdown`）

```python
FRONTMATTER_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)
```

政策 Markdown 文件必须包含 **YAML frontmatter**，示例：

```markdown
---
policy_id: P-refund-001
keyword: refund
title: VIP 客户退款规则
version: 2.0
effective_date: 2026-06-01
status: active
department: 客户服务部
---

VIP 客户在订单完成 30 天内可进入快速退款审批...
```

**校验规则：**
- frontmatter 必须存在 → 否则抛 `KnowledgeDocumentInvalidError`
- frontmatter 通过 `PolicyMetadata` Pydantic 校验（`policy_id ≥ 3 字符`、`version` 正则 `^\d+\.\d+$` 等）
- 正文长度 ≥ 80 字符 → 防止空内容

### 6.2 PDF 解析（`parse_pdf`）

```python
pdf = fitz.open(stream=raw, filetype="pdf")
for index, page in enumerate(pdf, start=1):
    text = page.get_text("text").strip()
    if text:
        pages.append(PolicyPage(text=text, page=index))
```

- 每页提取纯文本，保留页码
- 上传 PDF **必须**提供元数据 `PolicyMetadata`（因其不含 frontmatter）
- **不支持扫描件 OCR** → 纯图片 PDF 会被拒绝

### 6.3 校验和

```python
def content_checksum(content: bytes, metadata: PolicyMetadata) -> str:
    digest = hashlib.sha256()
    digest.update(content)
    digest.update(metadata.model_dump_json().encode("utf-8"))
    return digest.hexdigest()
```

校验和同时包含文件内容 + 元数据，用于幂等判断。

---

## 7. 索引管线详解

### 7.1 整体流程

```
ingest_file(path)
  │
  ├─ ① parse_policy_file() → 解析文档（Markdown/PDF）
  │
  ├─ ② 幂等检查：同一 (policy_id, version) 且索引指纹不变且已 indexed
  │     → 直接返回 "unchanged"（但仍重新校准 is_current 指针）
  │
  ├─ ③ repository.begin_index() → 写库 status="indexing"
  │
  ├─ ④ build_policy_nodes() → 结构感知的自适应分块
  │     ├─ Markdown 标题与 PDF 页面作为强边界
  │     ├─ 短章节保持完整；超长章节才使用 SentenceSplitter(512/80)
  │     └─ 每个 Node 保存 heading_path、parent_id、稳定 SHA256 ID
  │
  ├─ ⑤ 显式生成向量 embedding
  │     ├─ 关键：PGVectorStore 只负责持久化，不负责算向量
  │     ├─ aget_text_embedding_batch(texts) → 批量推理
  │     └─ node.embedding = embedding
  │
  ├─ ⑥ node_store.add() → 双写入
  │     ├─ PGVectorStore.async_add(nodes) → 向量表
  │     └─ INSERT knowledge_lexical_nodes → 词法表（jieba 分词）
  │
  ├─ ⑦ repository.complete_index() → status="indexed"
  │     └─ 自动切换 is_current 为最新生效版本
  │
  ├─ ⑧ 清理旧版本（如果 checksum 变化导致 document_id 不同）
  │
  └─ ⑨ 异常回滚
        └─ node_store.delete_document() + repository.fail_index()
```

### 7.2 Node 构建（`build_policy_nodes`）

```python
def build_policy_nodes(document, *, chunk_size=512, chunk_overlap=80):
    # 1. 每页先按 Markdown 标题建立强章节边界
    llama_documents = []
    for page in document.pages:
        for section in _split_markdown_sections(page.text):
            metadata = {
                **document.metadata,
                "document_id": ref_doc_id,
                "section": section.section,
                "heading_path": section.heading_path,
                "parent_id": stable_parent_id,
            }
            llama_documents.append(Document(text=section.text, metadata=metadata))

    # 2. 只有超过硬上限的章节才会被递归拆分
    splitter = SentenceSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    nodes = splitter.get_nodes_from_documents(llama_documents)

    # 3. 分配稳定 Node ID
    for ordinal, node in enumerate(nodes):
        node.metadata["ordinal"] = ordinal
        node.id_ = hashlib.sha256(f"{ref_doc_id}:{ordinal}:{node.text}".encode()).hexdigest()
    return nodes
```

索引使用 `source_checksum + chunking_strategy + chunk_size + chunk_overlap` 生成指纹。源文件
没有变化但切块策略或参数发生变化时，会生成新文档行和新 Node，并在成功后原子切换
`is_current`；相同策略的后续启动仍保持 `unchanged`。

检索响应同时返回完整 `content` 和 Query 相关的 `snippet`：前者用于 Trace 与 Citation 审计，
后者用于最终业务结论，避免把整个检索节点直接回显给用户。

每条 Match 还返回 `ranking_stage`，用于解释顶层 `score` 的来源：

- `reranker`：Cross-encoder 选择主证据时的重排分；
- `fast_semantic`：未启用 Reranker 时，向量分为主、融合分为辅的在线主排分；
- `fusion_coverage`：为 Top 2–5 保留跨政策覆盖时使用的 RRF 融合分。

不同 `ranking_stage` 的 `score` 不可直接横向比较。前端卡片必须同时展示阶段标签；Vector、
Lexical、Fusion 和 Rerank 原始分只在调试表中并列展示。缺少该字段的旧 Trace 标记为
“历史综合分”，禁止推断为当前任一评分阶段。

### 7.3 向量写入（`PostgresNodeStore.add`）

```python
async def add(self, document_id, nodes):
    # 第 1 步：写入 PGVectorStore（自动生成向量索引条目）
    await self.vector_store.async_add(list(nodes))
    try:
        # 第 2 步：写入词法表（jieba 分词）
        async with self.sessions.begin() as session:
            for node in nodes:
                session.add(KnowledgeLexicalNodeModel(
                    node_id=node.node_id,
                    document_id=document_id,
                    content=node.text,
                    lexical_tokens=" ".join(jieba.cut_for_search(node.text)),
                    node_metadata=node.metadata,
                ))
    except Exception:
        # 回滚：词法写入失败时，删除已写入向量
        await self.vector_store.adelete(document_id)
        raise
```

**事务语义**：词法写入失败时回滚向量写入，保证两库一致。

---

## 8. 混合检索流水线（核心）

### 8.1 四阶段管线

```
用户查询 "VIP退款需要审批吗" + keyword_hint="refund"
  │
  ├─ 阶段① 向量检索（bge-m3 → PGVectorStore）
  │     └─ 语义匹配，Top-20
  │
  ├─ 阶段② 词法检索（jieba → PostgreSQL tsvector（或 BM25））
  │     └─ 关键词匹配，Top-20
  │
  ├─ 阶段③ RRF 融合（Reciprocal Rank Fusion）
  │     └─ 合并排序 + keyword_hint 加分，保留融合前各阶段得分
  │
  ├─ 阶段④ Cross-encoder 重排序（bge-reranker-v2-m3）
  │     └─ 逐对打分 → sigmoid 归一化
  │
  ├─ 阶段⑤ 阈值过滤（≥ minimum_score）+ Top-K 截断
  │
  └─ 阶段⑥ 结果映射 → PolicyKnowledgeMatch[] + KnowledgeRetrievalMetrics
```

### 8.2 阶段①：向量检索

```python
class LlamaIndexVectorSource:
    def __init__(self, vector_store, embed_model, sessions=None):
        self.index = VectorStoreIndex.from_vector_store(vector_store, embed_model=embed_model)

    async def retrieve(self, query, top_k, *, include_archived=False):
        retriever = self.index.as_retriever(similarity_top_k=top_k)
        candidates = await retriever.aretrieve(query)
        # 默认过滤：只返回 is_current=True 且 status="active" 的文档
        if include_archived:
            return candidates
        # 异步查询当前 active 文档 ID 集合
        async with self.sessions() as session:
            current_ids = set( ... WHERE status="active"
                              AND index_status="indexed"
                              AND is_current=true )
        return [c for c in candidates if c.node.metadata["document_id"] in current_ids]
```

**bge-m3** 对查询编码 → PGVectorStore 的 IVFFlat/HNSW 近似最近邻搜索 → 语义相似的 Top-20。

**文档过滤**在检索之后做（而非 SQL 中），配合 `sessions` 做异步查询。

### 8.3 阶段②：词法检索 — PostgreSQL 全文搜索模式

```python
class PostgresLexicalSource:
    async def retrieve(self, query, top_k, *, include_archived=False):
        # 中文分词后使用 OR 组合，避免长句按全词 AND 查询造成零召回。
        ts_query = func.websearch_to_tsquery(
            "simple", build_lexical_websearch_query(query)
        )
        rank = func.ts_rank_cd(
            func.to_tsvector("simple", KnowledgeLexicalNodeModel.lexical_tokens),
            ts_query
        )
        statement = (
            select(KnowledgeLexicalNodeModel, rank)
            .join(KnowledgeDocumentModel, ...)
            .where(文档 active / indexed / is_current)
            .where(to_tsvector("simple", lexical_tokens).op("@@")(ts_query))
            .order_by(rank.desc())
            .limit(top_k)
        )
```

**优点**：
- 使用 PostgreSQL 内置全文搜索 → 无需额外微服务
- GIN 索引 → 适合作为数据库内词法检索基线
- `websearch_to_tsquery` + OR 分词表达式 → 降低中文长句全词匹配导致的零召回风险
- `ts_rank_cd` → 使用覆盖密度对命中结果排序

**中文处理**：jieba 分好的词存入 `lexical_tokens`，PG 用 `simple` 词典（不做额外词形变化）直接匹配。

### 8.4 阶段③：RRF 融合

```python
def reciprocal_rank_fusion(vector, lexical, rrf_k=60, keyword_hint=None):
    by_id = {}      # 去重：按 node_id 合并向量和词法候选
    scores = {}
    maximum = 2 / (rrf_k + 1)  # 理论最高分（两个来源都排第 1）

    for candidates in (vector, lexical):
        for rank, candidate in enumerate(candidates, start=1):
            node_id = candidate.node.node_id
            by_id.setdefault(node_id, candidate)
            scores[node_id] = scores.get(node_id, 0) + 1 / (rrf_k + rank)
            # 保留各阶段原始得分到 metadata，供诊断和评测
            score_key = "vector_score" if candidates is vector else "lexical_score"
            by_id[node_id].node.metadata[score_key] = candidate.score

    for node_id, raw_score in scores.items():
        candidate = by_id[node_id]
        normalized = raw_score / maximum   # 归一化到 [0, 1]
        if keyword_hint and candidate.node.metadata.get("keyword") == keyword_hint:
            normalized = min(1.0, normalized + 0.05)  # keyword 命中加分
        candidate.node.metadata["fusion_score"] = normalized
        result.append(NodeWithScore(node=candidate.node, score=normalized))

    return sorted(result, key=lambda item: item.score or 0, reverse=True)
```

**RRF 公式**：`score(d) = Σ 1/(k + rank_i(d))`，其中 `rank_i` 是文档 d 在第 i 个检索系统中的排名。

**设计要点**：

| 特性 | 说明 |
|------|------|
| **不需要分数归一化** | RRF 基于排名而非分数，向量余弦相似度和 BM25 分数尺度不同也能直接融合 |
| **去重合并** | 两路候选按 `node_id` 合并，同时存在于两路中的文档得分更高 |
| **keyword_hint 弱信号** | `+0.05` 加成（上限 1.0），提升命中文档排序但不做硬过滤 |
| **保留各阶段得分** | `vector_score`、`lexical_score`、`fusion_score` 写入 metadata，供 TypeScript 端诊断 |

### 8.5 阶段④：Cross-encoder 重排序

```python
class LlamaIndexSentenceReranker:
    def load(self, top_n=10):
        if self._postprocessor is None:
            self._postprocessor = SentenceTransformerRerank(model=self.model_name, top_n=top_n)

    async def rerank(self, query, candidates, top_n):
        self.load(top_n)  # 首次加载后缓存
        return await self._postprocessor.apostprocess_nodes(list(candidates), query_str=query)
```

**分数归一化**：

```python
def normalize_rerank_score(score):
    if score is None: return 0
    if 0 <= score <= 1: return score       # 已经是概率输出
    return 1 / (1 + math.exp(-clamp(x, -30, 30)))  # sigmoid 钳制，防止溢出
```

**bi-encoder vs cross-encoder**：

| | bi-encoder（bge-m3） | cross-encoder（bge-reranker-v2-m3） |
|---|---|---|
| 编码方式 | 查询和文档分别编码 → 余弦相似度 | 查询+文档拼接 → 逐 token 交互 |
| 精度 | 中 | 高 |
| 速度 | 快（可预计算文档向量） | 慢（不能预计算，需逐对推理） |
| 用途 | 粗筛（20 个候选） | 精排（10 个候选） |

### 8.6 阶段⑤⑥：过滤 + 映射

```python
matches = [self._to_match(candidate) for candidate in reranked]
matches = [m for m in matches if m.score >= self.minimum_score][:request.top_k]

if not matches:
    raise KnowledgeNoMatchError(...)   # 空结果不返回，直接抛异常

return SearchResponse(
    matches=matches,
    retrieval=KnowledgeRetrievalMetrics(
        vector_candidates=...,
        lexical_candidates=...,
        reranked_candidates=...,
        duration_ms=...,
    ),
)
```

**空结果处理**：低于阈值时抛 `KnowledgeNoMatchError（404）`，而不是返回空列表让调用方做错误判断。TypeScript 端将 404 映射为 `KNOWLEDGE_NO_MATCH`，Executor 标记为可重试。

---

## 9. BM25 关键词检索实现

### 9.1 定位

BM25 是词法检索的一种实现方式，作为 PostgreSQL `tsvector` 全文搜索的替代方案（通过 `lexical_mode` 配置切换）。

### 9.2 实现

```python
class LlamaIndexBM25Source:
    """使用 LlamaIndex BM25Retriever 实现关键词检索。"""

    def __init__(self, sessions, similarity_top_k=20):
        self.sessions = sessions
        self.similarity_top_k = similarity_top_k
        self._retriever = None

    def _build_retriever(self):
        # 从数据库加载所有 active 文档的文本
        # 用 jieba 分词后构建 BM25 倒排索引
        ...

    async def refresh(self):
        # 在 BM25 模式下，启动时或文档变更后显式刷新倒排索引
        await asyncio.to_thread(self._build_retriever)

    async def retrieve(self, query, top_k, *, include_archived=False):
        if self._retriever is None:
            await self.refresh()
        # jieba 分词后检索
        tokens = " ".join(jieba.cut_for_search(query))
        return await self._retriever.aretrieve(tokens)
```

### 9.3 BM25 vs PostgreSQL tsvector

| 对比维度 | PostgreSQL tsvector（基线/回滚） | BM25（LlamaIndex，默认） |
|----------|---------------------------------|--------------------------|
| **存储位置** | 数据库 `lexical_tokens` 列 | 内存中构建倒排索引 |
| **启动加载** | 无需加载，SQL 直接查询 | 需从 DB 读取所有文档构建索引 |
| **实时性** | 事务提交后直接查询 | 文档变更成功后原子 `refresh()` 快照 |
| **文档量大时** | 稳定，GIN 索引性能好 | 全量在内存，受内存限制 |
| **依赖** | PostgreSQL 内置 | jieba + LlamaIndex |
| **与 TypeScript 端匹配度** | vector_score + lexical_score 双列 | 同一分数字段 |

**默认选择**：`lexical_mode=bm25`。当前政策语料规模适中，内存索引和刷新成本可控；
在现有 50 条 Golden Query 的 Fast/CPU 热态评测中，BM25 混合检索达到 Recall@5 100%、
MRR 0.841、无答案拒答准确率 100%，因此作为已经通过验收的默认实现。

`lexical_mode=postgres` 保留为同语料 A/B 基线和故障回滚路径。它不依赖进程内快照，
在多副本、高频文档更新或语料显著增长时具有更简单的数据一致性与运维边界；在没有
同版本、同语料直接对照评测前，不将两种方案的算法优劣写成确定结论。

### 9.4 两种模式的使用边界

- **优先 BM25**：单 RAG 服务或副本较少、文档量适中、政策编号和专业术语精确匹配重要
- **考虑 PostgreSQL**：多副本、高频更新、内存快照成本升高，或需要数据库作为唯一实时索引来源
- **切换原则**：固定语料、阈值和 50 条查询，对比 Recall@5、MRR、拒答准确率、P95、错误数与更新一致性
- **保留回滚**：默认模式切换不删除 `PostgresLexicalSource`，确保 BM25 初始化或刷新异常时可快速恢复

### 9.5 BM25 模式的索引更新时机

`runtime.py` 中：

```python
if settings.auto_ingest_bundled:
    results = await admin.reindex_bundled()     # 自动索引内置语料
    # 注：BM25 模式在 admin.reindex_bundled() 中通过 lexical_index 参数
    # 将新文档对应的 Node 加入 BM25 倒排索引
elif isinstance(lexical_source, LlamaIndexBM25Source):
    await lexical_source.refresh()               # 禁用 auto_ingest 时显式刷新
```

---

## 10. 错误模型与服务韧性

### 10.1 错误分类

```python
@dataclass(slots=True)
class KnowledgeError(Exception):
    code: str
    message: str
    status_code: int = 500
    retryable: bool = False
    details: dict[str, Any]
```

| Python 异常 | code | status | retryable | 含义 |
|---|---|---|---|---|
| `KnowledgeServiceUnavailableError` | `KNOWLEDGE_SERVICE_UNAVAILABLE` | 503 | true | 服务不可达 |
| `KnowledgeIndexNotReadyError` | `KNOWLEDGE_INDEX_NOT_READY` | 503 | true | 索引未就绪 |
| `KnowledgeNoMatchError` | `KNOWLEDGE_NO_MATCH` | 404 | true | 低于阈值无匹配 |
| `KnowledgeDocumentInvalidError` | `KNOWLEDGE_DOCUMENT_INVALID` | 422 | false | 文档/响应不符合契约 |

### 10.2 与 TypeScript 端错误映射

```
Python FastAPI → JSON 序列化
{
  "error": {
    "code": "KNOWLEDGE_NO_MATCH",
    "message": "...",
    "retryable": true,
    "details": {...}
  }
}
```
```
TypeScript ragClient.ts → mapRemoteCode()
status=404 → KNOWLEDGE_NO_MATCH
status=503 + code 含 "INDEX" → KNOWLEDGE_INDEX_NOT_READY
status=422 → KNOWLEDGE_DOCUMENT_INVALID
其他 → KNOWLEDGE_SERVICE_UNAVAILABLE
```

### 10.3 服务韧性设计

`initialize_runtime()` 分段执行，**每段失败都不导致进程崩溃**：

```
① DB 连接失败       → logger.error, readyz.database=false, 返回
② 模型加载失败       → readyz.models=false, 返回（服务存活但不可检索）
③ 索引初始化失败     → readyz.index=false, 返回（管理 API 仍可用）
```

但 `healthz` 始终返回 200（K8s liveness 探测可以区分于 readiness 探测）。

---

## 11. 评测系统

### 11.1 评测流程

```python
async def evaluate_queries(service, query_path):
    cases = json.loads(query_path.read_text())
    for case in cases:
        expected = set(case["expected_policy_ids"])
        result = await service.search(SearchRequest(
            query=case["query"],
            keyword_hint=case.get("keyword_hint"),
            top_k=10,
        ))
        actual = [item.policy_id for item in result.matches[:5]]
        # 计算指标...
```

### 11.2 Golden Query 格式

```json
[
  {
    "query": "VIP 客户退款需要审批吗",
    "keyword_hint": "refund",
    "expected_policy_ids": ["P-refund-001"]
  },
  {
    "query": "不存在的政策内容",
    "expected_policy_ids": []
  }
]
```

### 11.3 评测指标与目标

| 指标 | 含义 | 验收目标 |
|------|------|----------|
| `recall_at_5` | Top-5 命中率 | ≥ 0.95 |
| `mrr` | 平均倒数排名（Mean Reciprocal Rank） | ≥ 0.85 |
| `no_answer_accuracy` | 无匹配场景准确率 | ≥ 0.90 |
| `fusion_top1_accuracy` | RRF 融合后 top-1 准确率 | 记录不设门禁 |
| `reranker_top1_accuracy` | 重排序后 top-1 准确率 | ≥ fusion_top1_accuracy |
| `average_duration_ms` | 平均耗时 | 记录不设门禁 |
| `p95_duration_ms` | P95 耗时 | ≤ 2000ms |

**强制验收模式**：`--enforce-targets` 模式下不达标进程 exit(1)，可集成 CI 门禁。

### 11.4 评测运行方式

```bash
# 本地评测
python -m agentflow_rag.evaluation --base-url http://localhost:8000

# 带强制验收门禁 + 输出文件
python -m agentflow_rag.evaluation \
  --base-url http://localhost:8000 \
  --output results.json \
  --enforce-targets
```

---

## 12. 启动与依赖装配

### 12.1 进程入口

```python
# main.py
app = create_app()  # 应用工厂

def run():
    uvicorn.run("agentflow_rag.main:app", host="0.0.0.0", port=8000)
```

### 12.2 应用工厂（依赖注入）

```python
# app.py
def create_app(settings=None, readiness=None, retrieval=None, admin=None, bootstrap=None):
    """
    依赖注入友好的应用工厂：
    - 测试时可注入 mock 对象
    - 生产环境 bootstrap=True 自动装配
    """
    resolved_settings = settings or get_settings()
    ...
    app.include_router(router)
    app.add_exception_handler(KnowledgeError, knowledge_error_handler)

    @app.middleware("http")
    async def request_context(request, call_next):
        request_id = request.headers.get("X-Request-Id") or uuid4().hex
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id  # 回传跟踪 ID
        return response
```

### 12.3 启动初始化时序

```
initialize_runtime()
  │
  ├─ [① 数据库] create_engine() → 连接池
  │             → readiness.refresh_database()
  │
  ├─ [② 模型]  HuggingFaceEmbedding(bge-m3) → asyncio.to_thread 异步加载
  │            → reranker.load() → 预加载 cross-encoder
  │            → readiness.set_models_ready()
  │
  ├─ [③ 索引]  create_pg_vector_store(perform_setup=True) → 自动建向量表
  │            → SqlDocumentRepository
  │            → PostgresNodeStore
  │            → IngestionService
  │            → KnowledgeAdminService
  │            → admin.reindex_bundled() → 索引所有内置语料（幂等）
  │            → PolicyHybridRetriever → 组装检索器
  │            → RetrievalService → 注册到 app.state
  │            → readiness.set_index_ready()
  │
  └─ 就绪 → /readyz 返回 200
```

---

## 13. REST API 契约

### 13.1 搜索 API

```
POST /v1/search
```

**请求体**：
```json
{
  "query": "VIP 客户退款需要审批吗",
  "keyword_hint": "refund",
  "top_k": 5,
  "include_archived": false
}
```

**成功响应（200）**：
```json
{
  "matches": [
    {
      "policy_id": "POL-REFUND-001",
      "keyword": "refund",
      "title": "企业退款审批政策",
      "content": "VIP 客户在订单完成 30 天内可进入快速退款审批...",
      "score": 0.91,
      "vector_score": 0.85,
      "lexical_score": 0.88,
      "fusion_score": 0.72,
      "rerank_score": 0.91,
      "citation": {
        "document_id": "P-refund-001:v2:abc123def456",
        "node_id": "<SHA256>",
        "source_name": "vip-refund-policy-v2.md",
        "version": "2.0",
        "section": null
      }
    }
  ],
  "retrieval": {
    "vector_candidates": 20,
    "lexical_candidates": 20,
    "reranked_candidates": 10,
    "duration_ms": 86
  }
}
```

**错误响应**：
```json
{
  "error": {
    "code": "KNOWLEDGE_NO_MATCH",
    "message": "低于得分阈值未返回可靠结果",
    "retryable": true,
    "details": { "query_length": 12, "threshold": 0.35 }
  }
}
```

### 13.2 管理 API

所有管理接口需要 `X-Admin-Token` 请求头，使用 `secrets.compare_digest` 防时序攻击。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/admin/documents` | 列出所有文档 |
| `POST` | `/admin/documents` | 上传新文档（支持 Markdown/PDF） |
| `POST` | `/admin/documents/{id}/reindex` | 重新索引指定文档 |
| `DELETE` | `/admin/documents/{id}` | 删除文档 |
| `POST` | `/admin/reindex-bundled` | 重新索引全部内置语料 |

### 13.3 健康检查

| 端点 | 用途 | 返回 |
|------|------|------|
| `GET /healthz` | Liveness 探针 | `{"status": "ok"}` |
| `GET /readyz` | Readiness 探针 | 200/503 含详细检查状态 |

---

## 14. 面试高频问题与答题策略

### Q1: RAG 服务的混合检索是如何实现的？

**考察点**：对检索流水线的理解、各阶段的作用和取舍。

**答**：

> "我们的混合检索分四个阶段。前两个阶段是并行的：向量检索用 bge-m3 embedding 在 PGVectorStore 中做语义搜索召回 Top-20；词法检索用 jieba 分词加 PostgreSQL 全文搜索的 `ts_rank_cd` 召回 Top-20。第三个阶段是 RRF 融合，把两路候选按排名而非分数合并排序——这样做的好处是不需要校准两种不同尺度的分数。RRF 阶段接收一个 keyword_hint，如果命中则额外加 0.05 的惩罚分，这是一个弱信号，只提升排序不硬过滤。最后，融合后的 Top-10 候选经过 bge-reranker-v2-m3 cross-encoder 做逐对精排。最终结果低于 0.35 阈值的会被丢弃并返回 404，而不是返回空结果让 LLM 瞎编。"

### Q2: 为什么用 RRF 融合而不是加权平均？

**考察点**：对 RRF 原理的理解、实际工程判断力。

**答**：

> "核心原因是向量余弦相似度和 BM25 分数在尺度上不可比。向量检索返回的是 0 到 1 之间的余弦距离，但 BM25 的分数范围可以到几十甚至上百。如果做加权平均，需要引入额外的校准步骤——比如 min-max 归一化或者学习一个权重系数。而 RRF 只看排名，排名天然在 [1, N] 范围内，两端尺度一致。而且 RRF 对异常值更鲁棒：极端高分不会主导融合结果，因为排名是离散的。实现上也更简单，就一个核心公式：`score = Σ 1/(k + rank)`，没有任何需要学习的参数。"

### Q3: keyword_hint 的实现细节？会不会变成硬过滤？

**考察点**：对弱信号控制的理解、代码阅读能力。

**答**：

> "keyword_hint 只在 RRF 融合阶段使用，不是在向量或词法检索阶段。具体实现是：在 RRF 对每个候选算完融合分后，如果 keyword_hint 匹配了该节点的 metadata.keyword，就在融合分上加 0.05，上限 1.0。这是一个精心设计的弱信号——它只提升命中文档的排序位置，但不会把未命中的文档排除掉。这样设计的原因是：用户的 keyword_hint 可能不准（比如用'发票'来搜'refund'相关的内容），如果变成硬过滤就会召回到零，而我们的方案最多是排序靠后一点，不会排除正确结果。这个设计也是 README 中故意写的'错误的 keyword_hint 是故意设置的难例'的应对。"

### Q4: 词法检索为什么用 PostgreSQL 全文搜索而不是 Elasticsearch？

**考察点**：技术选型能力、对场景的理解。

**答**：

> "ES 是非常优秀的检索引擎，但对当前政策语料规模来说太重了。项目已经使用 PostgreSQL 保存文档元数据和 pgvector，再增加 ES 会引入第三套存储及额外的数据同步成本。目前默认采用进程内 BM25，并保留 PostgreSQL tsvector 作为 A/B 和回滚路径；现有 50 条 Golden Query 已达到 Recall@5 100%、MRR 0.841。等语料增长到需要跨副本共享倒排索引，或者需要复杂分词、同义词扩展、字段权重和学习排序时，再评估 ES/OpenSearch。"

### Q5: BM25 和 PostgreSQL tsvector 在实现上有什么区别？

**考察点**：对两种词法检索方案的了解。

**答**：

> "我们通过 `lexical_mode` 配置支持两种词法检索。默认的 `bm25` 模式由 LlamaIndex `BM25Retriever` 在内存中构建倒排索引，查询和正文统一使用 jieba 分词；服务启动或文档变更成功后通过 `refresh()` 构建新索引，再原子替换有效版本与历史版本快照。`postgres` 模式把预分词文本保存到 `knowledge_lexical_nodes.lexical_tokens`，查询时使用 PostgreSQL `to_tsvector`、`websearch_to_tsquery` 和 `ts_rank_cd`，由 GIN 索引加速。BM25 已通过当前 50 条检索评测，因此作为默认；PostgreSQL 不依赖进程内快照，继续作为 A/B 基线和故障回滚路径。"

### Q6: 索引的幂等性怎么保证？

**考察点**：对数据一致性和工程健壮性的理解。

**答**：

> "我们有三层保障。第一层是 checksum 校验——同一 policy_id 和 version 的文档，如果文件的 SHA256 校验和没变而且已经索引成功，直接跳过。第二层是稳定的 Node ID——每个 Node 的 ID 由 `document_id + ordinal + text` 的 SHA256 生成，同样的内容产生同样的 ID，不会重复插入。第三层是版本切换——`complete_index` 里先设同一 policy_id 的所有文档 `is_current=False`，再选最新生效日期和版本的文档设为 `is_current=True`。这样即使反复索引，向量库和词法库都不会产生脏数据。另外，索引失败时也会通过 try-catch 清理已写入的 Node 数据，避免半索引状态。"

### Q7: 检索结果为空时为什么抛 404 而不是返回空列表？

**考察点**：RAG 安全设计、LLM 幻觉防御。

**答**：

> "这是一个经过考虑的设计。如果返回空列表，LLM 可能假装检索到了内容继续生成回复——这是 RAG 系统常见的幻觉来源。我们直接抛 404 让上游明确知道'没有可靠依据'，TypeScript 端会映射为 `KNOWLEDGE_NO_MATCH` 错误，Executor 标记为可重试并提示 LLM 换用不同的关键词。这样就把'无依据'和'有结果'明确区分开了，LLM 不会有机会在无依据的情况下继续生成。这个设计对应我们一个核心原则：'安全边界在服务端代码，不在 Prompt 中'。"

### Q8: 向量检索和词法检索结果不一致时，优先相信哪个？

**考察点**：对两种检索模式差异的认知。

**答**：

> "这其实不是相信哪个的问题，它们互补。向量检索擅长语义匹配——用户问'补开发票'可能命中'发票'的 embedding。词法检索擅长精确关键词——用户搜'refund'能准确匹配到退款政策。两者不一致通常是合理的，比如语义相似的文档排名高但关键词不匹配。RRF 融合就是处理这种不一致的：如果一个文档在两路中都出现，它的融合分会接近两路最高的分；如果只出现在一路，那么单路的分会被保留。我们没有优先级，让排名数据说话。在实践中，我们发现语义检索对新用户问法（如'合同怎么升级'→upgrade 政策）帮助大，而词法检索对标准业务术语（如退款、发票）更可靠。"

### Q9: 如何处理 embedding 模型的冷启动？

**考察点**：对生产环境模型加载问题的认识。

**答**：

> "我们的 embedding 模型 bge-m3 和重排序模型 bge-reranker-v2-m3 都是在**启动阶段**加载的，不是懒加载。embedding 模型通过 `asyncio.to_thread` 异步加载——因为 HuggingFace 的模型加载是同步阻塞的，不能用普通的 await 否则会阻塞事件循环。重排序模型虽然设计成 '延迟导入'（第一次 `rerank` 时才 `from llama_index.postprocessor.sbert_rerank import SentenceTransformerRerank`，避免测试和健康检查时下载模型），但实际的 `model.from_pretrained()` 也是在启动阶段显式调用 `reranker.load()` 完成的。代码注释说得很清楚：'在 readiness 前显式加载模型，避免首次真实查询承担冷启动'。"

### Q10: 怎么保证向量库和词法库的数据一致性？

**考察点**：对分布式数据一致性的理解。

**答**：

> "我们在 `PostgresNodeStore.add()` 里做了最佳努力的两阶段写入——先写 PGVectorStore，再写 knowledge_lexical_nodes。如果词法写入失败，会立即调用 `vector_store.adelete(document_id)` 回滚向量写入。虽然不是严格的分布式事务（XA），但在单 PostgreSQL 实例下够用了。而且 Node ID 和服务端生成的 embedding 都是幂等的，即使写入过程中断后重试，也不会产生重复数据。更彻底的一致性方案需要引入 Saga 模式或两阶段提交，对当前 23 篇文档的规模来说收益率不高。"

### Q11: 安全方面有哪些考虑？

**考察点**：安全意识和 AI 安全认知。

**答**：

> "有三层。第一，管理 API 使用 `X-Admin-Token` 认证，用 `secrets.compare_digest` 做字符串比较防时序攻击。第二，文件上传做了白名单校验——只允许 `.md` 和 `.pdf`，限制文件大小（默认 10MB），文件名用 UUID 重命名防止路径穿越。第三，Prompt 注入的防御不在 RAG 层——我们遵循的核心原则是安全边界在服务端代码不在 Prompt 中。RAG 的职责是忠实地返回检索结果，不做任何提取或过滤；Agent Executor 层才负责限制 LLM 对检索结果的滥用（如不能根据检索结果随意执行高风险操作）。"

### Q12: 从 Agent 的角度看，为什么当前默认 BM25，同时保留 PostgreSQL FTS？

**考察点**：对混合检索中词法引擎选型的理解。

**答**：

> "BM25 和 PostgreSQL FTS 都属于词法检索，但评分公式并不等价：BM25显式考虑词频饱和与文档长度，`ts_rank_cd` 采用 PostgreSQL 的覆盖密度排序。当前语料规模允许把倒排索引放在内存中，而且 BM25 混合检索已经通过 50 条 Golden Query 的质量与延迟门禁，所以默认选 BM25。PostgreSQL FTS 的优势是数据库内统一查询，不需要每个服务副本维护快照，因此保留为 A/B、故障回滚，以及未来多副本或高频更新场景的候选。两者统一实现 `AsyncCandidateSource`，切换不会改变上层 RRF 和结果契约。"

---

## 15. 简历项目描述建议

### 简洁版

> **AgentFlow 企业政策 RAG 知识服务** | Python, FastAPI, PostgreSQL/pgvector, LlamaIndex, bge-m3
>
> - 设计并实现**四阶段混合检索流水线**（向量检索 + 中文词法检索 + RRF 融合 + Cross-encoder 重排）；当前 50 条 Golden Query 的 Fast/CPU 热态评测达到 Recall@5 100%、MRR 0.841、无答案拒答准确率 100%
> - 默认使用 jieba + LlamaIndex BM25 完成词法召回，并保留 PostgreSQL tsvector 作为 A/B 基线和故障回滚路径，无需额外维护 ES 集群
> - 设计**幂等索引管线**：checksum 对比避免重复 embedding，稳定 Node ID 保证向量库数据一致性，异常时自动回滚半写入数据
> - 实现**严格的分级错误模型**（4 种 KnowledgeError），错误码与 TypeScript 端一一映射，空检索结果抛 404 而非空列表，从源头防止 LLM 幻觉
> - 搭建 **Golden Query 评测系统**，6 项检索质量指标（recall@5、MRR、P95 延迟等）支持自动化门禁验收

### 详细版

> **AgentFlow 企业政策 RAG 知识服务**
>
> **技术栈：** Python, FastAPI, PostgreSQL/pgvector, LlamaIndex, bge-m3/bge-reranker-v2-m3, jieba, SQLAlchemy, Pydantic, HuggingFace Transformers
>
> **项目概述：** 面向 AgentFlow 平台的独立 RAG 知识服务，负责企业政策知识的文档管理、索引构建和多阶段混合检索。通过 HTTP API 与 TypeScript Agent 执行器解耦，支持独立部署和扩缩容。
>
> **核心贡献：**
>
> 1. **混合检索流水线**：设计并实现了向量检索（bge-m3 → PGVectorStore Top-20）+ 中文词法检索（jieba + LlamaIndex BM25 Top-20）+ RRF 融合 + bge-reranker-v2-m3 cross-encoder 重排序的四阶段流水线。PostgreSQL tsvector 可作为可切换基线；keyword_hint 在 RRF 阶段作为弱信号加分，不参与硬过滤。
>
> 2. **双模式词法检索**：默认使用 LlamaIndex BM25（内存倒排索引），通过 `lexical_mode=postgres` 可切换到 PostgreSQL 全文搜索（`to_tsvector` + `websearch_to_tsquery` + GIN 索引），两个词法源统一实现 `AsyncCandidateSource` 协议。
>
> 3. **幂等索引管线**：`(policy_id, version)` + checksum 双重幂等检测，SHA256 稳定 Node ID 防重复，`is_current` 字段由 SQL 自动选择最新生效版本，索引异常时自动回滚向量和词法写入。
>
> 4. **结构化错误模型**：4 种 `KnowledgeError` 子类与 TypeScript 端错误码一一对应，错误 JSON 携带 `code` / `retryable` / `details` 字段，上游可精确判断重试策略。支持 200/404/422/503 四种 HTTP 状态码映射。
>
> 5. **文档管理**：支持 Markdown（YAML frontmatter 自描述元数据）和 PDF 上传、版本管理、重新索引、软删除。内置 23 篇政策文档启动时自动索引。
>
> 6. **检索质量评测**：Golden Query 评测系统覆盖 6 项指标（recall@5、MRR、no_answer_accuracy、fusion_top1_accuracy、reranker_top1_accuracy、p95_duration_ms），`--enforce-targets` 模式支持 CI 门禁集成。

---

> **面试准备的核心原则：**
>
> 1. **从数据流说明实现** — 面试中讲解 RAG 时，从"用户查询"开始，一路说到"结果返回给 LLM"，中间每个阶段的输入输出说清楚
> 2. **突出工程化取舍** — 为什么选 PG 内置 FTS 而不是 ES？为什么 RRF 而不是加权平均？为什么显式生成 embedding？这些选择体现了工程判断力
> 3. **与整体项目关联** — 不要孤立讲 RAG，说明它如何与 Agent Executor 的 `searchPolicy` 工具、`normalizeTaskAwareToolCall` 关键词修正、`KnowledgeServiceError` 错误体系、`requiresPolicyCitation` 评测断言协同工作
> 4. **诚实面对不足** — 两阶段写入不是严格分布式事务、23 篇文档规模较小、向量检索文档过滤点在检索后而非 SQL 中 —— 这些可以在被追问时坦率说明并给出演进方向
