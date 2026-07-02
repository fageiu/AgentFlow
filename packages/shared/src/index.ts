/** Agent 执行时间线中的步骤类型。 */
export type AgentStepType = "plan" | "tool_call" | "observation" | "approval" | "final";

export type ApprovalStatus = "pending" | "approved" | "rejected";

/** 高风险工具调用的人工审批请求，前后端通过它共享审批状态。 */
export interface ApprovalRequest {
  id: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  riskLevel: "high";
  input: unknown;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  reason?: string;
}

/** 单个执行步骤，前端会把它渲染成一张时间线卡片。 */
export interface AgentStep {
  id: string;
  type: AgentStepType;
  title: string;
  detail: string;
  durationMs?: number;
  toolName?: string;
  status?: "running" | "completed" | "failed";
  approvalRequest?: ApprovalRequest;
}

/** 一次 Agent 任务运行的完整快照。 */
export interface AgentRun {
  id: string;
  task: string;
  status: "running" | "waiting_approval" | "completed" | "failed";
  steps: AgentStep[];
  createdAt: string;
  completedAt?: string;
}

/** 历史运行列表使用的轻量摘要，避免列表接口一次性传回完整 trace 明细。 */
export interface AgentRunSummary {
  id: string;
  task: string;
  status: AgentRun["status"];
  stepCount: number;
  createdAt: string;
  completedAt?: string;
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
      kind: "approval_required";
      run: AgentRun;
      approval: ApprovalRequest;
      step: AgentStep;
    }
  | {
      kind: "approval_resolved";
      run: AgentRun;
      approval: ApprovalRequest;
    }
  | {
      kind: "run_completed";
      run: AgentRun;
    }
  | {
      kind: "error";
      message: string;
    };

export type TicketStatus = "open" | "waiting_approval" | "refunded" | "rejected" | "closed";
export type CustomerLevel = "standard" | "vip" | "enterprise";
export type OrderStatus = "paid" | "completed" | "cancelled";
export type RefundStatus = "none" | "pending_approval" | "created" | "rejected";

/** 沙箱工单数据，代表 Agent 可以读取和更新的业务对象。 */
export interface Ticket {
  id: string;
  customerId: string;
  orderId: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: "low" | "medium" | "high";
}

/** 沙箱客户数据，用于判断客户等级、风险和业务价值。 */
export interface Customer {
  id: string;
  name: string;
  level: CustomerLevel;
  riskScore: number;
  contractValue: number;
}

/** 沙箱订单数据，用于退款金额和订单状态判断。 */
export interface Order {
  id: string;
  customerId: string;
  amount: number;
  paidAt: string;
  completedAt: string;
  status: OrderStatus;
  refundStatus: RefundStatus;
}

/** 沙箱政策规则数据，后续可替换为 RAG 检索结果。 */
export interface Policy {
  id: string;
  keyword: string;
  title: string;
  content: string;
}

/** 沙箱退款记录，代表 Agent 工具产生的业务状态变更。 */
export interface Refund {
  id: string;
  orderId: string;
  amount: number;
  reason: string;
  status: RefundStatus;
  createdAt: string;
}

/** 前端沙箱状态面板消费的完整状态快照。 */
export interface SandboxState {
  tickets: Ticket[];
  customers: Customer[];
  orders: Order[];
  policies: Policy[];
  refunds: Refund[];
}
