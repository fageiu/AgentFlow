# AgentFlow：企业级 AI Agent 执行与评测平台

AgentFlow 是一个面向企业流程自动化的 AI Agent Runtime 与 Evaluation 平台。项目以工单处理和退款审批为业务场景，重点解决 Agent 落地时的四类工程问题：**受控执行、高风险人工接管、全链路可观测和可重复评测**。

它不是只封装一次模型对话的聊天 Demo：Agent 会先生成结构化计划，Executor 按步骤授予最小工具权限，所有参数经过服务端 Schema 校验；高风险操作在真正写入前暂停等待人工审批；每次运行都会保存计划、工具调用、审批、错误和指标，供历史审计与自动化回归使用。

## 核心设计亮点

- **受约束的 Agent 执行器**：Planner、Executor 与 Replanner 分工，单个计划步骤只授权一项工具，避免模型跳步或越权调用。
- **统一 Tool Registry**：集中维护工具描述、风险等级、Zod 入参校验、JSON Schema 与执行入口，让模型工具定义和服务端校验保持一致。
- **Human-in-the-loop**：`riskLevel: "high"` 的退款工具必须等待人工批准；拒绝后不创建退款，也不继续更新工单状态。
- **可观测与可恢复**：通过 SSE 展示执行时间线，持久化 AgentRun、会话和审批快照，并将服务重启时无法继续的任务降级为可重试中断状态。
- **确定性 Agent 评测**：内置 18 条 golden task，覆盖查询、知识检索、退款、审批边界、异常安全和幂等性；同时断言最终回答、工具轨迹与业务副作用。
- **模型层解耦**：统一封装 OpenAI-compatible Provider，支持兼容模型切换和 Mock fallback，便于本地演示与稳定回归。

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
- Recoverable Conversations：后端维护会话摘要和完整消息快照，前端可以创建、切换和恢复多轮会话。
- Run Control：支持取消当前执行、重试上一条任务，并在刷新恢复时提示可重试的中断消息。
- Evaluation Workbench：内置 18 条评测用例，支持按能力分组运行、断言诊断、工具轨迹、token/工具调用指标和模型/Prompt A/B 对比。

## 项目结构

```txt
apps/
  web/                 Vue 3 + Vite 前端工作台
  server/              Fastify 后端、Agent 执行器、LLM Provider、审批和沙箱工具
packages/
  shared/              前后端共享类型和 SSE 事件契约
docs/
  roadmap.md           阶段规划
```

## 执行链路

```txt
前端点击“开始执行”
  -> EventSource 连接后端 SSE 接口
  -> 后端创建 AgentRun
  -> Planner 生成并校验结构化执行计划（步骤、工具授权、审批要求）
  -> Executor 只接受当前计划步骤授权的一项 tool_call
  -> 后端通过 Tool Registry 校验并执行工具，成功后才推进下一步骤
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
- `DELETE /agent/runs`：清空内存运行历史。
- `GET /agent/conversations`：读取可恢复会话摘要列表。
- `POST /agent/conversations`：创建一个新的会话。
- `GET /agent/conversations/:conversationId`：读取完整会话消息和嵌入式 trace。
- `DELETE /agent/conversations/:conversationId`：删除单个空闲会话，运行中的会话会返回 409。
- `DELETE /agent/conversations`：清空内存会话列表。
- `GET /agent/runs/:runId/approval`：读取当前等待中的审批。
- `POST /agent/runs/:runId/approve`：批准当前等待中的高风险工具调用。
- `POST /agent/runs/:runId/reject`：拒绝当前等待中的高风险工具调用。
- `POST /agent/runs/:runId/cancel`：取消当前正在执行或等待审批的 run。
- `GET /eval/cases`：读取内置评测用例集，包含能力分组信息。
- `POST /eval/runs`：执行一次批量评测，可传 `caseIds` 只运行部分用例或某个能力组。
- `GET /eval/runs`：读取评测运行历史，包含分组汇总、模型配置、token/工具调用指标和相对上一轮的回归对比。
- `DELETE /eval/runs`：清空评测运行历史，不影响会话、Agent run trace 或沙箱数据。
- `GET /eval/runs/:evaluationRunId`：读取单次评测完整断言、诊断、工具轨迹和失败原因。

## LLM 配置

服务端通过 `apps/server/src/llm/provider.ts` 统一封装模型调用。可以在项目根目录新建 `.env`：

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

确认配置、费用和工具调用符合预期后，再运行完整 18 条用例：

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

### 已验证的真实模型冒烟结果

使用 `deepseek-v4-flash`、关闭 Mock fallback，在查询、非退款咨询和审批拒绝3条代表性 Case 上完成两轮真实模型评测：

| 轮次 | 通过 | 失败 | 异常 | 平均耗时 | 总 Token | 回归变化 |
|---|---:|---:|---:|---:|---:|---|
| 修复前 | 1/3 | 2 | 0 | 23.5 s | 35,029 | 首次运行 |
| 修复后 | 3/3 | 0 | 0 | 28.4 s | 37,596 | 2 recovered、0 regressed |

失败 Trace 表明：查询结果在最终总结阶段丢失明细；退款决策因缺少业务基准日期而无法判断30天窗口。修复后，最终回复会保留用户要求的查询字段，沙箱通过固定业务日期执行可重复的时间规则判断。完整结果见 [DeepSeek 冒烟评测报告](docs/evaluation-results/deepseek-smoke.md)。

以上结果仅代表3条冒烟用例，不等同于完整18条评测集的真实模型通过率。

完整18条真实模型首轮评测随后取得 `14 passed / 1 failed / 3 errors`，通过率为 77.8%，共消耗 252,495 Token，平均每条耗时 26.3 秒。失败集中在计划耗尽后重复调用工具、工具失败消息配对、退款待审批状态约束和重复执行幂等性。

执行器与状态机修复后，对上述4条失败 Case 进行定向真实复测，结果为 `4/4 passed`、0 failed、0 errors，共消耗 53,415 Token。报告见 [DeepSeek 当前全量回归报告](docs/evaluation-results/deepseek-full.md) 与 [失败 Case 定向复测报告](docs/evaluation-results/deepseek-fix-smoke.md)。

定向复测通过只能证明已覆盖的4条失败路径恢复；在第二轮完整18条真实评测完成前，不将其表述为“真实模型全量18/18通过”。

第二轮完整18条真实评测仍为 `14/18`，其中3条恢复、3条新回归，说明真实模型在筛选工具选择、规则关键词、审批标志和退款写入判断上存在非确定性漂移。项目因此进一步将这些约束下沉到服务端：查询条件决定只读工具、规则意图归一化、审批属性绑定 Tool Registry 风险等级、非明确退款诉求禁止解锁写入。下沉后本地确定性评测保持 `18/18`，但在再次完成真实模型全量回归前，不宣称最终真实通过率已经提升。

## 本地运行

```bash
pnpm install
pnpm dev
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

## 本地持久化

服务端会把会话、运行历史和当前进程内等待审批元数据写入 `.agentflow-data/server-state.json`。可以通过 `AGENTFLOW_DATA_DIR` 指定其他目录。

如果服务重启时发现旧 run 仍处于 `running` 或 `waiting_approval`，会恢复为失败/中断快照，前端可通过上一条用户任务重试。等待审批的 executor 无法跨进程恢复，因此重启后会清理旧 pending approval，避免误批准一个无法继续的执行流。

## 工程边界与演进方向

当前版本定位为可本地运行的单机 Agent 工程沙箱，使用本地 JSON 保存运行状态；它适合演示执行约束、人工审批、Trace 与评测闭环，但不把单机存储描述成生产级分布式方案。

后续生产化演进将优先考虑：使用 PostgreSQL 持久化 Run/Step/Approval，以任务队列承载异步执行与失败恢复，为写工具增加幂等键和事务边界，并基于真实模型评测数据建立 Prompt/模型版本发布门禁。
