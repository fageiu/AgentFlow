const ignoredTableCells = new Set(["项目", "结果", "------", "---"]);
const preferredLabels = ["工单状态", "判断依据", "已执行动作", "风险", "建议后续"];
const conclusionLabels = ["关键处理结果", "风险提示", "下一步建议", "判断依据", "已执行动作", "建议后续", "原因", "结论"];

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
