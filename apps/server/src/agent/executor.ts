import type { AgentRun, AgentRunEvent, AgentStep, AgentStepType, ApprovalRequest } from "@agentflow/shared";
import {
  createApprovalRequest,
  resolveApprovalForRun,
  type ApprovalDecision,
} from "../approval/approvalStore.js";
import { generateChat, generateText } from "../llm/provider.js";
import { buildPlanPrompt, buildToolCallingMessages } from "../llm/prompts.js";
import type { LlmChatMessage, LlmToolCall } from "../llm/types.js";
import { saveRun } from "../trace/runStore.js";
import { isAgentToolName, listAgentTools, runTool, toolRegistry, type ToolName } from "../tools/toolRegistry.js";

const STEP_DELAY_MS = 250;
const MAX_TOOL_LOOP_TURNS = 10;

type ApprovalMode = "interactive" | "auto";

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
  };
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

function addStep(run: AgentRun, step: AgentStep) {
  run.steps.push(step);
  return {
    kind: "step",
    step,
  } satisfies AgentRunEvent;
}

/** 通过工具注册表执行模型请求的工具，并把结果包装成时间线 step。 */
async function buildToolStep(index: number, toolCall: LlmToolCall) {
  const toolName = toolCall.name;

  if (!isAgentToolName(toolName)) {
    throw new Error(`Tool is not available to agent: ${toolName}`);
  }

  const measured = await measureStep(() => runTool(toolName, toolCall.arguments));

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

/** 生成计划 step，作为 Tool Calling 之前的可观测决策入口。 */
async function buildPlanStep(task: string, index: number) {
  const planPrompt = buildPlanPrompt(task);
  const plan = await measureStep(() =>
    generateText({
      ...planPrompt,
      temperature: 0.2,
    }),
  );

  return createStep({
    index,
    type: "plan",
    title: plan.value.isMock ? "生成处理计划（Mock LLM）" : "生成处理计划",
    detail: plan.value.text,
    durationMs: plan.durationMs,
    toolName: plan.value.model,
    status: "completed",
  });
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
    throw new Error(`Tool is not available to agent: ${toolName}`);
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
  saveRun(run);

  yield {
    kind: "approval_required",
    run,
    approval,
    step: approvalStep,
  };

  // 非流式调试接口无法让用户在同一响应中操作审批，因此只在该入口自动批准。
  if (mode === "auto") {
    resolveApprovalForRun(run.id, {
      status: "approved",
      reason: "非流式调试接口自动批准高风险工具调用。",
    });
  }

  const result = await decision;
  const resolvedApproval: ApprovalRequest = {
    ...approval,
    status: result.status,
    reason: result.reason,
    resolvedAt: new Date().toISOString(),
  };

  run.status = "running";
  resolveApprovalStep(run, resolvedApproval);
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

  yield addStep(run, await buildPlanStep(run.task, stepIndex++));

  const tools = listAgentTools();
  const messages = buildToolCallingMessages(run.task);

  for (let turn = 1; turn <= MAX_TOOL_LOOP_TURNS; turn += 1) {
    const assistant = await measureStep(() =>
      generateChat({
        messages,
        tools,
        temperature: 0.2,
      }),
    );
    const toolCalls = assistant.value.message.toolCalls ?? [];

    messages.push({
      role: "assistant",
      content: assistant.value.message.content,
      toolCalls,
    });

    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        if (!isAgentToolName(toolCall.name)) {
          throw new Error(`Tool is not available to agent: ${toolCall.name}`);
        }

        const tool = toolRegistry[toolCall.name];
        if (tool.riskLevel === "high") {
          const rejectedToolMessage = yield* requestApprovalForTool(run, stepIndex++, toolCall, mode);

          if (rejectedToolMessage) {
            messages.push(rejectedToolMessage);
            continue;
          }
        }

        const toolStep = await buildToolStep(stepIndex++, toolCall);
        messages.push(toolStep.toolMessage);
        yield addStep(run, toolStep.step);
      }

      continue;
    }

    if (assistant.value.message.content) {
      yield addStep(
        run,
        createStep({
          index: stepIndex++,
          type: "final",
          title: assistant.value.isMock ? "生成处理结论（Mock LLM）" : "生成处理结论",
          detail: assistant.value.message.content,
          durationMs: assistant.durationMs,
          toolName: assistant.value.model,
          status: "completed",
        }),
      );
      return;
    }

    throw new Error("LLM returned neither tool calls nor final content.");
  }

  throw new Error(`LLM tool calling loop exceeded ${MAX_TOOL_LOOP_TURNS} turns.`);
}

/** 一次性执行 Agent 任务，主要用于脚本调试；高风险工具会自动批准。 */
export async function runAgentTask(task: string): Promise<AgentRun> {
  const run = createRun(task, "running");

  try {
    for await (const event of buildAgentEvents(run, "auto")) {
      if (event.kind !== "approval_required") {
        await wait(0);
      }
    }

    run.status = "completed";
    run.completedAt = new Date().toISOString();
    saveRun(run);
    return run;
  } catch (error) {
    run.status = "failed";
    run.completedAt = new Date().toISOString();
    saveRun(run);
    throw error;
  }
}

/** 流式执行 Agent 任务，SSE 路由会把每个事件实时写给前端。 */
export async function* streamAgentTask(task: string): AsyncGenerator<AgentRunEvent> {
  const run = createRun(task, "running");

  yield {
    kind: "run_started",
    run,
  };

  try {
    for await (const event of buildAgentEvents(run, "interactive")) {
      await wait(STEP_DELAY_MS);
      yield event;
    }

    run.status = "completed";
    run.completedAt = new Date().toISOString();
    saveRun(run);

    yield {
      kind: "run_completed",
      run,
    };
  } catch (error) {
    run.status = "failed";
    run.completedAt = new Date().toISOString();
    saveRun(run);
    throw error;
  }
}
