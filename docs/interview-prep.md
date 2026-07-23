# AgentFlow 社招面试准备文档

> 本文档将当前项目作为社招项目，系统梳理面试所需的技术亮点、项目深度、高频问题与答题策略。
> 目标岗位：Agent开发/AI应用开发/AI全栈，技术栈 TypeScript / Python / Node.js / Vue / AI Agent

---

## 目录

1. [项目总览与一页纸自我介绍](#1-项目总览与一页纸自我介绍)
2. [技术栈速览](#2-技术栈速览)
3. [八大技术亮点详解](#3-八大技术亮点详解)
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

> “企业工单 Agent 执行与评测平台，是一个 AI Agent 运行时和评测平台。核心架构是 Planner-Executor-Replanner：Planner 先生成计划，每步只授权一个工具；Executor 严格按计划执行，高风险操作走人工审批；工具失败时 Replanner 只重规划未完成步骤。服务端还会根据真实工具轨迹派生结构化 Outcome，不信任模型自报成功。28 条 golden task 用确定性规则检查工具轨迹、审批和业务副作用；真实模型仍可能漂移，所以模型或 Prompt 变更后必须重新回归。技术栈是 Fastify + FastAPI、Vue 3 和 TypeScript + Python。”


### 项目量级（应对"项目规模"类问题）

| 指标 | 数值 |
|------|------|
| 源码总行数 | ~19,800 行（TypeScript / Vue / CSS / Python） |
| 服务端 TypeScript 文件 | 30 个 |
| Vue 组件 | 13 个 |
| RAG Python 文件 | 18 个 |
| 内置评测用例 | 28 条 |
| 服务端核心测试 | 44 条 |
| RAG 测试用例 | 28 条 |
| 迭代记录 | Week 1-15.2 |
| 构建工具 | pnpm monorepo + uv (Python) |
| 后端框架 | Fastify v4 + FastAPI |
| 前端框架 | Vue 3 + Vite 5 |

### 面试可引用的验证数据

| 实验 | 结果 | 正确解读 |
|------|------|----------|
| [Mock 全量基线](evaluation-results/mock-full.md) | 18/18，约 6.2 秒 | 证明确定性执行路径和 Judge 基线通过，不代表真实模型能力。注意：当前正式报告为旧版 18 套，代码已扩展至 28 套（含 15 条知识检索） |
| [DeepSeek Outcome 全量评测](evaluation-results/deepseek-post-outcome-full.md) | 17/18，94.4%，185,322 Token | 17 条通过，1 条因 Planner step 校验失败而异常 |
| [Planner 稳健性定向复测](evaluation-results/deepseek-planner-robustness-targeted.md) | 1/1 | 只证明对应幂等性失败路径恢复，不等同于全量 18/18 |

推荐口径：先说当前全量真实报告是 17/18，再说明失败 Trace 如何驱动修复以及定向复测 1/1。不要把不同批次结果相加成”18/18”。注意指出已编写 28 条评测用例，正式报告基于当时冻结的 18 条核心用例。

---

## 2. 技术栈速览

### 核心技术栈

| 层级 | 技术 | 熟练度要求 |
|------|------|-----------|
| **语言** | TypeScript (ES2022, strict mode) + Python 3.12 | 精通 TS / 熟悉 Python |
| **后端框架** | Fastify v4 + FastAPI | 熟悉 — 能说出和 Express 的区别 |
| **前端框架** | Vue 3 Composition API + `<script setup>` | 熟悉 — 响应式原理、组合式 API |
| **构建** | Vite 5 + pnpm workspace + uv | 了解 |
| **Schema 校验** | Zod v3 | 精通 — 项目亮点之一 |
| **AI/LLM** | OpenAI-compatible Chat Completions API | 熟悉 — Function Calling、Token 管理 |
| **实时通信** | SSE (Server-Sent Events) | 熟悉 — 和 WebSocket 的区别和选型 |
| **RAG 检索** | BM25 + 向量混合检索 + FastAPI | 熟悉 — 跨语言架构、混合检索策略 |
| **持久化** | 本地 JSON 文件 + SQLite（RAG 索引） | 了解 — 非项目的生产级方案 |
| **测试/评测** | Node.js `node:test` + pytest + 确定性规则评分 | 精通 — 项目的独特亮点 |
| **CI** | GitHub Actions | 熟悉 — 测试、类型检查、构建与 Mock 评测门禁 |

### 可迁移的技术深度

| 技术点 | 面试时可横向迁移到的话题 |
|--------|------------------------|
| Zod Schema 校验 | 前后端校验一致性、运行时类型安全 |
| AsyncGenerator | 流式数据处理、背压控制 |
| SSE 事件流 | 实时通信方案对比、断连恢复 |
| 插件式 Provider | 策略模式、依赖倒置、接口抽象 |
| 确定性评测 | 测试金字塔、回归测试、契约测试 |
| 混合检索 (BM25 + Vector) | 搜索系统设计、召回策略、排序融合 |
| 跨语言架构 (TS ↔ Python) | 微服务通信、异构系统集成 |
| 业务证据链 (EvidenceFacts) | 审计日志、合规追溯、可信 AI |

---

## 3. 八大技术亮点详解

> 这七个点是你在面试中的“武器库”，每个都应该能展开讲解 5-10 分钟。
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
// executor.ts — 每步检查工具授权
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

每个工具在注册表中同时维护风险、校验、模型契约和执行入口：

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
// executor.ts — 高风险工具审批分支
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

> "高风险操作的审批是我们比较有特色的设计。Executor 遇到 riskLevel 为 high 的工具时，会暂停执行、创建审批请求并通过 SSE 推送给前端。关键设计点是：这个暂停是 Promise-based 的，用 AsyncGenerator 实现了一个看上去同步的异步暂停，代码可读性很好。另外我们保证了业务原子性：如果审批拒绝，不仅不会执行退款，连后续的工单状态更新也不会执行。LLM 会收到结构化的拒绝信息，并在最终回复中体现'审批已拒绝'，而不是假装操作成功了。"

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

**28 条 Golden Test Case，覆盖 6 大能力组：**

| 能力组 | 用例数 | 示例 |
|--------|--------|------|
| 查询能力 | 3 | 查询所有工单、筛选高优先级工单 |
| 政策知识检索 | 15 | SLA 规则查询、处理指令自动决策、跨政策匹配 |
| 退款链路 | 3 | VIP 客户退款全流程 |
| 审批边界 | 2 | 非退款任务不触发审批、拒绝后的工单状态不更新 |
| 异常安全 | 4 | 不存在的工单、case 归一化、工具调用超限 |
| 幂等性 | 1 | 重复退款防止 |

说明：知识检索从 5 条大幅扩展至 15 条，配合 RAG 混合检索服务的接入，覆盖政策精准匹配、Top-K 排序与跨文档推理场景。

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

**为什么核心业务断言不用 LLM Judge：**

- 零额外成本（不消耗 token）
- 评分规则本身确定、可重复
- 回归对比精确到每条断言

需要注意：真实模型执行仍然具有非确定性；这里的“确定性”指 Judge 对同一份 Trace 和沙箱快照会给出相同结果，不代表真实模型每次都会产生相同 Trace。

#### 面试话术

> “评测体系是项目的一个特色。28 条 golden task 覆盖查询、政策知识检索、退款、审批、安全和幂等性 6 组能力。每条 case 明确声明必须和禁止调用的工具、审批行为、结构化 Outcome 以及最终沙箱状态。Judge 是纯规则化的：同一份 Trace 会得到相同评分，也不产生额外 Judge token。真实模型本身依然可能漂移，所以每次模型或 Prompt 变更都要重新跑回归，而不能把某次通过当成永久保证。”

---

### 亮点六：可信结构化 Outcome + 业务证据链

#### 解决了什么问题

LLM 的自然语言不能作为业务事实。模型可能说”退款已创建”，但工具实际失败；也可能在幂等重试中复用旧退款，却被统计成一次新写入。更棘手的是，模型可能跳过真实工具数据，直接生成一个看似合理但与事实不符的结论。

#### 实现方案

**双层架构：确定性 Outcome 派生 + 基于证据的业务决策**

**第一层：确定性 Outcome（由服务端根据 Trace 派生）**

- 模型回复只进入 `outcome.userMessage`
- 服务端根据 Run 终态、审批决议和真实工具 Trace 派生 `decision`
- 写工具返回 `operation`：`created/reused` 或 `updated/unchanged`
- 只有 `created`、`updated` 等真实副作用进入 `performedActions`

**第二层：结构化业务决策（businessDecision.ts）**

```typescript
// 从已完成工具步骤中提取可信证据
interface EvidenceFact {
  id: string;       // “tool.getTicket.output”
  source: string;   // 工具名称
  description: string;  // 描述
  value: unknown;   // 可信输出
}

// 构建证据包，交给 LLM 生成带推理链的业务结论
interface EvidencePacket {
  task: string;
  trustedDecision: AgentOutcome[“decision”];
  performedActions: string[];
  facts: EvidenceFact[];
}
```

关键设计：
- **证据溯源**：只将 `tool_call` 和 `approval` 类型的已完成步骤提取为可信事实（`isTrustedToolStep`），跳过模型生成的中间文本
- **字段级拆分**：工具输出中的每个 `string/number/boolean` 字段被拆分为独立 `EvidenceFact`，方便 LLM 引用具体数据
- **LLM 在可信证据上推理**：LLM 不直接生成结论，而是在 EvidencePacket 上执行结构化推理（`reasoning[]`），产出关联推荐（`recommendation`）
- **兜底回退**：如果模型输出包含虚假写入声明或未知证据，回退到确定性 Outcome，不做业务决策

#### 面试话术

> “我们在 Outcome 上做了双层架构。第一层是确定性的——服务端根据工具 Trace 来派生 decision：审批是否通过、写操作是 created 还是 reused。模型的语言只作为 userMessage，不作为业务事实。
>
> 第二层是新增的结构化业务决策模块。它不会再让 LLM 自由发挥结论了——而是先把已完成工具的输出提取成可信的证据事实（EvidenceFacts），把工具输出的每个字段拆成独立证据，再把这些证据打包交给 LLM。LLM 只能在证据之上做结构化推理，产出 reasoning 链和 recommendation。如果它输出了虚假声明，比如声称有退款但证据包里没有，系统就会回退到确定性 Outcome。
>
> 这样既保留了 LLM 的理解和推理能力——比如跨工具数据关联、给出处置建议——又约束了它必须在真实证据基础上推演，不能凭空编造。评测也因此更精确：我们优先断言 Outcome 的 decision 和 reasoning，而不是固定自然语言措辞。”

---

### 亮点七：模型层解耦 + Mock Fallback

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

> “LLM 层统一暴露 generateText 和 generateChat，底层可以切换 OpenAI-compatible 服务或 Mock。Mock 也输出同构的计划和 tool call，复用同一套 Executor，适合本地开发和 CI。演示环境可以选择错误时 fallback，且 Trace 会记录结构化 fallback 元数据；真实评测则强制关闭 fallback，API 失败必须记为异常，避免用 Mock 成绩冒充真实模型结果。”

---

### 亮点八：企业政策 RAG 混合检索

#### 解决了什么问题

Agent 在处理工单和退款时需要理解企业政策（SLA 规则、退款条件、安全规范等）。传统做法是把政策写在 Prompt 里，但 Prompt 长度有限且难以维护大量政策文档。Agent 需要一种可扩展的、精准的政策检索能力。

#### 实现方案

**跨语言架构：Python FastAPI RAG 服务 + TypeScript Agent 集成**

```
政策文档 → 索引管线 → SQLite 向量库
                         ↓
Agent Executor → searchPolicy → RAG 混合检索 (BM25 + 向量) → 排序融合 → 结果
```

**混合检索策略：**

```
BM25 (关键词排序)        向量相似度 (语义排序)
     ↓                          ↓
   RRF 融合 (rrf_k=60)   ←  两个来源等权按排名累加
     ↓
   阈值过滤 (≥0.35) → 最终排序结果
```

- **BM25**: 基于关键词的精确匹配，保证政策编号、术语等精确命中
- **向量检索**: 基于 sentence embedding 的语义相似度，覆盖同义表达
- **排序融合**: RRF (Reciprocal Rank Fusion) — 每个结果按排名获得 `1/(rrf_k + rank)` 分，两来源等权累加按总分重排，`rrf_k=60` 控制排名衰减速度
- **阈值过滤**: 融合结果经最低分数阈值清洗，低分噪声不进入 Agent 上下文
- **Top-K 截断**: 只返回 Top-K 最相关结果，避免模型在噪声政策中迷失

**评测保障：**

```python
# 18 条检索评测用例，覆盖精准匹配、语义泛化、边界拒绝
test_exact_policy_retrieval_by_name()     # 按政策名精确查找
test_semantic_policy_retrieval()           # 同义表达语义检索
test_empty_query_rejected()               # 空查询拒绝
test_non_existent_policy_rejected()       # 不存在政策返回空
test_top_k_truncation()                   # Top-K 截断
```

#### 面试话术

> "政策检索我们选择自建 RAG 混合检索，而不是直接把政策塞 Prompt 里或者接入第三方知识库。原因有三：第一，企业政策有精确编号和条款，纯关键词（BM25）能保证这些精确信息不丢失。第二，用户的自然语言表述和官方政策措辞可能不同——'查一下高优先级工单多久处理'和 SLA 规则表里的措辞不一定一样，语义检索能兜住这种同义表达。第三，我们用了 RRF（Reciprocal Rank Fusion）排序融合，基于排名位置而非分数加权，两个来源在融合层面等权，`rrf_k=60` 控制排名衰减速度，兼顾精确和泛化。
>
> 这个服务是 Python FastAPI 写的，18 个文件、约 2,500 行。评测方面也写了 18 条 Python 侧的检索测试用例和一个独立的 15 条知识检索 evaluation case 组。Agent 端通过 searchPolicy 工具调用它——跟其他工具一样，走 Tool Registry 的双重校验。跨语言集成只通过 HTTP JSON 通信，对 Agent 执行器来说，它和本地工具没有区别。"

---

## 4. 高频面试问题与答题策略

> 以下按"为什么做 → 怎么做 → 有什么难点 → 效果如何"的结构组织答案。

---

### Q1: 为什么不用 LangChain / AutoGPT / Semantic Kernel？

**考察点**：技术选型能力、对现有生态的了解、独立判断力。

**答**：

> "在做这个项目之前，我调研了 LangChain、AutoGPT 和 Semantic Kernel。最终选择自研的原因有三点：
>
> **第一，控制粒度问题。** 通用 Agent 框架通常默认把一组工具交给模型循环选择；我们的核心需求是每个计划步骤动态缩小到单工具授权，并在服务端直接拒绝越权。框架并非不能扩展，但需要深入改造执行循环和状态机，自研能让关键安全边界更透明。
>
> **第二，审批流的集成。** 我们需要在执行流中暂停高风险工具、保存等待状态、等 HTTP 审批决议后继续。通用 callback 更偏事件通知，而项目需要显式的暂停/恢复语义；AsyncGenerator + Promise 更贴合当前单进程状态机。
>
> **第三，评测与业务状态耦合。** 项目需要直接断言退款记录、工单状态、审批步骤和结构化 Outcome。无论是否使用框架，这部分都要围绕自己的业务工具和状态模型建设。
>
> 这个选择不是说通用框架能力不足，而是当前项目优先换取执行协议的透明度和可审计性；代价是规划、重试、持久化和评测基础设施都要自己维护。"

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
> 关于断连恢复：已完成和等待审批的阶段性 AgentRun 会保存快照，前端刷新后可以恢复查看。服务重启时，running 或 waiting_approval 的 run 会被降级为 failed/interrupted——因为 executor 的 Promise 不能跨进程存活，前端会提供重试入口。当前不会把 EventSource 重连包装成‘原 run 断点续跑’；生产版需要持久化步骤状态和任务队列。
>
> 与 WebSocket 的选择上，我们选择 SSE，因为主要数据流是后端向前端推送，审批和取消可以走独立 HTTP 请求。浏览器 EventSource 支持连接级自动重连，但当前服务端没有基于 Last-Event-ID 实现同一个 run 的事件补发，所以不能把它描述成业务级断点续传。"

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
> **发布治理：** 当前 GitHub Actions 已执行测试、类型检查、构建和完整 Mock golden task 门禁，但真实模型回归仍是单独授权运行。生产版需要定义模型/Prompt 版本发布阈值、灰度策略、线上采样评测和回滚条件。"

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

### Q8: RAG 服务是 Python 写的，TypeScript Agent 怎么和它集成？

**考察点**：跨语言架构设计、系统集成能力、RAG 知识。

**答**：

> "RAG 检索服务用 Python FastAPI 实现，提供统一的 `/retrieve` 端点。Agent 端通过 `searchPolicy` 工具调用它——这个工具跟其他业务工具一样，注册在 Tool Registry 中，走相同的双重校验和审批流程。
>
> **为什么用 Python 而非 TypeScript？** Python 的 NLP/ML 生态更成熟——sentence-transformers 做 embedding、BM25 算法有现成的高质量实现、将来接 LLM embedding 模型也更直接。用 Python 做检索服务是最务实的选择。
>
> **集成方式**：TypeScript Agent 通过 HTTP JSON 请求 RAG 服务，返回结果经过 Zod schema 校验后进入 Agent 的上下文。对 Executor 来说，`searchPolicy` 和 `getTicket` 没有本质区别——都是工具调用。跨语言没有增加 Agent 执行器的复杂度。
>
> **混合检索策略**：我们同时用了 BM25（关键词，精确匹配政策编号和术语）和向量检索（语义，覆盖同义表达），用 RRF（Reciprocal Rank Fusion）排序融合，`rrf_k=60`。RRF 基于排名位置而非分数加权，两个来源等权，兼顾精确和泛化。评测方面有 18 条 Python 测试用例覆盖检索精准度和边界拒绝场景。"

---

### Q9: BM25 和向量混合检索具体怎么实现的？为什么不用纯向量检索？

**考察点**：搜索系统设计、召回策略理解、工程取舍判断。

**答**：

向量检索擅长找“意思相近”的内容，但不擅长保证“关键词、编号、专有名词、代码”一定命中。所以，不单纯用向量检索，是因为 RAG 既需要“语义理解”，也需要“关键词精确命中”。向量检索负责懂意思，BM25 / 全文检索负责抓关键字，二者混合后召回更稳。
>
> 我们的实现分三步：
>
> 1. **并行检索**：同一份查询同时跑 BM25 和向量检索，各自返回 Top-K 结果的排序列表
> 2. **RRF 融合**：对两个排序列表做 Reciprocal Rank Fusion。每个结果按排名获得 `1/(rrf_k + rank)` 分，`rrf_k=60` 控制衰减速度，两来源等权累加，按总分重排
> 3. **阈值过滤**：融合结果经过最低分数阈值（0.35）清洗，低分噪声不进入 Agent 上下文
>
> 评测上我们写了专门的测试用例覆盖——按政策名精确匹配、同义表达泛化检索、空查询和不存在政策的边界拒绝、Top-K 截断验证。确保混合检索不是"看起来效果好"，而是有量化指标支撑。"

> STAR = Situation（背景）→ Task（任务）→ Action（行动）→ Result（结果）
> 每个故事控制在 3-5 分钟，重点在 Action 部分。

---

### 故事一：从零搭建受约束的 Agent 执行架构

| 环节 | 内容 |
|------|------|
| **Situation** | 需要构建一个企业级 AI Agent 来处理工单和退款。但现有框架（LangChain）让模型自由选择工具，无法控制调用顺序和授权范围。 |
| **Task** | 设计一套能精确控制工具调用、支持分步授权、防止模型越权或跳步的 Agent 执行架构。 |
| **Action** | 我设计并实现了 Planner-Executor-Replanner 三层架构。关键设计决策：1）Planner 输出的每个计划步骤只授权一项工具，模型没有选择空间；2）Executor 每步严格校验模型调用是否在授权范围内，不在就抛错；3）设计了完整的计划校验逻辑（parseAgentPlan），version、steps 数量、工具名、步骤 ID 全部校验；4）工具失败时 Replanner 只重规划未完成步骤，不会重复已完成的工作；5）Action Planner 在只读核查完成后才决策是否追加写入动作，且必须基于已执行的真实业务证据。 |
| **Result** | 系统向模型暴露 8 种业务工具，并保留 2 个演示控制工具；越权调用会被 Executor 拒绝并记录失败 Trace。核心执行器约 1,400 行 TypeScript。这里不声称模型越权概率为零，只说明服务端不会放行已识别的越权调用。 |

---

### 故事二：实现 Human-in-the-loop 审批机制

| 环节 | 内容 |
|------|------|
| **Situation** | 退款等高风险操作不能让 AI 自动执行，但审批又不能完全脱离 Agent 工作流。之前的设计是在 Agent 执行前一次性审批，灵活性不足。 |
| **Task** | 设计一套在运行时暂停 Agent 执行、等待人工审批、然后无缝恢复的审批机制，同时保证无论批准还是拒绝，业务状态都保持一致。 |
| **Action** | 我用 AsyncGenerator + Promise 实现了同步风格的审批暂停。遇到高风险工具时：1）生成 ApprovalRequest 并通过 SSE 推送 approval_required 事件给前端；2）然后 yield 出事件后 await 一个 Promise——这个 Promise 在前端用户点击批准/拒绝时由外部 resolve；3）审批通过则执行工具，审批拒绝则回传拒绝信息给 LLM，并阻止后续所有写入步骤。核心原子性保证：拒绝后的代码直接 return 而不是 throw，确保不走后续任何业务步骤。前端展示的审批卡片有实时倒计时和操作按钮。 |
| **Result** | 审批流嵌入同一条 Agent 时间线，用户无需离开工作台。28 条评测集中有 2 条审批边界用例，覆盖非退款任务不触发审批和审批拒绝后不产生写入。 |

---

### 故事三：构建确定性评测体系

| 环节 | 内容 |
|------|------|
| **Situation** | Agent 行为不稳定，改 Prompt 或执行器可能引入回归；只看最终回答无法判断工具轨迹和执行副作用是否正确，不同模型之间也难以做可比实验。 |
| **Task** | 设计一套低成本、可重复、自动化的 Agent 评测体系，支持回归检测和多模型对比。 |
| **Action** | 我先设计了 EvaluationCase 的契约结构——每条 case 定义 task、expectations（requiredTools、forbiddenTools、approval、final message、sandbox state）。然后实现了确定性评分器（EvaluationScorer），基于 run trace 和沙箱最终状态做规则化断言，不依赖 LLM Judge。评测 Runner 每次重新初始化沙箱、走真实执行路径、自动对比上一次运行结果并标记 regressed/recovered。我陆续写了 28 条 golden test case，覆盖 6 大能力组（政策知识检索从 5 条扩展到 15 条）。同时增加了 CLI 评测工具（evaluationCli.ts、evaluationCompareCli.ts）和评测结果存储（evaluationStore.ts），支持 A/B 对比和结果持久化。 |
| **Result** | 当前保存的 Mock 全量基线为 18/18（基于旧版 18 条核心用例），约 6.2 秒完成且没有模型 API 成本；DeepSeek 全量评测为 17/18，唯一异常是 Planner step 校验失败，修复后的单 Case 定向复测为 1/1。已新增 10 条知识检索用例待正式回归。说明规则 Judge 能稳定定位失败，但不能消除真实模型本身的漂移。 |

---

### 故事四：企业政策 RAG 混合检索服务

| 环节 | 内容 |
|------|------|
| **Situation** | Agent 在处理工单和退款时需要理解企业政策，最初通过关键词映射政策。随着政策增多（SLA 规则、退款条件、安全规范等），Prompt 越来越长且难以维护。同时模型经常把类似的政策搞混，引用错误的条款。 |
| **Task** | 设计一套可扩展的企业政策检索系统，支持精确匹配政策编号和语义泛化查询，并与现有的 Agent 执行架构无缝集成。 |
| **Action** | 我选择自建 RAG 服务而不是接入第三方知识库。用 Python FastAPI 搭建检索服务（18 个文件，约 2,500 行）。采用混合检索策略：BM25 保证政策编号和术语精确命中，向量检索（sentence embedding）覆盖同义表达泛化查询，RRF 排序融合兼顾两者。索引管线支持增量更新文档。Agent 端通过 `searchPolicy` 工具调用 RAG 服务，与现有业务工具走相同的 Tool Registry 和双重校验。评测方面分别写了 18 条 Python 测试用例和 15 条 Agent 端 evaluation case。 |
| **Result** | Agent 从"读对应政策"升级为"实时检索政策知识库"，知识覆盖范围不再受 Prompt 长度限制。评测用例从 5 条知识检索扩展到 15 条，覆盖精准匹配、语义泛化、跨文档推理和边界拒绝。跨语言架构（TypeScript ↔ Python）通过 HTTP JSON 通信，对 Executor 透明。 |

---

## 6. 简历项目描述建议

### 简洁版（简历空间有限时）

> **AgentFlow — 企业级 AI Agent 执行与评测平台** | TypeScript, Python, Vue 3, Fastify, FastAPI
>
> - 设计并实现了 **Planner-Executor-Replanner** 三层 Agent 执行架构，每步只授权一项工具，通过服务端校验防止模型跳步或越权调用
> - 实现 **Human-in-the-loop 审批机制**，高风险操作通过 SSE 推送审批事件，拒绝后保证业务原子性
> - 构建 **Tool Registry**，同时维护 Zod 服务端校验和 JSON Schema 模型定义，所有入参双层校验
> - 实现 **工具失败自动重试 + 恢复校验**，防止模型在工具失败后直接生成"已完成"结论
> - 设计 **28 条确定性评测用例**（6 大能力组），通过规则化评分实现零成本、可重复的 Agent 回归测试
> - 构建 **结构化业务决策**，从工具 Trace 提取可信证据（EvidenceFacts），LLM 在可信数据上推理，编造时回退确定性 Outcome
> - 自建 **RAG 混合检索服务**（Python FastAPI），BM25 + 向量检索 + RRF 排序融合，支持企业政策实时检索
> - 实现 **OpenAI-compatible LLM Provider**，支持多模型切换和 Mock Fallback

### 详细版（面试作品集时使用）

> **AgentFlow — 企业级 AI Agent 执行与评测平台**
>
> **技术栈：** TypeScript, Python 3.12, Vue 3 (Composition API), Fastify, FastAPI, Zod, pnpm + uv Monorepo, OpenAI API, SSE, RAG
>
> **项目概述：** 面向企业工单处理和退款审批场景的 AI Agent Runtime，重点解决 LLM 在企业落地时的可控性、安全性和可评测性问题。不是简单的聊天 Demo——Agent 生成结构化计划、Executor 按最小权限执行、高风险操作走人工审批、所有 trace 可审计。
>
> **核心贡献：**
>
> 1. **受约束的 Agent 执行器**：设计 Planner-Executor-Replanner 架构，Planner 输出结构化 JSON 计划（版本、摘要、步骤），每步只授权一个工具；Executor 严格校验每步的工具授权，拒绝越权调用；Replanner 仅在工具失败时重规划未完成步骤。计划步骤最多 6 步，工具调用 10 轮上限。
>
> 2. **Human-in-the-loop 审批流**：利用 AsyncGenerator + Promise 实现运行时审批暂停与恢复。高风险工具（createRefund）进入等待审批状态，拒绝后业务状态保持原子性（不创建退款、不更新工单）。支持 interactive/auto/auto-reject 三种模式。
>
> 3. **统一 Tool Registry**：向模型暴露 8 种业务工具，同时保留 2 个演示控制工具；每个工具维护 Zod Schema（服务端校验）和 JSON Schema（模型定义）。审批属性由服务端 riskLevel 决定，不信任模型返回值。
>
> 4. **工具失败自动重试与恢复校验**：根据错误类型判断是否可重试，最多 2 次自动重试。关键工具失败后如果模型尝试跳过，Executor 拦截并强制恢复，最多 2 次提醒后生成明确失败错误（TOOL_RECOVERY_INCOMPLETE）。
>
> 5. **确定性评测体系**：28 条 golden test case，覆盖查询、政策知识检索（15 条）、退款、审批、安全、幂等性等 6 大能力组。规则化评分器基于 trace 和沙箱状态做断言（工具轨迹、业务状态、回复关键词），零成本、可重复、支持回归对比和 A/B 比较。
>
> 6. **模型层解耦**：统一 Provider 封装，支持 OpenAI-compatible 服务与 Mock 切换。Mock 输出与真实模型同构，走同一执行路径；演示模式可配置失败 fallback，真实评测强制关闭 fallback。

> 7. **结构化业务结论**：双层架构——确定性 Outcome（服务端根据 Run 终态、审批和工具 `operation` 派生）加上基于证据的业务决策（businessDecision.ts 从工具 Trace 提取 EvidenceFacts，LLM 在可信证据上推理，编造时回退确定性 Outcome）。

> 8. **企业政策 RAG 混合检索**：自建 Python FastAPI 检索服务（约 2,500 行），BM25 关键词 + 向量语义 + RRF 排序融合。通过 searchPolicy 工具与 Agent 集成，18 条 Python 测试 + 15 条 Agent 端评测用例保障检索质量。

---

## 7. 面试官可能的追问方向

| 追问方向 | 可能的追问 | 准备建议 |
|----------|-----------|---------|
| **架构设计** | "Planner 和 Replanner 的 Prompt 怎么设计的？如何避免模型输出不合规的 Plan？" | 熟悉 prompts.ts 中的系统提示词设计和 parseAgentPlan 的校验逻辑 |
| **并发与状态** | "如果两个请求同时处理工单 T-1001，会有什么问题？" | 讲清楚当前是单进程内存沙箱，以及生产级需要加分布式锁或队列 |
| **持久化方案** | "JSON 文件持久化怎么保证不丢数据？" | 了解 persistentState.ts 的原子写入 + 重试逻辑，以及和生产级方案的差距 |
| **评测覆盖度** | "28 条用例能覆盖所有 Agent 行为吗？怎么设计新用例？" | 讲清楚从业务场景出发 + 边界条件 + 异常路径的方法论 |
| **前端实现** | "SSE 事件在前端怎么处理的？EventSource 断连怎么恢复？" | 熟悉 api/index.ts 中 EventSource 的封装和断连处理 |
| **多模型对比** | "同一个 Task 在 GPT-4 和 DeepSeek 上结果不同，怎么办？" | 讲评测体系的 A/B 对比功能和回归检测机制 |
| **权限模型** | "如果想要不同角色的审批权限不同，怎么改？" | 可以谈 ApprovalStore 扩展、角色与审批策略映射 |
| **可观测性** | "怎么监控 Agent 的健康状态？" | 可以谈运行指标（调用次数、Token 消耗、成功率）、/health 端点、未来可以做的 APM 集成 |
| **RAG 检索** | "为什么自建 RAG 而不是用第三方知识库？混合检索的 BM25 和向量权重怎么调的？" | 熟悉 retrieval.py 中 BM25 + 向量 + RRF 的实现，讲清楚企业政策场景下精确匹配优先于语义泛化 |
| **跨语言架构** | "TypeScript 和 Python 之间通信怎么保证可靠性？" | 谈 HTTP JSON + Zod 校验 + 超时重试，以及两种语言错误码对齐策略 |
| **业务证据** | "EvidenceFacts 怎么保证真的是'可信'的？模型不能伪造工具输出吗？" | 熟悉 isTrustedToolStep 的过滤逻辑——只取工具调用和审批类型的已完成步骤，跳过模型生成文本 |

---

## 8. 21天准备计划

### 第一阶段：熟悉代码和架构（第1-7天）

| 天数 | 任务 | 具体内容 |
|------|------|---------|
| 第1天 | 整体概览 | 通读 README.md、docs/architecture.md，理解项目全貌和执行链路 |
| 第2天 | 核心执行器 | 精读 executor.ts（约 1,700 行），理解 Planner-Executor-Replanner 循环 |
| 第3天 | Tool Registry + 业务决策 | 精读 toolRegistry.ts 和 businessDecision.ts，理解双重校验和证据提取 |
| 第4天 | LLM Provider | 精读 provider.ts（约 1,000 行），理解模型封装和 Mock 机制 |
| 第5天 | 评测体系 | 精读 eval/*.ts 中的 evaluationRunner、evaluationScorer、evaluationCases（28 条） |
| 第6天 | RAG 检索服务 | 快速浏览 apps/rag/src/，精读 retrieval.py（混合检索实现） |
| 第7天 | 整体复盘 | 画出完整的执行链路图（含 RAG 集成），确保能脱稿讲清每个环节 |

### 第二阶段：准备面试话术（第8-14天）

| 天数 | 任务 | 具体内容 |
|------|------|---------|
| 第8天 | 亮点一 | 准备 Planner-Executor-Replanner 的 5 分钟讲解 |
| 第9天 | 亮点二 | 准备 Tool Registry + 双重校验的讲解 |
| 第10天 | 亮点三 | 准备 Human-in-the-loop 审批流的讲解 |
| 第11天 | 亮点四 | 准备工具失败重试 + 恢复校验的讲解 |
| 第12天 | 亮点五 | 准备确定性评测体系（28 条用例，6 组能力）的讲解 |
| 第13天 | 亮点六 + 七 | 准备结构化业务决策 + Provider / Mock 讲解 |
| 第14天 | 亮点八 + 整合 | 准备 RAG 混合检索讲解，并把八个亮点串成 10 分钟项目总览 |

### 第三阶段：模拟面试（第15-21天）

| 天数 | 任务 | 具体内容 |
|------|------|---------|
| 第15-17天 | 高频问题 | 练习 Q1-Q9 的答案，每个控制在 3-5 分钟 |
| 第18-19天 | STAR 故事 | 练习四个 STAR 故事，每个 3-5 分钟 |
| 第20天 | 追问准备 | 熟悉 12 个追问方向的应对思路（含 RAG、业务证据、跨语言架构） |
| 第21天 | 全真模拟 | 找朋友或 AI 做一次完整模拟面试 |

---

> **面试准备的核心原则：**
>
> 1. **不要背稿子** — 理解设计决策背后的 why 比背诵代码更重要
> 2. **说到点子上** — 每个回答控制在 2-5 分钟，不要东拉西扯
> 3. **展示思考过程** — 解释"当时为什么这么做"而不是"代码里这么写的"
> 4. **诚实面对不足** — 当被问到"这里为什么没做成生产级"，直接说"这是 Demo 阶段的权衡"并展开生产化方案
