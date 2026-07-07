# AgentFlow Sandbox

AgentFlow Sandbox 是一个面向企业流程自动化的 AI Agent 沙箱项目。当前场景模拟“企业工单处理”：用户输入任务后，Agent 会生成处理计划，通过 LLM Tool Calling 调用沙箱业务工具，遇到高风险动作时等待人工审批，并通过 SSE 实时展示完整执行 trace。

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
  -> LLM 生成执行计划
  -> LLM 根据 tools 定义发起 tool_calls
  -> 后端通过 Tool Registry 校验并执行工具
  -> 高风险工具进入 approval_required，前端展示批准/拒绝按钮
  -> 审批结果通过 approval_resolved 回到同一条执行流
  -> 审批通过则执行工具，审批拒绝则把拒绝结果回传给 LLM
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

## 本地运行

```bash
pnpm install
pnpm dev
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

## 当前阶段

当前已完成到 Week 10：

- Week 1-2：项目骨架、沙箱数据和工具注册。
- Week 3-4：SSE 时间线、Trace 历史、沙箱状态面板。
- Week 5：OpenAI-compatible LLM Tool Calling。
- Week 6：高风险工具人工审批。
- Week 7：单会话多轮消息流和嵌入式 run trace。
- Week 8：可恢复多会话工作台，会话列表支持创建、切换和恢复消息 trace。
- Week 9：运行控制与断线恢复，支持取消执行、重试上一条任务、中断消息提示和会话删除保护。
- Week 10：本地 JSON 持久化，支持服务重启后恢复会话和运行历史，并对未完成执行做中断降级。
