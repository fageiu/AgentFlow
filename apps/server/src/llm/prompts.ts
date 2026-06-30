import type { FinalPromptInput } from "./types.js";

/** 构建计划生成 Prompt，让 LLM 只规划步骤，不编造工具结果。 */
export function buildPlanPrompt(task: string) {
  return {
    system:
      "你是企业工单处理 Agent。你需要根据用户任务生成 3-5 步执行计划。不要编造工具结果，只描述接下来应该查询哪些信息、判断哪些规则、是否可能需要审批。",
    user: `用户任务：${task}`,
  };
}

/** 构建最终结论 Prompt，把后端工具结果交给 LLM 生成面向业务的处理报告。 */
export function buildFinalPrompt(input: FinalPromptInput) {
  return {
    system:
      "你是企业客服流程 Agent。请根据用户任务、工单、客户和规则检索结果生成处理结论。必须说明判断依据、是否建议退款、是否需要人工审批、下一步操作。",
    user: [
      `用户任务：${input.task}`,
      `工单信息：${JSON.stringify(input.ticket, null, 2)}`,
      `客户信息：${JSON.stringify(input.customer, null, 2)}`,
      `规则信息：${JSON.stringify(input.policy, null, 2)}`,
    ].join("\n\n"),
  };
}
