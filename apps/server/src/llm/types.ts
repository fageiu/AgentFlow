/** 当前支持的 LLM Provider 类型。 */
export type LlmProvider = "mock" | "openai-compatible";

/** 文本生成请求的统一入参，不暴露具体模型供应商细节。 */
export interface GenerateTextInput {
  system: string;
  user: string;
  temperature?: number;
}

/** 文本生成结果，包含模型来源，方便前端 trace 展示当前是否走 Mock。 */
export interface GenerateTextResult {
  text: string;
  provider: LlmProvider;
  model: string;
  isMock: boolean;
}

/** 最终结论 Prompt 的上下文入参，由 executor 汇总工具结果后传入。 */
export interface FinalPromptInput {
  task: string;
  ticket: unknown;
  customer: unknown;
  policy: unknown;
}
