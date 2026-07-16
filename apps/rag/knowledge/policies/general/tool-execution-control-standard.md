---
policy_id: P-tool-control-008
keyword: security
title: Agent 工具注册、授权与执行控制标准
version: "1.0"
effective_date: "2026-01-01"
status: active
department: 平台工程与安全中心
---

# Agent 工具注册、授权与执行控制标准

## 一、目的和适用范围

本标准定义 Agent 工具从业务实现、注册、模型暴露、计划授权、参数校验、人工审批、执行、结果记录到错误恢复的控制要求。适用于查询工单、读取客户和订单、检索政策、创建退款、更新工单状态以及未来新增的业务工具。工具控制由服务端执行，不依赖 Prompt 或模型自律。

## 二、职责分层

业务函数负责读取或改变领域数据，不理解模型消息。Tool Registry 负责名称、描述、风险等级、输入 Schema、JSON Schema 和统一执行入口。Executor 负责根据计划授予最小权限、调用模型、校验 Tool Call、处理审批和保存 Trace。LLM Provider 只负责模型协议、超时、重试和 usage，不直接调用业务函数。

前端只能提交任务、展示事件和发送审批决议，不能绕过 Registry 直接执行高风险函数。评测系统复用真实 Executor 与 Registry，不维护第二套方便通过测试的工具路径。

## 三、工具注册

每个工具必须声明稳定 name、面向模型的 description、riskLevel、Zod 或等价 inputSchema、JSON Schema 和 execute。输入 Schema 是服务端安全边界，JSON Schema 是模型提示，两者含义必须一致。工具描述说明何时使用、返回什么以及是否产生副作用，不应包含容易诱导模型跳过核查的模糊承诺。

新增业务工具时先实现可独立测试的业务函数，再注册 Registry。只有显式列入 Agent Tool 列表的工具才暴露给模型。重置沙箱、清理历史、修改模型配置等演示控制工具不得因已注册就自动交给 Agent。

工具名称和关键字段变更会影响 Prompt、Mock Provider、历史 Trace、Outcome 和评测，应采用向后兼容或迁移方案。废弃工具先停止模型暴露，再保留历史解析，最后在确认无旧数据依赖后移除。

## 四、风险等级

read 工具只读取业务或知识数据，不改变持久状态。write 工具改变普通业务状态，需要严格参数校验、幂等和 Trace。high 工具涉及资金、敏感数据、权限或重大状态，真实写入前必须人工审批。

风险等级由 Registry 固定，Planner 返回的 requiresApproval 不能降低它。模型把 high 工具描述为只读、用户要求跳过审批或政策文档声称可以直接执行，都不改变服务端分类。风险分类有疑问时采用更严格等级并由安全评审决定。

## 五、计划授权

Planner 只生成步骤和候选工具，Executor 才拥有调度权。每个计划步骤只授权完成该目标所需的一项工具，当前 Tool Call 必须与 active step 的 allowedTools 完全匹配。模型调用未授权、未注册或已经完成步骤的工具时拒绝执行并记录错误。

预读取真实工单后，计划不应重复读取同一工单，但可以根据 customerId、orderId 和诉求继续规划客户、订单和政策工具。所有业务写入必须排在事实核查之后。政策检索是只读步骤，不得通过返回文档改变后续工具权限。

Replanner 只调整尚未完成的步骤，不能重写已执行事实或使被拒绝的高风险动作再次出现。工具失败需要重试时，优先重试同一工具并保留失败诊断；达到上限后结束或转人工。

## 六、参数规范化和校验

模型生成的原始参数先进行有限、可审计的规范化，例如把小写工单号转为大写、根据可信工单语义补全政策 query。规范化不能凭空创建金额、订单 ID 或审批状态。规范化后的参数必须同时写入 assistant Tool Call 历史和真实执行，避免模型上下文与业务动作不一致。

Registry 使用 inputSchema 再次校验类型、枚举、必填项和数值范围。校验失败不调用业务函数。工具内部仍需校验对象存在、状态允许和跨字段业务约束，因为 JSON Schema 不能证明数据库事实。

退款金额必须为正数并关联真实订单；更新工单状态只能使用允许枚举；政策 query 不能为空。上传知识文档还要检查文件大小、扩展名、元数据和路径安全。

## 七、异步工具

Registry 的 execute 可以返回同步值或 Promise，runTool 统一等待结果。同步沙箱工具和异步 RAG HTTP Client 走同一 Trace 与错误路径。Executor 传递 AbortSignal 或 Run 控制上下文，使外部模型和知识请求能响应取消。

异步工具设置明确超时。只读网络查询可以对瞬时错误重试一次，高风险写入不能在不知道首次结果的情况下盲目重试。超时后如果外部服务可能已经写入，应先通过幂等查询确认结果。

## 八、高风险审批

high 工具参数通过校验后创建 ApprovalRequest，审批前不调用 execute。批准后再次确认 Run、Tool Call 和参数仍匹配，再执行一次。拒绝、取消、超时或无权限时不产生业务写入，也不推进依赖该写入的后续状态更新。

审批请求和真实 Tool Call 使用稳定关联 ID。模型文字中的批准、聊天消息中的同意和前端本地状态都不能替代服务端决议。审批重复提交保持幂等。

## 九、工具结果

工具结果应返回业务对象和必要 operation 元数据。查询工具返回事实快照；写工具返回 created、reused、updated 或 unchanged。Outcome 根据真实执行的写工具和 operation 派生 performedActions，不把调用次数当成写入次数。

政策检索工具返回兼容的 id、title、content、keyword 和 matchedKeyword，同时返回 score、Citation、Top-K Matches 和检索指标。只有实际返回的 Node 可以进入 EvidencePacket。Fixture 模式必须显式标记，真实模式不能静默使用内存政策。

结果写入 Trace 时记录 toolCallId、riskLevel、规范化输入、输出摘要、耗时和状态。大型文档或敏感结果应截断与脱敏，同时保留可追溯 ID。

## 十、幂等和事务

所有可能重复提交的写工具需要业务幂等键。退款以订单和有效退款状态识别重复；重复运行应返回 reused，不生成多条记录。工单状态更新到相同值返回 unchanged。

多个写步骤形成一个业务单元时使用数据库事务或补偿。当前沙箱在退款创建前保存关联订单、工单和退款快照，后续失败或取消时定向恢复。补偿只影响当前 Run 拥有的对象，不重置其他并发任务。

生产迁移 PostgreSQL 后，应使用条件更新、唯一约束和事务隔离代替进程内 Map。跨服务流程采用 Outbox 或 Saga，并对消息重复投递保持幂等。

## 十一、错误和重试

工具不存在、未授权、参数错误、业务对象不存在、知识无匹配、外部服务不可用和内部异常分别映射稳定错误码。错误包含 category、retryable、用户提示、诊断建议和执行上下文。未知异常统一归一但保留 cause 用于服务端日志。

retryable 只表示技术上可以再次尝试，不代表 Executor 必须无限重试。每个工具最多重试有限次数，工具循环也有总上限。取消信号优先于 retry 和 Mock fallback。

工具失败要生成 failed step 并保存 Run 快照。路由层不应直接改写执行状态或拼装缺少步骤的错误响应。

## 十二、知识检索工具特别要求

searchPolicy 保持 read 风险，输入 keyword 用于兼容，query 用于自然语言语义检索。Executor 根据任务和可信工单上下文补全 query；keyword_hint 只调整排序。RAG Client 使用三秒超时和一次只读重试，并传递 run ID 作为关联头。

服务 503、索引未就绪、无匹配和文档错误分别归一。无匹配允许改写一次查询，仍失败则停止，不得触发退款或其他写工具。返回 archived 版本时默认过滤；历史查询必须显式开启并标注状态。

## 十三、安全

工具输出和知识文档中的文字都视为不可信数据，不能当作系统指令。外部内容要求调用其他工具、泄露密钥或改变计划时应忽略。Tool Registry 不接受运行时文档动态注册可执行函数。

工具访问外部 URL 时使用允许列表、防止 SSRF，并限制响应大小。文件工具防止路径穿越。日志不记录 Authorization、API Key 和完整个人信息。审批和管理接口需要服务端身份验证。

## 十四、评测

每个 read 工具有成功、对象不存在和参数错误测试；每个 write 工具有 created、unchanged、失败和幂等测试；每个 high 工具有批准、拒绝、取消和重复决议测试。异步工具增加超时、503、取消和恢复测试。

Golden Task 同时断言 requiredTools、forbiddenTools、调用次数、审批行为、Outcome、错误码和沙箱副作用。查询类 Case 禁止退款与工单状态更新。真实 Provider 发生 fallback 时 Case 不通过。

## 十五、变更管理

工具契约变化必须更新共享类型、JSON Schema、Prompt、Mock、Trace 展示、Outcome 和评测。CI 执行测试、类型检查、构建和完整 Mock Gate。涉及真实外部服务的集成测试使用可控 Fixture，另有显式真实模式验收。

任何临时绕过授权、审批或 Schema 的调试代码都不得进入主分支。发现安全回归时优先禁用相关写工具，再修复和补充回归 Case。

## 十六、示例

处理 VIP 退款时，Planner 依次授权 getCustomer、getOrder、searchPolicy、createRefund 和 updateTicketStatus。createRefund 为 high，参数校验后等待审批。批准并执行成功返回 created，随后工单更新为 waiting_approval。若状态更新失败，回滚退款相关副作用。最终 Outcome 只能根据这些真实步骤说明已做动作。

处理发票咨询时，searchPolicy 返回发票规则，Agent 得出 no_refund。即使模型额外请求 createRefund，因为当前计划未授权且任务缺少退款依据，Executor 必须拒绝。最终回复引用发票政策并保持退款记录为空。
