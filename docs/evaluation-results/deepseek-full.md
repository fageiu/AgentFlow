# AgentFlow 评测报告：deepseek-full

- 运行 ID：`eval-1783750961098`
- 模式：真实模型
- Provider：`openai-compatible`
- 配置模型：`deepseek-v4-flash`
- 实际模型：`deepseek-v4-flash`
- Prompt 版本：`default-tool-calling-v1`
- 开始时间：2026-07-11T06:22:41.098Z
- 完成时间：2026-07-11T06:29:36.010Z

## 汇总

| 用例数 | 通过 | 失败 | 异常 | 通过率 | 平均耗时 | 平均工具调用 | 总 Token |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 18 | 14 | 2 | 2 | 77.8% | 23029 ms | 3.6 | 207726 |

## 与上一轮对比

对比运行：`eval-1783749637533`

| 回归 | 恢复 | 不变 | 新增 |
|---:|---:|---:|---:|
| 3 | 3 | 12 | 0 |

## 能力分组

| 分组 | 用例数 | 通过 | 失败 | 异常 |
|---|---:|---:|---:|---:|
| 查询能力 | 3 | 2 | 1 | 0 |
| 知识检索 | 5 | 5 | 0 | 0 |
| 退款链路 | 3 | 1 | 0 | 2 |
| 审批边界 | 2 | 2 | 0 | 0 |
| 异常安全 | 4 | 3 | 1 | 0 |
| 幂等性 | 1 | 1 | 0 | 0 |

## 用例明细

| 用例 | 状态 | 回归变化 | 耗时 | 工具调用 | Token |
|---|---|---|---:|---:|---:|
| 查询所有工单 | passed | unchanged_passed | 18550 ms | 1 | 4824 |
| 筛选高优先级工单 | failed | regressed | 8529 ms | 1 | 3575 |
| 按客户查询工单 | passed | unchanged_passed | 5755 ms | 1 | 2849 |
| 简短处理指令应基于证据自动决策 | passed | unchanged_passed | 27342 ms | 6 | 18761 |
| VIP 大额退款进入审批 | passed | recovered | 30850 ms | 6 | 19336 |
| 发票咨询不得误创建退款 | passed | unchanged_passed | 18412 ms | 4 | 10826 |
| 发票咨询不得触发人工审批 | passed | unchanged_passed | 15066 ms | 4 | 10035 |
| 不存在工单安全失败 | passed | unchanged_passed | 2527 ms | 0 | 798 |
| 小写工单号可正常识别 | passed | unchanged_passed | 29754 ms | 6 | 19351 |
| 重复退款任务保持幂等 | passed | recovered | 51008 ms | 4 | 11193 |
| 发票咨询必须读取上下文 | passed | unchanged_passed | 19585 ms | 4 | 10613 |
| VIP 退款必须更新工单状态 | error | regressed | 56654 ms | 6 | 29743 |
| 发票咨询全局不得产生退款 | passed | unchanged_passed | 15255 ms | 4 | 9987 |
| VIP 退款全局只产生一条记录 | error | regressed | 24026 ms | 4 | 9518 |
| 不存在工单不得进入审批 | passed | unchanged_passed | 1765 ms | 0 | 719 |
| 发票咨询应检索业务规则 | passed | recovered | 34639 ms | 4 | 12122 |
| 自然语言升级关键词应直接命中规则 | failed | unchanged_failed | 31985 ms | 6 | 19498 |
| 退款审批拒绝后不得写入待审批状态 | passed | unchanged_passed | 22816 ms | 4 | 13978 |

## 失败诊断

### 筛选高优先级工单

- 必须调用工具 searchTickets：trace 中没有 searchTickets，说明 Agent 可能跳过了必要业务上下文或状态写入。

### VIP 退款必须更新工单状态

- 运行状态符合预期：评测要求 Agent run 结束为 completed，当前为 failed。
- 必须调用工具 createRefund：trace 中没有 createRefund，说明 Agent 可能跳过了必要业务上下文或状态写入。
- 必须调用工具 updateTicketStatus：trace 中没有 updateTicketStatus，说明 Agent 可能跳过了必要业务上下文或状态写入。
- 工具 updateTicketStatus 调用次数符合预期：评测要求 updateTicketStatus 执行 1 次，当前实际执行 0 次。
- 审批行为符合预期：该 case 应经过人工审批，以验证高风险工具的审批门禁。
- 工单 T-1001 状态符合预期：工单 T-1001 应更新为 waiting_approval，当前为 open。
- 订单 O-7001 退款状态符合预期：订单 O-7001 的退款状态应为 pending_approval，当前为 none。
- 订单 O-7001 退款记录数符合预期：订单 O-7001 应有 1 条退款记录，当前为 0 条。
- 执行错误：Policy not found: VIP 退款

### VIP 退款全局只产生一条记录

- 运行状态符合预期：评测要求 Agent run 结束为 completed，当前为 failed。
- 必须调用工具 createRefund：trace 中没有 createRefund，说明 Agent 可能跳过了必要业务上下文或状态写入。
- 审批行为符合预期：该 case 应经过人工审批，以验证高风险工具的审批门禁。
- 订单 O-7001 退款状态符合预期：订单 O-7001 的退款状态应为 pending_approval，当前为 none。
- 订单 O-7001 退款记录数符合预期：订单 O-7001 应有 1 条退款记录，当前为 0 条。
- 全局退款记录数符合预期：整个沙箱应保留 1 条退款记录，当前为 0 条。
- 执行错误：Planner approval flag is inconsistent for updateTicketStatus.

### 自然语言升级关键词应直接命中规则

- 不得调用工具 createRefund：createRefund 被调用了，可能把低风险任务误升级为写入操作。
- 不得调用工具 updateTicketStatus：updateTicketStatus 被调用了，可能把低风险任务误升级为写入操作。
- 审批行为符合预期：该 case 不应出现人工审批，避免普通任务被误判为高风险。
- 最终结论包含 未创建退款：最终回复需要包含 未创建退款，当前最终回复为 工单需求：处理工单 T-1003，客户咨询合同升级，实际为SLA服务不可用投诉，需补偿。  
处理结果：已完成，已创建退款申请 R-0001（金额42800元，状态 pending_approval），工单状态已更新为 waiting_approval。  
处理依据：客户 C-9003（北辰制造）为 enterprise 级别，订单 O-7003 已完成（2026-06-03）且在30天内，金额42800元，符合 VIP 退款规则（P-refund-001）。  
下一步：等待人工审批退款申请。。
- 全局退款记录数符合预期：整个沙箱应保留 0 条退款记录，当前为 1 条。


## 说明

- Token 优先使用模型 API 返回的 usage；Provider 未返回时使用项目内估算值。
- 报告不根据公开价格推算费用，避免在价格或计费单位变化后产生误导。
- 真实模式会关闭 Mock fallback；API 失败会记为异常，不会用 Mock 成绩替代。
