/** Agent 执行时间线中的步骤类型。 */
export type AgentStepType = "plan" | "tool_call" | "observation" | "approval" | "final";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface LlmTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentRunMetrics {
  llmCallCount: number;
  toolCallCount: number;
  fallbackCount: number;
  modelNames: string[];
  tokenUsage: LlmTokenUsage;
}

/** Planner 产出的单个可执行步骤；allowedTools 是 Executor 的最小工具授权边界。 */
export interface AgentPlanStep {
  id: string;
  title: string;
  objective: string;
  allowedTools: string[];
  requiresApproval?: boolean;
}

/** 一次运行使用的结构化处理计划，会随 trace 一起保存以便审计与恢复。 */
export interface AgentPlan {
  version: 1;
  summary: string;
  steps: AgentPlanStep[];
}

export interface AgentErrorInfo {
  code: string;
  category: "business" | "tool" | "llm" | "system";
  message: string;
  userMessage: string;
  detailMessage?: string;
  suggestion?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

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
  modelName?: string;
  tokenUsage?: LlmTokenUsage;
  fallback?: {
    provider: string;
    model: string;
    reason: string;
  };
  status?: "running" | "completed" | "failed" | "cancelled";
  approvalRequest?: ApprovalRequest;
}

/** 一次 Agent 任务运行的完整快照。 */
export interface AgentRun {
  id: string;
  task: string;
  status: "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  steps: AgentStep[];
  plan?: AgentPlan;
  createdAt: string;
  completedAt?: string;
  metrics?: AgentRunMetrics;
  error?: AgentErrorInfo;
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

/** 会话消息角色，目前只区分用户输入和 Agent 回复。 */
export type ConversationMessageRole = "user" | "assistant";

/** 会话消息展示状态，assistant 消息会跟随对应 AgentRun 的执行状态变化。 */
export type ConversationMessageStatus = AgentRun["status"] | "idle";

/** 可持久化的会话消息；assistant 消息可以携带所属 AgentRun 和嵌入式 trace。 */
export interface ConversationMessage {
  id: string;
  role: ConversationMessageRole;
  content: string;
  createdAt: string;
  run?: AgentRun;
  steps?: AgentStep[];
  status?: ConversationMessageStatus;
  errorMessage?: string;
}

/** 可恢复的工作台会话，包含多轮消息以及消息下方嵌入的执行 trace。 */
export interface ConversationSession {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
  activeRunId?: string;
}

/** 左侧会话列表使用的轻量摘要，避免列表接口返回完整消息和 trace。 */
export interface ConversationSessionSummary {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  activeRunId?: string;
  lastMessagePreview?: string;
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
  /** run 被用户取消后发出，前端据此关闭执行态并展示可重试提示。 */
  | {
      kind: "run_cancelled";
      run: AgentRun;
    }
  | {
      kind: "error";
      message: string;
      error?: AgentErrorInfo;
      run?: AgentRun;
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

export type EvaluationCaseGroup = "refund" | "approval" | "knowledge" | "query" | "safety" | "idempotency";

export type EvaluationCaseStatus = "passed" | "failed" | "error";

export type EvaluationRegressionStatus = "new" | "unchanged_passed" | "unchanged_failed" | "regressed" | "recovered";

export interface EvaluationExpectations {
  requiredTools?: string[];
  forbiddenTools?: string[];
  toolCallCounts?: Array<{
    toolName: string;
    count: number;
  }>;
  minimumToolCallCounts?: Array<{
    toolName: string;
    count: number;
  }>;
  requiresApproval?: boolean;
  requiresPlan?: boolean;
  runStatus?: AgentRun["status"];
  errorMessageIncludes?: string[];
  errorCode?: string;
  finalMessageIncludes?: string[];
  finalMessageExcludes?: string[];
  ticketStatus?: {
    ticketId: string;
    status: TicketStatus;
  };
  orderRefundStatus?: {
    orderId: string;
    status: RefundStatus;
  };
  refundCount?: {
    orderId: string;
    count: number;
  };
  totalRefundCount?: number;
}

/** 评测用例描述一次可重复执行的 Agent 任务和 deterministic judge 断言。 */
export interface EvaluationCase {
  id: string;
  group: EvaluationCaseGroup;
  groupLabel: string;
  title: string;
  description: string;
  task: string;
  /** 非流式评测无法等待真实用户输入，因此可显式模拟高风险调用的审批结论。 */
  approvalMode?: "approve" | "reject";
  repeat?: number;
  expectations: EvaluationExpectations;
}

export interface EvaluationAssertionResult {
  id: string;
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
  diagnosis: string;
}

export interface EvaluationCaseResult {
  caseId: string;
  group: EvaluationCaseGroup;
  groupLabel: string;
  title: string;
  task: string;
  status: EvaluationCaseStatus;
  runId?: string;
  runStatus?: AgentRun["status"];
  durationMs: number;
  assertions: EvaluationAssertionResult[];
  failedAssertionCount: number;
  toolNames: string[];
  executedToolNames: string[];
  toolCallCount: number;
  tokenUsage: LlmTokenUsage;
  modelNames: string[];
  approvalRequired: boolean;
  previousStatus?: EvaluationCaseStatus;
  regressionStatus: EvaluationRegressionStatus;
  errorMessage?: string;
}

export interface EvaluationGroupSummary {
  group: EvaluationCaseGroup;
  label: string;
  total: number;
  passed: number;
  failed: number;
  error: number;
}

export interface EvaluationRunSummary {
  total: number;
  passed: number;
  failed: number;
  error: number;
  durationMs: number;
  averageDurationMs: number;
  averageToolCallCount: number;
  totalToolCallCount: number;
  averageTokenCount: number;
  totalTokenCount: number;
  modelNames: string[];
  failureReasons: string[];
  regressed: number;
  recovered: number;
  unchanged: number;
  newCases: number;
}

export interface EvaluationRegressionItem {
  caseId: string;
  title: string;
  previousStatus?: EvaluationCaseStatus;
  currentStatus: EvaluationCaseStatus;
  regressionStatus: EvaluationRegressionStatus;
}

export interface EvaluationRegressionSummary {
  comparedWithRunId?: string;
  regressed: EvaluationRegressionItem[];
  recovered: EvaluationRegressionItem[];
  unchanged: EvaluationRegressionItem[];
  newCases: EvaluationRegressionItem[];
}

export interface EvaluationRunConfig {
  provider: string;
  model: string;
  promptVersion: string;
  mock: boolean;
}

/** 一次批量评测运行，包含所有 case 的评分结果和可追溯 runId。 */
export interface EvaluationRun {
  id: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  config: EvaluationRunConfig;
  summary: EvaluationRunSummary;
  groupSummaries: EvaluationGroupSummary[];
  regression: EvaluationRegressionSummary;
  results: EvaluationCaseResult[];
}
