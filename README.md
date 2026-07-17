# AgentFlow：企业级 AI Agent 执行与评测平台

AgentFlow 是一个面向企业流程自动化的 AI Agent Runtime 与 Evaluation 平台。项目以工单处理和退款审批为业务场景，重点解决 Agent 落地时的四类工程问题：**受控执行、高风险人工接管、全链路可观测和可重复评测**。

它不是只封装一次模型对话的聊天 Demo：Agent 会先生成结构化计划，Executor 按步骤授予最小工具权限，所有参数经过服务端 Schema 校验；高风险操作在真正写入前暂停等待人工审批；每次运行都会保存计划、工具调用、审批、错误和指标，供历史审计与自动化回归使用。

## 核心设计亮点

- **受约束的 Agent 执行器**：Planner、Executor 与 Replanner 分工，单个计划步骤只授权一项工具，避免模型跳步或越权调用。
- **统一 Tool Registry**：集中维护工具描述、风险等级、Zod 入参校验、JSON Schema 与执行入口，让模型工具定义和服务端校验保持一致。
- **Human-in-the-loop**：`riskLevel: "high"` 的退款工具必须等待人工批准；拒绝后不创建退款，也不继续更新工单状态。
- **可观测与可恢复**：通过 SSE 展示执行时间线，持久化 AgentRun、会话和审批快照，并将服务重启时无法继续的任务降级为可重试中断状态。
- **确定性 Agent 评测**：内置 28 条 golden task（含 10 条 RAG 专项），同时断言最终回答、Citation、工具轨迹与业务副作用。
- **结构化业务 Outcome**：服务端根据真实工具轨迹和审批决议派生 `decision`、实际写入动作与证据引用，自然语言措辞变化不再影响核心业务判定。
- **业务语义约束**：单工单任务会预读取真实上下文，规则检索依据工单标题和描述归一到退款、审批、发票、SLA、升级、取消、重复退款或安全规则，降低模型误选工具和关键词的概率。
- **模型层解耦**：统一封装 OpenAI-compatible Provider，支持兼容模型切换和 Mock fallback，便于本地演示与稳定回归。
- **企业政策 RAG**：独立 FastAPI + LlamaIndex 服务使用 BGE-M3、BGE Reranker、pgvector 与中文全文索引，`searchPolicy` 返回 Top-K、分阶段得分和可验证 Citation。

完整设计见 [Agent 执行架构](docs/architecture.md)。

## 当前能力

- Vue 3 + Vite 前端任务工作台。
- Fastify 后端和 SSE 流式执行事件。
- 实时执行时间线：计划、工具调用、人工审批、最终结论。
- 沙箱业务状态面板：工单、客户、订单、退款、规则。
- Tool Registry：统一管理工具名称、描述、风险等级、Zod 入参校验和 JSON Schema。
- OpenAI-compatible LLM Provider，支持 OpenAI、DeepSeek 等兼容 `/chat/completions` 的服务。
- Mock fallback：没有 API Key 或模型请求失败时，本地 Demo 仍可运行。
- Trace 历史：运行完成或等待审批时保存 `AgentRun` 快照，前端可恢复查看。
- Human Approval：`riskLevel: "high"` 的工具调用会暂停等待用户批准或拒绝。
- Conversation Workspace：前端支持单会话多轮消息流，每条用户消息触发一次 Agent run，并把 trace 挂在对应 Agent 回复下。
- Workspace Starter：空会话提供退款处理、SLA 核查和批量查询任务模板，模板只填入编辑器，由用户确认后执行。
- Business Context：右侧面板可跟随当前任务中的工单号，也可手动切换工单；未指定工单时展示沙箱业务概览。
- Recoverable Conversations：后端维护会话摘要和完整消息快照，前端可以创建、切换和恢复多轮会话。
- Run Control：支持取消当前执行、重试上一条任务，并在刷新恢复时提示可重试的中断消息。
- Evaluation Workbench：内置 28 条评测用例，支持按能力分组运行、Citation 断言、工具轨迹、token/工具调用指标和模型/Prompt A/B 对比。

## 项目结构

```txt
apps/
  web/                 Vue 3 + Vite 前端工作台、会话、Trace 与评测界面
  server/              Fastify API、Agent 执行器、LLM、工具、审批、Trace 与评测
  rag/                 FastAPI + LlamaIndex 摄取、混合检索、管理 API 与 50 条检索评测集
packages/
  shared/              前后端共享类型和 SSE 事件契约
docs/
  architecture.md      Agent 执行架构与关键状态流
  demo-guide.md        演示流程
  roadmap.md           分阶段演进记录
  evaluation-results/  Mock 与真实模型评测报告
```

## 执行链路

```txt
前端点击“开始执行”
  -> EventSource 连接后端 SSE 接口
  -> 后端创建 AgentRun
  -> Planner 生成并校验结构化执行计划（步骤、工具授权、审批要求）
  -> Executor 只接受当前计划步骤授权的一项 tool_call
  -> 后端通过 Tool Registry 校验并执行工具；searchPolicy 异步调用 RAG 并返回 Citation
  -> 工具失败时将观察结果交给 Replanner，只重规划尚未完成的步骤
  -> 高风险工具进入 approval_required，前端展示批准/拒绝按钮
  -> 审批结果通过 approval_resolved 回到同一条执行流
  -> 审批通过则执行工具，审批拒绝则停止后续状态写入并生成拒绝结论
  -> LLM 生成最终结论
  -> 后端保存 AgentRun trace，前端刷新历史列表和沙箱状态
```

## 常用接口

- `GET /health`：健康检查。
- `GET /sandbox/state`：读取当前沙箱状态。
- `POST /sandbox/reset`：重置沙箱状态。
- `POST /agent/run`：非流式调试执行，高风险工具会自动批准。
- `GET /agent/run/stream?task=...`：SSE 流式执行入口。
- `GET /agent/runs`：读取运行历史摘要。
- `GET /agent/runs/:runId`：读取单次运行完整 trace。
- `DELETE /agent/runs`：清空运行历史。
- `GET /agent/conversations`：读取可恢复会话摘要列表。
- `POST /agent/conversations`：创建一个新的会话。
- `GET /agent/conversations/:conversationId`：读取完整会话消息和嵌入式 trace。
- `DELETE /agent/conversations/:conversationId`：删除单个空闲会话，运行中的会话会返回 409。
- `DELETE /agent/conversations`：清空会话列表。
- `GET /agent/runs/:runId/approval`：读取当前等待中的审批。
- `POST /agent/runs/:runId/approve`：批准当前等待中的高风险工具调用。
- `POST /agent/runs/:runId/reject`：拒绝当前等待中的高风险工具调用。
- `POST /agent/runs/:runId/cancel`：取消当前正在执行或等待审批的 run。
- `GET /eval/cases`：读取内置评测用例集，包含能力分组信息。
- `POST /eval/runs`：执行一次批量评测，可传 `caseIds` 只运行部分用例或某个能力组。
- `GET /eval/runs`：读取评测运行历史，包含分组汇总、模型配置、token/工具调用指标和相对上一轮的回归对比。
- `DELETE /eval/runs`：清空评测运行历史，不影响会话、Agent run trace 或沙箱数据。
- `GET /eval/runs/:evaluationRunId`：读取单次评测完整断言、诊断、工具轨迹和失败原因。
- `POST http://127.0.0.1:8000/v1/search`：混合检索企业政策，返回 Top-K、各阶段得分和引用。
- `GET http://127.0.0.1:8000/v1/admin/documents`：列出知识文档，需要 `X-Admin-Token`。
- `POST http://127.0.0.1:8000/v1/admin/documents`：上传 Markdown/PDF 并幂等索引，需要 `X-Admin-Token`。
- `POST http://127.0.0.1:8000/v1/admin/reindex-bundled`：重建 bundled 政策索引。

## 企业政策知识库

`apps/rag/knowledge/policies` 是真实检索数据源，共包含 27 篇正式政策、FAQ/指引与历史版本；原 TypeScript Seed Policy 只保留给旧 Trace 与显式 Mock 评测。默认检索排除 `archived`，同一政策只召回最新的有效版本。

检索链路如下：

```txt
Markdown / PDF
  -> SentenceSplitter(512 / overlap 80)
  -> BGE-M3 1024 维向量 + pgvector
  -> jieba 中文分词 + PostgreSQL FTS
  -> 向量 Top20 + 关键词 Top20
  -> RRF(k=60) 融合前 10
  -> BGE Reranker
  -> 阈值 0.35 拒答或返回 Top5 Citation
```

搜索示例：

```bash
curl -X POST http://127.0.0.1:8000/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query":"核心接口中断两小时如何处理","keyword_hint":"sla","top_k":5}'
```

Docker Compose 默认设置 `RAG_ENABLE_RERANKER=false`，用于普通 CPU 电脑上的低延迟在线演示；
向量召回仍使用 BGE-M3，并通过 jieba/PostgreSQL 与 RRF 融合。运行完整 BGE Reranker
质量评测时，将该变量设置为 `true`。完整重排在 CPU 上开销较大，建议作为离线评测或在 GPU 环境启用。
快速模式使用 `RAG_MINIMUM_VECTOR_SCORE_WITHOUT_RERANKER=0.55` 做语义拒答，并按文档去重 Top-K。
在线排序以 BGE-M3 向量分为主、RRF 为辅；完整模式再使用 BGE CrossEncoder 重排。

上传 Markdown：

```bash
curl -X POST http://127.0.0.1:8000/v1/admin/documents \
  -H "X-Admin-Token: agentflow-local-admin" \
  -F "file=@./policy.md"
```

PDF 首期要求文本型文件，并通过表单同时提供 `policy_id`、`keyword`、`title`、`version`、`effective_date`、`status` 和 `department`；扫描件暂不做 OCR。

## LLM 配置

服务端通过 `apps/server/src/llm/provider.ts` 统一封装模型调用。先复制根目录的配置示例：

```powershell
Copy-Item .env.example .env
```

OpenAI-compatible 示例：

```bash
LLM_PROVIDER=openai-compatible
LLM_MOCK=false
LLM_FALLBACK_ON_ERROR=true
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

DeepSeek 示例：

```bash
LLM_PROVIDER=openai-compatible
LLM_MOCK=false
LLM_FALLBACK_ON_ERROR=true
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

如果没有配置任何 API Key，后端会自动启用 Mock LLM，保证本地 Demo 可完整演示。

沙箱数据默认使用 `2026-07-01` 作为业务基准日期，保证退款窗口等时间规则可以重复评测，不会随运行机器的真实日期漂移。需要覆盖时可设置：

```bash
AGENTFLOW_BUSINESS_DATE=2026-07-01
```

## 可重复评测与 A/B 对比

命令行评测必须显式指定 `--mock` 或 `--real`，避免混淆 Mock 基线与真实模型结果。真实模式会强制关闭 Mock fallback：API 调用失败将如实记录为异常，不会使用 Mock 成绩替代。

先运行少量代表性 Case 做冒烟验证：

```bash
pnpm --filter @agentflow/server eval -- \
  --label deepseek-smoke \
  --real \
  --cases query-list-all-tickets,invoice-t1002-no-refund,refund-rejected-keeps-ticket-open \
  --output docs/evaluation-results/deepseek-smoke.md
```

确认配置、费用和工具调用符合预期后，再运行完整 28 条用例：

```bash
pnpm --filter @agentflow/server eval -- \
  --label deepseek-full \
  --real \
  --output docs/evaluation-results/deepseek-full.md
```

每次实验同时输出 Markdown 和 JSON。完成两组使用相同 Case 的实验后，可生成 A/B 对比：

```bash
pnpm --filter @agentflow/server eval:compare -- \
  --baseline docs/evaluation-results/model-a.json \
  --candidate docs/evaluation-results/model-b.json \
  --output docs/evaluation-results/model-a-vs-model-b.md
```

`AGENTFLOW_PROMPT_VERSION` 当前用于记录实验元数据；只有 Prompt 内容真实发生变化时，才能把两次运行描述为 Prompt A/B，而不能只修改版本标签。

### CI 质量门禁

仓库通过 GitHub Actions 在 Pull Request、`main` 分支推送和手动触发时执行统一质量门禁：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm eval:gate
```

`eval:gate` 会运行完整 Mock Golden Task，并把 Markdown/JSON 报告写入 `.agentflow-artifacts/`。只要任一 case 失败或执行异常，命令就以非零状态退出并阻断流水线；报告同时写入 GitHub Actions Summary，并作为构建产物保留 14 天。

CI 不读取真实模型密钥，也不会产生模型 API 费用。真实模型冒烟和全量回归仍需在获得明确费用授权后单独执行，避免把 Mock 成绩与真实模型成绩混淆。

### 当前已保存的评测基线

| 报告 | 模式 | 结果 | 说明 |
|---|---|---:|---|
| [Mock 全量基线](docs/evaluation-results/mock-full.md) | Mock | 18/18 | 历史 18 条基线；当前 CI 已扩展为 28 条 |
| [DeepSeek Outcome 全量评测](docs/evaluation-results/deepseek-post-outcome-full.md) | 真实模型 | 17/18 | 17 条通过、1 条因 Planner step 校验失败而异常 |
| [Planner 稳健性定向复测](docs/evaluation-results/deepseek-planner-robustness-targeted.md) | 真实模型 | 1/1 | 上述幂等性失败路径定向复测通过 |

真实模型全量报告的通过率为 94.4%，共消耗 185,322 Token；随后通过的单 Case 定向复测只证明对应失败路径已恢复，不等同于重新完成全量 18/18 回归。报告记录的是特定模型、Prompt 和代码版本下的实验结果，不能视为对后续版本的永久保证。

## Docker Compose 一键运行

前置环境：Docker Desktop / Docker Engine。首次启动需要下载 BGE-M3 与 BGE Reranker，耗时取决于网络和 CPU；模型缓存会保存在命名 Volume，后续启动复用。

```bash
docker compose up --build
```

启动顺序由健康检查约束：PostgreSQL/pgvector → Alembic → 模型加载 → bundled 索引 → RAG readiness → Fastify Server → Vue Web。

```txt
Web：http://127.0.0.1:5173
Server：http://127.0.0.1:3001/health
RAG Swagger：http://127.0.0.1:8000/docs
RAG readiness：http://127.0.0.1:8000/readyz
```

`docker compose down` 会保留索引、模型和上传文档。若要完全删除 PostgreSQL、模型缓存、上传文档和 Agent 状态，执行 `docker compose down -v`。

## 本地开发运行

前置环境：Node.js 20+、pnpm 9、Python 3.12、uv 和 PostgreSQL 16 + pgvector。

```bash
pnpm install
pnpm dev
```

RAG 服务单独运行：

```bash
cd apps/rag
uv sync --frozen --extra dev
uv run alembic upgrade head
uv run agentflow-rag
```

RAG 服务 ready 后，可执行真实 BGE 检索门禁：

```bash
cd apps/rag
uv run agentflow-rag-eval --profile fast --enforce-targets --output ../../.agentflow-artifacts/rag-evaluation.json
```

`fast` 对应 Docker Compose 的 CPU 在线模式（Recall@5 ≥90%、MRR ≥0.78、拒答率 ≥90%、P95 ≤2 秒）。
GPU 或离线完整 BGE Reranker 验收使用 `--profile full`，继续执行原计划的 95% / 0.85 质量目标，
不会因本机 CPU 限制而降低完整模式标准。

也可以只启动一侧：

```bash
pnpm dev:server
pnpm dev:web
```

运行服务端核心测试：

```bash
pnpm --filter @agentflow/server test
```

常用地址：

```txt
前端：http://127.0.0.1:5173
后端健康检查：http://127.0.0.1:3001/health
SSE 执行接口：http://127.0.0.1:3001/agent/run/stream?task=处理工单%20T-1001
Trace 历史接口：http://127.0.0.1:3001/agent/runs
```

### RAG 故障排查

- `/healthz` 为 200、`/readyz` 为 503：查看 `checks`，分别定位数据库、模型或索引未就绪。
- `KNOWLEDGE_SERVICE_UNAVAILABLE`：确认 8000 端口、`RAG_BASE_URL` 与容器网络；真实模式不会回退 Seed Policy。
- `KNOWLEDGE_INDEX_NOT_READY`：等待模型加载/自动索引完成，或调用 `POST /v1/admin/reindex-bundled`。
- `KNOWLEDGE_NO_MATCH`：问题低于 0.35 阈值；补充具体业务场景或新增政策，不应降低阈值掩盖语料缺口。
- PDF 导入失败：确认是文本型 PDF且页码可提取；扫描 PDF 需要后续 OCR 扩展。
- 首次启动慢：BGE 模型只在首次下载；检查 `model_cache` Volume 是否被保留。

## 本地持久化

服务端会把会话、运行历史和当前进程内等待审批元数据写入 `.agentflow-data/server-state.json`。可以通过 `AGENTFLOW_DATA_DIR` 指定其他目录。

如果服务重启时发现旧 run 仍处于 `running` 或 `waiting_approval`，会恢复为失败/中断快照，前端可通过上一条用户任务重试。等待审批的 executor 无法跨进程恢复，因此重启后会清理旧 pending approval，避免误批准一个无法继续的执行流。

## 工程边界与演进方向

当前版本定位为可本地运行的单机 Agent 工程沙箱，使用本地 JSON 保存运行状态；它适合演示执行约束、人工审批、Trace 与评测闭环，但不把单机存储描述成生产级分布式方案。

后续生产化演进将优先考虑：使用 PostgreSQL 持久化 Run/Step/Approval，以任务队列承载异步执行与失败恢复，为写工具增加幂等键和事务边界，并基于真实模型评测数据建立 Prompt/模型版本发布门禁。
