import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { EvaluationRun } from "@agentflow/shared";

interface EvaluationArtifact {
  label: string;
  run: EvaluationRun;
}

function readOption(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readArtifact(path: string): EvaluationArtifact {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<EvaluationArtifact>;

  if (!parsed.label || !parsed.run?.summary || !Array.isArray(parsed.run.results)) {
    throw new Error(`评测文件格式不合法：${path}`);
  }

  return parsed as EvaluationArtifact;
}

function signed(value: number, suffix = "") {
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function passRate(run: EvaluationRun) {
  return run.summary.total ? (run.summary.passed / run.summary.total) * 100 : 0;
}

/** 对比两个结构化评测产物，突出通过率、延迟、Token 和逐 Case 回归。 */
function buildComparison(baseline: EvaluationArtifact, candidate: EvaluationArtifact) {
  const baselineByCase = new Map(baseline.run.results.map((result) => [result.caseId, result]));
  const caseRows = candidate.run.results.map((result) => {
    const previous = baselineByCase.get(result.caseId);
    const change = !previous
      ? "新增"
      : previous.status === "passed" && result.status !== "passed"
        ? "回归"
        : previous.status !== "passed" && result.status === "passed"
          ? "恢复"
          : "不变";

    return `| ${result.title.replaceAll("|", "\\|")} | ${previous?.status ?? "-"} | ${result.status} | ${change} |`;
  });
  const baselineRate = passRate(baseline.run);
  const candidateRate = passRate(candidate.run);

  return [
    `# AgentFlow A/B 评测对比：${baseline.label} → ${candidate.label}`,
    "",
    "| 指标 | Baseline | Candidate | 变化 |",
    "|---|---:|---:|---:|",
    `| 通过率 | ${baselineRate.toFixed(1)}% | ${candidateRate.toFixed(1)}% | ${signed(Number((candidateRate - baselineRate).toFixed(1)), "%")} |`,
    `| 通过数 | ${baseline.run.summary.passed} | ${candidate.run.summary.passed} | ${signed(candidate.run.summary.passed - baseline.run.summary.passed)} |`,
    `| 异常数 | ${baseline.run.summary.error} | ${candidate.run.summary.error} | ${signed(candidate.run.summary.error - baseline.run.summary.error)} |`,
    `| 平均耗时 | ${baseline.run.summary.averageDurationMs} ms | ${candidate.run.summary.averageDurationMs} ms | ${signed(candidate.run.summary.averageDurationMs - baseline.run.summary.averageDurationMs, " ms")} |`,
    `| 平均工具调用 | ${baseline.run.summary.averageToolCallCount} | ${candidate.run.summary.averageToolCallCount} | ${signed(Number((candidate.run.summary.averageToolCallCount - baseline.run.summary.averageToolCallCount).toFixed(1)))} |`,
    `| 总 Token | ${baseline.run.summary.totalTokenCount} | ${candidate.run.summary.totalTokenCount} | ${signed(candidate.run.summary.totalTokenCount - baseline.run.summary.totalTokenCount)} |`,
    "",
    "## 实验配置",
    "",
    "| 配置 | Baseline | Candidate |",
    "|---|---|---|",
    `| 模式 | ${baseline.run.config.mock ? "Mock" : "真实模型"} | ${candidate.run.config.mock ? "Mock" : "真实模型"} |`,
    `| Provider | ${baseline.run.config.provider} | ${candidate.run.config.provider} |`,
    `| 模型 | ${baseline.run.config.model} | ${candidate.run.config.model} |`,
    `| Prompt 版本 | ${baseline.run.config.promptVersion} | ${candidate.run.config.promptVersion} |`,
    "",
    "## Case 变化",
    "",
    "| 用例 | Baseline | Candidate | 结论 |",
    "|---|---|---|---|",
    ...caseRows,
    "",
    "> 对比有效的前提是两次实验使用同一组 Case。模型或 Prompt 内容必须真实发生变化，不能只修改版本标签。",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const baselinePath = readOption(args, "--baseline");
  const candidatePath = readOption(args, "--candidate");
  const outputPath = readOption(args, "--output");

  if (!baselinePath || !candidatePath || !outputPath) {
    throw new Error("用法：--baseline <json> --candidate <json> --output <md>。");
  }

  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const resolveFromInvocation = (path: string) => isAbsolute(path) ? path : join(invocationCwd, path);
  const resolvedBaseline = resolveFromInvocation(baselinePath);
  const resolvedCandidate = resolveFromInvocation(candidatePath);
  const resolvedOutput = resolveFromInvocation(outputPath);
  const baseline = readArtifact(resolvedBaseline);
  const candidate = readArtifact(resolvedCandidate);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, buildComparison(baseline, candidate), "utf8");
  console.log(`[evaluation] Comparison: ${resolvedOutput}`);
}

try {
  main();
} catch (error) {
  console.error(`[evaluation] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
