import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { EvaluationRun } from "@agentflow/shared";

interface CliOptions {
  label: string;
  mode: "mock" | "real";
  caseIds?: string[];
  output?: string;
}

function readOption(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/** 解析评测命令参数；强制显式选择 real/mock，避免误把 Mock 结果当成真实模型数据。 */
function parseOptions(args: string[]): CliOptions {
  const real = args.includes("--real");
  const mock = args.includes("--mock");

  if (real === mock) {
    throw new Error("必须且只能指定一个运行模式：--real 或 --mock。");
  }

  const label = readOption(args, "--label")?.trim();
  if (!label) {
    throw new Error("缺少实验标签，请使用 --label <name>。");
  }

  const rawCases = readOption(args, "--cases");
  const caseIds = rawCases
    // pnpm 在 Windows 下可能把逗号参数转为空格，CLI 同时兼容两种分隔形式。
    ?.split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    label,
    mode: real ? "real" : "mock",
    caseIds: caseIds?.length ? caseIds : undefined,
    output: readOption(args, "--output"),
  };
}

function escapeCell(value: unknown) {
  return String(value ?? "-").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function percentage(numerator: number, denominator: number) {
  return denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : "0.0%";
}

/** 将结构化评测结果生成人可读报告，数据全部来自 EvaluationRun，不推算或编造成本。 */
function buildMarkdownReport(label: string, run: EvaluationRun) {
  const failedResults = run.results.filter((result) => result.status !== "passed");
  const lines = [
    `# AgentFlow 评测报告：${label}`,
    "",
    `- 运行 ID：\`${run.id}\``,
    `- 模式：${run.config.mock ? "Mock 基线" : "真实模型"}`,
    `- Provider：\`${run.config.provider}\``,
    `- 配置模型：\`${run.config.model}\``,
    `- 实际模型：${run.summary.modelNames.map((name) => `\`${name}\``).join(", ") || "-"}`,
    `- Prompt 版本：\`${run.config.promptVersion}\``,
    `- 开始时间：${run.createdAt}`,
    `- 完成时间：${run.completedAt ?? "-"}`,
    "",
    "## 汇总",
    "",
    "| 用例数 | 通过 | 失败 | 异常 | 通过率 | 平均耗时 | 平均工具调用 | 总 Token |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| ${run.summary.total} | ${run.summary.passed} | ${run.summary.failed} | ${run.summary.error} | ${percentage(run.summary.passed, run.summary.total)} | ${run.summary.averageDurationMs} ms | ${run.summary.averageToolCallCount} | ${run.summary.totalTokenCount} |`,
    "",
    ...(run.regression.comparedWithRunId
      ? [
          "## 与上一轮对比",
          "",
          `对比运行：\`${run.regression.comparedWithRunId}\``,
          "",
          "| 回归 | 恢复 | 不变 | 新增 |",
          "|---:|---:|---:|---:|",
          `| ${run.regression.regressed.length} | ${run.regression.recovered.length} | ${run.regression.unchanged.length} | ${run.regression.newCases.length} |`,
          "",
        ]
      : []),
    "## 能力分组",
    "",
    "| 分组 | 用例数 | 通过 | 失败 | 异常 |",
    "|---|---:|---:|---:|---:|",
    ...run.groupSummaries.map(
      (group) => `| ${escapeCell(group.label)} | ${group.total} | ${group.passed} | ${group.failed} | ${group.error} |`,
    ),
    "",
    "## 用例明细",
    "",
    "| 用例 | 状态 | 回归变化 | 耗时 | 工具调用 | Token |",
    "|---|---|---|---:|---:|---:|",
    ...run.results.map(
      (result) => `| ${escapeCell(result.title)} | ${result.status} | ${result.regressionStatus} | ${result.durationMs} ms | ${result.toolCallCount} | ${result.tokenUsage.totalTokens} |`,
    ),
  ];

  if (failedResults.length) {
    lines.push(
      "",
      "## 失败诊断",
      "",
      ...failedResults.flatMap((result) => [
        `### ${result.title}`,
        "",
        ...result.assertions
          .filter((assertion) => !assertion.passed)
          .map((assertion) => `- ${assertion.label}：${assertion.diagnosis}`),
        ...(result.errorMessage ? [`- 执行错误：${result.errorMessage}`] : []),
        "",
      ]),
    );
  }

  lines.push(
    "",
    "## 说明",
    "",
    "- Token 优先使用模型 API 返回的 usage；Provider 未返回时使用项目内估算值。",
    "- 报告不根据公开价格推算费用，避免在价格或计费单位变化后产生误导。",
    "- 真实模式会关闭 Mock fallback；API 失败会记为异常，不会用 Mock 成绩替代。",
    "",
  );

  return lines.join("\n");
}

function writeReport(outputPath: string, label: string, run: EvaluationRun) {
  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const resolvedOutput = isAbsolute(outputPath) ? outputPath : join(invocationCwd, outputPath);
  const markdownPath = resolvedOutput.endsWith(".md") ? resolvedOutput : `${resolvedOutput}.md`;
  const jsonPath = markdownPath.replace(/\.md$/i, ".json");

  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, buildMarkdownReport(label, run), "utf8");
  writeFileSync(jsonPath, `${JSON.stringify({ label, run }, null, 2)}\n`, "utf8");

  return { markdownPath, jsonPath };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const safeLabel = options.label.replace(/[^a-zA-Z0-9_-]+/g, "-");

  // 必须在动态导入状态仓库前设置隔离目录，因为持久化路径会在模块初始化时确定。
  process.env.AGENTFLOW_DATA_DIR = join(process.cwd(), ".agentflow-data", "evaluation-cli", safeLabel);
  process.env.LLM_MOCK = options.mode === "mock" ? "true" : "false";
  process.env.LLM_FALLBACK_ON_ERROR = options.mode === "mock" ? "true" : "false";

  const { getLlmConfig } = await import("../llm/config.js");
  const config = getLlmConfig();

  if (options.mode === "real" && !config.apiKey) {
    throw new Error("真实评测缺少 API Key，请先在 .env 配置兼容模型密钥。");
  }

  const { evaluationCases } = await import("./evaluationCases.js");
  if (options.caseIds) {
    const knownIds = new Set(evaluationCases.map((item) => item.id));
    const unknownIds = options.caseIds.filter((id) => !knownIds.has(id));
    if (unknownIds.length) {
      throw new Error(`存在未知评测用例：${unknownIds.join(", ")}`);
    }
  }

  const { runEvaluationSuite } = await import("./evaluationRunner.js");
  const run = await runEvaluationSuite(options.caseIds);

  console.log(
    `[evaluation] ${options.label}: ${run.summary.passed}/${run.summary.total} passed, ${run.summary.error} errors, ${run.summary.totalTokenCount} tokens.`,
  );

  if (options.output) {
    const paths = writeReport(options.output, options.label, run);
    console.log(`[evaluation] Markdown: ${paths.markdownPath}`);
    console.log(`[evaluation] JSON: ${paths.jsonPath}`);
  }

  if (run.summary.failed > 0 || run.summary.error > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[evaluation] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
