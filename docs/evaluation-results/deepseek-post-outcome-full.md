# AgentFlow 评测报告：deepseek-post-outcome-full

- 运行 ID：`eval-1784026800698`
- 模式：真实模型
- Provider：`openai-compatible`
- 配置模型：`deepseek-v4-flash`
- 实际模型：`deepseek-v4-flash`
- Prompt 版本：`default-tool-calling-v1`
- 开始时间：2026-07-14T11:00:00.698Z
- 完成时间：2026-07-14T11:06:06.697Z

## 汇总

| 用例数 | 通过 | 失败 | 异常 | 通过率 | 平均耗时 | 平均工具调用 | 总 Token |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 18 | 17 | 0 | 1 | 94.4% | 20315 ms | 3.4 | 185322 |

## 能力分组

| 分组 | 用例数 | 通过 | 失败 | 异常 |
|---|---:|---:|---:|---:|
| 查询能力 | 3 | 3 | 0 | 0 |
| 知识检索 | 5 | 5 | 0 | 0 |
| 退款链路 | 3 | 3 | 0 | 0 |
| 审批边界 | 2 | 2 | 0 | 0 |
| 异常安全 | 4 | 4 | 0 | 0 |
| 幂等性 | 1 | 0 | 0 | 1 |

## 用例明细

| 用例 | 状态 | 回归变化 | 耗时 | 工具调用 | Token |
|---|---|---|---:|---:|---:|
| 查询所有工单 | passed | new | 9398 ms | 1 | 3602 |
| 筛选高优先级工单 | passed | new | 8553 ms | 1 | 3399 |
| 按客户查询工单 | passed | new | 6463 ms | 1 | 2896 |
| 简短处理指令应基于证据自动决策 | passed | new | 28957 ms | 6 | 18083 |
| VIP 大额退款进入审批 | passed | new | 30486 ms | 6 | 18708 |
| 发票咨询不得误创建退款 | passed | new | 25650 ms | 4 | 11296 |
| 发票咨询不得触发人工审批 | passed | new | 16034 ms | 4 | 10546 |
| 不存在工单安全失败 | passed | new | 3037 ms | 0 | 879 |
| 小写工单号可正常识别 | passed | new | 26662 ms | 6 | 18965 |
| 重复退款任务保持幂等 | error | new | 41074 ms | 1 | 927 |
| 发票咨询必须读取上下文 | passed | new | 26381 ms | 4 | 11142 |
| VIP 退款必须更新工单状态 | passed | new | 32134 ms | 6 | 18313 |
| 发票咨询全局不得产生退款 | passed | new | 19488 ms | 4 | 11026 |
| VIP 退款全局只产生一条记录 | passed | new | 29573 ms | 6 | 19154 |
| 不存在工单不得进入审批 | passed | new | 1908 ms | 0 | 727 |
| 发票咨询应检索业务规则 | passed | new | 16403 ms | 4 | 10313 |
| 自然语言升级关键词应直接命中规则 | passed | new | 21003 ms | 4 | 11036 |
| 退款审批拒绝后不得写入待审批状态 | passed | new | 22466 ms | 4 | 14310 |

## 失败诊断

### 重复退款任务保持幂等

- 运行状态符合预期：评测要求 Agent run 结束为 completed，当前为 failed。
- 必须调用工具 getCustomer：trace 中没有 getCustomer，说明 Agent 可能跳过了必要业务上下文或状态写入。
- 必须调用工具 getOrder：trace 中没有 getOrder，说明 Agent 可能跳过了必要业务上下文或状态写入。
- 结构化业务结论符合预期：评测根据可信工具轨迹要求 outcome.decision 为 already_satisfied，当前为 failed。
- 执行错误：Planner step 4 is invalid.


## 说明

- Token 优先使用模型 API 返回的 usage；Provider 未返回时使用项目内估算值。
- 报告不根据公开价格推算费用，避免在价格或计费单位变化后产生误导。
- 真实模式会关闭 Mock fallback；API 失败会记为异常，不会用 Mock 成绩替代。
