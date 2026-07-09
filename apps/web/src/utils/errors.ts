import type { AgentErrorInfo, AgentStep } from "@agentflow/shared";

interface ErrorSummary {
  title: string;
  message: string;
  advice: string;
  code?: string;
  category?: string;
  retryable?: boolean;
}

const errorTitleMap: Record<string, string> = {
  BUSINESS_DATA_NOT_FOUND: "业务数据不存在",
  TOOL_INPUT_VALIDATION_ERROR: "工具参数不完整或不合法",
  TOOL_NOT_AVAILABLE: "工具不可用",
  LLM_PROVIDER_ERROR: "模型调用异常",
  AGENT_LOOP_LIMIT_EXCEEDED: "执行轮次超限",
  AGENT_INTERNAL_ERROR: "Agent 内部异常",
};

const errorAdviceMap: Record<string, string> = {
  BUSINESS_DATA_NOT_FOUND: "请检查任务中的业务 ID 或查询条件，也可以先让 Agent 执行只读搜索再继续处理。",
  TOOL_INPUT_VALIDATION_ERROR: "请补充缺失参数，或让 Agent 先读取上下文后重新生成工具参数。",
  TOOL_NOT_AVAILABLE: "当前工具注册表不包含该能力，请改用已注册工具或补齐工具定义。",
  LLM_PROVIDER_ERROR: "请检查模型配置和服务可用性，稍后重试。",
  AGENT_LOOP_LIMIT_EXCEEDED: "请缩小任务范围，或补充更明确的业务约束后重试。",
  AGENT_INTERNAL_ERROR: "请查看失败步骤和服务端日志定位未归类异常。",
};

const categoryLabelMap: Record<AgentErrorInfo["category"], string> = {
  business: "业务错误",
  tool: "工具错误",
  llm: "模型错误",
  system: "系统错误",
};

function isAgentErrorInfo(value: unknown): value is AgentErrorInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AgentErrorInfo>;
  return Boolean(candidate.code && candidate.userMessage && candidate.category);
}

export function buildAgentErrorSummary(error: AgentErrorInfo | undefined, fallbackMessage = ""): ErrorSummary | undefined {
  if (!error && !fallbackMessage) {
    return undefined;
  }

  const code = error?.code;

  return {
    title: code ? errorTitleMap[code] ?? "执行失败" : "执行失败",
    message: error?.detailMessage ?? error?.userMessage ?? fallbackMessage,
    advice: error?.suggestion ?? (code ? errorAdviceMap[code] : undefined) ?? "请查看 trace 中的失败步骤，确认失败发生在哪个工具或阶段。",
    code,
    category: error ? categoryLabelMap[error.category] : undefined,
    retryable: error?.retryable,
  };
}

export function extractStepError(step: AgentStep): AgentErrorInfo | undefined {
  if (step.status !== "failed") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(step.detail) as { error?: unknown };
    return isAgentErrorInfo(parsed.error) ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

export function buildStepErrorSummary(step: AgentStep): ErrorSummary | undefined {
  if (step.status !== "failed") {
    return undefined;
  }

  const error = extractStepError(step);
  return buildAgentErrorSummary(error, error ? "" : "该步骤执行失败，详细信息见下方 trace 原始记录。");
}
