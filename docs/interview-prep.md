# AgentFlow 社招面试准备文档

> 本文档将当前项目作为社招项目，系统梳理面试所需的技术亮点、项目深度、高频问题与答题策略。
> 目标岗位：中高级前端/全栈/后端工程师（3-5年经验），技术栈 TypeScript / Node.js / Vue / AI Agent

---

## 目录

1. [项目总览与一页纸自我介绍](#1-项目总览与一页纸自我介绍)
2. [技术栈速览](#2-技术栈速览)
3. [六大技术亮点详解](#3-六大技术亮点详解)
4. [高频面试问题与答题策略](#4-高频面试问题与答题策略)
5. [STAR 面试故事模板](#5-star-面试故事模板)
6. [简历项目描述建议](#6-简历项目描述建议)
7. [面试官可能的追问方向](#7-面试官可能的追问方向)
8. [21天准备计划](#8-21天准备计划)

---

## 1. 项目总览与一页纸自我介绍

### 项目定位

> AgentFlow 是一个**企业级 AI Agent 执行与评测平台**。它以工单处理和退款审批为业务场景，核心解决 LLM 在企业落地时面临的四类工程问题：**受控执行、高风险人工接管、全链路可观测、可重复评测**。

### 一句话自我介绍（开场用）

> "我做的是一个企业级 AI Agent 执行与评测平台。它不是简单调 API 的聊天 Demo——Agent 会先生成结构化计划，Executor 按步骤授予最小工具权限，所有参数经过服务端 Schema 校验；高风险操作在真正写入前暂停等待人工审批；每次运行都保存完整 trace，供审计和自动化回归使用。"

### 30秒版本（如果面试官说"简单介绍一下你的项目"）

> "这个项目叫 AgentFlow，是一个 AI Agent 运行时和评测平台。核心架构是 Planner-Executor-Replanner：Planner 先生成计划，每步只授权一个工具；Executor 严格按计划执行，高风险操作走人工审批；工具失败时 Replanner 只重规划未完成的步骤。另外我们还做了一个完全确定性的评测体系，18 条 golden test case 覆盖了查询、退款、审批、安全、幂等性等场景，用来做回归测试。技术栈是 Fastify + Vue 3 + TypeScript，LLM 层封装了 OpenAI-compatible 接口，也支持 Mock 模式在本地跑完整 Demo。"

### 项目量级（应对"项目规模"类问题）

| 指标 | 数值 |
|------|------|
| 源码总行数 | ~11,800 行 |
| 服务端源文件 | 23 个 |
| 前端组件 | 10+ 个 |
| 内置评测用例 | 18 条 |
| 开发周期 | ~14 周（每周一个功能迭代） |
| 构建工具 | pnpm monorepo |
| 后端框架 | Fastify v4 |
| 前端框架 | Vue 3 + Vite 5 |

---

## 2. 技术栈速览

### 核心技术栈

| 层级 | 技术 | 熟练度要求 |
|------|------|-----------|
| **语言** | TypeScript (ES2022, strict mode) | 精通 — 面试重点 |
| **后端框架** | Fastify v4 | 熟悉 — 能说出和 Express 的区别 |
| **前端框架** | Vue 3 Composition API + `<script setup>` | 熟悉 — 响应式原理、组合式 API |
| **构建** | Vite 5 + pnpm workspace | 了解 |
| **Schema 校验** | Zod v3 | 精通 — 项目亮点之一 |
| **AI/LLM** | OpenAI-compatible Chat Completions API | 熟悉 — Function Calling、Token 管理 |
| **实时通信** | SSE (Server-Sent Events) | 熟悉 — 和 WebSocket 的区别和选型 |
| **持久化** | 本地 JSON 文件 | 了解 — 非项目的生产级方案 |
| **测试/评测** | 确定性规则评分（非 LLM Judge） | 精通 — 项目的独特亮点 |

### 可迁移的技术深度

| 技术点 | 面试时可横向迁移到的话题 |
|--------|------------------------|
| Zod Schema 校验 | 前后端校验一致性、运行时类型安全 |
| AsyncGenerator | 流式数据处理、背压控制 |
| SSE 事件流 | 实时通信方案对比、断连恢复 |
| 插件式 Provider | 策略模式、依赖倒置、接口抽象 |
| 确定性评测 | 测试金字塔、回归测试、契约测试 |

---

## 3. 六大技术亮点详解

> 这六个点是你在面试中的"武器库"，每个都应该能展开讲解 5-10 分钟。
> 面试时不要一口气全讲完，看面试官的兴趣方向，挑 2-3 个深度展开。

---

### 亮点一：受约束的 Agent 执行架构 (Planner-Executor-Replanner)

#### 解决了什么问题

普通 LLM Agent（如直接使用 OpenAI Function Calling）让模型自由选择工具，存在三个问题：

1. **模型可能跳步** — 跳过前置核查直接执行写入操作
2. **模型可能越权** — 调用未授权的工具或超出范围的操作
3. **模型可能绕过程序** — 在工具失败后直接生成"已完成"的结论

#### 架构设计

```
用户任务 → Planner(生成结构化计划) → Executor(逐步执行) → 完成
                                          ↑ 失败时 ↓
                                       Replanner(重规划)
```

**关键约束：**

- 每个计划步骤只授权 **一项工具**（`allowedTools: [toolName]`），不给模型选择权
- Executor 每步检查模型调用的工具是否在当前步骤授权列表中
- 计划步骤上限 **6 步**，工具调用循环上限 **10 轮**
- 模型返回纯文本试图跳过工具时，Executor 强制拦截并继续执行

#### 代码锚点

```typescript
// executor.ts L974 — 每步检查工具授权
if (!activePlanStep.allowedTools.includes(toolCall.name)) {
  throw new Error(
    `Tool ${toolCall.name} is not authorized for current plan step ${activePlanStep.id}`,
  );
}
```

#### 面试话术

> "我们采用的是 Planner-Executor-Replanner 三层架构。传统 Agent 框架一般是'给模型一堆工具，让它自己选'，但企业场景下这太不可控了。我们的方案是：Planner 先生成一个结构化的 JSON 计划，每个计划步骤只授权一个工具。Executor 拿到计划后逐步骤执行，每一步都会检查模型调用的工具是否在当前步骤的授权列表中——不在就抛错。工具失败时，Replanner 只重新规划未完成的步骤，不会重复已完成的工作。这样做的好处是：每一步都最小权限、可审计、失败不会丢掉已完成的上下文。"

---

### 亮点二：统一 Tool Registry + 双重校验机制

#### 解决了什么问题

LLM Agent 的工具定义通常有两种方式：

1. **Prompt 中描述工具** — 不安全，容易被注入
2. **OpenAI Function Calling 的 JSON Schema** — 只做建议，不做强制

这两种方式都缺少**服务端强制校验**。我们的方案是让工具定义同时在模型侧（JSON Schema）和服务端（Zod Schema）生效。

#### 设计细节

每个工具在注册表中同时维护三样东西：

```typescript
// toolRegistry.ts
const toolRegistry = {
  createRefund: {
    name: "createRefund",
    description: "创建退款记录，高风险操作",
    riskLevel: "high",  // 服务端决定风险等级
    inputSchema: z.object({  // Zod 服务端校验
      orderId: z.string(),
      amount: z.number().positive(),
      reason: z.string(),
    }),
    jsonSchema: { ... },  // JSON Schema 给模型看
    execute(input) { ... },  // 业务逻辑
  },
};
```

**三个关键设计决策：**

1. **审批属性不信任模型** — `requiresApproval` 由服务端 `riskLevel` 决定，Planner 返回的布尔值被忽略
2. **双重校验** — JSON Schema 告诉模型参数格式，Zod Schema 在服务端强制执行
3. **统一执行入口** — 所有工具走 `runTool()`，经过 `inputSchema.parse()` 后再执行

#### 面试话术

> "我们做了一个统一的 Tool Registry，每个工具同时维护了 Zod Schema（服务端校验）和 JSON Schema（传给模型）。这样做有几个好处：第一，模型看到的参数定义和服务端校验的一致，不会出现'模型传了正确的参数但服务端要求不同'的情况。第二，高风险工具的审批属性由服务端决定——即使模型在 Planner 中返回了错误的风险等级，Executor 也会忽略它，用注册表里的真实等级。第三，所有工具调用统一经过 inputSchema.parse()，从源头防止了畸形参数进入业务逻辑。"

---

### 亮点三：Human-in-the-loop 审批流

#### 解决了什么问题

退款等高危操作不能让 AI 自动执行，必须有人工审批环节。但审批流不能阻塞整个 Agent 执行，也不能在审批后出现不一致状态。

#### 实现方案

```
Executor 遇到高风险工具
  → 创建 ApprovalRequest
  → 通过 SSE 推送 approval_required 事件
  → 暂停执行，等待前端用户操作
  → 用户批准 → 继续执行工具
  → 用户拒绝 → 回传拒绝结果给 LLM，生成拒绝结论
```

**原子性保证：**

- 拒绝后不创建退款记录
- 拒绝后不更新工单状态
- 拒绝后 LLM 生成"审批已拒绝"感知的最终回复

#### 代码锚点

```typescript
// executor.ts L1050-L1062
if (tool.riskLevel === "high") {
  const rejectedToolMessage = yield* requestApprovalForTool(run, stepIndex++, toolCall, mode);
  if (rejectedToolMessage) {
    messages.push(rejectedToolMessage);
    const finalStep = await buildFinalConclusionStep(run, stepIndex++, "人工已拒绝...");
    yield addStep(run, finalStep);
    return;  // 直接结束，不走后续步骤
  }
}
```

#### 面试话术

> "高风险操作的审批是我们比较有特色的设计。Executor 遇到 riskLevel 为 high 的工具时，会暂停执行、创建审批请求并通过 SSE 推送给你端。关键设计点是：这个暂停是 Promise-based 的，用 AsyncGenerator 实现了一个看上去同步的异步暂停，代码可读性很好。另外我们保证了业务原子性：如果审批拒绝，不仅不会执行退款，连后续的工单状态更新也不会执行。LLM 会收到结构化的拒绝信息，并在最终回复中体现'审批已拒绝'，而不是假装操作成功了。"

---

### 亮点四：工具失败自动重试 + 恢复校验

#### 解决了什么问题

LLM 调用工具失败后，一个常见的问题是：**模型会直接生成"已完成"的结论，掩盖真正的失败**。例如 searchPolicy 返回空结果，模型可能说"已检索到规则"而不是说"没有匹配规则"。

#### 实现方案

**双重重试机制：**

1. **参数级重试**（最多 2 次）
   - 参数校验失败 → 让模型修正参数重试
   - 关键词未命中 → 换用更贴近业务语义的关键词重试
   - 工具选择错误 → 重新选择合法工具
   - 明确不存在的业务对象 → 不再重试

2. **结论级恢复校验**
   - 关键工具失败后，模型想直接生成文本 → Executor 拦截
   - 最多 2 次恢复提醒
   - 超限后生成 `TOOL_RECOVERY_INCOMPLETE` 错误

```typescript
// 典型的恢复校验拦截
if (pendingRecovery) {
  if (pendingRecovery.promptAttempts < MAX_TOOL_RETRY_ATTEMPTS) {
    // 拦截并提醒模型继续重试
    messages.push(buildRecoveryInstructionMessage(pendingRecovery));
    continue;
  }
  // 超限，生成恢复未完成错误
  throw new AgentExecutionError(buildRecoveryIncompleteError(pendingRecovery));
}
```

#### 面试话术

> "工具失败处理这块我们做得比较细致。我们有一个 decideToolRetry 函数，根据错误类型判断是否值得重试——参数校验失败可以修，关键词没命中可以换词重试，但业务对象不存在就不重试了。重试时通过 tool message 把结构化错误信息回传给模型，让模型理解到底哪里错了。更重要的一个设计是恢复校验：如果关键工具失败了，模型尝试直接生成'已完成'的文本，Executor 会拦截并强制要求模型继续重试。最多提醒 2 次，如果模型还是无法完成，就生成一个 TOOL_RECOVERY_INCOMPLETE 错误。这样就避免了'假装成功'的情况。"

---

### 亮点五：确定性评测体系

#### 解决了什么问题

Agent 的行为受 LLM 随机性、Prompt 改动、模型升级等因素影响。传统测试方法无法覆盖"Agent 是否按照预期调用了工具"、"业务状态是否符合预期"这类问题。如果用 LLM-as-Judge，成本高且不可靠。

#### 实现方案

**18 条 Golden Test Case，覆盖 6 大能力组：**

| 能力组 | 用例数 | 示例 |
|--------|--------|------|
| 查询能力 | 3 | 查询所有工单、筛选高优先级工单 |
| 知识检索 | 5 | 简短处理指令自动决策 |
| 退款链路 | 3 | VIP 客户退款全流程 |
| 审批边界 | 3 | 拒绝后的工单状态不更新 |
| 异常安全 | 4 | 不存在的工单、case 归一化 |
| 幂等性 | 1 | 重复退款防止 |

**每条用例的断言维度：**

```typescript
expectations: {
  requiredTools: ["getTicket", "getCustomer", ...],  // 必须调用的工具
  forbiddenTools: ["createRefund"],                   // 禁止调用的工具
  requiresApproval: true,                             // 是否需要审批
  runStatus: "completed",                             // 运行状态
  finalMessageIncludes: ["T-1001"],                   // 最终回复关键词
  ticketStatus: { ticketId: "T-1001", status: "waiting_approval" },  // 业务状态
  totalRefundCount: 1,                                // 退款记录数量
}
```

**为什么不用 LLM Judge：**

- 零额外成本（不消耗 token）
- 100% 确定性和可重复
- 回归对比精确到每条断言

#### 面试话术

> "评测体系是我们项目的一个特色。我们有 18 条 golden test case，覆盖了查询、退款、审批、安全、幂等性等 6 大能力组。每条 case 定义了明确的预期——必须调哪些工具、禁止调哪些工具、最终回复要包含什么、沙箱业务状态最后变成什么样。评分器是纯规则化的，检查 Agent 执行后的 trace 和沙箱快照，不做 LLM-as-Judge。这样做的好处：第一是完全确定性，同样的 Agent 改同样的 Prompt，跑出来结果完全一致；第二是零额外成本，不消耗 API token；第三是支持回归对比，能精确看到这次改动了哪些 case 从 pass 变成了 fail。"

---

### 亮点六：模型层解耦 + Mock Fallback

#### 解决了什么问题

项目依赖特定的 LLM 供应商（如 OpenAI），没有 API Key 时无法运行。评测需要在不同模型间对比，但代码不应该耦合到具体模型。

#### 实现方案

**统一 Provider 抽象：**

```typescript
// provider.ts
export async function generateText(input: GenerateTextInput): Promise<GenerateTextResult>
export async function generateChat(input: GenerateChatInput): Promise<GenerateChatResult>
```

- `generateText` — 用于 Plan 生成、Final Conclusion 等纯文本任务
- `generateChat` — 用于 Tool Calling 循环

**Mock LLM 与真实模型走同一条链路：**

- Mock 输出与真实模型同构的结构化计划（JSON 格式一致）
- Mock 支持完整的 Tool Calling 流程（工单查询→客户核查→订单核查→政策检索→退款判断）
- Mock 最终回复也经过 Final Conclusion 阶段，保证输出风格一致

**自动降级机制：**

```typescript
if (config.mock || !config.apiKey || config.provider === "mock") {
  return createMockTextResult(input);  // Mock 模式
}
try {
  // 调用真实 API...
} catch (error) {
  if (!config.fallbackOnError) throw error;
  return createMockTextResult(input, `${config.model} -> mock-fallback`);
  // 失败后自动降级到 Mock，带 fallback 标记
}
```

#### 面试话术

> "LLM 层我们做了统一封装，对外暴露 generateText 和 generateChat 两个方法，底层可以切换 OpenAI、DeepSeek 或者 Mock。Mock 模式下，LLM 也会输出和真实模型完全同构的结构化计划和工具调用，不走特殊路径。这在本地开发和 CI 中特别有用——没有 API Key 也能跑完整 Demo，而且所有评测用例在 Mock 模式下也能跑。还有一个自动降级机制：如果配置了真实模型但调用失败了，会自动 fallback 到 Mock，保证演示不中断。"

---

## 4. 高频面试问题与答题策略

> 以下按"为什么做 → 怎么做 → 有什么难点 → 效果如何"的结构组织答案。

---

### Q1: 为什么不用 LangChain / AutoGPT / Semantic Kernel？

**考察点**：技术选型能力、对现有生态的了解、独立判断力。

**答**：

> "在做这个项目之前，我调研了 LangChain、AutoGPT 和 Semantic Kernel。最终选择自研的原因有三点：
>
> **第一，控制粒度问题。** LangChain 的 Agent Executor 本质上是一个循环——给模型工具列表，让它自己选、自己调。但在企业场景中，我们需要精确控制每一步能调什么工具、不能调什么工具，甚至需要拒绝模型调某个工具。LangChain 的 Agent 模式做不到"每步只授权一个工具"这种粒度的控制。
>
> **第二，审批流的集成。** 我们需要在 Agent 执行流中嵌入人工审批——遇到高风险工具要暂停、等人点了按钮再继续。LangChain 的 callback 机制可以实现通知，但暂停和恢复的逻辑比较复杂。我们的 AsyncGenerator + Promise 的方案代码量很小但流程很清晰。
>
> **第三，评测的可重复性。** LangChain 生态中没有成熟的确定性评测方案。我们的评测体系是规则的、确定性的、零成本的——不依赖 LLM Judge。这在 LangChain 中很难做到。
>
> 当然 LangChain 生态丰富，我们不是要重复造轮子。但在 Agent 执行器的核心架构上，可控性的需求让我们选择了自研。整个核心执行器代码不到 1300 行，但要实现同样的功能在 LangChain 里可能要绕过很多抽象层。"

---

### Q2: 如何处理 LLM 输出的不确定性？

**考察点**：对 LLM 局限性认知、防御性编程、架构层面的鲁棒性设计。

**答**：

> "我们分三个层面来处理：
>
> **第一，结构化输出 + 服务端校验。** Planner 输出的是 JSON，Executor 会做严格的 schema 校验——version 必须是 1、steps 不能超过 6 个、每个步骤必须授权一个且只能一个已注册工具、步骤 ID 不能重复。不合规就抛错，不给模型'编造'的机会。
>
> **第二，安全边界在服务端，不在 Prompt。** Prompt 只是建议，不是安全边界。高风险工具的审批属性由服务端的 riskLevel 决定，不信任 Planner 返回的 requiresApproval。Action Planner 生成了退款动作后，Executor 还会检查任务原文中是否真的有退款诉求——没有就不执行。
>
> **第三，失败恢复的兜底。** 工具失败后，模型可能想直接说'已完成了'蒙混过关。我们的恢复校验机制会拦截这种尝试，最多提醒 2 次要求继续重试。如果模型确实无法完成，生成一个明确的 TOOL_RECOVERY_INCOMPLETE 错误，而不是让用户以为操作成功了。"

---

### Q3: SSE 流式执行怎么实现的？断连如何处理？

**考察点**：实时通信方案理解、错误恢复机制设计。

**答**：

> "SSE 这块，后端 Agent 执行器是一个 AsyncGenerator，每完成一个步骤就 yield 一个事件。Fastify 路由层拿到这个 generator 后，把事件序列化成 SSE 格式推给前端。前端用 EventSource 连接，监听不同的事件类型来更新 UI。
>
> 关于断连恢复：我们做了几个设计。第一，每次 Agent 运行完成后会持久化一个 AgentRun 快照，包含完整的步骤、计划、审批记录、指标。第二，前端刷新后可以通过 API 恢复查看已完成的 run。第三，服务重启时，running 或 waiting_approval 的 run 会被降级为 failed/interrupted 状态——因为 executor 的 Promise 对象在进程间不能存活。前端会展示可重试的提示。
>
> 与 WebSocket 的选择上，我们选择了 SSE 因为这里是单向事件推送（后端→前端），不需要双向通信。SSE 原生支持断连重连（EventSource 会自动重连），比 WebSocket 更简单。"

---

### Q4: 这个项目最大的技术挑战是什么？

**考察点**：技术深度、问题定位能力、系统性思考。

**答**：

> "最大的挑战是在保证 Agent 灵活性的同时实现企业级的可控性。具体有几个子问题：
>
> **1. 计划粒度与执行灵活性的平衡。** 如果计划太粗 — 比如直接说'处理退款'，模型自由度太高，容易跳过关键前置步骤。如果计划太细 — Planner 要预测每一步，又太僵化。我们的方案是分层规划：首轮 Planner 只做只读核查，所有写入动作交给 Action Planner 在核查完成后决策。这样既有结构性，又有灵活性。
>
> **2. 审批流与执行流的耦合。** 高风险工具需要暂停执行、等人工审批、再无缝恢复。传统的 callback 模式会打散流程。我们用了 AsyncGenerator + Promise 的方案，在 generator 中 yield 出审批事件，外部通过 resolve/reject 控制 Promise 来恢复。代码看起来像是同步顺序执行的，但实际是异步流式的。
>
> **3. 评测的确定性。** Agent 行为受 LLM 随机性影响，不能像传统软件那样用 assert 断言函数返回值。我们想了很久，最终的方案是：每条评测用例同时断言工具轨迹、业务状态变化、最终回复关键词这三个维度。工具轨迹是确定性的（调了就是调了），业务状态是确定性的（沙箱是可控的），回复关键词虽然是文本但也是确定性的（包含特定字符串）。三者结合，实现了不需要 LLM Judge 的确定性评测。"

---

### Q5: Prompt Injection 怎么防御？

**考察点**：安全意识、AI 安全常识。

**答**：

> "我们遵循了一个核心原则：**安全边界在服务端代码，不在 Prompt 中。** Prompt 只是给模型的指令，模型可以被绕过，所以不能依赖 Prompt 做安全控制。
>
> 具体措施有四点：
>
> 第一，所有工具参数必须经过 Zod schema 校验。就算模型被注入后传了恶意参数，`inputSchema.parse()` 会在服务端拦截。
>
> 第二，高风险操作的审批属性由服务端工具定义的 `riskLevel` 决定。Planner 返回的 `requiresApproval: false` 会被 Executor 覆盖。就算 Prompt 被注入让模型认为退款是低风险操作，服务端也不认。
>
> 第三，Action Planner 生成写入动作后，Executor 会二次检查任务原文中是否有明确的退款诉求。没有就不执行写入。
>
> 第四，审批拒绝后，Executor 会阻止后续所有写入操作，不会出现'只拒绝退款但工单状态已变更'的半成品状态。这里我们用了 return 而非 throw——直接结束执行，不走后续任何步骤。"

---

### Q6: 如果要把这个项目做到生产级，还需要做什么？

**考察点**：工程化意识、生产环境认知、架构演进能力。

**答**：

> "当前项目是一个工程化的技术 Demo，要上生产还需要很多工作：
>
> **持久化层：** 现在的本地 JSON 文件需要替换成真正的数据库（PostgreSQL）。审批状态需要事务性保证，AgentRun 的写入需要支持并发。
>
> **分布式支持：** 现在的 Agent 执行是单进程的，executor 的 Promise 状态不能跨进程存在。生产级需要引入任务队列（如 Bull/Redis），把每个计划步骤做成一个可恢复的 job，支持分布式 Worker。
>
> **认证与授权：** 现在没有用户系统。生产级需要集成 OAuth/SSO，审批流需要知道谁有权限做什么操作。
>
> **监控与告警：** 需要一个 Agent Ops 面板，监控工具调用成功率、平均执行时长、审批超时率、Token 消耗趋势等。
>
> **评测的持续集成：** 现在的评测是 CLI 手动跑的。生产级应该集成到 CI/CD 流水线中，每次部署前自动跑全量回归，不通过就不允许上线。"

---

### Q7: 你的评测和传统自动化测试有什么不同？

**考察点**：对测试理论的理解、Agent 测试的特殊性认知。

**答**：

> "传统自动化测试的断言目标是确定的——函数返回值、API 响应体、UI 元素的属性。但 Agent 测试有三个额外的维度：
>
> 第一，**行为轨迹测试**：我们不仅要检查结果对不对，还要检查 Agent 是**怎么**得到这个结果的。比如'查询所有工单'这条 case，我们断言它必须调 listTickets，不能调 createRefund。这相当于 Agent 版本的"调用链路追踪"。
>
> 第二，**副作用测试**：Agent 调用工具后会改变业务状态。我们需要检查沙箱的最终业务状态是否符合预期——工单是不是 waiting_approval、退款记录是不是只有一条。这相当于"端到端的业务验收"。
>
> 第三，**回归敏感性**：Agent 的行为是不稳定的，修改一个 Prompt 可能同时影响多个无关的能力组。我们的评测每次运行都会对比上一次的结果，标记每个 case 是 regressed、recovered 还是 unchanged。这相当于"Agent 行为的全量回归"。"

---

## 5. STAR 面试故事模板

> STAR = Situation（背景）→ Task（任务）→ Action（行动）→ Result（结果）
> 每个故事控制在 3-5 分钟，重点在 Action 部分。

---

### 故事一：从零搭建受约束的 Agent 执行架构

| 环节 | 内容 |
|------|------|
| **Situation** | 需要构建一个企业级 AI Agent 来处理工单和退款。但现有框架（LangChain）让模型自由选择工具，无法控制调用顺序和授权范围。项目经理反馈之前 PoC 中出现了模型跳过客资核查直接执行退款的问题。 |
| **Task** | 设计一套能精确控制工具调用、支持分步授权、防止模型越权或跳步的 Agent 执行架构。 |
| **Action** | 我设计并实现了 Planner-Executor-Replanner 三层架构。关键设计决策：1）Planner 输出的每个计划步骤只授权一项工具，模型没有选择空间；2）Executor 每步严格校验模型调用是否在授权范围内，不在就抛错；3）设计了完整的计划校验逻辑（parseAgentPlan），version、steps 数量、工具名、步骤 ID 全部校验；4）工具失败时 Replanner 只重规划未完成步骤，不会重复已完成的工作；5）Action Planner 在只读核查完成后才决策是否追加写入动作，且必须基于已执行的真实业务证据。 |
| **Result** | 系统支持 8 种业务工具的有序调用，模型越权率和跳步率降为零。整个执行器约 1300 行 TypeScript 代码，远少于同类框架的代理实现。 |

---

### 故事二：实现 Human-in-the-loop 审批机制

| 环节 | 内容 |
|------|------|
| **Situation** | 退款等高风险操作不能让 AI 自动执行，但审批又不能完全脱离 Agent 工作流。之前的设计是在 Agent 执行前一次性审批，灵活性不足。 |
| **Task** | 设计一套在运行时暂停 Agent 执行、等待人工审批、然后无缝恢复的审批机制，同时保证无论批准还是拒绝，业务状态都保持一致。 |
| **Action** | 我用 AsyncGenerator + Promise 实现了同步风格的审批暂停。遇到高风险工具时：1）生成 ApprovalRequest 并通过 SSE 推送 approval_required 事件给前端；2）然后 yield 出事件后 await 一个 Promise——这个 Promise 在前端用户点击批准/拒绝时由外部 resolve；3）审批通过则执行工具，审批拒绝则回传拒绝信息给 LLM，并阻止后续所有写入步骤。核心原子性保证：拒绝后的代码直接 return 而不是 throw，确保不走后续任何业务步骤。前端展示的审批卡片有实时倒计时和操作按钮。 |
| **Result** | 审批流无缝嵌入 Agent 执行，用户无需另开页面操作。拒绝后的业务一致性被 3 条专门的安全测试用例覆盖并验证通过。 |

---

### 故事三：构建确定性评测体系

| 环节 | 内容 |
|------|------|
| **Situation** | Agent 行为不稳定，改 Prompt 可能引入回归。之前靠手动测试 18 个业务场景，每次改完需要花 1-2 小时验证。而且同一个 Prompt 在 GPT-4 和 DeepSeek 上的表现不一样，难以对比。 |
| **Task** | 设计一套低成本、可重复、自动化的 Agent 评测体系，支持回归检测和多模型对比。 |
| **Action** | 我先设计了 EvaluationCase 的契约结构——每条 case 定义 task、expectations（requiredTools、forbiddenTools、approval、final message、sandbox state）。然后实现了确定性评分器（EvaluationScorer），基于 run trace 和沙箱最终状态做规则化断言，不依赖 LLM Judge。评测 Runner 每次重新初始化沙箱、走真实执行路径、自动对比上一次运行结果并标记 regressed/recovered。我陆续写了 18 条 golden test case，覆盖 6 大能力组。最后在评测面板中增加了能力组筛选、单条 case 详情、断言诊断、A/B 对比等交互功能。 |
| **Result** | 全量评测 30 秒左右跑完，零 API 成本（Mock 模式），每次改动自动标记回归。后续在切换模型供应商时，评测体系成功发现了 3 处行为差异。 |

---

## 6. 简历项目描述建议

### 简洁版（简历空间有限时）

> **AgentFlow — 企业级 AI Agent 执行与评测平台** | TypeScript, Vue 3, Fastify, OpenAI API
>
> - 设计并实现了 **Planner-Executor-Replanner** 三层 Agent 执行架构，每步只授权一项工具，通过服务端校验防止模型跳步或越权调用
> - 实现 **Human-in-the-loop 审批机制**，高风险操作通过 SSE 推送审批事件，拒绝后保证业务原子性
> - 构建 **Tool Registry**，同时维护 Zod 服务端校验和 JSON Schema 模型定义，所有入参双层校验
> - 实现 **工具失败自动重试 + 恢复校验**，防止模型在工具失败后直接生成"已完成"结论
> - 设计 **18 条确定性评测用例**（6 大能力组），通过规则化评分实现零成本、可重复的 Agent 回归测试
> - 实现 **OpenAI-compatible LLM Provider**，支持多模型切换和 Mock Fallback

### 详细版（面试作品集时使用）

> **AgentFlow — 企业级 AI Agent 执行与评测平台**
>
> **技术栈：** TypeScript, Vue 3 (Composition API), Fastify, Zod, pnpm Monorepo, OpenAI API, SSE
>
> **项目概述：** 面向企业工单处理和退款审批场景的 AI Agent Runtime，重点解决 LLM 在企业落地时的可控性、安全性和可评测性问题。不是简单的聊天 Demo——Agent 生成结构化计划、Executor 按最小权限执行、高风险操作走人工审批、所有 trace 可审计。
>
> **核心贡献：**
>
> 1. **受约束的 Agent 执行器**：设计 Planner-Executor-Replanner 架构，Planner 输出结构化 JSON 计划（版本、摘要、步骤），每步只授权一个工具；Executor 严格校验每步的工具授权，拒绝越权调用；Replanner 仅在工具失败时重规划未完成步骤。计划步骤最多 6 步，工具调用 10 轮上限。
>
> 2. **Human-in-the-loop 审批流**：利用 AsyncGenerator + Promise 实现运行时审批暂停与恢复。高风险工具（createRefund）进入等待审批状态，拒绝后业务状态保持原子性（不创建退款、不更新工单）。支持 interactive/auto/auto-reject 三种模式。
>
> 3. **统一 Tool Registry**：集中管理 8 种业务工具，同时维护 Zod Schema（服务端校验）和 JSON Schema（模型定义）。审批属性由服务端 riskLevel 决定，不信任模型返回值。实现了双重校验确保参数安全。
>
> 4. **工具失败自动重试与恢复校验**：根据错误类型判断是否可重试，最多 2 次自动重试。关键工具失败后如果模型尝试跳过，Executor 拦截并强制恢复，最多 2 次提醒后生成明确失败错误（TOOL_RECOVERY_INCOMPLETE）。
>
> 5. **确定性评测体系**：18 条 golden test case，覆盖查询、退款、审批、安全、幂等性等 6 大能力组。规则化评分器基于 trace 和沙箱状态做断言（工具轨迹、业务状态、回复关键词），零成本、可重复、支持回归对比。
>
> 6. **模型层解耦**：统一 Provider 封装，支持 OpenAI/DeepSeek/Mock 切换。Mock 输出与真实模型同构，走同一执行路径。真实模型失败自动降级到 Mock，保证演示不中断。

---

## 7. 面试官可能的追问方向

| 追问方向 | 可能的追问 | 准备建议 |
|----------|-----------|---------|
| **架构设计** | "Planner 和 Replanner 的 Prompt 怎么设计的？如何避免模型输出不合规的 Plan？" | 熟悉 prompts.ts 中的系统提示词设计和 parseAgentPlan 的校验逻辑 |
| **并发与状态** | "如果两个请求同时处理工单 T-1001，会有什么问题？" | 讲清楚当前是单进程内存沙箱，以及生产级需要加分布式锁或队列 |
| **持久化方案** | "JSON 文件持久化怎么保证不丢数据？" | 了解 persistentState.ts 的原子写入 + 重试逻辑，以及和生产级方案的差距 |
| **评测覆盖度** | "18 条用例能覆盖所有 Agent 行为吗？怎么设计新用例？" | 讲清楚从业务场景出发 + 边界条件 + 异常路径的方法论 |
| **前端实现** | "SSE 事件在前端怎么处理的？EventSource 断连怎么恢复？" | 熟悉 api/index.ts 中 EventSource 的封装和断连处理 |
| **多模型对比** | "同一个 Task 在 GPT-4 和 DeepSeek 上结果不同，怎么办？" | 讲评测体系的 A/B 对比功能和回归检测机制 |
| **权限模型** | "如果想要不同角色的审批权限不同，怎么改？" | 可以谈 ApprovalStore 扩展、角色与审批策略映射 |
| **可观测性** | "怎么监控 Agent 的健康状态？" | 可以谈运行指标（调用次数、Token 消耗、成功率）、/health 端点、未来可以做的 APM 集成 |

---

## 8. 21天准备计划

### 第一阶段：熟悉代码和架构（第1-7天）

| 天数 | 任务 | 具体内容 |
|------|------|---------|
| 第1天 | 整体概览 | 通读 README.md、docs/architecture.md，理解项目全貌和执行链路 |
| 第2天 | 核心执行器 | 精读 executor.ts（~1300行），理解 Planner-Executor-Replanner 循环 |
| 第3天 | Tool Registry | 精读 toolRegistry.ts，理解工具注册和双重校验 |
| 第4天 | LLM Provider | 精读 provider.ts，理解模型封装和 Mock 机制 |
| 第5天 | 评测体系 | 精读 evaluationRunner.ts、evaluationScorer.ts、evaluationCases.ts |
| 第6天 | 前端 + 共享层 | 浏览前端组件和 shared/index.ts 的类型定义 |
| 第7天 | 整体复盘 | 画出完整的执行链路图，确保能脱稿讲清每个环节 |

### 第二阶段：准备面试话术（第8-14天）

| 天数 | 任务 | 具体内容 |
|------|------|---------|
| 第8天 | 亮点一 | 准备 Planner-Executor-Replanner 的 5 分钟讲解 |
| 第9天 | 亮点二 | 准备 Tool Registry + 双重校验的讲解 |
| 第10天 | 亮点三 | 准备 Human-in-the-loop 审批流的讲解 |
| 第11天 | 亮点四 | 准备工具失败重试 + 恢复校验的讲解 |
| 第12天 | 亮点五 | 准备确定性评测体系的讲解 |
| 第13天 | 亮点六 | 准备模型层解耦 + Mock Fallback 的讲解 |
| 第14天 | 整合 | 把六个亮点串成 10 分钟的项目总览 |

### 第三阶段：模拟面试（第15-21天）

| 天数 | 任务 | 具体内容 |
|------|------|---------|
| 第15-17天 | 高频问题 | 练习 Q1-Q7 的答案，每个控制在 3-5 分钟 |
| 第18-19天 | STAR 故事 | 练习三个 STAR 故事，每个 3-5 分钟 |
| 第20天 | 追问准备 | 熟悉追问方向的应对思路 |
| 第21天 | 全真模拟 | 找朋友或 AI 做一次完整模拟面试 |

---

> **面试准备的核心原则：**
>
> 1. **不要背稿子** — 理解设计决策背后的 why 比背诵代码更重要
> 2. **说到点子上** — 每个回答控制在 2-5 分钟，不要东拉西扯
> 3. **展示思考过程** — 解释"当时为什么这么做"而不是"代码里这么写的"
> 4. **诚实面对不足** — 当被问到"这里为什么没做成生产级"，直接说"这是 Demo 阶段的权衡"并展开生产化方案
