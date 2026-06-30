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
