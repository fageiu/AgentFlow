import type { LlmTokenUsage } from "@agentflow/shared";

/** 当前支持的 LLM Provider 类型。 */
export type LlmProvider = "mock" | "openai-compatible";

export type JsonObjectSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** 暴露给 LLM 的工具定义，保持 OpenAI-compatible tools 可直接转换。 */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: JsonObjectSchema;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type LlmChatMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content?: string;
      toolCalls?: LlmToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      content: string;
    };

/** 文本生成请求的统一入参，不暴露具体模型供应商细节。 */
export interface GenerateTextInput {
  system: string;
  user: string;
  temperature?: number;
}

export interface GenerateChatInput {
  messages: LlmChatMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
}

/** 文本生成结果包含模型来源，方便前端 trace 展示当前是否走 Mock。 */
export interface GenerateTextResult {
  text: string;
  provider: LlmProvider;
  model: string;
  isMock: boolean;
  tokenUsage: LlmTokenUsage;
}

export interface GenerateChatResult {
  message: {
    content?: string;
    toolCalls?: LlmToolCall[];
  };
  provider: LlmProvider;
  model: string;
  isMock: boolean;
  tokenUsage: LlmTokenUsage;
}

/** 最终结论 Prompt 的上下文入参，由 executor 汇总工具结果后传入。 */
export interface FinalPromptInput {
  task: string;
  ticket: unknown;
  customer: unknown;
  order: unknown;
  policy: unknown;
  refund?: unknown;
  ticketStatusUpdate?: unknown;
}
