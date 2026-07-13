# AgentFlow 执行架构

## 模块关系

```mermaid
flowchart LR
    User["用户任务"] --> Web["Vue 3 工作台"]
    Web -->|"SSE / HTTP"| API["Fastify API"]
    API --> Executor["Agent Executor"]

    Executor --> Planner["Planner / Replanner"]
    Planner --> Provider["OpenAI-compatible Provider"]
    Executor --> Provider

    Executor --> Registry["Tool Registry"]
    Registry --> Schema["Zod + JSON Schema"]
    Registry --> Sandbox["工单 / 客户 / 订单 / 规则"]

    Registry -->|"high risk"| Approval["Human Approval"]
    Approval -->|"批准 / 拒绝"| Executor

    Executor --> Outcome["Structured Outcome"]
    Executor --> Trace["Run Trace & Metrics"]
    Executor --> Conversation["Conversation Snapshot"]
    Outcome --> Evaluation["Deterministic Evaluation"]
    Trace --> Evaluation["Deterministic Evaluation"]
    Sandbox --> Evaluation
```

## 单次运行时序

```mermaid
sequenceDiagram
    participant U as 用户
    participant W as Web
    participant E as Executor
    participant L as LLM Provider
    participant T as Tool Registry
    participant A as Approval Store

    U->>W: 提交业务任务
    W->>E: 建立 SSE 执行流
    E->>L: 生成结构化计划
    L-->>E: steps + allowedTools

    loop 按计划逐步执行
        E->>L: 请求当前步骤的 tool call
        L-->>E: 单个工具及参数
        E->>T: 校验工具授权、风险和参数
        alt 普通工具
            T-->>E: 执行结果
        else 高风险工具
            E->>A: 创建审批请求并暂停
            E-->>W: approval_required
            U->>W: 批准或拒绝
            W->>A: 提交审批结果
            A-->>E: 恢复执行
            alt 审批批准
                E->>T: 执行高风险工具
            else 审批拒绝
                E->>L: 回传拒绝结果
                Note over E,T: 不执行退款，也不推进后续写入步骤
            end
        end
        E-->>W: 推送步骤 Trace
    end

    E->>L: 生成最终结论
    E->>E: 根据终态、审批和工具轨迹派生 Outcome
    E-->>W: 完成并保存 Run 快照
```

## 结构化 Outcome

模型生成的自然语言只写入 `outcome.userMessage`。服务端依据可信 Run 终态、审批决议和实际执行的写工具派生 `decision` 与 `performedActions`，并从工具 Trace 提取业务证据引用。确定性 Judge 优先断言结构化 Outcome、工具轨迹和沙箱副作用，不再把“未创建退款”等固定措辞当作业务正确性的唯一证据。

旧版持久化 Run 可以没有 Outcome；新 Run 在进入 `waiting_approval`、`completed`、`failed` 或 `cancelled` 状态时写入结构化结果，服务重启后被中断的 Run 也会补写 `failed` Outcome。

## 核心约束

1. Planner 只提出计划，Executor 才拥有调度权。
2. 每个计划步骤只允许一项工具，模型不能调用未授权工具。
3. 所有工具参数必须通过服务端 Zod 校验，Prompt 不是安全边界。
4. 高风险工具批准前不产生业务写入，拒绝后不推进后续状态更新。
5. 模型自报动作不作为事实，业务结论必须由服务端 Trace 与状态派生。
5. 工具成功后才推进计划游标，失败时只重规划尚未完成的步骤。
6. 评测复用真实 Executor 和 Tool Registry，同时检查回答、Trace 和最终业务状态。
