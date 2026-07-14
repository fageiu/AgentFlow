import type {
  AgentErrorInfo,
  AgentPlan,
  AgentPlanStep,
  AgentRun,
  AgentRunEvent,
  AgentRunMetrics,
  AgentStep,
  AgentStepType,
  ApprovalRequest,
  LlmTokenUsage,
} from "@agentflow/shared";
import {
  createApprovalRequest,
  resolveApprovalForRun,
  type ApprovalDecision,
} from "../approval/approvalStore.js";
import {
  AgentExecutionError,
  AgentLoopLimitError,
  ToolNotAvailableError,
  createAgentErrorEvent,
  formatAgentErrorDetail,
  normalizeAgentError,
} from "./errors.js";
import { generateChat, generateText } from "../llm/provider.js";
import {
  buildErrorSummaryPrompt,
  buildActionPlanPrompt,
  buildFinalConclusionPrompt,
  buildPlanPrompt,
  buildToolCallingMessages,
} from "../llm/prompts.js";
import type { LlmChatMessage, LlmToolCall } from "../llm/types.js";
import { saveRun } from "../trace/runStore.js";
import { isAgentToolName, listAgentTools, runTool, toolRegistry, type ToolName } from "../tools/toolRegistry.js";
import {
  beginRefundWorkflowTransaction,
  commitRefundWorkflowTransaction,
  rollbackRefundWorkflowTransaction,
} from "../tools/sandboxTools.js";
import {
  AgentRunCancelledError,
  clearRunCancel,
  getRunAbortSignal,
  getRunCancel,
  registerRunControl,
  throwIfRunCancelled,
} from "./runControl.js";
import { deriveAgentOutcome } from "./outcome.js";

const STEP_DELAY_MS = 250;
const MAX_TOOL_LOOP_TURNS = 10;
const MAX_TOOL_RETRY_ATTEMPTS = 2;

type ApprovalMode = "interactive" | "auto" | "auto-reject";

interface ToolRetryDecision {
  retryable: boolean;
  reason: string;
}

interface PendingToolRecovery {
  toolName: string;
  retryAttempt: number;
  promptAttempts: number;
  error: AgentErrorInfo;
}

/** 在 Demo 中制造轻微延迟，让前端能看到时间线逐步出现。 */
function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 创建一次 Agent 运行记录，后续 step 会不断追加到这条 run 中。 */
function createRun(task: string, status: AgentRun["status"], steps: AgentStep[] = []): AgentRun {
  return {
    id: `run-${Date.now()}`,
    task,
    status,
    steps,
    createdAt: new Date().toISOString(),
    metrics: createEmptyRunMetrics(),
  };
}

function createEmptyTokenUsage(): LlmTokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

function createEmptyRunMetrics(): AgentRunMetrics {
  return {
    llmCallCount: 0,
    toolCallCount: 0,
    fallbackCount: 0,
    modelNames: [],
    tokenUsage: createEmptyTokenUsage(),
  };
}

function addTokenUsage(left: LlmTokenUsage, right: LlmTokenUsage): LlmTokenUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

/** 汇总 run 级 LLM 指标，评测系统会基于它统计 token、模型和平均调用成本。 */
function recordLlmUsage(run: AgentRun, modelName: string, tokenUsage: LlmTokenUsage, fallbackTriggered = false) {
  const metrics = run.metrics ?? createEmptyRunMetrics();
  metrics.llmCallCount += 1;
  metrics.tokenUsage = addTokenUsage(metrics.tokenUsage, tokenUsage);
  metrics.fallbackCount = (metrics.fallbackCount ?? 0) + (fallbackTriggered ? 1 : 0);

  if (!metrics.modelNames.includes(modelName)) {
    metrics.modelNames.push(modelName);
  }

  run.metrics = metrics;
}

function recordToolCall(run: AgentRun) {
  const metrics = run.metrics ?? createEmptyRunMetrics();
  metrics.toolCallCount += 1;
  run.metrics = metrics;
}

/** 创建标准化 step，保证每个步骤都有稳定 id。 */
function createStep(input: Omit<AgentStep, "id"> & { index: number }): AgentStep {
  const { index, ...step } = input;

  return {
    id: `step-${index}`,
    ...step,
  };
}

/** 执行一步异步操作并记录耗时，用于前端展示 LLM 或工具调用成本。 */
async function measureStep<T>(action: () => T | Promise<T>) {
  const startedAt = Date.now();
  const value = await action();

  return {
    value,
    durationMs: Date.now() - startedAt,
  };
}

/** 将工具调用的输入、输出、风险等级和 callId 整理成 trace 详情。 */
function formatToolDetail(input: unknown, output: unknown, riskLevel: string, toolCallId: string) {
  return JSON.stringify(
    {
      toolCallId,
      riskLevel,
      input,
      output,
    },
    null,
    2,
  );
}

function formatApprovalDetail(approval: ApprovalRequest) {
  return JSON.stringify(
    {
      approvalId: approval.id,
      toolCallId: approval.toolCallId,
      riskLevel: approval.riskLevel,
      status: approval.status,
      input: approval.input,
      reason: approval.reason,
    },
    null,
    2,
  );
}

function getToolStepType(name: ToolName): AgentStepType {
  return name === "createRefund" ? "approval" : "tool_call";
}

function getToolStepTitle(name: ToolName) {
  const titles: Partial<Record<ToolName, string>> = {
    listTickets: "LLM 调用工具：查询全部工单",
    searchTickets: "LLM 调用工具：筛选工单",
    getTicket: "LLM 调用工具：查询工单",
    getCustomer: "LLM 调用工具：查询客户",
    getOrder: "LLM 调用工具：查询订单",
    searchPolicy: "LLM 调用工具：检索规则",
    createRefund: "LLM 调用工具：创建待审批退款",
    updateTicketStatus: "LLM 调用工具：更新工单状态",
  };

  return titles[name] ?? `LLM 调用工具：${name}`;
}

function buildToolMessage(toolCall: LlmToolCall, toolName: string, output: unknown): LlmChatMessage {
  return {
    role: "tool",
    toolCallId: toolCall.id,
    name: toolName,
    content: JSON.stringify(output),
  };
}

function buildToolErrorMessage(toolCall: LlmToolCall, error: AgentErrorInfo, retryAttempt: number): LlmChatMessage {
  return buildToolMessage(toolCall, toolCall.name, {
    ok: false,
    retryable: error.retryable,
    retryAttempt,
    error: {
      code: error.code,
      category: error.category,
      message: error.message,
      detailMessage: error.detailMessage,
      suggestion: error.suggestion,
      details: error.details,
    },
  });
}

function addStep(run: AgentRun, step: AgentStep) {
  run.steps.push(step);
  return {
    kind: "step",
    step,
  } satisfies AgentRunEvent;
}

function buildFailedToolStep(index: number, toolCall: LlmToolCall, error: unknown) {
  const toolName = isAgentToolName(toolCall.name) ? toolCall.name : undefined;
  const agentError = normalizeAgentError(error, {
    phase: "tool_call",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    arguments: toolCall.arguments,
  });

  return {
    agentError,
    step: createStep({
      index,
      type: toolName ? getToolStepType(toolName) : "observation",
      title: toolName ? `${getToolStepTitle(toolName)}失败` : "工具调用失败：工具不可用",
      detail: formatAgentErrorDetail(agentError, {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        arguments: toolCall.arguments,
      }),
      toolName,
      status: "failed",
    }),
  };
}

/** 判断工具失败是否值得交还给模型自我修正，避免对明确不存在的数据做无意义重试。 */
function decideToolRetry(error: AgentErrorInfo, toolCall: LlmToolCall, attempts: number): ToolRetryDecision {
  if (attempts >= MAX_TOOL_RETRY_ATTEMPTS) {
    return {
      retryable: false,
      reason: `已达到最大重试次数 ${MAX_TOOL_RETRY_ATTEMPTS}。`,
    };
  }

  if (error.code === "TOOL_INPUT_VALIDATION_ERROR") {
    return {
      retryable: true,
      reason: "工具参数校验失败，模型可根据校验错误修正参数后重试。",
    };
  }

  if (error.code === "TOOL_NOT_AVAILABLE") {
    return {
      retryable: true,
      reason: "模型选择了未开放工具，可重新选择工具注册表中的合法工具。",
    };
  }

  if (error.code === "BUSINESS_DATA_NOT_FOUND" && toolCall.name === "searchPolicy") {
    return {
      retryable: true,
      reason: "规则关键词未命中，模型可根据任务语义换用更贴近规则库的关键词重试。",
    };
  }

  return {
    retryable: false,
    reason: "该错误通常代表业务对象不存在或外部异常，本轮不自动重试。",
  };
}

/** 构造恢复校验提示，防止模型在关键工具失败后直接生成“已完成”结论。 */
function buildRecoveryInstructionMessage(recovery: PendingToolRecovery): LlmChatMessage {
  return {
    role: "user",
    content: [
      `恢复校验未通过：工具 ${recovery.toolName} 尚未成功执行。`,
      `请先修正参数并再次调用 ${recovery.toolName}，不要生成最终结论，也不要执行写入类工具。`,
      `这是第 ${recovery.promptAttempts} 次恢复提醒；原始错误：${recovery.error.detailMessage ?? recovery.error.message}`,
    ].join("\n"),
  };
}

/** 生成恢复未完成错误，确保最终状态和用户结论不会误报成功。 */
function buildRecoveryIncompleteError(recovery: PendingToolRecovery): AgentErrorInfo {
  return {
    ...recovery.error,
    code: "TOOL_RECOVERY_INCOMPLETE",
    category: "tool",
    message: `Tool recovery was not completed: ${recovery.toolName}`,
    userMessage: `工具 ${recovery.toolName} 失败后未完成有效重试，本次任务未完成。`,
    detailMessage: `工具 ${recovery.toolName} 已失败，但模型连续 ${recovery.promptAttempts} 次未完成修正后的工具调用。`,
    suggestion: recovery.error.suggestion ?? `请检查 ${recovery.toolName} 的参数或补充对应业务数据后重试。`,
    retryable: false,
    details: {
      ...recovery.error.details,
      recoveryRequired: true,
      recoveryPromptAttempts: recovery.promptAttempts,
      recoveryToolName: recovery.toolName,
      recoveryRetryAttempt: recovery.retryAttempt,
    },
  };
}

/** 将恢复校验失败记录到 trace，前端可明确区分“重试准备”和“恢复失败”。 */
function buildRecoveryIncompleteStep(index: number, recovery: PendingToolRecovery, error: AgentErrorInfo) {
  return createStep({
    index,
    type: "observation",
    title: "恢复未完成，阻止生成最终结论",
    detail: formatAgentErrorDetail(error, {
      recoveryToolName: recovery.toolName,
      retryAttempt: recovery.retryAttempt,
      promptAttempts: recovery.promptAttempts,
    }),
    toolName: recovery.toolName,
    status: "failed",
  });
}

function buildRetryObservationStep(input: {
  index: number;
  toolCall: LlmToolCall;
  error: AgentErrorInfo;
  retryAttempt: number;
  decision: ToolRetryDecision;
}) {
  return createStep({
    index: input.index,
    type: "observation",
    title: `分析错误并准备第 ${input.retryAttempt} 次重试`,
    detail: JSON.stringify(
      {
        retry: {
          attempt: input.retryAttempt,
          maxAttempts: MAX_TOOL_RETRY_ATTEMPTS,
          toolName: input.toolCall.name,
          arguments: input.toolCall.arguments,
          reason: input.decision.reason,
          instruction: "已将结构化错误作为 tool message 回传给模型，请模型调整工具或参数后继续执行。",
        },
        error: input.error,
      },
      null,
      2,
    ),
    toolName: input.toolCall.name,
    status: "completed",
  });
}

function appendRunFailureStep(run: AgentRun, error: unknown) {
  const agentError = normalizeAgentError(error, {
    phase: "agent_run",
    runId: run.id,
  });

  run.steps.push(createStep({
    index: run.steps.length + 1,
    type: "observation",
    title: "Agent 执行失败：错误处理",
    detail: formatAgentErrorDetail(agentError, {
      runId: run.id,
      task: run.task,
    }),
    status: "failed",
  }));

  return agentError;
}

async function failRun(run: AgentRun, error: unknown) {
  const normalizedError = error instanceof AgentExecutionError && error.alreadyTraced
    ? normalizeAgentError(error)
    : appendRunFailureStep(run, error);
  const agentError = await enrichErrorWithLlmSummary(run, normalizedError);

  const lastFailedStep = [...run.steps].reverse().find((step) => step.status === "failed");
  if (lastFailedStep) {
    lastFailedStep.detail = formatAgentErrorDetail(agentError, {
      runId: run.id,
      task: run.task,
      ...(agentError.details ?? {}),
    });
  }

  run.status = "failed";
  run.completedAt = new Date().toISOString();
  run.error = agentError;
  run.outcome = deriveAgentOutcome(run);
  saveRun(run);
  clearRunCancel(run.id);
  return agentError;
}

/** 通过工具注册表执行模型请求的工具，并把结果包装成时间线 step。 */
async function buildToolStep(run: AgentRun, index: number, toolCall: LlmToolCall) {
  const toolName = toolCall.name;

  if (!isAgentToolName(toolName)) {
    throw new ToolNotAvailableError(toolName);
  }

  const measured = await measureStep(() => runTool(toolName, toolCall.arguments));
  recordToolCall(run);

  return {
    output: measured.value.output,
    toolMessage: buildToolMessage(toolCall, measured.value.tool.name, measured.value.output),
    step: createStep({
      index,
      type: getToolStepType(toolName),
      title: getToolStepTitle(toolName),
      detail: formatToolDetail(measured.value.input, measured.value.output, measured.value.tool.riskLevel, toolCall.id),
      durationMs: measured.durationMs,
      toolName: measured.value.tool.name,
      status: "completed",
    }),
  };
}

/** 生成计划 step，Planner 可使用预读取的工单详情避免只按任务文本猜测范围。 */
async function buildPlanStep(run: AgentRun, index: number, ticketContext?: unknown) {
  const planPrompt = buildPlanPrompt(run.task, ticketContext ? { ticketContext } : undefined);
  const plan = await measureStep(() =>
    generateText({
      ...planPrompt,
      temperature: 0.2,
      signal: getRunAbortSignal(run.id),
    }),
  );

  const planValue = completeInitialPlanCoverage(parseAgentPlan(plan.value.text), run.task, Boolean(ticketContext));

  return {
    plan: planValue,
    step: createStep({
      index,
      type: "plan",
      title: plan.value.isMock ? "生成处理计划（Mock LLM）" : "生成处理计划",
      detail: JSON.stringify(planValue, null, 2),
      durationMs: plan.durationMs,
      toolName: plan.value.model,
      modelName: plan.value.model,
      tokenUsage: plan.value.tokenUsage,
      fallback: plan.value.fallback,
      status: "completed",
    }),
  };
}

/**
 * 将 Action Planner 输出收敛到退款写入事务：非明确退款任务禁止任何写入，
 * 明确退款任务则必须保持 createRefund -> updateTicketStatus 的完整顺序。
 */
export function constrainActionPlan(actionPlan: AgentPlan, task: string, ticketContext: unknown) {
  const refundEvidence = `${task}\n${JSON.stringify(ticketContext)}`;
  const hasExplicitRefundRequest = /申请退款|退款诉求|创建(?:必要的)?退款|创建退款记录|退款申请/.test(refundEvidence);

  if (!hasExplicitRefundRequest && actionPlan.steps.length > 0) {
    // 咨询类任务即使模型误规划单独状态写入，也应安全收敛为空计划而不是让整个 run 失败。
    return {
      version: 1,
      summary: "现有任务与工单没有明确退款诉求，服务端安全边界阻止业务写入。",
      steps: [],
    } satisfies AgentPlan;
  }

  const actionTools = actionPlan.steps.map((step) => step.allowedTools[0]);

  if (actionTools.some((toolName) => toolName !== "createRefund" && toolName !== "updateTicketStatus")) {
    throw new Error("Action Planner returned an unsupported tool.");
  }

  if (actionTools.length > 0 && (actionTools.length !== 2 || actionTools[0] !== "createRefund" || actionTools[1] !== "updateTicketStatus")) {
    throw new Error("Action Planner must create a refund before synchronizing ticket status.");
  }

  return actionPlan;
}

/** 基础核查完成后，基于真实证据决定是否追加高风险退款动作。 */
async function buildActionPlanStep(run: AgentRun, ticketContext: unknown, index: number) {
  const actionPlanResult = await measureStep(() =>
    generateText({
      ...buildActionPlanPrompt({
        task: run.task,
        ticketContext,
        evidence: summarizeStepsForFinalPrompt(run.steps),
        // 沙箱使用固定业务时钟，避免演示数据随真实日期推移后改变退款资格判断。
        businessDate: process.env.AGENTFLOW_BUSINESS_DATE ?? "2026-07-01",
      }),
      temperature: 0.1,
      signal: getRunAbortSignal(run.id),
    }),
  );
  const actionPlan = constrainActionPlan(
    parseAgentPlan(actionPlanResult.value.text, true),
    run.task,
    ticketContext,
  );

  return {
    plan: actionPlan,
    step: createStep({
      index,
      type: "observation",
      title: actionPlanResult.value.isMock ? "根据实际规则判断后续动作（Mock LLM）" : "根据实际规则判断后续动作",
      detail: JSON.stringify({
        observation: actionPlan.summary,
        remainingPlan: actionPlan,
      }, null, 2),
      durationMs: actionPlanResult.durationMs,
      toolName: actionPlanResult.value.model,
      modelName: actionPlanResult.value.model,
      tokenUsage: actionPlanResult.value.tokenUsage,
      fallback: actionPlanResult.value.fallback,
      status: "completed",
    }),
  };
}

function extractProcessTicketId(task: string) {
  if (!/处理\s*工单\s*T-\d+/i.test(task)) {
    return undefined;
  }

  return task.match(/T-\d+/i)?.[0].toUpperCase();
}

/** 处理单张工单前先读取真实详情，为 Planner 提供可靠上下文；该步骤保持只读。 */
async function buildPlanningTicketContextStep(run: AgentRun, index: number) {
  const ticketId = extractProcessTicketId(run.task);
  if (!ticketId) {
    return undefined;
  }

  const toolCall: LlmToolCall = {
    id: "planning-ticket-context",
    name: "getTicket",
    arguments: { ticketId },
  };
  const result = await buildToolStep(run, index, toolCall);
  result.step.title = "读取工单上下文（用于制定计划）";

  return {
    ticket: result.output,
    step: result.step,
  };
}

const defaultPlanStepDefinitions = {
  getTicket: ["read-ticket", "读取工单", "确认工单关联的客户、订单和诉求。", false],
  getCustomer: ["read-customer", "读取客户", "核查客户等级和风险信息。", false],
  getOrder: ["read-order", "读取订单", "核查订单金额、状态与退款状态。", false],
  searchPolicy: ["read-policy", "检索规则", "依据工单诉求检索适用业务规则。", false],
  createRefund: ["create-refund", "创建待审批退款", "在规则满足时创建待审批退款记录。", true],
  updateTicketStatus: ["sync-ticket-status", "同步工单状态", "退款记录成功创建后同步工单状态。", false],
} as const;

/**
 * “处理工单”默认完成完整业务核查，不能因 Planner 忽略任务细节而退化成只查一张工单。
 * 默认只补齐核查步骤；用户明确提出的业务动作由 Planner 保留，避免把请求压缩成固定脚本。
 */
function completeInitialPlanCoverage(plan: AgentPlan, task: string, hasTicketContext: boolean): AgentPlan {
  if (!extractProcessTicketId(task) && /查询|列出|查看|筛选|统计|工单列表|哪些工单/.test(task)) {
    const requiresFilter = /高优先级|中优先级|低优先级|高优|中优|低优|客户\s*C-\d+|待审批|等待审批|已关闭|已拒绝|状态为/i.test(task);
    const toolName = requiresFilter ? "searchTickets" : "listTickets";

    return {
      version: 1,
      summary: plan.summary || "按用户条件查询工单并返回真实结果。",
      steps: [{
        id: requiresFilter ? "search-tickets" : "list-tickets",
        title: requiresFilter ? "按条件筛选工单" : "查询全部工单",
        objective: requiresFilter ? "使用用户给定条件筛选工单，不产生业务写入。" : "读取全部工单，不产生业务写入。",
        allowedTools: [toolName],
        requiresApproval: false,
      }],
    };
  }

  if (!extractProcessTicketId(task)) {
    return plan;
  }

  const coreTools: Array<keyof typeof defaultPlanStepDefinitions> = [
    ...(hasTicketContext ? [] : ["getTicket"] as const),
    "getCustomer",
    "getOrder",
    "searchPolicy",
  ];
  const existingByTool = new Map(plan.steps.map((step) => [step.allowedTools[0], step]));
  const coreSteps = coreTools.map((toolName) => {
    const existing = existingByTool.get(toolName);
    if (existing) {
      return existing;
    }

    const [id, title, objective, requiresApproval] = defaultPlanStepDefinitions[toolName];
    return {
      id,
      title,
      objective,
      allowedTools: [toolName],
      requiresApproval,
    } satisfies AgentPlanStep;
  });

  const coreToolNames = new Set(coreTools);
  const plannedReadExtensions = plan.steps.filter((step) => {
    const toolName = step.allowedTools[0];
    if (hasTicketContext && toolName === "getTicket") {
      return false;
    }

    if (coreToolNames.has(toolName as keyof typeof defaultPlanStepDefinitions)) {
      return false;
    }

    // 写入必须等待实际证据齐备后交给 Action Planner 决定，首轮计划仅保留只读扩展。
    if (toolName === "createRefund" || toolName === "updateTicketStatus") {
      return false;
    }

    return true;
  });

  return {
    version: 1,
    summary: plan.summary || "结合工单上下文完成业务核查并给出处理结论。",
    steps: [...coreSteps, ...plannedReadExtensions],
  };
}

/** 工具观察表明原计划需要调整时，仅为尚未完成的部分生成新计划。 */
async function buildReplanStep(
  run: AgentRun,
  completedSteps: AgentPlanStep[],
  requiredFirstTool: string,
  observation: string,
  index: number,
  ticketContext?: unknown,
) {
  const replan = await measureStep(() =>
    generateText({
      ...buildPlanPrompt(run.task, {
        completedTools: completedSteps.flatMap((step) => step.allowedTools),
        observation,
        ticketContext,
      }),
      temperature: 0.1,
      signal: getRunAbortSignal(run.id),
    }),
  );
  const remainingPlan = parseAgentPlan(replan.value.text);
  const completedTools = new Set(completedSteps.flatMap((step) => step.allowedTools));

  if (remainingPlan.steps.some((step) => completedTools.has(step.allowedTools[0]))) {
    throw new Error("Replanner repeated a completed tool step.");
  }

  if (remainingPlan.steps[0]?.allowedTools[0] !== requiredFirstTool) {
    throw new Error(`Replanner must retry ${requiredFirstTool} before advancing.`);
  }

  return {
    plan: remainingPlan,
    step: createStep({
      index,
      type: "observation",
      title: replan.value.isMock ? "根据执行观察重规划（Mock LLM）" : "根据执行观察重规划",
      detail: JSON.stringify({ observation, remainingPlan }, null, 2),
      durationMs: replan.durationMs,
      toolName: replan.value.model,
      modelName: replan.value.model,
      tokenUsage: replan.value.tokenUsage,
      fallback: replan.value.fallback,
      status: "completed",
    }),
  };
}

/** 校验 Planner 输出，防止模型把未注册工具或不可执行结构交给 Executor。 */
function parseAgentPlan(raw: string, allowEmpty = false): AgentPlan {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Planner did not return valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Planner result must be an object.");
  }

  const candidate = value as Partial<AgentPlan>;
  if (candidate.version !== 1 || typeof candidate.summary !== "string" || !Array.isArray(candidate.steps)
    || (!allowEmpty && candidate.steps.length === 0) || candidate.steps.length > 6) {
    throw new Error("Planner result does not match the required plan contract.");
  }

  const stepIds = new Set<string>();
  const steps = candidate.steps.map((step, index) => {
    if (!step || typeof step !== "object" || typeof step.id !== "string" || typeof step.title !== "string"
      || typeof step.objective !== "string" || !Array.isArray(step.allowedTools) || step.allowedTools.length !== 1
      || typeof step.allowedTools[0] !== "string" || !isAgentToolName(step.allowedTools[0])) {
      throw new Error(`Planner step ${index + 1} is invalid.`);
    }

    if (stepIds.has(step.id)) {
      throw new Error(`Planner step id is duplicated: ${step.id}`);
    }
    stepIds.add(step.id);

    const toolName = step.allowedTools[0];
    return {
      id: step.id,
      title: step.title,
      objective: step.objective,
      allowedTools: [toolName],
      // 审批属性由服务端工具风险等级决定，不能信任模型返回的布尔值。
      requiresApproval: toolRegistry[toolName].riskLevel === "high",
    } satisfies AgentPlanStep;
  });

  return { version: 1, summary: candidate.summary, steps };
}

/** 对语义明确的规则查询做参数归一，避免模型用冗长或错误关键词制造无意义重试。 */
function normalizeTaskAwareToolCall(task: string, toolCall: LlmToolCall): LlmToolCall {
  if (toolCall.name !== "searchPolicy") {
    return toolCall;
  }

  let keyword: string | undefined;
  if (/发票|开票/.test(task)) {
    keyword = "发票";
  } else if (/升级/.test(task)) {
    keyword = "upgrade";
  } else if (/SLA|服务不可用|不可用/i.test(task)) {
    keyword = "sla";
  } else if (/取消|cancel/i.test(task)) {
    keyword = "cancel";
  } else if (/退款|refund/i.test(task)) {
    keyword = "refund";
  }

  return keyword
    ? { ...toolCall, arguments: { ...toolCall.arguments, keyword } }
    : toolCall;
}

/** 将当前计划位置写入模型上下文，同时让 trace 能据此审计每一步实际授权范围。 */
function buildPlanProgressMessage(activeStep: AgentPlanStep | undefined): LlmChatMessage {
  return {
    role: "system",
    content: activeStep
      ? `当前计划步骤：${activeStep.id}（${activeStep.title}）。目标：${activeStep.objective}。本轮仅允许调用：${activeStep.allowedTools.join(", ")}。`
      : "Planner 的全部步骤已经完成。禁止继续调用工具，请输出最终结论。",
  };
}

function summarizeStepsForFinalPrompt(steps: AgentStep[]) {
  return steps
    .filter((step) => step.type !== "final")
    .map((step) => ({
      type: step.type,
      title: step.title,
      status: step.status,
      toolName: step.toolName,
      detail: step.detail.length > 1800 ? `${step.detail.slice(0, 1800)}...` : step.detail,
    }));
}

/** 基于完整执行 trace 再生成一次面向用户的精简结论，避免把过程日志或评测指标暴露到最终回复。 */
async function buildFinalConclusionStep(run: AgentRun, index: number, candidate: string) {
  const finalPrompt = buildFinalConclusionPrompt({
    task: run.task,
    candidate,
    steps: summarizeStepsForFinalPrompt(run.steps),
  });
  const final = await measureStep(() =>
    generateText({
      ...finalPrompt,
      temperature: 0.1,
      signal: getRunAbortSignal(run.id),
    }),
  );

  recordLlmUsage(run, final.value.model, final.value.tokenUsage, Boolean(final.value.fallback));

  return createStep({
    index,
    type: "final",
    title: final.value.isMock ? "生成最终回复（Mock LLM）" : "生成最终回复",
    detail: final.value.text,
    durationMs: final.durationMs,
    toolName: final.value.model,
    modelName: final.value.model,
    tokenUsage: final.value.tokenUsage,
    fallback: final.value.fallback,
    status: "completed",
  });
}

function parseErrorSummaryText(text: string) {
  try {
    const parsed = JSON.parse(text) as { detailMessage?: unknown; suggestion?: unknown };
    return {
      detailMessage: typeof parsed.detailMessage === "string" ? parsed.detailMessage.trim() : undefined,
      suggestion: typeof parsed.suggestion === "string" ? parsed.suggestion.trim() : undefined,
    };
  } catch {
    return {
      detailMessage: text.trim(),
      suggestion: undefined,
    };
  }
}

async function enrichErrorWithLlmSummary(run: AgentRun, error: AgentErrorInfo) {
  if (error.category === "llm") {
    return error;
  }

  try {
    const prompt = buildErrorSummaryPrompt({
      task: run.task,
      error,
      steps: summarizeStepsForFinalPrompt(run.steps),
    });
    const summary = await measureStep(() =>
      generateText({
        ...prompt,
        temperature: 0.1,
        signal: getRunAbortSignal(run.id),
      }),
    );
    const parsed = parseErrorSummaryText(summary.value.text);

    recordLlmUsage(run, summary.value.model, summary.value.tokenUsage, Boolean(summary.value.fallback));

    return {
      ...error,
      detailMessage: parsed.detailMessage ?? error.detailMessage,
      suggestion: parsed.suggestion ?? error.suggestion,
      details: {
        ...error.details,
        errorSummaryModel: summary.value.model,
        errorSummaryMock: summary.value.isMock,
      },
    };
  } catch {
    return error;
  }
}

function resolveApprovalStep(run: AgentRun, approval: ApprovalRequest) {
  const step = run.steps.find((item) => item.approvalRequest?.id === approval.id);

  if (!step) {
    return;
  }

  step.status = approval.status === "approved" ? "completed" : "failed";
  step.approvalRequest = approval;
  step.detail = formatApprovalDetail(approval);
}

function createRejectedToolMessage(toolCall: LlmToolCall, toolName: string, decision: ApprovalDecision) {
  return buildToolMessage(toolCall, toolName, {
    approved: false,
    rejectedBy: "human",
    reason: decision.reason ?? "人工拒绝高风险工具调用。",
  });
}

/** 高风险工具先进入人工审批，批准后才执行，拒绝时把拒绝结果回传给 LLM。 */
async function* requestApprovalForTool(
  run: AgentRun,
  index: number,
  toolCall: LlmToolCall,
  mode: ApprovalMode,
): AsyncGenerator<AgentRunEvent, LlmChatMessage | undefined> {
  const toolName = toolCall.name;

  if (!isAgentToolName(toolName)) {
    throw new ToolNotAvailableError(toolName);
  }

  const { approval, decision } = createApprovalRequest({
    runId: run.id,
    toolCallId: toolCall.id,
    toolName,
    riskLevel: "high",
    input: toolCall.arguments,
  });
  const approvalStep = createStep({
    index,
    type: "approval",
    title: "等待人工审批：高风险工具调用",
    detail: formatApprovalDetail(approval),
    toolName,
    status: "running",
    approvalRequest: approval,
  });

  run.status = "waiting_approval";
  run.steps.push(approvalStep);
  run.outcome = deriveAgentOutcome(run);
  saveRun(run);

  yield {
    kind: "approval_required",
    run,
    approval,
    step: approvalStep,
  };

  // 非流式调试接口无法让用户在同一响应中操作审批，因此只在该入口自动批准。
  if (mode === "auto" || mode === "auto-reject") {
    resolveApprovalForRun(run.id, {
      status: mode === "auto" ? "approved" : "rejected",
      reason: mode === "auto"
        ? "非流式调试接口自动批准高风险工具调用。"
        : "评测场景自动拒绝高风险工具调用。",
    });
  }

  const result = await decision;
  const resolvedApproval: ApprovalRequest = {
    ...approval,
    status: result.status,
    reason: result.reason,
    resolvedAt: new Date().toISOString(),
  };

  // 先把审批决议写回 trace，再检查取消，避免审批已删除但历史步骤仍显示等待中。
  resolveApprovalStep(run, resolvedApproval);
  if (getRunCancel(run.id)) {
    const approvalStep = run.steps.find((step) => step.approvalRequest?.id === resolvedApproval.id);
    if (approvalStep) {
      approvalStep.status = "cancelled";
    }
  }
  saveRun(run);
  throwIfRunCancelled(run);

  run.status = "running";
  // 审批等待结论已经失效，最终 Outcome 会在新的终态重新派生。
  run.outcome = undefined;
  saveRun(run);

  yield {
    kind: "approval_resolved",
    run,
    approval: resolvedApproval,
  };

  if (result.status === "rejected") {
    return createRejectedToolMessage(toolCall, toolName, result);
  }

  return undefined;
}

/** Tool Calling 执行循环：模型选择工具，后端执行，再把 tool result 回传模型。 */
async function* buildAgentEvents(run: AgentRun, mode: ApprovalMode): AsyncGenerator<AgentRunEvent> {
  let stepIndex = 1;

  throwIfRunCancelled(run);
  const ticketContext = await buildPlanningTicketContextStep(run, stepIndex++);
  if (ticketContext) {
    yield addStep(run, ticketContext.step);
  } else {
    stepIndex -= 1;
  }
  throwIfRunCancelled(run);

  const planned = await buildPlanStep(run, stepIndex++, ticketContext?.ticket);
  let activePlan = planned.plan;
  run.plan = activePlan;
  if (planned.step.modelName && planned.step.tokenUsage) {
    recordLlmUsage(run, planned.step.modelName, planned.step.tokenUsage, Boolean(planned.step.fallback));
  }
  yield addStep(run, planned.step);
  throwIfRunCancelled(run);

  const tools = listAgentTools();
  const messages = buildToolCallingMessages(run.task, activePlan, ticketContext?.ticket);
  const retryAttemptsByTool = new Map<string, number>();
  let pendingRecovery: PendingToolRecovery | undefined;
  let activePlanStepIndex = 0;
  let actionDecisionCompleted = !ticketContext;

  for (let turn = 1; turn <= MAX_TOOL_LOOP_TURNS; turn += 1) {
    throwIfRunCancelled(run);
    let activePlanStep = activePlan.steps[activePlanStepIndex];

    if (!activePlanStep && !actionDecisionCompleted && ticketContext) {
      const actionPlan = await buildActionPlanStep(run, ticketContext.ticket, stepIndex++);
      recordLlmUsage(
        run,
        actionPlan.step.modelName ?? "unknown",
        actionPlan.step.tokenUsage ?? createEmptyTokenUsage(),
        Boolean(actionPlan.step.fallback),
      );
      actionDecisionCompleted = true;
      yield addStep(run, actionPlan.step);

      if (actionPlan.plan.steps.length > 0) {
        activePlan = {
          version: 1,
          summary: actionPlan.plan.summary,
          steps: [...activePlan.steps, ...actionPlan.plan.steps],
        };
        run.plan = activePlan;
        messages.push({
          role: "system",
          content: `已基于真实核查证据追加后续动作计划：${JSON.stringify(actionPlan.plan)}`,
        });
        activePlanStep = activePlan.steps[activePlanStepIndex];
      }
    }

    // 计划已耗尽时且无恢复锁，主动收敛总结，避免模型在无授权步骤时重复调用最后一个工具。
    if (!activePlanStep && actionDecisionCompleted && !pendingRecovery) {
      const finalStep = await buildFinalConclusionStep(
        run,
        stepIndex++,
        "已完成计划中的全部步骤，请根据真实工具结果生成最终结论。",
      );
      yield addStep(run, finalStep);
      return;
    }

    messages.push(buildPlanProgressMessage(activePlanStep));
    const assistant = await measureStep(() =>
      generateChat({
        messages,
        tools,
        temperature: 0.2,
        signal: getRunAbortSignal(run.id),
      }),
    );
    recordLlmUsage(run, assistant.value.model, assistant.value.tokenUsage, Boolean(assistant.value.fallback));
    const toolCalls = assistant.value.message.toolCalls ?? [];

    messages.push({
      role: "assistant",
      content: assistant.value.message.content,
      toolCalls,
    });

    // llm调用工具
    if (toolCalls.length > 0) {
      if (toolCalls.length > 1) {
        throw new Error("Executor accepts one tool call per planned step.");
      }
      let shouldAskModelToRecover = false;

      for (const rawToolCall of toolCalls) {
        const toolCall = normalizeTaskAwareToolCall(run.task, rawToolCall);
        throwIfRunCancelled(run);
        try {
          if (!isAgentToolName(toolCall.name)) {
            throw new ToolNotAvailableError(toolCall.name);
          }

          if (!activePlanStep) {
            throw new Error(`Planner has no remaining step, but model requested ${toolCall.name}.`);
          }

          if (!activePlanStep.allowedTools.includes(toolCall.name)) {
            throw new Error(
              `Tool ${toolCall.name} is not authorized for current plan step ${activePlanStep.id}; expected ${activePlanStep.allowedTools.join(", ")}.`,
            );
          }

          const tool = toolRegistry[toolCall.name];
          // 高风险工具调用需要人工审批，批准后才执行，拒绝时把拒绝结果回传给 LLM。
          if (tool.riskLevel === "high") {
            const rejectedToolMessage = yield* requestApprovalForTool(run, stepIndex++, toolCall, mode);

            if (rejectedToolMessage) {
              messages.push(rejectedToolMessage);
              const finalStep = await buildFinalConclusionStep(
                run,
                stepIndex++,
                "人工已拒绝本次高风险退款操作，因此未创建退款记录，也不会更新工单为待审批状态。请根据拒绝原因与客户沟通后续处理。",
              );
              yield addStep(run, finalStep);
              return;
            }
          }

          if (toolCall.name === "createRefund" && typeof toolCall.arguments.orderId === "string") {
            beginRefundWorkflowTransaction(run.id, toolCall.arguments.orderId);
          }

          const toolStep = await buildToolStep(run, stepIndex++, toolCall);
          messages.push(toolStep.toolMessage);
          yield addStep(run, toolStep.step);
          // 只有工具成功落地后才推进计划，避免失败或审批拒绝时越过业务前置条件。
          activePlanStepIndex += 1;
          if (pendingRecovery?.toolName === toolCall.name) {
            // 只有对应失败工具真正成功后，才能解除恢复锁并允许最终结论。
            pendingRecovery = undefined;
          }
          if (toolCall.name === "updateTicketStatus") {
            commitRefundWorkflowTransaction(run.id);
          }
          throwIfRunCancelled(run);
        } catch (error) {
          rollbackRefundWorkflowTransaction(run.id);
          if (error instanceof AgentRunCancelledError) {
            throw error;
          }
          // 工具报错与用户取消并发时，以取消为最终语义，避免 run 被错误记录为 failed。
          throwIfRunCancelled(run);

          recordToolCall(run);
          const failedToolStep = buildFailedToolStep(stepIndex++, toolCall, error);
          const enrichedError = await enrichErrorWithLlmSummary(run, failedToolStep.agentError);
          const nextRetryAttempt = (retryAttemptsByTool.get(toolCall.name) ?? 0) + 1;
          const retryDecision = decideToolRetry(enrichedError, toolCall, nextRetryAttempt - 1);
          const traceError = retryDecision.retryable
            ? {
                ...enrichedError,
                retryable: true,
                details: {
                  ...enrichedError.details,
                  retryDecision: retryDecision.reason,
                  nextRetryAttempt,
                },
              }
            : enrichedError;

          failedToolStep.agentError = traceError;
          failedToolStep.step.detail = formatAgentErrorDetail(traceError, {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
          });
          yield addStep(run, failedToolStep.step);

          // 可重试 → 结构化错误回传 LLM → 重规划
          if (retryDecision.retryable) {
            retryAttemptsByTool.set(toolCall.name, nextRetryAttempt);
            // OpenAI-compatible 协议要求 assistant.tool_calls 后立即存在同 ID 的 tool message。
            messages.push(buildToolErrorMessage(toolCall, traceError, nextRetryAttempt));
            const completedPlanSteps = activePlan.steps.slice(0, activePlanStepIndex);
            const replanned = await buildReplanStep(
              run,
              completedPlanSteps,
              toolCall.name,
              traceError.detailMessage ?? traceError.message,
              stepIndex++,
              ticketContext?.ticket,
            );
            recordLlmUsage(
              run,
              replanned.step.modelName ?? "unknown",
              replanned.step.tokenUsage ?? createEmptyTokenUsage(),
              Boolean(replanned.step.fallback),
            );
            activePlan = {
              version: 1,
              summary: replanned.plan.summary,
              steps: [...completedPlanSteps, ...replanned.plan.steps],
            };
            run.plan = activePlan;
            messages.push({
              role: "system",
              content: `Planner 已根据工具观察更新剩余步骤：${JSON.stringify(replanned.plan)}`,
            });
            yield addStep(run, replanned.step);
            // 加锁：待恢复，工具调用失败需重试，不允许生成最终结论
            pendingRecovery = {
              toolName: toolCall.name,
              retryAttempt: nextRetryAttempt,
              promptAttempts: 0,
              error: traceError,
            };
            const retryStep = buildRetryObservationStep({
              index: stepIndex++,
              toolCall,
              error: traceError,
              retryAttempt: nextRetryAttempt,
              decision: retryDecision,
            });
            yield addStep(run, retryStep);
            shouldAskModelToRecover = true;
            break;
          }

          throw new AgentExecutionError(enrichedError, {
            alreadyTraced: true,
            cause: error,
          });
        }
      }

      if (shouldAskModelToRecover) {
        continue;
      }

      continue;
    }

    // 生成最终结论
    if (assistant.value.message.content) {
      throwIfRunCancelled(run);
      if (activePlanStep) {
        yield addStep(
          run,
          createStep({
            index: stepIndex++,
            type: "observation",
            title: "模型提前生成结论，已要求继续执行计划",
            detail: JSON.stringify({
              currentPlanStep: activePlanStep.id,
              allowedTools: activePlanStep.allowedTools,
              reason: "计划尚有未完成步骤，不能在缺少业务证据时结束。",
            }, null, 2),
            status: "completed",
          }),
        );
        continue;
      }
      // 存在恢复锁时，不允许直接生成结论
      if (pendingRecovery) {
        if (pendingRecovery.promptAttempts < MAX_TOOL_RETRY_ATTEMPTS) {
          pendingRecovery.promptAttempts += 1;
          yield addStep(
            run,
            createStep({
              index: stepIndex++,
              type: "observation",
              title: "模型尝试直接总结，已拦截并要求完成工具重试",
              detail: JSON.stringify(
                {
                  recovery: {
                    toolName: pendingRecovery.toolName,
                    retryAttempt: pendingRecovery.retryAttempt,
                    promptAttempts: pendingRecovery.promptAttempts,
                    reason: "关键工具尚未成功，不能生成最终结论。",
                  },
                },
                null,
                2,
              ),
              toolName: pendingRecovery.toolName,
              status: "completed",
            }),
          );
          messages.push(buildRecoveryInstructionMessage(pendingRecovery));
          continue;
        }

        const recoveryError = buildRecoveryIncompleteError(pendingRecovery);
        yield addStep(run, buildRecoveryIncompleteStep(stepIndex++, pendingRecovery, recoveryError));
        throw new AgentExecutionError(recoveryError, { alreadyTraced: true });
      }
      const finalStep = await buildFinalConclusionStep(run, stepIndex++, assistant.value.message.content);
      yield addStep(run, finalStep);
      return;
    }

    throw new Error("LLM returned neither tool calls nor final content.");
  }

  throw new AgentLoopLimitError(MAX_TOOL_LOOP_TURNS);
}

/** 一次性执行 Agent 任务；评测可显式模拟批准或拒绝高风险调用。 */
export async function runAgentTask(task: string, approvalMode: "approve" | "reject" = "approve"): Promise<AgentRun> {
  const run = createRun(task, "running");
  registerRunControl(run.id);
  saveRun(run);

  try {
    for await (const event of buildAgentEvents(run, approvalMode === "approve" ? "auto" : "auto-reject")) {
      if (event.kind !== "approval_required") {
        await wait(0);
      }
    }

    // 收敛到 completed 前再次检查，关闭最后一步结束与取消请求并发时的竞态窗口。
    throwIfRunCancelled(run);
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    run.outcome = deriveAgentOutcome(run);
    saveRun(run);
    clearRunCancel(run.id);
    return run;
  } catch (error) {
    rollbackRefundWorkflowTransaction(run.id);
    if (error instanceof AgentRunCancelledError) {
      run.status = "cancelled";
      run.completedAt = new Date().toISOString();
      run.outcome = deriveAgentOutcome(run);
      saveRun(run);
      clearRunCancel(run.id);
      return run;
    }

    const agentError = await failRun(run, error);
    throw new AgentExecutionError(agentError, {
      alreadyTraced: true,
      cause: error,
    });
  }
}

/** 流式执行 Agent 任务，SSE 路由会把每个事件实时写给前端。 */
export async function* streamAgentTask(task: string): AsyncGenerator<AgentRunEvent> {
  const run = createRun(task, "running");
  registerRunControl(run.id);
  // run_started 后前端即可发起取消，因此必须先写入 runStore，供取消接口校验生命周期。
  saveRun(run);

  yield {
    kind: "run_started",
    run,
  };

  try {
    for await (const event of buildAgentEvents(run, "interactive")) {
      await wait(STEP_DELAY_MS);
      throwIfRunCancelled(run);
      yield event;
    }

    // 最后一个事件发出后仍可能收到取消请求，终态写入前必须再确认一次。
    throwIfRunCancelled(run);
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    run.outcome = deriveAgentOutcome(run);
    saveRun(run);
    clearRunCancel(run.id);

    yield {
      kind: "run_completed",
      run,
    };
  } catch (error) {
    rollbackRefundWorkflowTransaction(run.id);
    if (error instanceof AgentRunCancelledError) {
      run.status = "cancelled";
      run.completedAt = new Date().toISOString();
      run.outcome = deriveAgentOutcome(run);
      saveRun(run);
      clearRunCancel(run.id);

      yield {
        kind: "run_cancelled",
        run,
      };
      return;
    }

    const agentError = await failRun(run, error);
    yield createAgentErrorEvent(run, agentError);
  }
}
