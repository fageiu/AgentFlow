# AgentFlow Sandbox Coding Notes

## 代码生成要求

以后在本项目中生成或修改代码时，需要遵守以下约定：

- 在关键逻辑位置添加简洁注释，帮助理解代码意图。
- 后端接口和关键函数需要添加注释。
- 涉及前后端通信、SSE、Agent 执行流程、工具调用、人工审批、状态流转、错误处理等核心逻辑时，优先补充注释。
- 新增较复杂模块时，同步在本文件中补充必要的项目级说明或协作约定。
- 保持注释克制，避免把每一行代码都解释一遍。

## 当前重点关注区域

- `apps/web/src/App.vue`：前端任务提交、SSE 监听、执行时间线渲染、人工审批交互。
- Week 7 起，`apps/web/src/App.vue` 采用单会话多轮消息流；每条用户消息对应一个 Agent run，trace 嵌在对应 assistant 消息下。
- `apps/server/src/main.ts`：Fastify 路由、SSE 响应流、审批接口。
- `apps/server/src/agent/executor.ts`：Agent 执行流程、步骤事件生成、Tool Calling 循环和审批暂停/恢复。
- `apps/server/src/approval/approvalStore.ts`：高风险工具调用的内存审批状态。
- `apps/server/src/llm/*`：LLM 配置、Prompt 和 Provider 封装。
- `apps/server/src/trace/runStore.ts`：AgentRun trace 历史的内存存储与摘要查询。
- `apps/server/src/tools/toolRegistry.ts`：业务工具注册、参数校验、风险等级描述。
- `packages/shared/src/index.ts`：前后端共享类型和事件契约。

## LLM 接入约定

- `executor.ts` 只编排业务流程，不直接写模型 HTTP 请求。
- 真实模型调用统一放在 `apps/server/src/llm/provider.ts`。
- Prompt 模板统一放在 `apps/server/src/llm/prompts.ts`，避免散落在执行器里。
- 没有 API Key 时必须保持 Mock fallback，保证本地 Demo 可运行。
- Tool Calling 消息统一使用 `apps/server/src/llm/types.ts` 中的内部类型，再由 provider 转换为 OpenAI-compatible 请求格式。

## Tool Registry 约定

- 新增业务工具时，先在 `sandboxTools.ts` 中实现业务函数，再在 `toolRegistry.ts` 中注册工具。
- 每个工具必须声明 `name`、`description`、`riskLevel`、`inputSchema`、`jsonSchema` 和 `execute`。
- `inputSchema` 用于后端 Zod 校验，`jsonSchema` 用于暴露给 LLM Tool Calling。
- executor 不直接调用业务函数，统一通过 `runTool()` 执行，保证 trace、参数校验和风险等级可复用。
- 只有 `listAgentTools()` 返回的工具会交给 LLM 自主调用；演示控制类工具例如 `resetSandboxState` 不应暴露给模型。

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
