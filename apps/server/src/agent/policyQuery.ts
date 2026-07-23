const TICKET_ID_PATTERN = /\bT-\d+\b/gi;
const GENERIC_TICKET_TASK_PATTERN = /^(?:请)?(?:处理|执行|查看|核查|跟进)?\s*工单\s*T-\d+\s*[。.!！]?$/i;
const SERIALIZED_CONTEXT_PATTERN = /(?:customerId|orderId|priority|\"description\"|\\\"description\\\")/i;

type PolicyQueryContext = {
  title?: string;
  description?: string;
};

const QUERY_FOCUS: Record<string, string> = {
  upgrade: "重点检索合同版本升级的适用范围、金额或差额处理、办理条件和后续流程。",
  refund: "重点检索退款适用条件、期限、金额和审批要求。",
  "duplicate-refund": "重点检索重复退款识别、幂等处理和审批要求。",
  security: "重点检索高风险工单的关闭限制和人工审批要求。",
  sla: "重点检索服务不可用的响应口径、责任认定和补偿流程。",
  cancel: "重点检索订单取消条件、费用处理和后续流程。",
  approval: "重点检索人工审批条件、审批层级和禁止操作。",
  "renewal-discount": "重点检索续费折扣、合同承诺、订单差异和复核流程。",
  发票: "重点检索发票受理条件、材料要求和更正流程。",
};

function asContext(value: unknown): PolicyQueryContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    title: typeof record.title === "string" ? record.title.trim() : undefined,
    description: typeof record.description === "string" ? record.description.trim() : undefined,
  };
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").replace(/。{2,}/g, "。").trim();
}

function isUsefulProvidedQuery(query: string) {
  const normalized = normalizeWhitespace(query);
  return normalized.length >= 4
    && !GENERIC_TICKET_TASK_PATTERN.test(normalized)
    && !SERIALIZED_CONTEXT_PATTERN.test(normalized);
}

function buildUpgradeQuery(context: PolicyQueryContext) {
  const evidence = `${context.title ?? ""} ${context.description ?? ""}`;
  const transition = evidence.match(
    /(?:从|把)([^，。；\s]{1,12}?)(?:升级|变更|更换)(?:到|至|为)([^，。；\s]{1,12})/,
  );
  const sourceVersion = transition?.[1] ?? "当前版本";
  const targetVersion = transition?.[2] ?? "目标版本";
  return [
    `客户从${sourceVersion}升级至${targetVersion}适用什么合同版本升级管理政策？`,
    "需要核对客户等级、当前订单金额、合同期限、目标版本和已使用权益，并说明报价与生效流程。",
  ].join("");
}

/**
 * 构造面向政策语义的检索问题。
 * 工单 ID、状态、优先级和序列化 JSON 仅用于业务追踪，不进入向量或词法检索正文。
 */
export function buildPolicySearchQuery(input: {
  task: string;
  ticketContext: unknown;
  providedQuery?: unknown;
  keyword?: string;
}) {
  const providedQuery = typeof input.providedQuery === "string"
    ? input.providedQuery.trim()
    : "";
  if (providedQuery && isUsefulProvidedQuery(providedQuery)) {
    return normalizeWhitespace(providedQuery).slice(0, 800);
  }

  const context = asContext(input.ticketContext);
  if (input.keyword === "upgrade" && (context.title || context.description)) {
    return buildUpgradeQuery(context);
  }

  const semanticParts = [context.title, context.description].filter(
    (value): value is string => Boolean(value),
  );
  if (semanticParts.length === 0) {
    const cleanedTask = normalizeWhitespace(input.task.replace(TICKET_ID_PATTERN, ""));
    semanticParts.push(cleanedTask || input.task.trim());
  }

  const focus = input.keyword ? QUERY_FOCUS[input.keyword] : undefined;
  return normalizeWhitespace([...semanticParts, focus].filter(Boolean).join("。")).slice(0, 800);
}
