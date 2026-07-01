import type { AgentRun, AgentRunEvent, AgentStep, AgentStepType } from "@agentflow/shared";
import { generateChat, generateText } from "../llm/provider.js";
import { buildPlanPrompt, buildToolCallingMessages } from "../llm/prompts.js";
import type { LlmChatMessage, LlmToolCall } from "../llm/types.js";
import { saveRun } from "../trace/runStore.js";
import { isAgentToolName, listAgentTools, runTool, type ToolName } from "../tools/toolRegistry.js";

const STEP_DELAY_MS = 250;
const MAX_TOOL_LOOP_TURNS = 10;

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

/** 创建标准化 step，保证每个步骤都有稳定 id 和 completed 状态。 */
function createStep(input: Omit<AgentStep, "id" | "status"> & { index: number }): AgentStep {
  const { index, ...step } = input;

  return {
    id: `step-${index}`,
    status: "completed",
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

/** 通过工具注册表执行模型请求的工具，并把结果包装成时间线 step。 */
async function buildToolStep(index: number, toolCall: LlmToolCall) {
  const toolName = toolCall.name;

  if (!isAgentToolName(toolName)) {
    throw new Error(`Tool is not available to agent: ${toolName}`);
  }

  const measured = await measureStep(() => runTool(toolName, toolCall.arguments));

  return {
    output: measured.value.output,
    toolMessage: {
      role: "tool",
      toolCallId: toolCall.id,
      name: measured.value.tool.name,
      content: JSON.stringify(measured.value.output),
    } satisfies LlmChatMessage,
    step: createStep({
      index,
      type: getToolStepType(toolName),
      title: getToolStepTitle(toolName),
      detail: formatToolDetail(measured.value.input, measured.value.output, measured.value.tool.riskLevel, toolCall.id),
      durationMs: measured.durationMs,
      toolName: measured.value.tool.name,
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
  });
}

/** Tool Calling 执行循环：模型选择工具，后端执行，再把 tool result 回传模型。 */
async function* buildAgentSteps(task: string): AsyncGenerator<AgentStep> {
  let stepIndex = 1;
  yield await buildPlanStep(task, stepIndex++);

  const tools = listAgentTools();
  const messages = buildToolCallingMessages(task);

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
        const toolStep = await buildToolStep(stepIndex++, toolCall);
        messages.push(toolStep.toolMessage);
        yield toolStep.step;
      }

      continue;
    }

    if (assistant.value.message.content) {
      yield createStep({
        index: stepIndex++,
        type: "final",
        title: assistant.value.isMock ? "生成处理结论（Mock LLM）" : "生成处理结论",
        detail: assistant.value.message.content,
        durationMs: assistant.durationMs,
        toolName: assistant.value.model,
      });
      return;
    }

    throw new Error("LLM returned neither tool calls nor final content.");
  }

  throw new Error(`LLM tool calling loop exceeded ${MAX_TOOL_LOOP_TURNS} turns.`);
}

async function collectAgentSteps(task: string) {
  const steps: AgentStep[] = [];

  for await (const step of buildAgentSteps(task)) {
    steps.push(step);
  }

  return steps;
}

/** 一次性执行 Agent 任务，返回完整 run，主要用于非流式接口和测试。 */
export async function runAgentTask(task: string): Promise<AgentRun> {
  const run = createRun(task, "running");

  try {
    run.steps = await collectAgentSteps(task);
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
    for await (const step of buildAgentSteps(task)) {
      await wait(STEP_DELAY_MS);
      run.steps.push(step);
      yield {
        kind: "step",
        step,
      };
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
