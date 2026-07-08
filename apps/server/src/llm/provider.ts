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

/** 生成 Mock 文本，保证没有 API Key 时项目仍可完整演示。 */
function buildMockText(input: GenerateTextInput) {
  if (input.system.includes("执行计划")) {
    return [
      "1. 读取工单信息，确认客户、订单和诉求。",
      "2. 查询客户等级与风险信息。",
      "3. 检索退款规则，判断是否满足条件。",
      "4. 涉及退款或状态变更时调用后端工具落库。",
      "5. 汇总依据并生成处理结论。",
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

function parseToolOutput(messages: LlmChatMessage[], name: string): Record<string, unknown> | undefined {
  const message = [...messages].reverse().find((item) => item.role === "tool" && item.name === name);

  if (!message || message.role !== "tool") {
    return undefined;
  }

  try {
    return JSON.parse(message.content) as Record<string, unknown>;
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
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item)) : undefined;
  } catch {
    return undefined;
  }
}

function hasToolOutput(messages: LlmChatMessage[], name: string) {
  return messages.some((item) => item.role === "tool" && item.name === name);
}

function extractUserTask(messages: LlmChatMessage[]) {
  const userMessage = [...messages].reverse().find((item) => item.role === "user");

  return userMessage?.role === "user" ? userMessage.content : "";
}

function extractTicketIdFromMessages(messages: LlmChatMessage[]) {
  return extractUserTask(messages).match(/T-\d+/i)?.[0].toUpperCase() ?? "T-1001";
}

function isTicketQueryTask(task: string) {
  return /查询|列出|查看|筛选|统计|所有工单|工单列表|哪些工单/.test(task) && !/处理工单\s*T-\d+/i.test(task);
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
  const ticket = parseToolOutput(input.messages, "getTicket");
  const order = parseToolOutput(input.messages, "getOrder");

  if (!hasToolOutput(input.messages, "getTicket")) {
    return { toolCalls: [createMockToolCall("getTicket", { ticketId: requestedTicketId })] };
  }

  if (!hasToolOutput(input.messages, "getCustomer")) {
    return { toolCalls: [createMockToolCall("getCustomer", { customerId: ticket?.customerId ?? "C-9001" })] };
  }

  if (!hasToolOutput(input.messages, "getOrder")) {
    return { toolCalls: [createMockToolCall("getOrder", { orderId: ticket?.orderId ?? "O-7001" })] };
  }

  if (!hasToolOutput(input.messages, "searchPolicy")) {
    return { toolCalls: [createMockToolCall("searchPolicy", { keyword: "refund" })] };
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
