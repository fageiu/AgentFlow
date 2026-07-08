export function formatDuration(value: number | undefined) {
  if (value == null) {
    return "-";
  }

  const absoluteValue = Math.abs(value);
  const formatted = absoluteValue >= 1000 ? `${(absoluteValue / 1000).toFixed(1)}s` : `${absoluteValue}ms`;

  return value < 0 ? `-${formatted}` : formatted;
}

export function formatCount(value: number | undefined) {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatSignedDuration(value: number) {
  if (value === 0) {
    return "0ms";
  }

  return `${value > 0 ? "+" : ""}${formatDuration(value)}`;
}

export function formatSignedDecimal(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function formatSignedCount(value: number) {
  return `${value > 0 ? "+" : ""}${formatCount(value)}`;
}

export function formatRunTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
