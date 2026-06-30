/** Agent 执行时间线中的步骤类型。 */
export type AgentStepType = "plan" | "tool_call" | "observation" | "approval" | "final";

/** 单个执行步骤，前端会把它渲染成一张时间线卡片。 */
export interface AgentStep {
  id: string;
  type: AgentStepType;
  title: string;
  detail: string;
  durationMs?: number;
  toolName?: string;
  status?: "running" | "completed" | "failed";
}

/** 一次 Agent 任务运行的完整快照。 */
export interface AgentRun {
  id: string;
  task: string;
  status: "running" | "waiting_approval" | "completed" | "failed";
  steps: AgentStep[];
}

/** 前后端共享的 SSE 事件契约，避免事件名和 payload 结构各写一套。 */
export type AgentRunEvent =
  | {
      kind: "run_started";
      run: AgentRun;
    }
  | {
      kind: "step";
      step: AgentStep;
    }
  | {
      kind: "run_completed";
      run: AgentRun;
    }
  | {
      kind: "error";
      message: string;
    };
