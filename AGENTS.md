# AgentFlow Sandbox Coding Notes

## 代码生成要求

以后在本项目中生成或修改代码时，需要遵守以下约定：

- 在关键逻辑位置添加简洁注释，帮助理解代码意图。
- 后端接口和关键函数需要添加注释。
- 涉及前后端通信、SSE、Agent 执行流程、工具调用、状态流转、错误处理等核心逻辑时，优先补充注释。
- 新增较复杂模块时，同步在本文件中补充必要的项目级说明或协作约定。
- 保持注释克制，避免把每一行代码都解释一遍。

## 当前重点关注区域

- `apps/web/src/App.vue`：前端任务提交、SSE 监听、执行时间线渲染。
- `apps/server/src/main.ts`：Fastify 路由、SSE 响应流。
- `apps/server/src/agent/executor.ts`：Agent 执行流程、步骤事件生成。
- `apps/server/src/llm/*`：LLM 配置、Prompt 和 Provider 封装。
- `packages/shared/src/index.ts`：前后端共享类型和事件契约。

## LLM 接入约定

- `executor.ts` 只编排业务流程，不直接写模型 HTTP 请求。
- 真实模型调用统一放在 `apps/server/src/llm/provider.ts`。
- Prompt 模板统一放在 `apps/server/src/llm/prompts.ts`，避免散落在执行器里。
- 没有 API Key 时必须保持 Mock fallback，保证本地 Demo 可运行。
