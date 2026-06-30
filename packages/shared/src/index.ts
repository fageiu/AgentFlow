export type AgentStepType = "plan" | "tool_call" | "observation" | "approval" | "final";

export interface AgentStep {
  id: string;
  type: AgentStepType;
  title: string;
  detail: string;
  durationMs?: number;
  toolName?: string;
  status?: "running" | "completed" | "failed";
}

export interface AgentRun {
  id: string;
  task: string;
  status: "running" | "waiting_approval" | "completed" | "failed";
  steps: AgentStep[];
}

// 前后端共享同一组 SSE 事件类型，避免事件名和 payload 结构各写一套。
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
