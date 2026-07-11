import type { AgentStep } from "@agentflow/shared";

const ignoredTableCells = new Set(["项目", "结果", "------", "---"]);
const preferredLabels = ["工单状态", "判断依据", "已执行动作", "风险", "建议后续"];
const conclusionLabels = ["工单需求", "处理结果", "处理依据", "下一步", "关键处理结果", "风险提示", "下一步建议", "判断依据", "已执行动作", "建议后续", "原因", "结论"];

export interface BusinessConclusionSection {
  label: "工单需求" | "处理结果" | "处理依据" | "下一步";
  value: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 从已完成的工单查询 trace 中取得真实工单描述，避免将用户指令误当作工单诉求。 */
export function getTicketRequirement(steps: AgentStep[] | undefined) {
  const ticketStep = (steps ?? []).find((step) => step.toolName === "getTicket" && step.status === "completed");

  if (!ticketStep) {
    return undefined;
  }

  try {
    const detail = JSON.parse(ticketStep.detail) as unknown;
    const output = isPlainObject(detail) && isPlainObject(detail.output) ? detail.output : undefined;
    const ticketId = typeof output?.id === "string" ? output.id.trim() : "";
    const description = typeof output?.description === "string" ? output.description.trim() : "";

    if (!description) {
      return undefined;
    }

    return ticketId ? `${ticketId}：${description}` : description;
  } catch {
    // 兼容历史 trace 或异常步骤：无法解析时继续使用模型结论或任务文本兜底。
    return undefined;
  }
}

function cleanFinalText(value: string) {
  return value
    .replace(/[✅❌]/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^[-#\s]+/g, "")
    .trim();
}

function normalizeHeadline(value: string) {
  const headline = cleanFinalText(value.split("|")[0] ?? value).replace(/^#+\s*/, "");

  if (!headline) {
    return "";
  }

  return headline.endsWith("。") ? headline : `${headline}。`;
}

function parseMarkdownTableConclusion(value: string) {
  if (!value.includes("|")) {
    return "";
  }

  const cells = value
    .split("|")
    .map(cleanFinalText)
    .filter((cell) => cell && !ignoredTableCells.has(cell));
  const lines = [normalizeHeadline(value)].filter(Boolean);

  for (const label of preferredLabels) {
    const index = cells.indexOf(label);
    const content = index >= 0 ? cells[index + 1] : undefined;

    if (content) {
      lines.push(`${label}：${content}`);
    }
  }

  return lines.join("\n");
}

export function formatFinalResponseForDisplay(value: string | undefined) {
  if (!value?.trim()) {
    return "";
  }

  const tableConclusion = parseMarkdownTableConclusion(value);

  if (tableConclusion) {
    return tableConclusion;
  }

  return value.trim();
}

/** 将模型结论切分为可扫读的业务要点，保留原文语义而不重新生成内容。 */
export function splitFinalResponseForDisplay(value: string | undefined) {
  const formatted = formatFinalResponseForDisplay(value);
  if (!formatted) {
    return [];
  }

  const labelPattern = conclusionLabels.join("|");
  return formatted
    .replace(new RegExp(`\\s*(${labelPattern})[：:]`, "g"), "\n$1：")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 将模型结论归一为固定的业务交付字段；旧格式也能通过回退规则保持可读。 */
export function buildBusinessConclusion(task: string, value: string | undefined, ticketRequirement?: string): BusinessConclusionSection[] {
  const lines = splitFinalResponseForDisplay(value);
  const findValue = (labels: string[]) => {
    const line = lines.find((item) => labels.some((label) => item.startsWith(`${label}：`)));
    return line?.slice(line.indexOf("：") + 1).trim();
  };
  const unlabeled = lines.filter((line) => !conclusionLabels.some((label) => line.startsWith(`${label}：`)));

  return [
    { label: "工单需求", value: ticketRequirement ?? findValue(["工单需求"]) ?? task },
    { label: "处理结果", value: findValue(["处理结果", "关键处理结果", "结论"]) ?? unlabeled[0] ?? "已完成处理。" },
    { label: "处理依据", value: findValue(["处理依据", "判断依据", "原因", "已执行动作"]) ?? unlabeled[1] ?? "依据已完成的工单、客户、订单和规则核查。" },
    { label: "下一步", value: findValue(["下一步", "下一步建议", "建议后续", "风险提示"]) ?? unlabeled[2] ?? "当前无需额外操作。" },
  ];
}
