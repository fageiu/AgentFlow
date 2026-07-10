import type { AgentPlan } from "@agentflow/shared";
import type { FinalPromptInput, LlmChatMessage } from "./types.js";

/** 构建结构化计划 Prompt，让 Planner 为 Executor 声明最小工具授权。 */
export function buildPlanPrompt(task: string, input?: {
  completedTools?: string[];
  observation?: string;
  ticketContext?: unknown;
}) {
  return {
    system: [
      input ? "[REPLANNER]" : "[PLANNER]",
      "你是企业工单处理 Agent 的 Planner。请只输出严格 JSON，不要 Markdown，也不要编造工具结果。",
      "JSON 格式：{\"version\":1,\"summary\":\"...\",\"steps\":[{\"id\":\"...\",\"title\":\"...\",\"objective\":\"...\",\"allowedTools\":[\"...\"],\"requiresApproval\":false}]}。",
      "每个执行步骤只能授权一个工具；可用工具只有 listTickets、searchTickets、getTicket、getCustomer、getOrder、searchPolicy、createRefund、updateTicketStatus。",
      "此阶段仅规划读取和核查步骤，不要规划 createRefund 或 updateTicketStatus。是否写入必须等待客户、订单和规则均已读取后再判断。",
      "查询、列出、筛选或统计工单时，只规划 listTickets 或 searchTickets，禁止 createRefund 和 updateTicketStatus。",
      input?.ticketContext
        ? "已提供真实工单上下文：不得重复规划 getTicket；根据其中的客户、订单、优先级、状态和诉求，继续规划 getCustomer、getOrder、searchPolicy 及必要的后续动作。"
        : "退款任务应依次规划 getTicket、getCustomer、getOrder、searchPolicy、createRefund、updateTicketStatus；createRefund 的 requiresApproval 必须为 true。",
      "只有确实需要变更状态时才规划 updateTicketStatus。计划步骤数量限制在 1-6 步。",
      input ? "这是一次重规划：只输出尚未完成的后续步骤，不能重复已完成工具。" : "",
    ].join("\n"),
    user: [
      `用户任务：${task}`,
      input?.ticketContext ? `已读取工单上下文：${JSON.stringify(input.ticketContext)}` : "",
      input ? `已完成工具：${input.completedTools?.join(", ") || "无"}` : "",
      input ? `执行观察：${input.observation ?? "无"}` : "",
    ].filter(Boolean).join("\n\n"),
  };
}

/** 基于已读取的真实证据决定后续动作；空 steps 代表无需写入，可直接生成结论。 */
export function buildActionPlanPrompt(input: {
  task: string;
  ticketContext?: unknown;
  evidence: unknown;
}) {
  return {
    system: [
      "[ACTION_PLANNER]",
      "你是企业工单处理 Agent 的决策 Planner。请只输出严格 JSON，不要 Markdown。",
      "JSON 格式：{\"version\":1,\"summary\":\"...\",\"steps\":[{\"id\":\"...\",\"title\":\"...\",\"objective\":\"...\",\"allowedTools\":[\"...\"],\"requiresApproval\":true}]}。",
      "你只能规划 createRefund 和 updateTicketStatus，或者返回空 steps。",
      "必须根据真实客户、订单和规则证据判断：仅当规则与实际情况支持退款时，才依次规划 createRefund（requiresApproval=true）和 updateTicketStatus；否则返回空 steps。",
      "不要因为用户提到退款就默认执行；也不要编造未在证据中出现的资格或金额。",
    ].join("\n"),
    user: [
      `用户任务：${input.task}`,
      input.ticketContext ? `工单上下文：${JSON.stringify(input.ticketContext)}` : "",
      `已完成核查证据：${JSON.stringify(input.evidence)}`,
    ].filter(Boolean).join("\n\n"),
  };
}

/** 构建 Tool Calling 的初始消息，要求模型用工具读取事实并执行必要业务动作。 */
export function buildToolCallingMessages(task: string, plan: AgentPlan, ticketContext?: unknown): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是企业客服流程 Agent，必须通过可用工具读取真实业务数据，不要凭空编造工单、客户、订单或规则信息。",
        "如果任务是查询、列出、筛选或统计工单，请优先使用 listTickets 或 searchTickets，只读汇总结果，不要执行 createRefund 或 updateTicketStatus。",
        "如果任务涉及退款，请先读取工单，再按工单中的 customerId/orderId 查询客户和订单，并检索 refund 规则。",
        ticketContext ? "已在制定计划前读取真实工单详情；请直接使用该上下文中的 customerId 和 orderId，禁止重复调用 getTicket。" : "",
        "如果工具返回 ok=false 的结构化错误，请先阅读 error.detailMessage、error.suggestion 和 retryAttempt，再修正工具名称或参数后重试；不要原样重复同一个失败参数。",
        "如果业务对象明确不存在，或重试后仍无法命中，请停止写入动作并给出失败原因。",
        "当证据足够且需要变更业务状态时，可以调用 createRefund 和 updateTicketStatus。",
        "必须严格遵循下方 Planner 计划：每轮只调用当前步骤 allowedTools 中的一个工具。工具成功后 Executor 才会推进到下一步骤；不得跳步、不得调用未授权工具。",
        "如果当前步骤已经全部完成，请不要再调用工具，直接用中文输出最终结论。",
        "完成所有必要工具调用后，用中文给出简洁最终结论，说明判断依据、已执行动作、风险和下一步。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `用户任务：${task}`,
        ticketContext ? `预读取工单上下文：${JSON.stringify(ticketContext)}` : "",
        `Planner 计划：${JSON.stringify(plan)}`,
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

export function buildFinalConclusionPrompt(input: {
  task: string;
  candidate?: string;
  steps: Array<{
    type: string;
    title: string;
    status?: string;
    toolName?: string;
    detail: string;
  }>;
}) {
  return {
    system: [
      "[FINAL_CONCLUSION]",
      "你是企业客服流程 Agent 的最终回复生成器。",
      "请只根据已完成的执行步骤、工具结果和候选结论生成面向用户的精简处理结论。",
      "要求：",
      "1. 只输出业务结论，不输出 Run ID、耗时、Token、模型名、工具调用次数等观测或评测数据。",
      "2. 不输出 Markdown 表格，不输出长篇过程复盘。",
      "3. 控制在 3-5 行，每行表达一个明确事实或下一步建议。",
      "4. 必须说明任务是否完成、关键处理结果、是否有风险或是否需要后续人工动作。",
      "5. 如果执行步骤已修改业务状态，明确说明修改结果；如果只是查询，明确说明未执行写入操作。",
    ].join("\n"),
    user: [
      `用户任务：${input.task}`,
      `候选结论：${input.candidate ?? "无"}`,
      `执行步骤：${JSON.stringify(input.steps, null, 2)}`,
    ].join("\n\n"),
  };
}

export function buildErrorSummaryPrompt(input: {
  task: string;
  error: {
    code: string;
    category: string;
    message: string;
    userMessage: string;
    detailMessage?: string;
    suggestion?: string;
    details?: Record<string, unknown>;
  };
  steps: Array<{
    type: string;
    title: string;
    status?: string;
    toolName?: string;
    detail: string;
  }>;
}) {
  return {
    system: [
      "[ERROR_SUMMARY]",
      "你是企业 Agent 的错误解释器。",
      "请根据用户任务、结构化错误、失败工具参数和已执行 trace，生成给最终用户看的具体错误原因。",
      "要求返回严格 JSON，不要 Markdown，不要解释 JSON 外的内容。",
      "JSON 结构：{\"detailMessage\":\"...\",\"suggestion\":\"...\"}",
      "detailMessage 必须具体说明失败发生在哪个工具或业务对象上，例如：检索规则失败，未找到关键字 SLA 对应规则。",
      "suggestion 必须给出下一步可操作建议，例如：换用已存在的规则关键字，或先查询规则库。",
      "不要输出 Run ID、Token、耗时、模型名等观测或评测数据。",
    ].join("\n"),
    user: [
      `用户任务：${input.task}`,
      `结构化错误：${JSON.stringify(input.error, null, 2)}`,
      `执行步骤：${JSON.stringify(input.steps, null, 2)}`,
    ].join("\n\n"),
  };
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
