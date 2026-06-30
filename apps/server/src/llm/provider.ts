import { getLlmConfig } from "./config.js";
import type { GenerateTextInput, GenerateTextResult } from "./types.js";

/** OpenAI-compatible chat completions 的最小响应结构，只保留当前用到的字段。 */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/** 生成 Mock 文本，保证没有 API Key 时项目仍可完整演示。 */
function buildMockText(input: GenerateTextInput) {
  if (input.system.includes("执行计划")) {
    return "1. 读取工单信息，确认客户、订单和诉求。\n2. 查询客户等级与风险信息。\n3. 检索退款规则，判断是否满足条件。\n4. 若涉及退款或状态变更，标记为需要人工审批。\n5. 汇总依据并生成处理结论。";
  }

  return "根据当前工单、客户和规则信息，该客户为 VIP，退款动作会改变业务状态，建议进入人工审批后再创建退款单，并将工单状态更新为 waiting_approval。";
}

/** 将 Mock 文本包装成统一的 GenerateTextResult，方便 executor 无差别消费。 */
function createMockResult(input: GenerateTextInput, model = "mock-llm"): GenerateTextResult {
  return {
    text: buildMockText(input),
    provider: "mock",
    model,
    isMock: true,
  };
}

/**
 * 统一的文本生成入口。
 * 当前支持 OpenAI-compatible HTTP API；配置缺失或请求失败时可降级为 Mock。
 */
export async function generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
  const config = getLlmConfig();

  if (config.mock || !config.apiKey || config.provider === "mock") {
    return createMockResult(input);
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
    };
  } catch (error) {
    if (!config.fallbackOnError) {
      throw error;
    }

    // 保持 Demo 可运行：真实 LLM 暂时不可用时降级为 Mock，同时在输出中暴露原因。
    const result = createMockResult(input, `${config.model} -> mock-fallback`);
    const message = error instanceof Error ? error.message : "unknown LLM error";
    return {
      ...result,
      text: `${result.text}\n\n[Mock fallback: ${message}]`,
    };
  }
}
