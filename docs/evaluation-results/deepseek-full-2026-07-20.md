# AgentFlow 评测报告：deepseek-full-2026-07-20

- 运行 ID：`eval-1784549641116`
- 模式：真实模型
- Provider：`openai-compatible`
- 配置模型：`deepseek-v4-flash`
- 实际模型：`deepseek-v4-flash`
- Prompt 版本：`default-tool-calling-v2`
- 开始时间：2026-07-20T12:14:01.116Z
- 完成时间：2026-07-20T12:25:58.151Z

## 汇总

| 用例数 | 通过 | 失败 | 异常 | 通过率 | 平均耗时 | 平均工具调用 | 总 Token |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 28 | 26 | 0 | 2 | 92.9% | 25549 ms | 3.5 | 343733 |

## 能力分组

| 分组 | 用例数 | 通过 | 失败 | 异常 |
|---|---:|---:|---:|---:|
| 查询能力 | 3 | 3 | 0 | 0 |
| 知识检索 | 15 | 13 | 0 | 2 |
| 退款链路 | 3 | 3 | 0 | 0 |
| 审批边界 | 2 | 2 | 0 | 0 |
| 异常安全 | 4 | 4 | 0 | 0 |
| 幂等性 | 1 | 1 | 0 | 0 |

## 用例明细

| 用例 | 状态 | 回归变化 | 耗时 | 工具调用 | Token |
|---|---|---|---:|---:|---:|
| 查询所有工单 | passed | new | 10882 ms | 1 | 3025 |
| 筛选高优先级工单 | passed | new | 8556 ms | 1 | 2481 |
| 按客户查询工单 | passed | new | 7990 ms | 1 | 2158 |
| 简短处理指令应基于证据自动决策 | passed | new | 50354 ms | 6 | 24505 |
| VIP 大额退款进入审批 | passed | new | 45437 ms | 6 | 24193 |
| 发票咨询不得误创建退款 | passed | new | 20031 ms | 4 | 12212 |
| 发票咨询不得触发人工审批 | passed | new | 24877 ms | 4 | 12820 |
| 不存在工单安全失败 | passed | new | 2034 ms | 0 | 773 |
| 小写工单号可正常识别 | passed | new | 42596 ms | 6 | 25586 |
| 重复退款任务保持幂等 | passed | new | 70177 ms | 4 | 13300 |
| 发票咨询必须读取上下文 | passed | new | 16455 ms | 4 | 12061 |
| VIP 退款必须更新工单状态 | passed | new | 39066 ms | 6 | 24097 |
| 发票咨询全局不得产生退款 | error | new | 5571 ms | 1 | 935 |
| VIP 退款全局只产生一条记录 | passed | new | 46828 ms | 6 | 25649 |
| 不存在工单不得进入审批 | passed | new | 2011 ms | 0 | 761 |
| 发票咨询应检索业务规则 | passed | new | 25898 ms | 4 | 12714 |
| 自然语言升级关键词应直接命中规则 | passed | new | 26152 ms | 4 | 12788 |
| 退款审批拒绝后不得写入待审批状态 | passed | new | 33123 ms | 4 | 17353 |
| 服务中断同义表达命中 SLA 政策 | passed | new | 23972 ms | 4 | 12701 |
| SLA 响应时间问法返回引用 | passed | new | 21618 ms | 4 | 12410 |
| 合同升级政策语义检索 | passed | new | 22025 ms | 4 | 12932 |
| 续费折扣争议检索合同规则 | passed | new | 22371 ms | 4 | 12577 |
| 订单取消费用政策检索 | passed | new | 22605 ms | 4 | 12550 |
| 高风险关单政策检索 | passed | new | 26371 ms | 4 | 12554 |
| 发票抬头更正政策检索 | passed | new | 35605 ms | 4 | 14317 |
| 补开发票同义问法返回引用 | error | new | 13501 ms | 1 | 911 |
| 服务等级协议中文问法检索 | passed | new | 24612 ms | 4 | 12876 |
| 套餐变更同义问法检索升级政策 | passed | new | 24667 ms | 4 | 12494 |

## 失败诊断

### 发票咨询全局不得产生退款

- 运行状态符合预期：评测要求 Agent run 结束为 completed，当前为 failed。
- 结构化业务结论符合预期：评测根据可信工具轨迹要求 outcome.decision 为 no_refund，当前为 failed。
- 执行错误：Planner plan has no executable tool step.

### 补开发票同义问法返回引用

- 运行状态符合预期：评测要求 Agent run 结束为 completed，当前为 failed。
- 必须调用工具 getCustomer：trace 中没有 getCustomer，说明 Agent 可能跳过了必要业务上下文或状态写入。
- 必须调用工具 getOrder：trace 中没有 getOrder，说明 Agent 可能跳过了必要业务上下文或状态写入。
- 必须调用工具 searchPolicy：trace 中没有 searchPolicy，说明 Agent 可能跳过了必要业务上下文或状态写入。
- 政策检索包含可追溯引用：searchPolicy 应返回 Document、Node、文件和版本引用，禁止仅凭模型常识下结论。
- 结构化业务结论符合预期：评测根据可信工具轨迹要求 outcome.decision 为 read_only，当前为 failed。
- 执行错误：Planner result does not match the required plan contract.


## 说明

- Token 优先使用模型 API 返回的 usage；Provider 未返回时使用项目内估算值。
- 报告不根据公开价格推算费用，避免在价格或计费单位变化后产生误导。
- 真实模式会关闭 Mock fallback；API 失败会记为异常，不会用 Mock 成绩替代。
