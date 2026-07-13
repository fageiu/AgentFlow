import type { AgentOutcome, AgentRun, AgentStep } from "@agentflow/shared";

const writeTools = new Set(["createRefund", "updateTicketStatus"]);
const refundIntentPattern = /退款|refund/i;
const businessReferencePattern = /\b(?:[TCOR]-[A-Za-z0-9-]+|P-[A-Za-z0-9-]+)\b/g;

function isExecutedToolStep(step: AgentStep) {
  return (step.type === "tool_call" || step.type === "approval")
    && step.status === "completed"
    && Boolean(step.toolName)
    && step.title !== "等待人工审批：高风险工具调用";
}

function collectEvidenceReferences(steps: AgentStep[]) {
  return [...new Set(
    steps
      .filter(isExecutedToolStep)
      .flatMap((step) => step.detail.match(businessReferencePattern) ?? []),
  )];
}

function getToolOperation(step: AgentStep) {
  try {
    const detail = JSON.parse(step.detail) as { output?: { operation?: unknown } };
    return typeof detail.output?.operation === "string" ? detail.output.operation : undefined;
  } catch {
    return undefined;
  }
}

function didWriteToolMutate(step: AgentStep) {
  const operation = getToolOperation(step);
  // 旧 Trace 没有 operation 元数据时沿用“成功调用即已执行”的兼容语义。
  return operation !== "reused" && operation !== "unchanged";
}

function getDefaultUserMessage(run: AgentRun) {
  if (run.status === "waiting_approval") {
    return "任务正在等待人工审批。";
  }
  if (run.status === "failed") {
    return run.error?.userMessage ?? "任务执行失败，请根据错误信息重试。";
  }
  if (run.status === "cancelled") {
    return "任务已取消，可重新发起。";
  }
  return "任务已完成。";
}

/**
 * 仅根据服务端 Run 终态、审批决议和真实工具轨迹派生业务结果。
 * 模型只负责 userMessage，自报的“已退款”等文本不会改变 decision 或 performedActions。
 */
export function deriveAgentOutcome(run: AgentRun): AgentOutcome {
  const executedToolSteps = run.steps.filter(isExecutedToolStep);
  const performedActions = [...new Set(
    executedToolSteps
      .filter(didWriteToolMutate)
      .map((step) => step.toolName)
      .filter((toolName): toolName is string => typeof toolName === "string" && writeTools.has(toolName)),
  )];
  const hasIdempotentReuse = executedToolSteps.some((step) => {
    const operation = getToolOperation(step);
    return operation === "reused" || operation === "unchanged";
  });
  const approvalRejected = run.steps.some((step) => step.approvalRequest?.status === "rejected");
  const hasPendingRefundEvidence = executedToolSteps.some(
    (step) => step.detail.includes('"refundStatus": "pending_approval"')
      || step.detail.includes('"status": "waiting_approval"'),
  );
  const finalMessage = [...run.steps].reverse().find((step) => step.type === "final")?.detail;

  let decision: AgentOutcome["decision"];
  if (run.status === "failed") {
    decision = "failed";
  } else if (run.status === "cancelled") {
    decision = "cancelled";
  } else if (run.status === "waiting_approval") {
    decision = "waiting_approval";
  } else if (approvalRejected) {
    decision = "manual_review";
  } else if (performedActions.includes("createRefund")) {
    decision = "refund_required";
  } else if (refundIntentPattern.test(run.task) && (hasIdempotentReuse || hasPendingRefundEvidence)) {
    decision = "already_satisfied";
  } else if (refundIntentPattern.test(run.task)) {
    decision = "no_refund";
  } else {
    decision = "read_only";
  }

  return {
    decision,
    performedActions,
    evidence: collectEvidenceReferences(run.steps),
    userMessage: finalMessage ?? getDefaultUserMessage(run),
  };
}
