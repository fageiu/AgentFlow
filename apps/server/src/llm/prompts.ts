import type { FinalPromptInput, LlmChatMessage } from "./types.js";

/** 构建计划生成 Prompt，让 LLM 只规划步骤，不编造工具结果。 */
export function buildPlanPrompt(task: string) {
  return {
    system: [
      "你是企业工单处理 Agent。你需要根据用户任务生成 3-5 步执行计划。不要编造工具结果，只描述接下来应该查询哪些信息、判断哪些规则、是否可能需要审批。",
      "如果用户只是查询或筛选工单，计划应保持只读，不要设计退款或状态变更步骤。",
    ].join("\n"),
    user: `用户任务：${task}`,
  };
}

/** 构建 Tool Calling 的初始消息，要求模型用工具读取事实并执行必要业务动作。 */
export function buildToolCallingMessages(task: string): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是企业客服流程 Agent，必须通过可用工具读取真实业务数据，不要凭空编造工单、客户、订单或规则信息。",
        "如果任务是查询、列出、筛选或统计工单，请优先使用 listTickets 或 searchTickets，只读汇总结果，不要执行 createRefund 或 updateTicketStatus。",
        "如果任务涉及退款，请先读取工单，再按工单中的 customerId/orderId 查询客户和订单，并检索 refund 规则。",
        "当证据足够且需要变更业务状态时，可以调用 createRefund 和 updateTicketStatus。",
        "完成所有必要工具调用后，用中文给出简洁最终结论，说明判断依据、已执行动作、风险和下一步。",
      ].join("\n"),
    },
    {
      role: "user",
      content: `用户任务：${task}`,
    },
  ];
}

/** 构建最终结论 Prompt，保留给非 Tool Calling 的兼容场景和后续评测脚本。 */
export function buildFinalPrompt(input: FinalPromptInput) {
  return {
    system:
      "你是企业客服流程 Agent。请根据用户任务、工单、客户和规则检索结果生成处理结论。必须说明判断依据、是否建议退款、是否需要人工审批、下一步操作。",
    user: [
      `用户任务：${input.task}`,
      `工单信息：${JSON.stringify(input.ticket, null, 2)}`,
      `客户信息：${JSON.stringify(input.customer, null, 2)}`,
      `订单信息：${JSON.stringify(input.order, null, 2)}`,
      `规则信息：${JSON.stringify(input.policy, null, 2)}`,
      `退款记录：${JSON.stringify(input.refund ?? null, null, 2)}`,
      `工单状态变更：${JSON.stringify(input.ticketStatusUpdate ?? null, null, 2)}`,
    ].join("\n\n"),
  };
}
