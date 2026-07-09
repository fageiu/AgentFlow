import type { AgentErrorInfo, AgentRun, AgentRunEvent } from "@agentflow/shared";
import { ZodError } from "zod";

export type AgentErrorCategory = "business" | "tool" | "llm" | "system";

export class AgentExecutionError extends Error {
  readonly agentError: AgentErrorInfo;
  readonly alreadyTraced: boolean;

  constructor(agentError: AgentErrorInfo, options?: { alreadyTraced?: boolean; cause?: unknown }) {
    super(agentError.message, { cause: options?.cause });
    this.name = "AgentExecutionError";
    this.agentError = agentError;
    this.alreadyTraced = Boolean(options?.alreadyTraced);
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createAgentError(input: AgentErrorInfo): AgentErrorInfo {
  return input;
}

function formatValue(value: unknown) {
  return value == null ? "" : String(value);
}

function describeBusinessDataNotFound(message: string, details: Record<string, unknown>) {
  const toolName = formatValue(details.toolName);
  const args = details.arguments && typeof details.arguments === "object"
    ? details.arguments as Record<string, unknown>
    : {};

  if (/Policy not found/i.test(message)) {
    const keyword = formatValue(args.keyword) || message.split(":").at(-1)?.trim() || "未知关键字";
    return {
      detailMessage: `检索规则失败：未找到关键字「${keyword}」对应的业务规则。`,
      suggestion: "请换用已存在的规则关键字，或先查询/补充规则库后再继续处理。",
    };
  }

  if (/Ticket not found/i.test(message)) {
    const ticketId = formatValue(args.ticketId) || message.split(":").at(-1)?.trim() || "未知工单";
    return {
      detailMessage: `查询工单失败：工单「${ticketId}」不存在。`,
      suggestion: "请确认工单号是否输入正确，或先使用工单查询工具搜索可用工单。",
    };
  }

  if (/Customer not found/i.test(message)) {
    const customerId = formatValue(args.customerId) || message.split(":").at(-1)?.trim() || "未知客户";
    return {
      detailMessage: `查询客户失败：客户「${customerId}」不存在。`,
      suggestion: "请确认客户 ID 是否正确，或先根据工单重新读取客户信息。",
    };
  }

  if (/Order not found/i.test(message)) {
    const orderId = formatValue(args.orderId) || message.split(":").at(-1)?.trim() || "未知订单";
    return {
      detailMessage: `查询订单失败：订单「${orderId}」不存在。`,
      suggestion: "请确认订单 ID 是否正确，或先根据工单重新读取订单信息。",
    };
  }

  return {
    detailMessage: toolName
      ? `工具 ${toolName} 未找到请求的数据：${message}`
      : `未找到请求的数据：${message}`,
    suggestion: "请检查任务中的业务 ID 或查询条件是否正确。",
  };
}

/** 将底层异常归一化为 Agent 可展示、可记录、可评测的错误对象。 */
export function normalizeAgentError(error: unknown, details: Record<string, unknown> = {}): AgentErrorInfo {
  if (error instanceof AgentExecutionError) {
    return {
      ...error.agentError,
      details: {
        ...error.agentError.details,
        ...details,
      },
    };
  }

  if (error instanceof ZodError) {
    return createAgentError({
      code: "TOOL_INPUT_VALIDATION_ERROR",
      category: "tool",
      message: error.message,
      userMessage: "工具参数校验失败，请检查任务中的业务对象 ID、状态或金额是否完整。",
      retryable: false,
      details: {
        issues: error.issues,
        ...details,
      },
    });
  }

  const message = getErrorMessage(error);

  if (/not found/i.test(message)) {
    const notFoundDetail = describeBusinessDataNotFound(message, details);

    return createAgentError({
      code: "BUSINESS_DATA_NOT_FOUND",
      category: "business",
      message,
      userMessage: "没有找到请求的业务数据，请检查工单、客户、订单或规则 ID 是否正确。",
      detailMessage: notFoundDetail.detailMessage,
      suggestion: notFoundDetail.suggestion,
      retryable: false,
      details,
    });
  }

  if (/Tool is not available/i.test(message)) {
    return createAgentError({
      code: "TOOL_NOT_AVAILABLE",
      category: "tool",
      message,
      userMessage: "模型请求了当前 Agent 未开放的工具，本次执行已停止以避免越权操作。",
      retryable: false,
      details,
    });
  }

  if (/LLM|model|chat completions|response/i.test(message)) {
    return createAgentError({
      code: "LLM_PROVIDER_ERROR",
      category: "llm",
      message,
      userMessage: "模型调用失败或返回格式异常，请稍后重试或检查模型配置。",
      retryable: true,
      details,
    });
  }

  if (/loop exceeded/i.test(message)) {
    return createAgentError({
      code: "AGENT_LOOP_LIMIT_EXCEEDED",
      category: "system",
      message,
      userMessage: "Agent 工具调用轮次超过上限，系统已停止执行以避免无限循环。",
      retryable: true,
      details,
    });
  }

  return createAgentError({
    code: "AGENT_INTERNAL_ERROR",
    category: "system",
    message,
    userMessage: "Agent 执行过程中出现未预期错误，请稍后重试或查看 trace 定位问题。",
    retryable: true,
    details,
  });
}

export function formatAgentErrorDetail(error: AgentErrorInfo, context: Record<string, unknown>) {
  return JSON.stringify(
    {
      error,
      context,
    },
    null,
    2,
  );
}

export function createAgentErrorEvent(run: AgentRun, error: AgentErrorInfo): Extract<AgentRunEvent, { kind: "error" }> {
  return {
    kind: "error",
    message: error.userMessage,
    error,
    run,
  };
}
