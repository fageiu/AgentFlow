import type { AgentRun, AgentRunEvent, AgentStep } from "@agentflow/shared";
import { getCustomer, getTicket, searchPolicy } from "../tools/sandboxTools.js";

const STEP_DELAY_MS = 450;

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildDemoSteps(): AgentStep[] {
  const ticket = getTicket("T-1001");
  const customer = getCustomer(ticket.customerId);
  const policy = searchPolicy("refund");

  return [
    {
      id: "step-1",
      type: "plan",
      title: "生成处理计划",
      detail: "读取工单、查询客户资料、检索退款规则，判断是否需要人工审批。",
      durationMs: 128,
      status: "completed",
    },
    {
      id: "step-2",
      type: "tool_call",
      title: "查询工单",
      detail: JSON.stringify(ticket, null, 2),
      durationMs: 82,
      toolName: "getTicket",
      status: "completed",
    },
    {
      id: "step-3",
      type: "tool_call",
      title: "查询客户",
      detail: JSON.stringify(customer, null, 2),
      durationMs: 96,
      toolName: "getCustomer",
      status: "completed",
    },
    {
      id: "step-4",
      type: "observation",
      title: "检索退款规则",
      detail: policy.content,
      durationMs: 104,
      toolName: "searchPolicy",
      status: "completed",
    },
    {
      id: "step-5",
      type: "approval",
      title: "识别高风险操作",
      detail: "客户为 VIP，且退款动作会改变业务状态。当前 Demo 将其标记为需要人工确认的操作。",
      durationMs: 64,
      status: "completed",
    },
    {
      id: "step-6",
      type: "final",
      title: "生成处理结论",
      detail: "建议进入人工审批后创建退款单，并将工单状态更新为 waiting_approval。",
      durationMs: 142,
      status: "completed",
    },
  ];
}

function createRun(task: string, status: AgentRun["status"], steps: AgentStep[] = []): AgentRun {
  return {
    id: `run-${Date.now()}`,
    task,
    status,
    steps,
  };
}

export async function runAgentTask(task: string): Promise<AgentRun> {
  return createRun(task, "completed", buildDemoSteps());
}

export async function* streamAgentTask(task: string): AsyncGenerator<AgentRunEvent> {
  const run = createRun(task, "running");

  yield {
    kind: "run_started",
    run,
  };

  for (const step of buildDemoSteps()) {
    await wait(STEP_DELAY_MS);
    run.steps.push(step);
    yield {
      kind: "step",
      step,
    };
  }

  run.status = "completed";

  yield {
    kind: "run_completed",
    run,
  };
}
