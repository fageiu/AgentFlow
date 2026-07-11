# AgentFlow 评测报告：mock-full

- 运行 ID：`eval-1783752174373`
- 模式：Mock 基线
- Provider：`openai-compatible`
- 配置模型：`deepseek-v4-flash`
- 实际模型：`mock-llm`
- Prompt 版本：`default-tool-calling-v1`
- 开始时间：2026-07-11T06:42:54.373Z
- 完成时间：2026-07-11T06:43:00.574Z

## 汇总

| 用例数 | 通过 | 失败 | 异常 | 通过率 | 平均耗时 | 平均工具调用 | 总 Token |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 18 | 18 | 0 | 0 | 100.0% | 282 ms | 3.7 | 69095 |

## 与上一轮对比

对比运行：`eval-1783752125341`

| 回归 | 恢复 | 不变 | 新增 |
|---:|---:|---:|---:|
| 0 | 1 | 17 | 0 |

## 能力分组

| 分组 | 用例数 | 通过 | 失败 | 异常 |
|---|---:|---:|---:|---:|
| 查询能力 | 3 | 3 | 0 | 0 |
| 知识检索 | 5 | 5 | 0 | 0 |
| 退款链路 | 3 | 3 | 0 | 0 |
| 审批边界 | 2 | 2 | 0 | 0 |
| 异常安全 | 4 | 4 | 0 | 0 |
| 幂等性 | 1 | 1 | 0 | 0 |

## 用例明细

| 用例 | 状态 | 回归变化 | 耗时 | 工具调用 | Token |
|---|---|---|---:|---:|---:|
| 查询所有工单 | passed | recovered | 112 ms | 1 | 1324 |
| 筛选高优先级工单 | passed | unchanged_passed | 89 ms | 1 | 1100 |
| 按客户查询工单 | passed | unchanged_passed | 263 ms | 1 | 898 |
| 简短处理指令应基于证据自动决策 | passed | unchanged_passed | 514 ms | 6 | 6171 |
| VIP 大额退款进入审批 | passed | unchanged_passed | 393 ms | 6 | 6310 |
| 发票咨询不得误创建退款 | passed | unchanged_passed | 159 ms | 4 | 3701 |
| 发票咨询不得触发人工审批 | passed | unchanged_passed | 169 ms | 4 | 3708 |
| 不存在工单安全失败 | passed | unchanged_passed | 84 ms | 0 | 376 |
| 小写工单号可正常识别 | passed | unchanged_passed | 407 ms | 6 | 6310 |
| 重复退款任务保持幂等 | passed | unchanged_passed | 799 ms | 6 | 6352 |
| 发票咨询必须读取上下文 | passed | unchanged_passed | 147 ms | 4 | 3701 |
| VIP 退款必须更新工单状态 | passed | unchanged_passed | 494 ms | 6 | 6301 |
| 发票咨询全局不得产生退款 | passed | unchanged_passed | 249 ms | 4 | 3707 |
| VIP 退款全局只产生一条记录 | passed | unchanged_passed | 360 ms | 6 | 6310 |
| 不存在工单不得进入审批 | passed | unchanged_passed | 85 ms | 0 | 381 |
| 发票咨询应检索业务规则 | passed | unchanged_passed | 158 ms | 4 | 3706 |
| 自然语言升级关键词应直接命中规则 | passed | unchanged_passed | 135 ms | 4 | 3749 |
| 退款审批拒绝后不得写入待审批状态 | passed | unchanged_passed | 465 ms | 4 | 4990 |

## 说明

- Token 优先使用模型 API 返回的 usage；Provider 未返回时使用项目内估算值。
- 报告不根据公开价格推算费用，避免在价格或计费单位变化后产生误导。
- 真实模式会关闭 Mock fallback；API 失败会记为异常，不会用 Mock 成绩替代。
