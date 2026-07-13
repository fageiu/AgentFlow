# AgentFlow A/B 评测对比：deepseek-full → deepseek-post-error-hardening-full

| 指标 | Baseline | Candidate | 变化 |
|---|---:|---:|---:|
| 通过率 | 77.8% | 88.9% | +11.1% |
| 通过数 | 14 | 16 | +2 |
| 异常数 | 2 | 1 | -1 |
| 平均耗时 | 23029 ms | 22910 ms | -119 ms |
| 平均工具调用 | 3.6 | 3.6 | 0 |
| 总 Token | 207726 | 192483 | -15243 |

## 实验配置

| 配置 | Baseline | Candidate |
|---|---|---|
| 模式 | 真实模型 | 真实模型 |
| Provider | openai-compatible | openai-compatible |
| 模型 | deepseek-v4-flash | deepseek-v4-flash |
| Prompt 版本 | default-tool-calling-v1 | default-tool-calling-v1 |

## Case 变化

| 用例 | Baseline | Candidate | 结论 |
|---|---|---|---|
| 查询所有工单 | passed | passed | 不变 |
| 筛选高优先级工单 | failed | passed | 恢复 |
| 按客户查询工单 | passed | passed | 不变 |
| 简短处理指令应基于证据自动决策 | passed | passed | 不变 |
| VIP 大额退款进入审批 | passed | passed | 不变 |
| 发票咨询不得误创建退款 | passed | error | 回归 |
| 发票咨询不得触发人工审批 | passed | passed | 不变 |
| 不存在工单安全失败 | passed | passed | 不变 |
| 小写工单号可正常识别 | passed | passed | 不变 |
| 重复退款任务保持幂等 | passed | passed | 不变 |
| 发票咨询必须读取上下文 | passed | passed | 不变 |
| VIP 退款必须更新工单状态 | error | passed | 恢复 |
| 发票咨询全局不得产生退款 | passed | passed | 不变 |
| VIP 退款全局只产生一条记录 | error | passed | 恢复 |
| 不存在工单不得进入审批 | passed | passed | 不变 |
| 发票咨询应检索业务规则 | passed | passed | 不变 |
| 自然语言升级关键词应直接命中规则 | failed | failed | 不变 |
| 退款审批拒绝后不得写入待审批状态 | passed | passed | 不变 |

> 对比有效的前提是两次实验使用同一组 Case。模型或 Prompt 内容必须真实发生变化，不能只修改版本标签。
