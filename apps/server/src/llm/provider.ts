import { getLlmConfig } from "./config.js";
import type { LlmTokenUsage } from "@agentflow/shared";
import type {
  GenerateChatInput,
  GenerateChatResult,
  GenerateTextInput,
  GenerateTextResult,
  LlmChatMessage,
  LlmToolCall,
  LlmToolDefinition,
} from "./types.js";

interface OpenAiToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** OpenAI-compatible chat completions 的最小响应结构，只保留当前用到的字段。 */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function createTokenUsage(promptText: string, completionText: string): LlmTokenUsage {
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(completionText);

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function parseUsage(data: ChatCompletionResponse, fallback: LlmTokenUsage): LlmTokenUsage {
  const promptTokens = data.usage?.prompt_tokens ?? fallback.promptTokens;
  const completionTokens = data.usage?.completion_tokens ?? fallback.completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens: data.usage?.total_tokens ?? promptTokens + completionTokens,
  };
}

/** Mock Planner 也输出与真实模型一致的结构化计划，保证本地演示走同一授权链路。 */
function buildMockPlan(task: string) {
  const queryTask = isTicketQueryTask(task);
  const refundTask = isRefundTask(task);

  if (queryTask) {
    const searchArgs = createTicketSearchArgs(task);
    const toolName = Object.keys(searchArgs).length > 0 ? "searchTickets" : "listTickets";
    return {
      version: 1,
      summary: "只读查询工单并汇总结果。",
      steps: [{
        id: "query-tickets",
        title: "查询工单",
        objective: "读取符合用户条件的工单，不产生业务写入。",
        allowedTools: [toolName],
        requiresApproval: false,
      }],
    };
  }

  const steps = [
    ["read-ticket", "读取工单", "确认工单关联的客户、订单和诉求。", "getTicket"],
    ["read-customer", "读取客户", "核查客户等级和风险信息。", "getCustomer"],
    ["read-order", "读取订单", "核查订单金额、状态与退款状态。", "getOrder"],
    ["read-policy", "检索规则", "依据任务检索对应业务规则。", "searchPolicy"],
  ].map(([id, title, objective, toolName]) => ({
    id,
    title,
    objective,
    allowedTools: [toolName],
    requiresApproval: false,
  }));

  if (refundTask) {
    steps.push(
      {
        id: "create-refund",
        title: "创建待审批退款",
        objective: "在规则满足时创建待审批退款记录。",
        allowedTools: ["createRefund"],
        requiresApproval: true,
      },
      {
        id: "sync-ticket-status",
        title: "同步工单状态",
        objective: "退款记录成功创建后，将工单同步为待审批。",
        allowedTools: ["updateTicketStatus"],
        requiresApproval: false,
      },
    );
  }

  return {
    version: 1,
    summary: refundTask ? "核查退款条件，必要时在审批后创建退款并同步工单。" : "核查工单上下文和规则后给出只读处理结论。",
    steps,
  };
}

/** Mock 决策阶段同样只根据已传入的工单与规则证据决定是否进入退款流程。 */
function buildMockActionPlan(evidence: string) {
  const hasMatchedRefundRule = /VIP 客户退款规则|"matchedKeyword"\s*:\s*"refund"|"keyword"\s*:\s*"refund"/i.test(evidence);
  const hasNonRefundScenario = /发票|invoice|升级|合同升级|sla|服务不可用|取消|cancel/i.test(evidence);
  // 工单证据明确属于发票、升级等非退款场景时，错误命中的退款规则不能覆盖业务事实。
  const shouldRefund = !hasNonRefundScenario && (hasMatchedRefundRule || /退款|refund/i.test(evidence));

  if (!shouldRefund) {
    return {
      version: 1,
      summary: "现有客户、订单与规则证据不足以支持退款，不执行写入操作。",
      steps: [],
    };
  }

  return {
    version: 1,
    summary: "客户、订单和退款规则满足条件，进入待审批退款流程并同步工单状态。",
    steps: [
      {
        id: "create-refund",
        title: "创建待审批退款",
        objective: "根据已核查的订单金额创建待审批退款记录。",
        allowedTools: ["createRefund"],
        requiresApproval: true,
      },
      {
        id: "sync-ticket-status",
        title: "同步工单状态",
        objective: "退款记录创建后，将工单同步为待审批。",
        allowedTools: ["updateTicketStatus"],
        requiresApproval: false,
      },
    ],
  };
}

/** 生成 Mock 文本，保证没有 API Key 时项目仍可完整演示。 */
function buildMockText(input: GenerateTextInput) {
  if (input.system.includes("[ACTION_PLANNER]")) {
    return JSON.stringify(buildMockActionPlan(input.user));
  }

  if (input.system.includes("[PLANNER]") || input.system.includes("[REPLANNER]")) {
    const task = input.user.match(/用户任务：\s*([^\n]+)/)?.[1] ?? input.user;
    const plan = buildMockPlan(task);
    const completedTools = input.user.match(/已完成工具：\s*([^\n]+)/)?.[1]
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];

    if (input.system.includes("[REPLANNER]")) {
      plan.steps = plan.steps.filter((step) => !completedTools.includes(step.allowedTools[0]));
    }

    if (input.user.includes("已读取工单上下文")) {
      plan.steps = plan.steps.filter((step) => step.allowedTools[0] !== "getTicket");
    }

    if (input.system.includes("[PLANNER]")) {
      plan.steps = plan.steps.filter((step) => step.allowedTools[0] !== "createRefund" && step.allowedTools[0] !== "updateTicketStatus");
    }

    return JSON.stringify(plan);
  }

  if (input.system.includes("[ERROR_SUMMARY]")) {
    const message = input.user.match(/"message":\s*"([^"]+)"/)?.[1] ?? "未知错误";
    const toolName = input.user.match(/"toolName":\s*"([^"]+)"/)?.[1];
    const keyword = input.user.match(/"keyword":\s*"([^"]+)"/)?.[1];
    const ticketId = input.user.match(/"ticketId":\s*"([^"]+)"/)?.[1];
    const target = keyword ? `关键字 ${keyword}` : ticketId ? `工单 ${ticketId}` : message;

    return JSON.stringify({
      detailMessage: toolName ? `${toolName} 调用失败：未找到 ${target} 对应的数据。` : `未找到 ${target} 对应的数据。`,
      suggestion: "请检查输入的业务 ID 或查询关键字是否存在，必要时先执行查询工具确认可用数据。",
    });
  }

  if (input.system.includes("[FINAL_CONCLUSION]")) {
    const ticketId = input.user.match(/T-\d+/i)?.[0]?.toUpperCase() ?? "该工单";
    const task = input.user.match(/用户任务：\s*([^\n]+)/)?.[1] ?? `处理 ${ticketId}`;
    const candidate = input.user.match(/候选结论：([\s\S]*?)\n\n执行步骤：/)?.[1]?.trim();
    const statusMatch = input.user.match(/"status"\s*:\s*"([^"]+)"/);
    const status = statusMatch?.[1];

    const hasQueryTrace = /"toolName"\s*:\s*"(?:listTickets|searchTickets)"/.test(input.user);
    if ((candidate && /已查询|查询工单|结果如下|只读查询/.test(candidate)) || hasQueryTrace) {
      const ticketIds = [...new Set(input.user.match(/T-\d+/gi)?.map((item) => item.toUpperCase()) ?? [])];
      return [
        `工单需求：${task}`,
        `处理结果：已完成只读查询，${ticketIds.length ? `返回工单 ${ticketIds.join("、")}。` : "已返回匹配工单。"}`,
        "处理依据：已通过工单查询工具读取真实业务数据，未执行写入操作。",
        "下一步：如需处理某张工单，请提供工单号或明确业务目标。",
      ].join("\n");
    }

    if (/人工已拒绝|审批拒绝/.test(input.user)) {
      return [
        `工单需求：${task}`,
        `处理结果：审批已拒绝，未创建退款记录，${ticketId} 保持原业务状态。`,
        "处理依据：退款属于高风险操作，人工审批未通过，因此后续依赖状态更新已跳过。",
        "下一步：请根据拒绝原因与客户沟通；如需重新处理，可补充材料后再次发起。",
      ].join("\n");
    }

    if (/未创建退款|未执行退款|未更新工单状态|未执行写入|不执行写入|无需退款|无需退款或状态变更/.test(input.user)) {
      return [
        `工单需求：${task}`,
        "处理结果：已完成核查，未创建退款记录，也未更新工单状态。",
        "处理依据：已读取工单、客户、订单及适用规则，现有证据不支持进入退款或高风险变更流程。",
        "下一步：可按命中规则与客户沟通后续处理意见。",
      ].join("\n");
    }

    return [
      `工单需求：${task}`,
      status ? `处理结果：已完成必要处理，当前关键业务状态为 ${status}。` : "处理结果：已完成必要业务核查和处理判断。",
      "处理依据：已读取工单、客户、订单及命中规则，并按审批边界执行必要动作。",
      "下一步：请根据当前业务状态完成后续人工确认或客户沟通。",
    ].join("\n");
  }

  return "根据当前工单、客户、订单和规则信息，该客户为 VIP，退款动作会改变业务状态，已创建待审批退款记录，并将工单状态更新为 waiting_approval。";
}

/** 将 Mock 文本包装成统一的 GenerateTextResult，方便 executor 无差别消费。 */
function createMockTextResult(input: GenerateTextInput, model = "mock-llm"): GenerateTextResult {
  const text = buildMockText(input);

  return {
    text,
    provider: "mock",
    model,
    isMock: true,
    tokenUsage: createTokenUsage(`${input.system}\n${input.user}`, text),
  };
}

function createMockToolCall(name: string, args: Record<string, unknown>): LlmToolCall {
  return {
    id: `mock-call-${name}`,
    name,
    arguments: args,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isToolErrorPayload(value: unknown) {
  return isRecord(value) && value.ok === false && isRecord(value.error);
}

function parseToolOutput(messages: LlmChatMessage[], name: string): Record<string, unknown> | undefined {
  const message = [...messages].reverse().find((item) => item.role === "tool" && item.name === name);

  if (!message || message.role !== "tool") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(message.content) as unknown;
    return isRecord(parsed) && !isToolErrorPayload(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 预读取的工单上下文会随初始消息传入，Mock 也必须使用它避免重复 getTicket。 */
function parsePreloadedTicketContext(messages: LlmChatMessage[]) {
  const userMessage = messages.find((item) => item.role === "user");
  if (!userMessage || userMessage.role !== "user") {
    return undefined;
  }

  const raw = userMessage.content.match(/预读取工单上下文：(\{[\s\S]*?\})\n\nPlanner 计划：/)?.[1];
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseToolOutputArray(messages: LlmChatMessage[], name: string): Array<Record<string, unknown>> | undefined {
  const message = [...messages].reverse().find((item) => item.role === "tool" && item.name === name);

  if (!message || message.role !== "tool") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(message.content) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => isRecord(item)) : undefined;
  } catch {
    return undefined;
  }
}

function hasToolOutput(messages: LlmChatMessage[], name: string) {
  return messages.some((item) => {
    if (item.role !== "tool" || item.name !== name) {
      return false;
    }

    try {
      return !isToolErrorPayload(JSON.parse(item.content) as unknown);
    } catch {
      return false;
    }
  });
}

/** Action Planner 追加动作后，Mock 必须服从当前计划而非只看初始用户措辞。 */
function hasPlannedAction(messages: LlmChatMessage[], toolName: string) {
  return messages.some((message) => message.role === "system" && message.content.includes(`\"${toolName}\"`));
}

function getLastToolError(messages: LlmChatMessage[], name: string) {
  const message = [...messages].reverse().find((item) => item.role === "tool" && item.name === name);

  if (!message || message.role !== "tool") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(message.content) as unknown;
    return isToolErrorPayload(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractUserTask(messages: LlmChatMessage[]) {
  const userMessage = [...messages].reverse().find((item) => item.role === "user");
  if (userMessage?.role !== "user") {
    return "";
  }

  // 初始消息还会携带 Planner 计划和预读取上下文；意图判断只能使用用户原始任务行。
  return userMessage.content.match(/用户任务：\s*([^\n]+)/)?.[1] ?? userMessage.content;
}

function extractTicketIdFromMessages(messages: LlmChatMessage[]) {
  return extractUserTask(messages).match(/T-\d+/i)?.[0].toUpperCase() ?? "T-1001";
}

function isTicketQueryTask(task: string) {
  return /查询|列出|查看|筛选|统计|所有工单|工单列表|哪些工单/.test(task) && !/处理工单\s*T-\d+/i.test(task);
}

function isRefundTask(task: string) {
  return /退款|refund/i.test(task) && !/发票|升级|合同升级|咨询/.test(task);
}

function createPolicyKeyword(task: string, messages: LlmChatMessage[]) {
  const lastPolicyError = getLastToolError(messages, "searchPolicy");
  // 只使用用户任务和工具观察作为业务证据；system prompt 中的示例词不能参与场景分类。
  const businessEvidence = messages
    .filter((message) => message.role === "user" || message.role === "tool")
    .map((message) => message.content ?? "")
    .join("\n");
  const evidence = `${task}\n${businessEvidence}`;

  if (lastPolicyError && /升级/.test(evidence)) {
    return "upgrade";
  }

  if (/发票/.test(evidence)) {
    // 模拟真实模型更常见的自然语言关键词，验证后端政策检索能完成语义归一化。
    return "发票补开";
  }

  if (/升级/.test(evidence)) {
    return "升级";
  }

  if (/SLA|服务不可用|不可用/i.test(evidence)) {
    return "sla";
  }

  if (/取消|cancel/i.test(evidence)) {
    return "cancel";
  }

  return "refund";
}

function createTicketSearchArgs(task: string) {
  const args: Record<string, unknown> = {};

  if (/待审批|等待审批/.test(task)) {
    args.status = "waiting_approval";
  } else if (/打开|未处理|待处理|open/i.test(task)) {
    args.status = "open";
  } else if (/已退款/.test(task)) {
    args.status = "refunded";
  } else if (/已拒绝|拒绝/.test(task)) {
    args.status = "rejected";
  } else if (/已关闭|关闭/.test(task)) {
    args.status = "closed";
  }

  if (/高优先级|高优|high/i.test(task)) {
    args.priority = "high";
  } else if (/中优先级|medium/i.test(task)) {
    args.priority = "medium";
  } else if (/低优先级|low/i.test(task)) {
    args.priority = "low";
  }

  const customerId = task.match(/C-\d+/i)?.[0].toUpperCase();
  if (customerId) {
    args.customerId = customerId;
  }

  return args;
}

function formatTicketList(tickets: Array<Record<string, unknown>> | undefined) {
  if (!tickets?.length) {
    return "未查询到符合条件的工单。";
  }

  return tickets
    .map((ticket) =>
      [
        `- ${ticket.id}`,
        ticket.title,
        `状态：${ticket.status}`,
        `优先级：${ticket.priority}`,
        `客户：${ticket.customerId}`,
        `订单：${ticket.orderId}`,
      ].join("，"),
    )
    .join("\n");
}

/** Mock Tool Calling 会读取上一轮工具输出，模拟模型逐步决定下一次工具调用。 */
function buildMockChatMessage(input: GenerateChatInput, errorMessage?: string): GenerateChatResult["message"] {
  const task = extractUserTask(input.messages);
  const isQueryTask = isTicketQueryTask(task);

  if (isQueryTask) {
    const searchArgs = createTicketSearchArgs(task);
    const useSearch = Object.keys(searchArgs).length > 0;
    const toolName = useSearch ? "searchTickets" : "listTickets";

    if (!hasToolOutput(input.messages, toolName)) {
      return { toolCalls: [createMockToolCall(toolName, searchArgs)] };
    }

    const tickets = parseToolOutputArray(input.messages, toolName);
    return {
      content: [
        useSearch ? "已按条件查询工单，结果如下：" : "已查询全部工单，结果如下：",
        formatTicketList(tickets),
        "本次为只读查询，未执行退款、审批或工单状态变更。",
        errorMessage ? `[Mock fallback: ${errorMessage}]` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const requestedTicketId = extractTicketIdFromMessages(input.messages);
  const ticket = parseToolOutput(input.messages, "getTicket") ?? parsePreloadedTicketContext(input.messages);
  const order = parseToolOutput(input.messages, "getOrder");
  const policyKeyword = createPolicyKeyword(task, input.messages);
  const shouldWriteRefund = isRefundTask(task) || hasPlannedAction(input.messages, "createRefund");

  // 工单可能已在 Planner 前预读取并作为上下文传入，此时无需重复调用 getTicket。
  if (!ticket) {
    return { toolCalls: [createMockToolCall("getTicket", { ticketId: requestedTicketId })] };
  }

  if (!hasToolOutput(input.messages, "getCustomer")) {
    return { toolCalls: [createMockToolCall("getCustomer", { customerId: ticket?.customerId ?? "C-9001" })] };
  }

  if (!hasToolOutput(input.messages, "getOrder")) {
    return { toolCalls: [createMockToolCall("getOrder", { orderId: ticket?.orderId ?? "O-7001" })] };
  }

  if (!hasToolOutput(input.messages, "searchPolicy")) {
    return { toolCalls: [createMockToolCall("searchPolicy", { keyword: policyKeyword })] };
  }

  if (!shouldWriteRefund) {
    return {
      content: [
        "已完成工具调用链路：读取工单、客户、订单和业务规则后，确认该任务不需要退款或高风险状态变更。",
        "本次为业务咨询处理，未创建退款记录，也未更新工单状态。",
        errorMessage ? `[Mock fallback: ${errorMessage}]` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (!hasToolOutput(input.messages, "createRefund")) {
    return {
      toolCalls: [
        createMockToolCall("createRefund", {
          orderId: order?.id ?? "O-7001",
          amount: order?.amount ?? 0,
          reason: "VIP 客户在退款规则范围内申请退款，先创建待审批退款记录。",
        }),
      ],
    };
  }

  if (!hasToolOutput(input.messages, "updateTicketStatus")) {
    return {
      toolCalls: [
        createMockToolCall("updateTicketStatus", {
          ticketId: ticket?.id ?? "T-1001",
          status: "waiting_approval",
        }),
      ],
    };
  }

  return {
    content: [
      "已完成工具调用链路：读取工单、客户、订单和退款规则后，创建了待审批退款记录，并把工单状态更新为 waiting_approval。",
      "结论：该请求满足进入退款处理流程的条件，但退款属于高风险业务动作，后续应接入人工审批后再最终确认。",
      errorMessage ? `[Mock fallback: ${errorMessage}]` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function createMockChatResult(input: GenerateChatInput, model = "mock-llm", errorMessage?: string): GenerateChatResult {
  const message = buildMockChatMessage(input, errorMessage);
  const completionText = JSON.stringify(message);

  return {
    message,
    provider: "mock",
    model,
    isMock: true,
    tokenUsage: createTokenUsage(JSON.stringify(input.messages), completionText),
  };
}

function toOpenAiTool(tool: LlmToolDefinition) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toOpenAiMessage(message: LlmChatMessage) {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.toolCalls?.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      })),
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }

  return message;
}

function parseToolCallArguments(raw: string | undefined) {
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM tool call arguments must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function parseAssistantMessage(data: ChatCompletionResponse): GenerateChatResult["message"] {
  const message = data.choices?.[0]?.message;

  if (!message) {
    throw new Error("LLM response does not contain assistant message.");
  }

  return {
    content: message.content?.trim() || undefined,
    toolCalls: message.tool_calls?.map((toolCall, index) => {
      const name = toolCall.function?.name;
      if (!name) {
        throw new Error("LLM tool call does not contain function name.");
      }

      return {
        id: toolCall.id ?? `tool-call-${index + 1}`,
        name,
        arguments: parseToolCallArguments(toolCall.function?.arguments),
      };
    }),
  };
}

/** 统一的文本生成入口，当前用于计划和兼容旧的最终总结。 */
export async function generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
  const config = getLlmConfig();

  if (config.mock || !config.apiKey || config.provider === "mock") {
    return createMockTextResult(input);
  }

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        temperature: input.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error("LLM response does not contain message content.");
    }

    return {
      text,
      provider: "openai-compatible",
      model: config.model,
      isMock: false,
      tokenUsage: parseUsage(data, createTokenUsage(`${input.system}\n${input.user}`, text)),
    };
  } catch (error) {
    if (!config.fallbackOnError) {
      throw error;
    }

    const result = createMockTextResult(input, `${config.model} -> mock-fallback`);
    const message = error instanceof Error ? error.message : "unknown LLM error";
    return {
      ...result,
      text: `${result.text}\n\n[Mock fallback: ${message}]`,
      tokenUsage: createTokenUsage(`${input.system}\n${input.user}`, `${result.text}\n\n[Mock fallback: ${message}]`),
    };
  }
}

/** 支持 Tool Calling 的统一 chat 入口，executor 只消费标准化后的 toolCalls。 */
export async function generateChat(input: GenerateChatInput): Promise<GenerateChatResult> {
  const config = getLlmConfig();

  if (config.mock || !config.apiKey || config.provider === "mock") {
    return createMockChatResult(input);
  }

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: input.messages.map(toOpenAiMessage),
        tools: input.tools?.map(toOpenAiTool),
        tool_choice: input.tools?.length ? "auto" : undefined,
        temperature: input.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const message = parseAssistantMessage(data);

    return {
      message,
      provider: "openai-compatible",
      model: config.model,
      isMock: false,
      tokenUsage: parseUsage(data, createTokenUsage(JSON.stringify(input.messages), JSON.stringify(message))),
    };
  } catch (error) {
    if (!config.fallbackOnError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "unknown LLM error";
    return createMockChatResult(input, `${config.model} -> mock-fallback`, message);
  }
}
