import type {
  AgentRun,
  EvaluationAssertionResult,
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationCaseStatus,
  LlmTokenUsage,
  SandboxState,
} from "@agentflow/shared";

function createAssertion(
  id: string,
  label: string,
  passed: boolean,
  expected: string,
  actual: string,
  diagnosis?: string,
): EvaluationAssertionResult {
  return {
    id,
    label,
    passed,
    expected,
    actual,
    diagnosis: diagnosis ?? (passed ? "符合预期。" : `期望 ${expected}，实际 ${actual}。`),
  };
}

function getToolNames(run: AgentRun | undefined) {
  return run?.steps
    .filter((step) => step.type === "tool_call" || step.type === "approval")
    .map((step) => step.toolName)
    .filter((name): name is string => Boolean(name)) ?? [];
}

function getExecutedToolNames(run: AgentRun | undefined) {
  return run?.steps
    .filter((step) => (step.type === "tool_call" || step.type === "approval")
      && step.title !== "等待人工审批：高风险工具调用")
    .map((step) => step.toolName)
    .filter((name): name is string => Boolean(name)) ?? [];
}

function getFinalMessage(run: AgentRun | undefined) {
  return [...(run?.steps ?? [])].reverse().find((step) => step.type === "final")?.detail ?? "";
}

function hasApprovalStep(run: AgentRun | undefined) {
  return run?.steps.some((step) => step.approvalRequest || step.type === "approval") ?? false;
}

function hasPolicyCitation(run: AgentRun | undefined) {
  return run?.steps.some((step) => {
    if (step.toolName !== "searchPolicy" || step.status !== "completed") return false;
    try {
      const detail = JSON.parse(step.detail) as {
        output?: { citation?: { documentId?: unknown; nodeId?: unknown; sourceName?: unknown; version?: unknown } };
      };
      const citation = detail.output?.citation;
      return [citation?.documentId, citation?.nodeId, citation?.sourceName, citation?.version]
        .every((value) => typeof value === "string" && value.length > 0);
    } catch {
      return false;
    }
  }) ?? false;
}

function createEmptyTokenUsage(): LlmTokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

/** 根据 trace 和沙箱最终状态执行确定性评分，避免 MVP 阶段引入额外 LLM judge 成本。 */
export function scoreEvaluationCase(input: {
  case: EvaluationCase;
  durationMs: number;
  errorMessage?: string;
  previousStatus?: EvaluationCaseStatus;
  run?: AgentRun;
  sandboxState: SandboxState;
}): EvaluationCaseResult {
  const toolNames = getToolNames(input.run);
  const executedToolNames = getExecutedToolNames(input.run);
  const finalMessage = getFinalMessage(input.run);
  const assertions: EvaluationAssertionResult[] = [];
  const expectations = input.case.expectations;

  if (expectations.runStatus) {
    assertions.push(
      createAssertion(
        "run-status",
        "运行状态符合预期",
        input.run?.status === expectations.runStatus,
        expectations.runStatus,
        input.run?.status ?? "missing-run",
        `评测要求 Agent run 结束为 ${expectations.runStatus}，当前为 ${input.run?.status ?? "missing-run"}。`,
      ),
    );
  }

  if (expectations.requiresPlan != null) {
    const hasPlan = Boolean(input.run?.plan?.steps.length);
    assertions.push(
      createAssertion(
        "planner-contract",
        "结构化 Planner 计划符合预期",
        hasPlan === expectations.requiresPlan,
        expectations.requiresPlan ? "present" : "not-present",
        hasPlan ? "present" : "not-present",
        expectations.requiresPlan
          ? "run 应保存可审计的结构化 Planner 计划，并由 Executor 据此执行。"
          : "该 case 不应依赖 Planner 计划。",
      ),
    );
  }

  for (const toolName of expectations.requiredTools ?? []) {
    assertions.push(
      createAssertion(
        `required-tool-${toolName}`,
        `必须调用工具 ${toolName}`,
        toolNames.includes(toolName),
        "called",
        toolNames.includes(toolName) ? "called" : "not-called",
        toolNames.includes(toolName)
          ? `trace 中已出现 ${toolName}。`
          : `trace 中没有 ${toolName}，说明 Agent 可能跳过了必要业务上下文或状态写入。`,
      ),
    );
  }

  for (const toolName of expectations.forbiddenTools ?? []) {
    assertions.push(
      createAssertion(
        `forbidden-tool-${toolName}`,
        `不得调用工具 ${toolName}`,
        !toolNames.includes(toolName),
        "not-called",
        toolNames.includes(toolName) ? "called" : "not-called",
        toolNames.includes(toolName)
          ? `${toolName} 被调用了，可能把低风险任务误升级为写入操作。`
          : `trace 中未出现 ${toolName}。`,
      ),
    );
  }

  for (const expectedCount of expectations.toolCallCounts ?? []) {
    const actual = executedToolNames.filter((toolName) => toolName === expectedCount.toolName).length;
    assertions.push(
      createAssertion(
        `tool-count-${expectedCount.toolName}`,
        `工具 ${expectedCount.toolName} 调用次数符合预期`,
        actual === expectedCount.count,
        String(expectedCount.count),
        String(actual),
        `评测要求 ${expectedCount.toolName} 执行 ${expectedCount.count} 次，当前实际执行 ${actual} 次。`,
      ),
    );
  }

  for (const expectedCount of expectations.minimumToolCallCounts ?? []) {
    const actual = executedToolNames.filter((toolName) => toolName === expectedCount.toolName).length;
    assertions.push(
      createAssertion(
        `tool-min-count-${expectedCount.toolName}`,
        `工具 ${expectedCount.toolName} 至少调用 ${expectedCount.count} 次`,
        actual >= expectedCount.count,
        `>=${expectedCount.count}`,
        String(actual),
        `评测要求 ${expectedCount.toolName} 至少执行 ${expectedCount.count} 次，用于验证失败后的参数修正或重试；当前实际执行 ${actual} 次。`,
      ),
    );
  }

  if (expectations.requiresApproval != null) {
    const actual = hasApprovalStep(input.run);
    assertions.push(
      createAssertion(
        "approval",
        "审批行为符合预期",
        actual === expectations.requiresApproval,
        expectations.requiresApproval ? "required" : "not-required",
        actual ? "required" : "not-required",
        expectations.requiresApproval
          ? "该 case 应经过人工审批，以验证高风险工具的审批门禁。"
          : "该 case 不应出现人工审批，避免普通任务被误判为高风险。",
      ),
    );
  }

  if (expectations.requiresPolicyCitation != null) {
    const actual = hasPolicyCitation(input.run);
    assertions.push(
      createAssertion(
        "policy-citation",
        "政策检索包含可追溯引用",
        actual === expectations.requiresPolicyCitation,
        expectations.requiresPolicyCitation ? "present" : "not-present",
        actual ? "present" : "not-present",
        expectations.requiresPolicyCitation
          ? "searchPolicy 应返回 Document、Node、文件和版本引用，禁止仅凭模型常识下结论。"
          : "该 case 不要求政策来源引用。",
      ),
    );
  }

  for (const expectedText of expectations.errorMessageIncludes ?? []) {
    assertions.push(
      createAssertion(
        `error-includes-${expectedText}`,
        `错误信息包含 ${expectedText}`,
        input.errorMessage?.includes(expectedText) ?? false,
        expectedText,
        input.errorMessage ?? "missing-error",
        `失败路径应返回可识别错误 ${expectedText}，当前错误为 ${input.errorMessage ?? "missing-error"}。`,
      ),
    );
  }

  if (expectations.errorCode) {
    assertions.push(
      createAssertion(
        "error-code",
        "结构化错误码符合预期",
        input.run?.error?.code === expectations.errorCode,
        expectations.errorCode,
        input.run?.error?.code ?? "missing-error-code",
        `评测要求错误码为 ${expectations.errorCode}，当前为 ${input.run?.error?.code ?? "missing-error-code"}。`,
      ),
    );
  }

  if (expectations.outcomeDecision) {
    assertions.push(
      createAssertion(
        "outcome-decision",
        "结构化业务结论符合预期",
        input.run?.outcome?.decision === expectations.outcomeDecision,
        expectations.outcomeDecision,
        input.run?.outcome?.decision ?? "missing-outcome",
        `评测根据可信工具轨迹要求 outcome.decision 为 ${expectations.outcomeDecision}，当前为 ${input.run?.outcome?.decision ?? "missing-outcome"}。`,
      ),
    );
  }

  for (const expectedText of expectations.finalMessageIncludes ?? []) {
    assertions.push(
      createAssertion(
        `final-includes-${expectedText}`,
        `最终结论包含 ${expectedText}`,
        finalMessage.includes(expectedText),
        expectedText,
        finalMessage || "missing-final-message",
        `最终回复需要包含 ${expectedText}，当前最终回复为 ${finalMessage || "missing-final-message"}。`,
      ),
    );
  }

  if (expectations.finalMessageIncludesAny?.length) {
    const matchedText = expectations.finalMessageIncludesAny.find((text) => finalMessage.includes(text));
    const expectedTexts = expectations.finalMessageIncludesAny.join(" / ");
    assertions.push(
      createAssertion(
        `final-includes-any-${expectations.finalMessageIncludesAny.join("-")}`,
        "最终结论包含任一等价表述",
        Boolean(matchedText),
        expectedTexts,
        matchedText ?? (finalMessage || "missing-final-message"),
        matchedText
          ? `最终回复已命中等价表述“${matchedText}”。`
          : `最终回复需要包含以下任一表述：${expectedTexts}；当前最终回复为 ${finalMessage || "missing-final-message"}。`,
      ),
    );
  }

  for (const forbiddenText of expectations.finalMessageExcludes ?? []) {
    assertions.push(
      createAssertion(
        `final-excludes-${forbiddenText}`,
        `最终结论不包含 ${forbiddenText}`,
        !finalMessage.includes(forbiddenText),
        `not include ${forbiddenText}`,
        finalMessage.includes(forbiddenText) ? `included ${forbiddenText}` : "not-included",
        `最终回复不应包含 ${forbiddenText}，当前最终回复为 ${finalMessage || "missing-final-message"}。`,
      ),
    );
  }

  if (expectations.ticketStatus) {
    const actual = input.sandboxState.tickets.find((ticket) => ticket.id === expectations.ticketStatus?.ticketId)?.status;
    assertions.push(
      createAssertion(
        "ticket-status",
        `工单 ${expectations.ticketStatus.ticketId} 状态符合预期`,
        actual === expectations.ticketStatus.status,
        expectations.ticketStatus.status,
        actual ?? "missing-ticket",
        `工单 ${expectations.ticketStatus.ticketId} 应更新为 ${expectations.ticketStatus.status}，当前为 ${actual ?? "missing-ticket"}。`,
      ),
    );
  }

  if (expectations.orderRefundStatus) {
    const actual = input.sandboxState.orders.find((order) => order.id === expectations.orderRefundStatus?.orderId)
      ?.refundStatus;
    assertions.push(
      createAssertion(
        "order-refund-status",
        `订单 ${expectations.orderRefundStatus.orderId} 退款状态符合预期`,
        actual === expectations.orderRefundStatus.status,
        expectations.orderRefundStatus.status,
        actual ?? "missing-order",
        `订单 ${expectations.orderRefundStatus.orderId} 的退款状态应为 ${expectations.orderRefundStatus.status}，当前为 ${actual ?? "missing-order"}。`,
      ),
    );
  }

  if (expectations.refundCount) {
    const actual = input.sandboxState.refunds.filter((refund) => refund.orderId === expectations.refundCount?.orderId)
      .length;
    assertions.push(
      createAssertion(
        "refund-count",
        `订单 ${expectations.refundCount.orderId} 退款记录数符合预期`,
        actual === expectations.refundCount.count,
        String(expectations.refundCount.count),
        String(actual),
        `订单 ${expectations.refundCount.orderId} 应有 ${expectations.refundCount.count} 条退款记录，当前为 ${actual} 条。`,
      ),
    );
  }

  if (expectations.totalRefundCount != null) {
    assertions.push(
      createAssertion(
        "total-refund-count",
        "全局退款记录数符合预期",
        input.sandboxState.refunds.length === expectations.totalRefundCount,
        String(expectations.totalRefundCount),
        String(input.sandboxState.refunds.length),
        `整个沙箱应保留 ${expectations.totalRefundCount} 条退款记录，当前为 ${input.sandboxState.refunds.length} 条。`,
      ),
    );
  }

  const fallbackCount = input.run?.metrics?.fallbackCount ?? 0;
  assertions.push(
    createAssertion(
      "no-mock-fallback",
      "评测过程中未触发 Mock 降级",
      fallbackCount === 0,
      "0",
      String(fallbackCount),
      `本 case 有 ${fallbackCount} 次模型调用降级为 Mock，不能作为真实模型通过结果。`,
    ),
  );

  const failedAssertions = assertions.filter((assertion) => !assertion.passed);
  const hasUnexpectedError = Boolean(input.errorMessage && !expectations.errorMessageIncludes?.length);
  const status = hasUnexpectedError ? "error" : failedAssertions.length === 0 ? "passed" : "failed";

  return {
    caseId: input.case.id,
    group: input.case.group,
    groupLabel: input.case.groupLabel,
    title: input.case.title,
    task: input.case.task,
    status,
    runId: input.run?.id,
    runStatus: input.run?.status,
    durationMs: input.durationMs,
    assertions,
    failedAssertionCount: failedAssertions.length,
    toolNames,
    executedToolNames,
    toolCallCount: input.run?.metrics?.toolCallCount ?? executedToolNames.length,
    tokenUsage: input.run?.metrics?.tokenUsage ?? createEmptyTokenUsage(),
    modelNames: input.run?.metrics?.modelNames ?? [],
    approvalRequired: hasApprovalStep(input.run),
    outcomeDecision: input.run?.outcome?.decision,
    previousStatus: input.previousStatus,
    regressionStatus: "new",
    errorMessage: input.errorMessage,
  };
}
