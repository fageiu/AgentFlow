import type { AgentErrorInfo, AgentRun, AgentRunEvent } from "@agentflow/shared";
import { ZodError } from "zod";

export type AgentErrorCategory = "business" | "tool" | "llm" | "system";

/** 携带稳定错误码的基础异常，跨 Provider、工具和 Executor 边界时不再依赖 message 正则猜测类型。 */
export class AgentTypedError extends Error {
  constructor(public readonly agentError: AgentErrorInfo, options?: { cause?: unknown }) {
    super(agentError.message, { cause: options?.cause });
    this.name = "AgentTypedError";
  }
}

export class AgentExecutionError extends AgentTypedError {
  readonly alreadyTraced: boolean;

  constructor(agentError: AgentErrorInfo, options?: { alreadyTraced?: boolean; cause?: unknown }) {
    super(agentError, { cause: options?.cause });
    this.name = "AgentExecutionError";
    this.alreadyTraced = Boolean(options?.alreadyTraced);
  }
}

export class BusinessDataNotFoundError extends AgentTypedError {
  constructor(entity: "Ticket" | "Customer" | "Order" | "Policy", identifier: string) {
    const entityLabels = {
      Ticket: "工单",
      Customer: "客户",
      Order: "订单",
      Policy: "业务规则",
    } as const;
    const label = entityLabels[entity];
    super({
      code: "BUSINESS_DATA_NOT_FOUND",
      category: "business",
      message: `${entity} not found: ${identifier}`,
      userMessage: "没有找到请求的业务数据，请检查工单、客户、订单或规则 ID 是否正确。",
      detailMessage: `查询${label}失败：未找到「${identifier}」对应的数据。`,
      suggestion: `请确认${label}标识是否正确，或先通过只读查询确认可用数据。`,
      retryable: false,
      details: { entity, identifier },
    });
    this.name = "BusinessDataNotFoundError";
  }
}

export type KnowledgeErrorCode =
  | "KNOWLEDGE_SERVICE_UNAVAILABLE"
  | "KNOWLEDGE_INDEX_NOT_READY"
  | "KNOWLEDGE_NO_MATCH"
  | "KNOWLEDGE_DOCUMENT_INVALID";

const knowledgeErrorDefinitions: Record<KnowledgeErrorCode, Omit<AgentErrorInfo, "code" | "message" | "details">> = {
  KNOWLEDGE_SERVICE_UNAVAILABLE: {
    category: "system",
    userMessage: "政策知识库服务暂时不可用，系统已停止后续业务操作。",
    detailMessage: "无法连接政策知识库或服务返回临时故障。",
    suggestion: "请检查 RAG 服务、网络和数据库状态，恢复后重试。",
    retryable: true,
  },
  KNOWLEDGE_INDEX_NOT_READY: {
    category: "system",
    userMessage: "政策知识库索引尚未就绪，系统已停止后续业务操作。",
    detailMessage: "知识库仍在加载模型、迁移数据库或构建索引。",
    suggestion: "请等待 readiness 通过后重新发起任务。",
    retryable: true,
  },
  KNOWLEDGE_NO_MATCH: {
    category: "business",
    userMessage: "政策知识库没有找到足够可靠的处理依据，未执行任何业务写入。",
    detailMessage: "检索结果低于可信阈值，不能据此生成业务决策。",
    suggestion: "请补充更具体的业务场景，或由知识库管理员补充相应政策。",
    retryable: true,
  },
  KNOWLEDGE_DOCUMENT_INVALID: {
    category: "tool",
    userMessage: "政策知识库返回了不符合契约的文档数据，系统已安全停止。",
    detailMessage: "检索响应缺少必要政策字段、得分或引用信息。",
    suggestion: "请检查知识库文档 Schema、索引数据和服务版本。",
    retryable: false,
  },
};

/** 统一承载知识服务错误码，保留 RAG 服务返回的诊断信息。 */
export class KnowledgeServiceError extends AgentTypedError {
  constructor(code: KnowledgeErrorCode, message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super({
      code,
      message,
      ...knowledgeErrorDefinitions[code],
      details,
    }, { cause: options?.cause });
    this.name = "KnowledgeServiceError";
  }
}

export class ToolNotAvailableError extends AgentTypedError {
  constructor(toolName: string) {
    super({
      code: "TOOL_NOT_AVAILABLE",
      category: "tool",
      message: `Tool is not available to agent: ${toolName}`,
      userMessage: "模型请求了当前 Agent 未开放的工具，本次执行已停止以避免越权操作。",
      retryable: false,
      details: { toolName },
    });
    this.name = "ToolNotAvailableError";
  }
}

/** 模型调用了已注册但不属于当前计划步骤的工具，允许 Executor 引导其回到授权工具。 */
export class ToolNotAuthorizedError extends AgentTypedError {
  constructor(toolName: string, expectedTools: string[], planStepId: string) {
    super({
      code: "TOOL_NOT_AUTHORIZED",
      category: "tool",
      message: `Tool is not authorized for plan step ${planStepId}: ${toolName}`,
      userMessage: "模型请求的工具不在当前计划步骤授权范围内，系统已阻止执行。",
      detailMessage: `当前步骤 ${planStepId} 仅允许调用 ${expectedTools.join(", ")}，但模型请求了 ${toolName}。`,
      suggestion: "请按当前计划步骤选择已授权工具。",
      retryable: false,
      details: { toolName, expectedTools, planStepId },
    });
    this.name = "ToolNotAuthorizedError";
  }
}

export class LlmProviderError extends AgentTypedError {
  constructor(message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown; retryable?: boolean }) {
    super({
      code: "LLM_PROVIDER_ERROR",
      category: "llm",
      message,
      userMessage: "模型调用失败，请稍后重试或检查模型配置。",
      retryable: options?.retryable ?? true,
      details,
    }, { cause: options?.cause });
    this.name = "LlmProviderError";
  }
}

export class LlmResponseFormatError extends AgentTypedError {
  constructor(message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super({
      code: "LLM_RESPONSE_FORMAT_ERROR",
      category: "llm",
      message,
      userMessage: "模型返回格式不符合协议要求，本次执行已安全停止。",
      retryable: true,
      details,
    }, { cause: options?.cause });
    this.name = "LlmResponseFormatError";
  }
}

export class LlmTimeoutError extends AgentTypedError {
  constructor(timeoutMs: number) {
    super({
      code: "LLM_TIMEOUT",
      category: "llm",
      message: `LLM request timed out after ${timeoutMs}ms.`,
      userMessage: "模型响应超时，系统已停止本次请求。",
      retryable: true,
      details: { timeoutMs },
    });
    this.name = "LlmTimeoutError";
  }
}

export class AgentLoopLimitError extends AgentTypedError {
  constructor(limit: number) {
    super({
      code: "AGENT_LOOP_LIMIT_EXCEEDED",
      category: "system",
      message: `LLM tool calling loop exceeded ${limit} turns.`,
      userMessage: "Agent 工具调用轮次超过上限，系统已停止执行以避免无限循环。",
      retryable: true,
      details: { limit },
    });
    this.name = "AgentLoopLimitError";
  }
}

export class StorageWriteError extends AgentTypedError {
  constructor(path: string, options?: { cause?: unknown }) {
    super({
      code: "STORAGE_WRITE_ERROR",
      category: "system",
      message: `Failed to persist AgentFlow state: ${path}`,
      userMessage: "运行状态持久化失败，系统已保留当前进程内快照。",
      detailMessage: `无法写入本地状态文件：${path}`,
      suggestion: "请检查数据目录权限、磁盘空间和文件占用情况后重启服务。",
      retryable: true,
      details: { path },
    }, { cause: options?.cause });
    this.name = "StorageWriteError";
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
  if (error instanceof AgentTypedError) {
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

  // 循环上限属于执行器保护，不应因为错误文本包含 LLM 而误归类为 Provider 故障。
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

/** 将结构化 Agent 错误映射为稳定 HTTP 状态，非流式接口与全局兜底共用。 */
export function getAgentErrorHttpStatus(error: AgentErrorInfo) {
  if (error.code === "BUSINESS_DATA_NOT_FOUND" || error.code === "KNOWLEDGE_NO_MATCH") {
    return 404;
  }
  if (error.code === "TOOL_INPUT_VALIDATION_ERROR" || error.code === "TOOL_NOT_AVAILABLE"
    || error.code === "TOOL_NOT_AUTHORIZED" || error.code === "KNOWLEDGE_DOCUMENT_INVALID") {
    return 422;
  }
  if (error.code === "KNOWLEDGE_SERVICE_UNAVAILABLE" || error.code === "KNOWLEDGE_INDEX_NOT_READY") {
    return 503;
  }
  if (error.code === "LLM_TIMEOUT") {
    return 504;
  }
  if (error.category === "llm") {
    return 502;
  }
  if (error.code === "STORAGE_WRITE_ERROR") {
    return 503;
  }
  return 500;
}
