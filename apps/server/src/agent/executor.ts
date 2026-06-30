import type { AgentRun, AgentRunEvent, AgentStep } from "@agentflow/shared";
import { generateText } from "../llm/provider.js";
import { buildFinalPrompt, buildPlanPrompt } from "../llm/prompts.js";
import { getCustomer, getTicket, searchPolicy } from "../tools/sandboxTools.js";

const STEP_DELAY_MS = 250;

/** 在 Demo 中制造轻微延迟，让前端能看到时间线逐步出现。 */
function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 创建一次 Agent 运行记录，后续 step 会不断追加到这条 run 上。 */
function createRun(task: string, status: AgentRun["status"], steps: AgentStep[] = []): AgentRun {
  return {
    id: `run-${Date.now()}`,
    task,
    status,
    steps,
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
async function measureStep<T>(action: () => Promise<T>) {
  const startedAt = Date.now();
  const value = await action();

  return {
    value,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * 构建当前 Demo 的完整执行步骤。
 * 第一版先让 LLM 负责生成计划和最终结论，工具调用仍由后端固定编排。
 */
async function buildAgentSteps(task: string): Promise<AgentStep[]> {
  const steps: AgentStep[] = [];

  const planPrompt = buildPlanPrompt(task);
  const plan = await measureStep(() =>
    generateText({
      ...planPrompt,
      temperature: 0.2,
    }),
  );

  steps.push(
    createStep({
      index: steps.length + 1,
      type: "plan",
      title: plan.value.isMock ? "生成处理计划（Mock LLM）" : "生成处理计划",
      detail: plan.value.text,
      durationMs: plan.durationMs,
      toolName: plan.value.model,
    }),
  );

  const ticket = getTicket("T-1001");
  steps.push(
    createStep({
      index: steps.length + 1,
      type: "tool_call",
      title: "查询工单",
      detail: JSON.stringify(ticket, null, 2),
      durationMs: 42,
      toolName: "getTicket",
    }),
  );

  const customer = getCustomer(ticket.customerId);
  steps.push(
    createStep({
      index: steps.length + 1,
      type: "tool_call",
      title: "查询客户",
      detail: JSON.stringify(customer, null, 2),
      durationMs: 38,
      toolName: "getCustomer",
    }),
  );

  const policy = searchPolicy("refund");
  steps.push(
    createStep({
      index: steps.length + 1,
      type: "observation",
      title: "检索退款规则",
      detail: policy.content,
      durationMs: 55,
      toolName: "searchPolicy",
    }),
  );

  steps.push(
    createStep({
      index: steps.length + 1,
      type: "approval",
      title: "识别高风险操作",
      detail: "客户为 VIP，且退款动作会改变业务状态。当前版本先把该动作标记为需要人工审批，后续会接入 Human-in-the-loop。",
      durationMs: 24,
    }),
  );

  const finalPrompt = buildFinalPrompt({
    task,
    ticket,
    customer,
    policy,
  });
  const final = await measureStep(() =>
    generateText({
      ...finalPrompt,
      temperature: 0.2,
    }),
  );

  steps.push(
    createStep({
      index: steps.length + 1,
      type: "final",
      title: final.value.isMock ? "生成处理结论（Mock LLM）" : "生成处理结论",
      detail: final.value.text,
      durationMs: final.durationMs,
      toolName: final.value.model,
    }),
  );

  return steps;
}

/** 一次性执行 Agent 任务，返回完整 run，主要用于非流式接口和测试。 */
export async function runAgentTask(task: string): Promise<AgentRun> {
  return createRun(task, "completed", await buildAgentSteps(task));
}

/**
 * 流式执行 Agent 任务。
 * 通过 async generator 逐步 yield 事件，后端 SSE 路由会把这些事件实时写给前端。
 */
export async function* streamAgentTask(task: string): AsyncGenerator<AgentRunEvent> {
  const run = createRun(task, "running");

  // 第一条事件先让前端拿到 runId，后续 step 事件可以持续追加到同一次运行中。
  yield {
    kind: "run_started",
    run,
  };

  for (const step of await buildAgentSteps(task)) {
    await wait(STEP_DELAY_MS);
    run.steps.push(step);
    // 每个步骤独立推送，前端可以实时渲染时间线，而不是等待整个任务完成。
    yield {
      kind: "step",
      step,
    };
  }

  run.status = "completed";

  // 最终快照用于前端校准状态，避免中途遗漏事件导致 UI 和后端结果不一致。
  yield {
    kind: "run_completed",
    run,
  };
}
