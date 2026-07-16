import type {
  AgentOutcome,
  AgentOutcomeReasoning,
  AgentOutcomeRecommendation,
  AgentRun,
  AgentStep,
} from "@agentflow/shared";

export interface EvidenceFact {
  id: string;
  source: string;
  description: string;
  value: unknown;
}

export interface EvidencePacket {
  task: string;
  trustedDecision: AgentOutcome["decision"];
  performedActions: string[];
  facts: EvidenceFact[];
}

interface LlmBusinessDecision {
  reasoning: AgentOutcomeReasoning[];
  result: string;
  recommendation: AgentOutcomeRecommendation;
}

function isTrustedToolStep(step: AgentStep) {
  return (step.type === "tool_call" || step.type === "approval")
    && step.status === "completed"
    && Boolean(step.toolName)
    && step.title !== "等待人工审批：高风险工具调用";
}

function parseToolOutput(step: AgentStep) {
  try {
    return (JSON.parse(step.detail) as { output?: unknown }).output;
  } catch {
    return undefined;
  }
}

function addOutputFacts(target: Map<string, EvidenceFact>, step: AgentStep, output: unknown) {
  const toolName = step.toolName as string;
  target.set(`tool.${toolName}.output`, {
    id: `tool.${toolName}.output`,
    source: toolName,
    description: `${toolName} 的可信输出`,
    value: output,
  });

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return;
  }

  const outputRecord = output as Record<string, unknown>;

  for (const [key, value] of Object.entries(outputRecord)) {
    if (["string", "number", "boolean"].includes(typeof value)) {
      target.set(`tool.${toolName}.${key}`, {
        id: `tool.${toolName}.${key}`,
        source: toolName,
        description: `${toolName} 输出字段 ${key}`,
        value,
      });
    }
  }

  // 检索引用和 Top-K 节点是服务端返回的可信事实，单独展开后模型才能精确引用。
  if (toolName === "searchPolicy") {
    const citation = outputRecord.citation;
    if (citation && typeof citation === "object" && !Array.isArray(citation)) {
      for (const [key, value] of Object.entries(citation)) {
        if (["string", "number"].includes(typeof value)) {
          target.set(`tool.searchPolicy.citation.${key}`, {
            id: `tool.searchPolicy.citation.${key}`,
            source: toolName,
            description: `命中政策引用字段 ${key}`,
            value,
          });
        }
      }
    }
    if (Array.isArray(outputRecord.matches)) {
      outputRecord.matches.slice(0, 5).forEach((match: unknown, index: number) => {
        target.set(`tool.searchPolicy.matches.${index}`, {
          id: `tool.searchPolicy.matches.${index}`,
          source: toolName,
          description: `政策检索 Top-${index + 1} 节点`,
          value: match,
        });
      });
    }
  }
}

/** 只从已完成工具、审批结果和服务端 Outcome 提取可引用事实。 */
export function buildEvidencePacket(run: AgentRun, outcome: AgentOutcome): EvidencePacket {
  const facts = new Map<string, EvidenceFact>();

  for (const step of run.steps.filter(isTrustedToolStep)) {
    addOutputFacts(facts, step, parseToolOutput(step));
  }

  for (const step of run.steps) {
    const approvalStatus = step.approvalRequest?.status;
    if (!approvalStatus) continue;

    const id = `approval.${step.toolName ?? step.id}.status`;
    facts.set(id, {
      id,
      source: "approval",
      description: "人工审批状态",
      value: approvalStatus,
    });
  }

  facts.set("outcome.decision", {
    id: "outcome.decision",
    source: "server",
    description: "服务端根据工具轨迹派生的可信决策",
    value: outcome.decision,
  });
  facts.set("outcome.performedActions", {
    id: "outcome.performedActions",
    source: "server",
    description: "本次真实发生的业务写入",
    value: outcome.performedActions,
  });

  return {
    task: run.task,
    trustedDecision: outcome.decision,
    performedActions: outcome.performedActions,
    facts: [...facts.values()],
  };
}

function parseDecisionJson(raw: string): unknown {
  const normalized = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Business decision is not valid JSON.");
  }
  return JSON.parse(normalized.slice(start, end + 1));
}

function isNonEmptyText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function validateEvidenceIds(value: unknown, availableIds: Set<string>) {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 8
    && value.every((id) => typeof id === "string" && availableIds.has(id));
}

function containsUntrustedActionClaim(result: string, performedActions: string[]) {
  if (!performedActions.includes("createRefund")
    && /(?:已|成功)(?:创建|生成).{0,8}退款|退款.{0,8}(?:已创建|创建成功)/.test(result)) {
    return true;
  }
  if (!performedActions.includes("updateTicketStatus")
    && /(?:已|成功)更新.{0,8}工单|工单.{0,12}(?:已更新|更新为)/.test(result)) {
    return true;
  }
  return /(?:已|成功)关闭.{0,8}工单|工单.{0,8}已关闭/.test(result);
}

/** 校验模型结构、事实引用和动作声明，任何一项不可信都回退确定性 Outcome。 */
export function validateBusinessDecision(
  raw: string,
  packet: EvidencePacket,
): LlmBusinessDecision | undefined {
  try {
    const value = parseDecisionJson(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    const availableIds = new Set(packet.facts.map((fact) => fact.id));
    const rawReasoning = candidate.reasoning;
    const rawRecommendation = candidate.recommendation;

    if (!Array.isArray(rawReasoning) || rawReasoning.length === 0 || rawReasoning.length > 5
      || !isNonEmptyText(candidate.result, 800)
      || !rawRecommendation || typeof rawRecommendation !== "object" || Array.isArray(rawRecommendation)) {
      return undefined;
    }

    const reasoning = rawReasoning.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const record = item as Record<string, unknown>;
      if (!isNonEmptyText(record.claim, 400) || !validateEvidenceIds(record.evidenceIds, availableIds)) {
        return undefined;
      }
      return { claim: record.claim.trim(), evidenceIds: record.evidenceIds as string[] };
    });
    if (reasoning.some((item) => !item)) return undefined;

    const recommendationRecord = rawRecommendation as Record<string, unknown>;
    const owner = recommendationRecord.owner;
    if (!isNonEmptyText(recommendationRecord.action, 300)
      || !["agent", "human", "customer_service"].includes(String(owner))
      || !isNonEmptyText(recommendationRecord.reason, 400)
      || (recommendationRecord.condition !== undefined && !isNonEmptyText(recommendationRecord.condition, 300))
      || !validateEvidenceIds(recommendationRecord.evidenceIds, availableIds)
      || containsUntrustedActionClaim(candidate.result, packet.performedActions)) {
      return undefined;
    }

    return {
      reasoning: reasoning as AgentOutcomeReasoning[],
      result: candidate.result.trim(),
      recommendation: {
        action: recommendationRecord.action.trim(),
        owner: owner as AgentOutcomeRecommendation["owner"],
        reason: recommendationRecord.reason.trim(),
        condition: typeof recommendationRecord.condition === "string"
          ? recommendationRecord.condition.trim()
          : undefined,
        evidenceIds: recommendationRecord.evidenceIds as string[],
      },
    };
  } catch {
    return undefined;
  }
}

function ensureSentence(value: string) {
  return /[。！？]$/.test(value) ? value : `${value}。`;
}

/** 将已验证模型判断合并到兼容 Outcome；校验失败时完整保留旧结论。 */
export function enrichOutcomeWithBusinessDecision(
  outcome: AgentOutcome,
  packet: EvidencePacket,
  raw: string,
): AgentOutcome {
  const decision = validateBusinessDecision(raw, packet);
  if (!decision || !outcome.conclusion) {
    return { ...outcome, decisionSource: "deterministic_fallback" };
  }

  const recommendationParts = [
    decision.recommendation.action,
    decision.recommendation.condition ? `执行条件：${decision.recommendation.condition}` : undefined,
    `推荐原因：${decision.recommendation.reason}`,
  ].filter((item): item is string => Boolean(item));

  return {
    ...outcome,
    reasoning: decision.reasoning,
    recommendation: decision.recommendation,
    decisionSource: "llm_validated",
    conclusion: {
      ...outcome.conclusion,
      result: ensureSentence(decision.result),
      basis: decision.reasoning.map((item) => ensureSentence(item.claim)).join(""),
      nextStep: recommendationParts.map(ensureSentence).join(""),
    },
  };
}

export function formatOutcomeConclusion(outcome: AgentOutcome) {
  const conclusion = outcome.conclusion;
  if (!conclusion) return outcome.userMessage;
  return [
    `工单需求：${conclusion.requirement}`,
    `处理结果：${conclusion.result}`,
    `处理依据：${conclusion.basis}`,
    `下一步：${conclusion.nextStep}`,
  ].join("\n");
}
