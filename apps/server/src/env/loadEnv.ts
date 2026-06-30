import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};

let loaded = false;

/** 解析单行 .env 配置，支持 KEY=value 和带引号的 value。 */
function parseEnvLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const equalIndex = trimmed.indexOf("=");
  if (equalIndex === -1) {
    return undefined;
  }

  const key = trimmed.slice(0, equalIndex).trim();
  const rawValue = trimmed.slice(equalIndex + 1).trim();
  const value = rawValue.replace(/^["']|["']$/g, "");

  return key ? { key, value } : undefined;
}

/** 从当前目录向上查找 .env，兼容在仓库根目录或 apps/server 下启动后端。 */
function findEnvFile() {
  let current = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return undefined;
}

/**
 * 轻量加载本地 .env。
 * 已存在的进程环境变量优先级更高，避免覆盖 CI、部署平台或 shell 中显式传入的配置。
 */
export function loadEnv() {
  if (loaded) {
    return;
  }
  loaded = true;

  const envFile = findEnvFile();
  if (!envFile) {
    return;
  }

  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed && process.env[parsed.key] == null) {
      process.env[parsed.key] = parsed.value;
    }
  }
}
