# AgentFlow Sandbox

AgentFlow Sandbox 是一个面向企业流程自动化的 AI Agent 沙箱项目。当前场景模拟“企业工单处理”：用户输入任务后，Agent 会生成处理计划、查询模拟业务数据、检索规则、识别高风险动作，并生成最终处理结论。

## 当前能力

- 前端任务输入工作台。
- 后端 SSE 流式执行事件。
- 执行时间线实时展示。
- 完成后的 AgentRun trace 会保存到后端内存历史，可在前端侧边栏恢复查看。
- 模拟工单、客户、规则数据。
- Tool Registry 统一管理业务工具、参数校验和风险等级。
- OpenAI-compatible LLM Provider。
- 无 API Key 时自动使用 Mock LLM，保证本地 Demo 可运行。
- 支持 DeepSeek 等兼容 OpenAI Chat Completions 协议的模型服务。

## 项目结构

```txt
apps/
  web/                 Vue 3 + Vite 前端工作台
  server/              Fastify 后端、Agent 执行器、LLM Provider、沙箱工具
packages/
  shared/              前后端共享类型
docs/
  roadmap.md           阶段规划
```

## 执行链路

```txt
前端点击“开始执行”
  -> EventSource 连接后端 SSE 接口
  -> 后端创建 AgentRun
  -> LLM 生成执行计划
  -> 后端通过 Tool Registry 调用沙箱工具
  -> LLM 基于工具结果生成最终结论
  -> 后端持续推送 step 事件
  -> 执行完成后保存 AgentRun trace
  -> 前端追加时间线卡片
```

## Trace 历史接口

当前 trace 历史先保存在后端进程内存中，重启服务后会清空，适合本地 Demo 和执行链路验证。

- `GET /agent/runs`：获取运行历史摘要列表。
- `GET /agent/runs/:runId`：获取单次运行的完整 trace。
- `DELETE /agent/runs`：清空当前进程内的运行历史。

## LLM 配置

服务端通过 `apps/server/src/llm/provider.ts` 统一封装模型调用。当前 Provider 使用 OpenAI-compatible `/chat/completions` 接口，因此可以接 OpenAI、DeepSeek 或其他兼容服务。

### OpenAI 示例

```bash
LLM_PROVIDER=openai-compatible
LLM_MOCK=false
LLM_FALLBACK_ON_ERROR=true
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

### DeepSeek 示例

```bash
LLM_PROVIDER=openai-compatible
LLM_MOCK=false
LLM_FALLBACK_ON_ERROR=true
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

如果没有配置任何 API Key，后端会自动启用 Mock LLM。这样即使没有真实模型账号，也可以完整演示前后端链路。

本地开发时可以在项目根目录新建 `.env`，填入真实配置。`.env` 已经在 `.gitignore` 中，不要把真实 API Key 写入 `.env.example` 或提交到仓库。

## 本地运行

安装依赖：

```bash
pnpm install
```

启动前端和后端：

```bash
pnpm dev
```

常用地址：

```txt
前端：http://127.0.0.1:5173
后端健康检查：http://127.0.0.1:3001/health
SSE 执行接口：http://127.0.0.1:3001/agent/run/stream?task=处理工单%20T-1001
Trace 历史接口：http://127.0.0.1:3001/agent/runs
```

## 当前阶段目标

第一阶段重点是跑通真实产品链路：

- 用户输入任务。
- 后端生成 Agent 执行轨迹。
- LLM 参与计划和最终结论生成。
- 通过 Tool Registry 调用工单、客户、订单、退款等沙箱工具。
- 前端实时展示每个步骤。

下一阶段会继续补充：

- 让 LLM 根据工具定义选择调用工具。
- 人工审批和风险控制流程。
- 评测任务集和指标看板。
## LLM Tool Calling

当前 Agent 执行器已经接入 OpenAI-compatible Tool Calling：

- `apps/server/src/tools/toolRegistry.ts` 同时维护 Zod 入参校验和暴露给模型的 JSON Schema。
- `apps/server/src/llm/provider.ts` 负责把内部消息转换为 `/chat/completions` 的 `tools`、`tool_calls` 和 `tool` 消息。
- `apps/server/src/agent/executor.ts` 负责执行 planner -> tool loop -> final answer，不直接写模型 HTTP 请求。
- 没有 API Key 或模型请求失败时，Mock fallback 也会返回标准化 `toolCalls`，保证本地 Demo 仍能完整展示工具调用链路。

当前只把业务 Agent 必需的工具暴露给 LLM：`getTicket`、`getCustomer`、`getOrder`、`searchPolicy`、`createRefund`、`updateTicketStatus`。`resetSandboxState` 这类演示控制工具不会交给模型自主调用。
