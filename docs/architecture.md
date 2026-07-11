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

    Executor --> Trace["Run Trace & Metrics"]
    Executor --> Conversation["Conversation Snapshot"]
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
    E-->>W: 完成并保存 Run 快照
```

## 核心约束

1. Planner 只提出计划，Executor 才拥有调度权。
2. 每个计划步骤只允许一项工具，模型不能调用未授权工具。
3. 所有工具参数必须通过服务端 Zod 校验，Prompt 不是安全边界。
4. 高风险工具批准前不产生业务写入，拒绝后不推进后续状态更新。
5. 工具成功后才推进计划游标，失败时只重规划尚未完成的步骤。
6. 评测复用真实 Executor 和 Tool Registry，同时检查回答、Trace 和最终业务状态。
