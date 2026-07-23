# AgentFlow Sandbox Coding Notes

## 代码生成要求

以后在本项目中生成或修改代码时，需要遵守以下约定：

- 在关键逻辑位置添加简洁注释，帮助理解代码意图。
- 后端接口和关键函数需要添加中文注释。
- 涉及前后端通信、SSE、Agent 执行流程、工具调用、人工审批、状态流转、错误处理等核心逻辑时，优先补充注释。
- 新增较复杂模块时，同步在本文件中补充必要的项目级说明或协作约定。
- 保持注释克制，避免把每一行代码都解释一遍。
- 使用 UTF-8 编码

## 当前重点关注区域

- `apps/web/src/App.vue`：前端任务提交、SSE 监听、执行时间线渲染、人工审批交互。
- `apps/web/src/components/*`：右侧上下文面板、业务状态、评测系统和评测对比等可复用前端组件。
- `apps/web/src/composables/*`：前端跨组件状态派生逻辑，例如评测视图筛选、汇总和对比计算。
- `apps/web/src/api/*`：前端 HTTP/SSE 契约封装，避免组件内散落接口路径和请求细节。
- `apps/web/src/utils/*`：前端展示格式化、状态文案等轻量工具。
- Week 7 起，`apps/web/src/App.vue` 采用单会话多轮消息流；每条用户消息对应一个 Agent run，trace 嵌在对应 assistant 消息下。
- `apps/server/src/main.ts`：Fastify 路由、SSE 响应流、审批接口。
- `apps/server/src/agent/executor.ts`：Agent 执行流程、步骤事件生成、Tool Calling 循环和审批暂停/恢复。
- `apps/server/src/agent/policyQuery.ts`：将任务和可信工单上下文改写为面向政策语义的检索 Query；禁止把完整工单 JSON、追踪 ID、状态或优先级直接送入 RAG。
- `apps/server/src/agent/outcome.ts`：根据 Run 终态、审批决议和真实工具轨迹派生结构化业务结论，禁止信任模型自报动作。
- `apps/server/src/agent/businessDecision.ts`：从可信工具轨迹构造 EvidencePacket，校验模型的事实引用、动作声明与推荐，并在失败时回退确定性 Outcome。
- `apps/server/src/agent/errors.ts`：Agent 统一错误模型，负责错误分类、用户提示、结构化错误码和 SSE error payload。
- `apps/server/src/agent/runControl.ts`：AgentRun 取消请求的进程内控制状态，executor 在步骤边界读取它来停止执行。
- `apps/server/src/agent/cancelRun.ts`：取消生命周期校验与审批唤醒编排，负责区分不存在、已结束、已取消和可取消 run。
- `apps/server/src/approval/approvalStore.ts`：高风险工具调用的内存审批状态。
- `apps/server/src/llm/*`：LLM 配置、Prompt 和 Provider 封装。
- `apps/server/src/knowledge/ragClient.ts`：企业政策 RAG 服务客户端，负责 Fixture/Service 模式隔离、超时重试、错误映射和 Citation 契约转换；真实模式禁止回退 Seed Policy。
- `apps/rag/src/agentflow_rag/runtime.py`：生产 RAG 依赖装配，按数据库、BGE 模型、bundled 索引顺序更新 readiness。
- `apps/rag/src/agentflow_rag/retrieval.py`：向量、BM25/PostgreSQL 稀疏召回、RRF 融合与重排；BM25 快照必须在文档变更成功后原子替换，并保留 `postgres` 回滚模式。
- 同一政策版本更新正文时会生成新的校验和文档；current 选择必须优先本次成功索引的文档，unchanged 启动路径仍需校准 current 指针，禁止留下“文档已索引但节点属于非 current 行”的空召回状态。
- `apps/web/src/components/PolicyRetrievalDetail.vue`：Trace 中的政策证据账本，展示 Top-K、检索得分和文件/版本/章节/页码引用。
- `apps/server/src/trace/runStore.ts`：AgentRun trace 历史的内存存储与摘要查询。
- `apps/server/src/conversation/conversationStore.ts`：可恢复会话的内存存储，负责会话摘要、消息快照和消息内嵌 trace。
- `apps/server/src/eval/*`：评测用例、批量运行器、规则评分器和评测结果存储。
- `apps/server/src/storage/persistentState.ts`：本地 JSON 持久化边界，负责读写 `.agentflow-data/server-state.json`。
- `apps/server/src/tools/toolRegistry.ts`：业务工具注册、参数校验、风险等级描述。
- `apps/server/src/sandbox/seed.ts`：沙箱初始业务样本数据；默认退款记录保持为空，以免污染只读任务和非退款评测基线。
- `packages/shared/src/index.ts`：前后端共享类型和事件契约。

## LLM 接入约定

- `executor.ts` 只编排业务流程，不直接写模型 HTTP 请求。
- 真实模型调用统一放在 `apps/server/src/llm/provider.ts`。
- Prompt 模板统一放在 `apps/server/src/llm/prompts.ts`，避免散落在执行器里。
- 没有 API Key 时必须保持 Mock fallback，保证本地 Demo 可运行。
- Tool Calling 消息统一使用 `apps/server/src/llm/types.ts` 中的内部类型，再由 provider 转换为 OpenAI-compatible 请求格式。
- Provider 请求必须复用统一的超时、429/5xx 重试和取消信号；触发 Mock fallback 时必须写入结构化 fallback 元数据，不能把调试文本混入模型结构化输出。
- 前端模型设置通过 `/llm/config` 系列接口更新服务端运行时配置；API Key 只保存在后端进程内存中且禁止回显或写入浏览器存储，服务重启后重新以环境变量为准。
- 模型配置只能在没有 Agent Run 或批量评测执行时切换；连接测试复用 Provider 的超时、重试和统一错误模型。

## Tool Registry 约定

- 新增业务工具时，先在 `sandboxTools.ts` 中实现业务函数，再在 `toolRegistry.ts` 中注册工具。
- 每个工具必须声明 `name`、`description`、`riskLevel`、`inputSchema`、`jsonSchema` 和 `execute`。
- `inputSchema` 用于后端 Zod 校验，`jsonSchema` 用于暴露给 LLM Tool Calling。
- executor 不直接调用业务函数，统一通过 `runTool()` 执行，保证 trace、参数校验和风险等级可复用。
- 只有 `listAgentTools()` 返回的工具会交给 LLM 自主调用；演示控制类工具例如 `resetSandboxState` 不应暴露给模型。
- 查询类工具例如 `listTickets`、`searchTickets` 应保持 `riskLevel: "read"`，用于只读业务问答，不应产生退款、审批或状态变更。
- 退款创建与工单状态同步属于同一业务写入单元；后续写入失败或 run 取消时必须调用定向补偿，避免留下部分成功状态。
- 写工具需要在 Tool Result 中返回 `operation` 元数据，例如 `created/reused`、`updated/unchanged`；结构化 Outcome 据此区分真实副作用与幂等复用，不能把工具调用次数直接当成写入次数。

## Human Approval 约定

- `riskLevel: "high"` 的工具必须经过人工审批，不应在流式执行入口中直接执行。
- `executor.ts` 遇到高风险工具时创建 `ApprovalRequest`，把 run 状态切到 `waiting_approval`，并通过 SSE 推送 `approval_required`。
- 前端通过 `POST /agent/runs/:runId/approve` 或 `POST /agent/runs/:runId/reject` 解决审批。
- 审批通过后 executor 执行工具，并把 tool result 回传给 LLM；审批拒绝后 executor 把拒绝结果作为 tool message 回传给 LLM，让模型生成解释性结论。
- `approvalStore.ts` 当前只做进程内存存储，后续替换数据库时应保持按 runId 解决 pending approval 的调用语义稳定。

## Trace 历史约定

- `executor.ts` 负责在运行完成后保存最终 `AgentRun` 快照，不在路由层拼装 trace。
- 等待人工审批时也应保存 run 快照，便于历史接口看到 `waiting_approval` 状态。
- `runStore.ts` 当前只做进程内存存储，后续替换数据库时应保持 `saveRun()`、`getRun()`、`listRuns()`、`clearRuns()` 的调用语义稳定。
- 历史列表接口只返回 `AgentRunSummary`，完整步骤明细通过单条详情接口按需读取。
- 会话列表接口只返回 `ConversationSessionSummary`，完整消息和嵌入式 trace 通过会话详情接口读取；`runStore` 仍作为审计 trace，`conversationStore` 负责恢复工作台上下文。
- 取消执行通过 `runControl.ts` 记录 run 级别取消标记，`executor.ts` 负责把取消转换为 `cancelled` 状态和 `run_cancelled` SSE 事件，路由层不直接改写执行流程。
- Week 10 起，`runStore`、`conversationStore` 和 `approvalStore` 的内存 Map 会同步写入本地 JSON；重启后无法继续的 `running`/`waiting_approval` run 必须降级为可重试的中断状态。
- Agent 错误必须经过 `errors.ts` 归一化；工具失败、业务数据不存在、模型异常和系统异常都应写入 failed trace，并在 run 快照中保存结构化 `error`。
- 新 Run 进入 completed、failed、cancelled 或 waiting_approval 时必须写入结构化 `outcome`；`decision` 与 `performedActions` 只能由服务端可信轨迹派生，`userMessage` 才允许来自模型自然语言。
- 模型可基于 EvidencePacket 生成 `reasoning` 与 `recommendation`，但每条判断必须引用真实 evidence ID；服务端校验通过后才能进入 Outcome，且不得改变可信 `decision` 或虚构未发生的写入。

## Evaluation 约定

- 评测系统复用 `runAgentTask()` 和真实工具注册表，不维护另一套执行逻辑。
- 每个评测 case 执行前必须重置沙箱，避免前一个 case 的退款或工单状态污染后续评分。
- MVP 阶段优先使用 deterministic judge，根据 trace、工具调用、审批步骤和沙箱最终状态评分；LLM Judge 后续再接入。
- 评测结果需要保留 runId，便于从失败 case 回溯到完整 AgentRun trace。
- Week 12 起，评测 case 需要声明能力分组，前端可按分组筛选或只运行某一组 case。
- 评分器需要输出断言诊断、工具调用轨迹和失败断言数量，便于前端详情面板直接定位问题。
- 批量评测完成时应对比上一轮 completed 评测结果，标记 `regressed`、`recovered`、`unchanged_*` 或 `new`。
- 评测存储读取旧版本地 JSON 时要做兼容归一化，避免阶段升级后历史结果无法渲染。
- 原规划要求评测集保持 10-20 条 golden task，新增 case 时优先覆盖真实业务风险，而不是只复制已有路径。
- 查询类 case 应断言只读工具调用、结果包含/排除关键工单号，并禁止触发退款或工单状态写入工具。
- executor 需要维护 run 级 `metrics`，包含 LLM 调用次数、工具调用次数、模型名和 token usage，评测汇总直接复用这些指标。
- provider 如果拿不到真实 usage，应为 Mock/fallback 提供估算 token，保证本地 Demo 的评测看板不缺指标。
- 每次评测 run 需要保存 provider、model、promptVersion 和 mock/real 模式，便于对比不同模型或 Prompt 配置效果。
- 真实 Provider 评测中只要触发 Mock fallback，该 case 不得判定为通过。
- 业务结论优先断言 `outcomeDecision`、工具轨迹和沙箱副作用；自然语言包含断言只用于稳定实体或展示完整性，不应用固定措辞代替业务语义。
- CI 质量门禁统一执行测试、类型检查、构建和完整 Mock Golden Task；任一评测失败或异常都必须使流水线失败。
- CI 生成的评测 Markdown/JSON 保存到 `.agentflow-artifacts/` 并作为流水线产物上传，不提交到 Git。
