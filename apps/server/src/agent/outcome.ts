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

function getToolOutput(run: AgentRun, toolName: string): unknown {
  const step = [...run.steps].reverse().find(
    (item) => isExecutedToolStep(item) && item.toolName === toolName,
  );
  if (!step) return undefined;

  try {
    return (JSON.parse(step.detail) as { output?: unknown }).output;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textField(value: Record<string, unknown> | undefined, key: string) {
  const field = value?.[key];
  return typeof field === "string" || typeof field === "number" ? String(field) : undefined;
}

/** 将可信工具输出归一成前端固定四栏，查询结果与“是否写入”保持职责分离。 */
function deriveConclusion(run: AgentRun, decision: AgentOutcome["decision"], performedActions: string[]) {
  const ticket = asRecord(getToolOutput(run, "updateTicketStatus")) ?? asRecord(getToolOutput(run, "getTicket"));
  const customer = asRecord(getToolOutput(run, "getCustomer"));
  const order = asRecord(getToolOutput(run, "getOrder"));
  const policy = asRecord(getToolOutput(run, "searchPolicy"));
  const refund = asRecord(getToolOutput(run, "createRefund"));
  const queryRows = getToolOutput(run, "searchTickets") ?? getToolOutput(run, "listTickets");
  const requirement = textField(asRecord(getToolOutput(run, "getTicket")), "description")
    ? `${textField(asRecord(getToolOutput(run, "getTicket")), "id") ?? "工单"}：${textField(asRecord(getToolOutput(run, "getTicket")), "description")}`
    : run.task;
  const policyId = textField(policy, "id");
  const policyTitle = textField(policy, "title");
  const policyContent = textField(policy, "content");
  const policyKeyword = textField(policy, "keyword");
  const ticketId = textField(ticket, "id");
  const ticketStatus = textField(ticket, "status");

  let result: string;
  if (Array.isArray(queryRows)) {
    const rows = queryRows.map(asRecord).filter((row): row is Record<string, unknown> => Boolean(row));
    const items = rows.map((row) => [
      textField(row, "id") ?? "未知工单",
      `状态 ${textField(row, "status") ?? "未知"}`,
      `优先级 ${textField(row, "priority") ?? "未知"}`,
      `客户 ${textField(row, "customerId") ?? "未知"}`,
    ].join("、"));
    result = `查询完成，共 ${rows.length} 条结果：${items.join("；") || "未找到匹配工单"}。`;
  } else if (decision === "refund_required") {
    result = [
      "退款处理已完成",
      textField(refund, "id") ? `退款申请 ${textField(refund, "id")}` : undefined,
      textField(refund, "amount") ? `金额 ${textField(refund, "amount")} 元` : undefined,
      textField(refund, "status") ? `状态 ${textField(refund, "status")}` : undefined,
      ticketId && ticketStatus ? `工单 ${ticketId} 已更新为 ${ticketStatus}` : undefined,
    ].filter(Boolean).join("；") + "。";
  } else if (decision === "already_satisfied") {
    result = `目标状态已达成，本次未重复写入；订单退款状态为 ${textField(order, "refundStatus") ?? "已存在"}，工单 ${ticketId ?? ""} 保持 ${ticketStatus ?? "原状态"}。`;
  } else if (decision === "waiting_approval") {
    result = "高风险操作尚未执行，当前正在等待人工审批。";
  } else if (decision === "manual_review") {
    result = "人工审批已拒绝，未创建退款，也未执行后续状态写入。";
  } else if (decision === "failed") {
    result = "任务未完成，具体原因请查看结构化错误信息。";
  } else if (decision === "cancelled") {
    result = "任务已取消，Agent 已停止后续处理。";
  } else if (policyId || policyContent) {
    result = `查询完成，命中规则 ${policyId ?? ""}${policyTitle ? `（${policyTitle}）` : ""}${policyContent ? `：${policyContent}` : ""}；未执行业务写入。`;
  } else {
    result = `查询完成${ticketId ? `，工单 ${ticketId} 当前状态为 ${ticketStatus ?? "未知"}` : ""}；未执行业务写入。`;
  }

  const basisParts = [
    textField(customer, "id") ? `客户 ${textField(customer, "id")} 等级 ${textField(customer, "level") ?? "未知"}` : undefined,
    textField(order, "id") ? `订单 ${textField(order, "id")} 金额 ${textField(order, "amount") ?? "未知"} 元、状态 ${textField(order, "status") ?? "未知"}` : undefined,
    policyId ? `业务规则 ${policyId}${policyTitle ? `（${policyTitle}）` : ""}` : undefined,
    performedActions.length > 0 ? `实际写入 ${performedActions.join("、")}` : "未发生业务写入",
  ].filter((item): item is string => Boolean(item));

  const nextByKeyword: Record<string, string> = {
    sla: "请转人工评估 SLA 影响范围，并结合合同等级确认补偿方案。",
    "发票": "请按发票规则记录处理意见并继续协助客户开票。",
    upgrade: "请确认目标版本和合同差额后继续办理升级。",
    cancel: "请向客户说明费用状态和后续恢复路径。",
  };
  const nextByDecision: Partial<Record<AgentOutcome["decision"], string>> = {
    refund_required: "请继续跟进待审批退款状态并完成后续人工确认。",
    already_satisfied: "无需重复提交，请继续跟进已有退款审批记录。",
    waiting_approval: "请完成人工审批，审批结果将决定是否继续执行。",
    manual_review: "请根据拒绝原因补充材料或与客户沟通后续方案。",
    failed: "请按错误建议修正后重试。",
    cancelled: "确认现有业务状态后可重新发起任务。",
  };

  return {
    requirement,
    result,
    basis: basisParts.join("；") + "。",
    nextStep: nextByDecision[decision] ?? nextByKeyword[policyKeyword ?? ""] ?? "当前无需额外自动化操作。",
  };
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
    conclusion: deriveConclusion(run, decision, performedActions),
  };
}
