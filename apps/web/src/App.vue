<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunSummary,
  ConversationMessage,
  ConversationSession,
  ConversationSessionSummary,
  EvaluationCase,
  EvaluationRun,
  SandboxState,
} from "@agentflow/shared";

type UiStatus = AgentRun["status"] | "idle";
type EvaluationGroupFilter = EvaluationCase["group"] | "all";

const API_BASE_URL = "http://127.0.0.1:3001";
const sampleTask = "处理工单 T-1001：判断客户是否符合退款规则，必要时创建退款并更新工单状态。";

const draft = ref(sampleTask);
const messages = ref<ConversationMessage[]>([]);
const activeAssistantMessageId = ref("");
const focusedTask = ref(sampleTask);
const sandboxState = ref<SandboxState>();
const baselineState = ref<SandboxState>();
const stateError = ref("");
const conversations = ref<ConversationSessionSummary[]>([]);
const activeConversationId = ref("");
const conversationError = ref("");
const runHistory = ref<AgentRunSummary[]>([]);
const historyError = ref("");
const evaluationCases = ref<EvaluationCase[]>([]);
const evaluationRuns = ref<EvaluationRun[]>([]);
const evaluationError = ref("");
const isRunningEvaluation = ref(false);
const selectedEvaluationGroup = ref<EvaluationGroupFilter>("all");
const selectedEvaluationCaseId = ref("");
const selectedEvaluationRunId = ref("");
const resolvingApproval = ref(false);
const cancellingRun = ref(false);
const deletingConversationId = ref("");
const conversationEl = ref<HTMLElement>();
const composerInput = ref<HTMLTextAreaElement>();
let eventSource: EventSource | undefined;

const activeAssistantMessage = computed(() =>
  messages.value.find((message) => message.id === activeAssistantMessageId.value && message.role === "assistant"),
);
const activeRun = computed(() => activeAssistantMessage.value?.run);
const activeSteps = computed(() => activeAssistantMessage.value?.steps ?? []);
const status = computed<UiStatus>(() => activeAssistantMessage.value?.status ?? "idle");
const isRunning = computed(() => status.value === "running");
const isBusy = computed(() => status.value === "running" || status.value === "waiting_approval");
const canRetryLastTask = computed(() => messages.value.some((message) => message.role === "user") && !isBusy.value);
const requestedTicketId = computed(() => extractTicketId(focusedTask.value) ?? "T-1001");
const targetTicket = computed(() => sandboxState.value?.tickets.find((ticket) => ticket.id === requestedTicketId.value));
const targetOrder = computed(() => sandboxState.value?.orders.find((order) => order.id === targetTicket.value?.orderId));
const targetCustomer = computed(() =>
  sandboxState.value?.customers.find((customer) => customer.id === targetTicket.value?.customerId),
);
const targetRefunds = computed(() =>
  targetOrder.value ? sandboxState.value?.refunds.filter((refund) => refund.orderId === targetOrder.value?.id) ?? [] : [],
);
const latestRefund = computed(() => targetRefunds.value.at(-1));
const matchedPolicy = computed(() => sandboxState.value?.policies.find((policy) => policy.keyword === "refund"));
const latestEvaluationRun = computed(() => evaluationRuns.value[0]);
const activeEvaluationRun = computed(() =>
  evaluationRuns.value.find((run) => run.id === selectedEvaluationRunId.value) ?? latestEvaluationRun.value,
);
const previousEvaluationRun = computed(() => {
  const activeIndex = evaluationRuns.value.findIndex((run) => run.id === activeEvaluationRun.value?.id);

  return activeIndex >= 0 ? evaluationRuns.value[activeIndex + 1] : undefined;
});
const evaluationGroups = computed(() => {
  const groups = new Map<EvaluationCase["group"], string>();

  for (const evaluationCase of evaluationCases.value) {
    groups.set(evaluationCase.group, evaluationCase.groupLabel);
  }

  return [...groups.entries()].map(([value, label]) => ({
    value,
    label,
    count: evaluationCases.value.filter((evaluationCase) => evaluationCase.group === value).length,
  }));
});
const filteredEvaluationCases = computed(() =>
  selectedEvaluationGroup.value === "all"
    ? evaluationCases.value
    : evaluationCases.value.filter((evaluationCase) => evaluationCase.group === selectedEvaluationGroup.value),
);
const filteredEvaluationResults = computed(() => {
  const results = activeEvaluationRun.value?.results ?? [];

  return selectedEvaluationGroup.value === "all"
    ? results
    : results.filter((result) => result.group === selectedEvaluationGroup.value);
});
const selectedEvaluationResult = computed(() =>
  filteredEvaluationResults.value.find((result) => result.caseId === selectedEvaluationCaseId.value)
    ?? filteredEvaluationResults.value.find((result) => result.status !== "passed")
    ?? filteredEvaluationResults.value[0],
);
const activeEvaluationGroupSummary = computed(() => {
  if (!activeEvaluationRun.value) {
    return undefined;
  }

  if (selectedEvaluationGroup.value === "all") {
    return activeEvaluationRun.value.summary;
  }

  return activeEvaluationRun.value.groupSummaries.find((summary) => summary.group === selectedEvaluationGroup.value);
});
const selectedEvaluationCaseIds = computed(() => filteredEvaluationCases.value.map((evaluationCase) => evaluationCase.id));

const statusLabel = computed(() => {
  const labels: Record<UiStatus, string> = {
    idle: "待执行",
    running: "执行中",
    waiting_approval: "待审批",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };

  return labels[status.value];
});

function getStatusLabel(value: UiStatus | undefined) {
  const labels: Record<UiStatus, string> = {
    idle: "待执行",
    running: "执行中",
    waiting_approval: "待审批",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };

  return labels[value ?? "idle"];
}

function getEvaluationStatusLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    passed: "通过",
    failed: "失败",
    error: "错误",
    running: "运行中",
    completed: "已完成",
    new: "新增",
    regressed: "回退",
    recovered: "恢复",
    unchanged_passed: "保持通过",
    unchanged_failed: "保持失败",
  };

  return labels[value ?? ""] ?? value ?? "未知";
}

function getEvaluationCase(caseId: string) {
  return evaluationCases.value.find((evaluationCase) => evaluationCase.id === caseId);
}

function getResultForCase(caseId: string) {
  return activeEvaluationRun.value?.results.find((result) => result.caseId === caseId);
}

function setEvaluationGroup(group: EvaluationGroupFilter) {
  selectedEvaluationGroup.value = group;
  selectedEvaluationCaseId.value = "";
}

function selectEvaluationResult(caseId: string) {
  selectedEvaluationCaseId.value = caseId;
}

function formatDuration(value: number | undefined) {
  if (value == null) {
    return "-";
  }

  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function formatCount(value: number | undefined) {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatRunTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function closeStream() {
  eventSource?.close();
  eventSource = undefined;
}

function cloneState(state: SandboxState | undefined) {
  return state ? JSON.parse(JSON.stringify(state)) as SandboxState : undefined;
}

function extractTicketId(value: string) {
  return value.match(/T-\d+/i)?.[0].toUpperCase();
}

function scrollConversationToBottom() {
  void nextTick(() => {
    if (conversationEl.value) {
      conversationEl.value.scrollTop = conversationEl.value.scrollHeight;
    }
  });
}

function focusComposer() {
  void nextTick(() => composerInput.value?.focus());
}

function resetConversationWorkspace() {
  closeStream();
  activeConversationId.value = "";
  messages.value = [];
  activeAssistantMessageId.value = "";
  draft.value = sampleTask;
  baselineState.value = undefined;
}

function updateActiveAssistant(update: (message: ConversationMessage) => ConversationMessage) {
  messages.value = messages.value.map((message) =>
    message.id === activeAssistantMessageId.value && message.role === "assistant" ? update(message) : message,
  );
}

async function refreshSandboxState() {
  try {
    stateError.value = "";
    const response = await fetch(`${API_BASE_URL}/sandbox/state`);

    if (!response.ok) {
      throw new Error(`Sandbox state request failed: ${response.status}`);
    }

    sandboxState.value = await response.json() as SandboxState;
  } catch (error) {
    stateError.value = error instanceof Error ? error.message : "沙箱状态获取失败";
  }
}

async function refreshRunHistory() {
  try {
    historyError.value = "";
    const response = await fetch(`${API_BASE_URL}/agent/runs`);

    if (!response.ok) {
      throw new Error(`Run history request failed: ${response.status}`);
    }

    runHistory.value = await response.json() as AgentRunSummary[];
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : "运行历史获取失败";
  }
}

async function loadRunFromHistory(historyRunId: string) {
  try {
    historyError.value = "";
    closeStream();

    const response = await fetch(`${API_BASE_URL}/agent/runs/${historyRunId}`);

    if (!response.ok) {
      throw new Error(`Run detail request failed: ${response.status}`);
    }

    const run = await response.json() as AgentRun;
    const userMessage: ConversationMessage = {
      id: createMessageId("user-history"),
      role: "user",
      content: run.task,
      createdAt: run.createdAt,
    };
    const assistantMessage: ConversationMessage = {
      id: createMessageId("assistant-history"),
      role: "assistant",
      content: "已从运行历史恢复这次 Agent 执行。",
      createdAt: run.completedAt ?? run.createdAt,
      run,
      steps: run.steps,
      status: run.status,
    };

    focusedTask.value = run.task;
    draft.value = run.task;
    activeAssistantMessageId.value = assistantMessage.id;
    baselineState.value = undefined;
    messages.value = [...messages.value, userMessage, assistantMessage];
    scrollConversationToBottom();
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : "运行历史读取失败";
  }
}

async function clearRunHistory() {
  try {
    historyError.value = "";
    const response = await fetch(`${API_BASE_URL}/agent/runs`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`Run history clear request failed: ${response.status}`);
    }

    runHistory.value = [];
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : "运行历史清空失败";
  }
}

async function refreshEvaluationCases() {
  try {
    evaluationError.value = "";
    const response = await fetch(`${API_BASE_URL}/eval/cases`);

    if (!response.ok) {
      throw new Error(`Evaluation cases request failed: ${response.status}`);
    }

    evaluationCases.value = await response.json() as EvaluationCase[];
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : "评测用例获取失败";
  }
}

async function refreshEvaluationRuns() {
  try {
    evaluationError.value = "";
    const response = await fetch(`${API_BASE_URL}/eval/runs`);

    if (!response.ok) {
      throw new Error(`Evaluation runs request failed: ${response.status}`);
    }

    evaluationRuns.value = await response.json() as EvaluationRun[];
    selectedEvaluationRunId.value = evaluationRuns.value.some((run) => run.id === selectedEvaluationRunId.value)
      ? selectedEvaluationRunId.value
      : evaluationRuns.value[0]?.id ?? "";
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : "评测结果获取失败";
  }
}

async function runEvaluations() {
  try {
    evaluationError.value = "";
    isRunningEvaluation.value = true;
    const response = await fetch(`${API_BASE_URL}/eval/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        selectedEvaluationGroup.value === "all"
          ? {}
          : {
              caseIds: selectedEvaluationCaseIds.value,
            },
      ),
    });

    if (!response.ok) {
      throw new Error(`Evaluation run request failed: ${response.status}`);
    }

    const evaluationRun = await response.json() as EvaluationRun;
    evaluationRuns.value = [evaluationRun, ...evaluationRuns.value.filter((run) => run.id !== evaluationRun.id)];
    selectedEvaluationRunId.value = evaluationRun.id;
    selectedEvaluationCaseId.value =
      evaluationRun.results.find((result) => result.status !== "passed")?.caseId ?? evaluationRun.results[0]?.caseId ?? "";
    await refreshSandboxState();
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : "评测运行失败";
  } finally {
    isRunningEvaluation.value = false;
  }
}

async function refreshConversations() {
  try {
    conversationError.value = "";
    const response = await fetch(`${API_BASE_URL}/agent/conversations`);

    if (!response.ok) {
      throw new Error(`Conversation list request failed: ${response.status}`);
    }

    conversations.value = await response.json() as ConversationSessionSummary[];
  } catch (error) {
    conversationError.value = error instanceof Error ? error.message : "会话列表获取失败";
  }
}

function selectLatestAssistantMessage(session: ConversationSession) {
  return [...session.messages].reverse().find((message) => message.role === "assistant")?.id ?? "";
}

function normalizeRestoredMessages(session: ConversationSession) {
  return session.messages.map((message) => {
    if (message.role !== "assistant" || message.status !== "running") {
      return message;
    }

    return {
      ...message,
      status: "failed" as const,
      errorMessage: "执行连接已断开，请重试上一条任务。",
    };
  });
}

async function loadConversation(conversationId: string) {
  try {
    conversationError.value = "";
    closeStream();

    const response = await fetch(`${API_BASE_URL}/agent/conversations/${conversationId}`);

    if (!response.ok) {
      throw new Error(`Conversation detail request failed: ${response.status}`);
    }

    const session = await response.json() as ConversationSession;
    activeConversationId.value = session.id;
    messages.value = normalizeRestoredMessages(session);
    activeAssistantMessageId.value = selectLatestAssistantMessage(session);
    focusedTask.value = [...session.messages].reverse().find((message) => message.role === "user")?.content ?? sampleTask;
    draft.value = "";
    baselineState.value = undefined;
    scrollConversationToBottom();
  } catch (error) {
    conversationError.value = error instanceof Error ? error.message : "会话读取失败";
  }
}

async function createNewConversation() {
  try {
    conversationError.value = "";

    if (isBusy.value) {
      conversationError.value = "当前任务仍在执行，请完成或取消后再新建会话。";
      return;
    }

    if (activeConversationId.value && messages.value.length === 0) {
      focusComposer();
      return;
    }

    const reusableEmptyConversation = conversations.value.find((conversation) => conversation.messageCount === 0);

    if (reusableEmptyConversation) {
      await loadConversation(reusableEmptyConversation.id);
      focusComposer();
      return;
    }

    closeStream();

    const response = await fetch(`${API_BASE_URL}/agent/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "新会话" }),
    });

    if (!response.ok) {
      throw new Error(`Conversation create request failed: ${response.status}`);
    }

    const session = await response.json() as ConversationSession;
    activeConversationId.value = session.id;
    messages.value = [];
    activeAssistantMessageId.value = "";
    draft.value = sampleTask;
    baselineState.value = undefined;
    await refreshConversations();
    focusComposer();
  } catch (error) {
    conversationError.value = error instanceof Error ? error.message : "会话创建失败";
  }
}

function isConversationDeleting(conversationId: string) {
  return deletingConversationId.value === conversationId;
}

function getConversationDeleteDisabled(conversation: ConversationSessionSummary) {
  return Boolean(conversation.activeRunId) || isConversationDeleting(conversation.id) || (
    conversation.id === activeConversationId.value && isBusy.value
  );
}

async function deleteConversationItem(conversationId: string) {
  if (deletingConversationId.value) {
    return;
  }

  try {
    conversationError.value = "";
    deletingConversationId.value = conversationId;

    const response = await fetch(`${API_BASE_URL}/agent/conversations/${conversationId}`, {
      method: "DELETE",
    });

    if (response.status === 409) {
      throw new Error("该会话仍有任务在执行，请完成或取消后再删除。");
    }

    if (!response.ok) {
      throw new Error(`Conversation delete request failed: ${response.status}`);
    }

    const wasActiveConversation = activeConversationId.value === conversationId;
    await refreshConversations();

    if (!wasActiveConversation) {
      return;
    }

    const nextConversation = conversations.value[0];

    if (nextConversation) {
      await loadConversation(nextConversation.id);
    } else {
      resetConversationWorkspace();
      focusComposer();
    }
  } catch (error) {
    conversationError.value = error instanceof Error ? error.message : "会话删除失败";
  } finally {
    deletingConversationId.value = "";
  }
}

async function ensureConversation() {
  if (activeConversationId.value) {
    return activeConversationId.value;
  }

  const response = await fetch(`${API_BASE_URL}/agent/conversations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "新会话" }),
  });

  if (!response.ok) {
    throw new Error(`Conversation create request failed: ${response.status}`);
  }

  const session = await response.json() as ConversationSession;
  activeConversationId.value = session.id;
  await refreshConversations();
  return session.id;
}

function updateApprovalStep(payload: Extract<AgentRunEvent, { kind: "approval_resolved" }>) {
  updateActiveAssistant((message) => ({
    ...message,
    run: payload.run,
    status: payload.run.status,
    steps: (message.steps ?? []).map((step) => {
      if (step.approvalRequest?.id !== payload.approval.id) {
        return step;
      }

      return {
        ...step,
        approvalRequest: payload.approval,
        detail: JSON.stringify(
          {
            approvalId: payload.approval.id,
            toolCallId: payload.approval.toolCallId,
            riskLevel: payload.approval.riskLevel,
            status: payload.approval.status,
            input: payload.approval.input,
            reason: payload.approval.reason,
          },
          null,
          2,
        ),
        status: payload.approval.status === "approved" ? "completed" : "failed",
      };
    }),
  }));
}

async function resolveApproval(action: "approve" | "reject", messageId: string) {
  const targetMessage = messages.value.find((message) => message.id === messageId && message.role === "assistant");
  const targetRunId = targetMessage?.run?.id;

  if (!targetRunId || resolvingApproval.value) {
    return;
  }

  try {
    resolvingApproval.value = true;
    activeAssistantMessageId.value = messageId;
    const response = await fetch(`${API_BASE_URL}/agent/runs/${targetRunId}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: action === "approve" ? "人工批准高风险工具调用。" : "人工拒绝高风险工具调用。",
      }),
    });

    if (!response.ok) {
      throw new Error(`Approval ${action} request failed: ${response.status}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "人工审批请求失败";
    messages.value = messages.value.map((message) =>
      message.id === messageId ? { ...message, errorMessage } : message,
    );
  } finally {
    resolvingApproval.value = false;
  }
}

async function cancelActiveRun() {
  const runId = activeRun.value?.id;

  if (!runId || cancellingRun.value) {
    return;
  }

  try {
    cancellingRun.value = true;
    const response = await fetch(`${API_BASE_URL}/agent/runs/${runId}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: "用户取消执行",
      }),
    });

    if (!response.ok) {
      throw new Error(`Run cancel request failed: ${response.status}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "取消执行失败";
    updateActiveAssistant((message) => ({
      ...message,
      errorMessage,
    }));
  } finally {
    cancellingRun.value = false;
  }
}

async function retryLastUserMessage() {
  const lastUserMessage = [...messages.value].reverse().find((message) => message.role === "user");

  if (!lastUserMessage || isBusy.value) {
    return;
  }

  draft.value = lastUserMessage.content;
  await sendMessage();
}

async function resetSandbox() {
  try {
    stateError.value = "";
    const response = await fetch(`${API_BASE_URL}/sandbox/reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    if (!response.ok) {
      throw new Error(`Sandbox reset request failed: ${response.status}`);
    }

    sandboxState.value = await response.json() as SandboxState;
    baselineState.value = undefined;
  } catch (error) {
    stateError.value = error instanceof Error ? error.message : "沙箱重置失败";
  }
}

function didChange(path: "ticket.status" | "order.refundStatus" | "refunds.length") {
  if (!baselineState.value || !sandboxState.value) {
    return false;
  }

  const beforeTicket = baselineState.value.tickets.find((ticket) => ticket.id === requestedTicketId.value);
  const beforeOrder = baselineState.value.orders.find((order) => order.id === beforeTicket?.orderId);

  if (path === "ticket.status") {
    return beforeTicket?.status !== targetTicket.value?.status;
  }

  if (path === "order.refundStatus") {
    return beforeOrder?.refundStatus !== targetOrder.value?.refundStatus;
  }

  const beforeRefundCount = beforeOrder
    ? baselineState.value.refunds.filter((refund) => refund.orderId === beforeOrder.id).length
    : 0;

  return beforeRefundCount !== targetRefunds.value.length;
}

function readEvent(event: Event): AgentRunEvent | undefined {
  const message = event as MessageEvent<string>;

  if (!message.data) {
    return undefined;
  }

  return JSON.parse(message.data) as AgentRunEvent;
}

async function applyRunEvent(event: Event) {
  const payload = readEvent(event);

  if (!payload) {
    return;
  }

  if (payload.kind === "run_started") {
    updateActiveAssistant((message) => ({
      ...message,
      run: payload.run,
      status: payload.run.status,
      steps: [],
      errorMessage: "",
    }));
    scrollConversationToBottom();
    return;
  }

  if (payload.kind === "step") {
    updateActiveAssistant((message) => ({
      ...message,
      steps: [...(message.steps ?? []), payload.step],
    }));
    scrollConversationToBottom();
    return;
  }

  if (payload.kind === "approval_required") {
    updateActiveAssistant((message) => ({
      ...message,
      run: payload.run,
      status: payload.run.status,
      steps: [...(message.steps ?? []), payload.step],
    }));
    scrollConversationToBottom();
    return;
  }

  if (payload.kind === "approval_resolved") {
    updateApprovalStep(payload);
    scrollConversationToBottom();
    return;
  }

  if (payload.kind === "run_completed") {
    updateActiveAssistant((message) => ({
      ...message,
      run: payload.run,
      status: payload.run.status,
      steps: payload.run.steps,
      content: "Agent 已完成本次任务。",
    }));
    closeStream();
    await refreshSandboxState();
    await refreshConversations();
    scrollConversationToBottom();
    return;
  }

  if (payload.kind === "run_cancelled") {
    updateActiveAssistant((message) => ({
      ...message,
      run: payload.run,
      status: payload.run.status,
      steps: payload.run.steps,
      content: "Agent 执行已取消。",
      errorMessage: "本次执行已取消，可重试上一条任务。",
    }));
    closeStream();
    await refreshSandboxState();
    await refreshConversations();
    scrollConversationToBottom();
    return;
  }

  updateActiveAssistant((message) => ({
    ...message,
    status: "failed",
    errorMessage: payload.message,
  }));
  closeStream();
}

async function sendMessage() {
  const nextTask = draft.value.trim();

  if (!nextTask || isBusy.value) {
    return;
  }

  closeStream();
  const conversationId = await ensureConversation();
  await refreshSandboxState();
  baselineState.value = cloneState(sandboxState.value);
  focusedTask.value = nextTask;

  const userMessage: ConversationMessage = {
    id: createMessageId("user"),
    role: "user",
    content: nextTask,
    createdAt: new Date().toISOString(),
  };
  const assistantMessage: ConversationMessage = {
    id: createMessageId("assistant"),
    role: "assistant",
    content: "正在执行 Agent 任务...",
    createdAt: new Date().toISOString(),
    steps: [],
    status: "running",
  };

  messages.value = [...messages.value, userMessage, assistantMessage];
  activeAssistantMessageId.value = assistantMessage.id;
  draft.value = "";
  scrollConversationToBottom();

  const url = new URL(`${API_BASE_URL}/agent/run/stream`);
  url.searchParams.set("task", nextTask);
  url.searchParams.set("conversationId", conversationId);
  url.searchParams.set("userMessageId", userMessage.id);
  url.searchParams.set("assistantMessageId", assistantMessage.id);
  eventSource = new EventSource(url);

  eventSource.addEventListener("run_started", applyRunEvent);
  eventSource.addEventListener("step", applyRunEvent);
  eventSource.addEventListener("approval_required", applyRunEvent);
  eventSource.addEventListener("approval_resolved", applyRunEvent);
  eventSource.addEventListener("run_completed", applyRunEvent);
  eventSource.addEventListener("run_cancelled", applyRunEvent);
  eventSource.addEventListener("error", (event) => {
    const payload = readEvent(event);
    const errorMessage = payload?.kind === "error" ? payload.message : "执行流连接中断，请确认后端服务是否正在运行。";

    updateActiveAssistant((message) => ({
      ...message,
      status: "failed",
      errorMessage,
    }));
    closeStream();
  });
}

function handleComposerKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void sendMessage();
  }
}

onMounted(() => {
  void refreshSandboxState();
  void refreshEvaluationCases();
  void refreshEvaluationRuns();
  void (async () => {
    await refreshConversations();

    if (conversations.value[0]) {
      await loadConversation(conversations.value[0].id);
    }
  })();
});
onBeforeUnmount(closeStream);
</script>

<template>
  <main class="shell">
    <section class="task-panel">
      <div class="brand-block">
        <p class="eyebrow">AgentFlow Sandbox</p>
        <h1>企业工单处理 Agent 工作台</h1>
      </div>

      <dl class="run-meta">
        <div>
          <dt>状态</dt>
          <dd>{{ statusLabel }}</dd>
        </div>
        <div>
          <dt>Run ID</dt>
          <dd>{{ activeRun?.id || "未生成" }}</dd>
        </div>
      </dl>

      <section class="history-panel" aria-label="会话列表">
        <header class="history-header">
          <div>
            <p class="eyebrow muted">Conversations</p>
            <h2>会话</h2>
          </div>
          <div class="history-actions">
            <button class="ghost-button" type="button" @click="refreshConversations">刷新</button>
            <button class="ghost-button" type="button" @click="createNewConversation">新建</button>
          </div>
        </header>

        <p v-if="conversationError" class="error-text">{{ conversationError }}</p>

        <div v-else-if="conversations.length === 0" class="empty-state compact">暂无会话</div>

        <div v-else class="history-list">
          <div
            v-for="conversation in conversations"
            :key="conversation.id"
            class="history-item"
            :class="{ active: conversation.id === activeConversationId }"
          >
            <button class="history-select" type="button" @click="loadConversation(conversation.id)">
              <span class="history-task">{{ conversation.title }}</span>
              <span class="history-meta">
                {{ formatRunTime(conversation.updatedAt) }} · {{ conversation.messageCount }} messages
              </span>
            </button>
            <button
              class="ghost-button history-delete danger"
              type="button"
              :aria-label="`删除会话：${conversation.title}`"
              :disabled="getConversationDeleteDisabled(conversation)"
              :title="conversation.activeRunId ? '任务执行中，暂不能删除' : '删除会话'"
              @click="deleteConversationItem(conversation.id)"
            >
              {{ isConversationDeleting(conversation.id) ? "..." : "删" }}
            </button>
          </div>
        </div>
      </section>
    </section>

    <div class="content-stack">
      <section class="workspace conversation-workspace" aria-label="会话工作区">
        <header class="workspace-header">
          <div>
            <p class="eyebrow muted">Conversation Workspace</p>
            <h2>会话式执行工作台</h2>
          </div>
          <span class="status-pill" :class="`status-${status}`">{{ statusLabel }}</span>
        </header>

        <div ref="conversationEl" class="conversation-list">
          <div v-if="messages.length === 0" class="empty-state">
            发送一条任务开始会话。每条用户消息都会触发一次 Agent run，执行 trace 会挂在对应的 Agent 回复下方。
          </div>

          <article
            v-for="message in messages"
            :key="message.id"
            class="message-row"
            :class="`message-${message.role}`"
          >
            <div class="message-meta">
              <span>{{ message.role === "user" ? "你" : "Agent" }}</span>
              <span>{{ formatRunTime(message.createdAt) }}</span>
              <span
                v-if="message.role === 'assistant'"
                class="message-status"
                :class="`status-${message.status ?? 'idle'}`"
              >
                {{ getStatusLabel(message.status) }}
              </span>
            </div>
            <p class="message-content">{{ message.content }}</p>

            <p v-if="message.errorMessage" class="error-text">{{ message.errorMessage }}</p>

            <div v-if="message.role === 'assistant' && (message.steps?.length ?? 0) > 0" class="timeline embedded">
              <article
                v-for="(step, index) in message.steps"
                :key="step.id"
                class="step-card"
                :class="`step-${step.type}`"
              >
                <div class="step-index">{{ index + 1 }}</div>
                <div class="step-body">
                  <div class="step-header">
                    <div>
                      <span class="step-type">{{ step.type.replace("_", " ") }}</span>
                      <h3>{{ step.title }}</h3>
                    </div>
                    <span v-if="step.durationMs != null" class="duration">{{ step.durationMs }}ms</span>
                  </div>

                  <p v-if="step.toolName" class="tool-name">{{ step.toolName }}</p>
                  <pre>{{ step.detail }}</pre>

                  <div v-if="step.approvalRequest?.status === 'pending'" class="approval-actions">
                    <button
                      type="button"
                      class="approve-button"
                      :disabled="resolvingApproval"
                      @click="resolveApproval('approve', message.id)"
                    >
                      批准
                    </button>
                    <button
                      type="button"
                      class="reject-button"
                      :disabled="resolvingApproval"
                      @click="resolveApproval('reject', message.id)"
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </article>
        </div>

        <div class="composer">
          <textarea
            ref="composerInput"
            v-model="draft"
            aria-label="任务输入"
            placeholder="输入下一条任务，例如：处理工单 T-1001..."
            @keydown="handleComposerKeydown"
          />
          <div class="composer-actions">
            <button type="button" :disabled="isBusy || !draft.trim()" @click="sendMessage">
              {{ isRunning ? "执行中..." : status === "waiting_approval" ? "等待审批" : "发送" }}
            </button>
            <button
              class="ghost-button danger"
              type="button"
              :disabled="!isBusy || cancellingRun"
              @click="cancelActiveRun"
            >
              {{ cancellingRun ? "取消中" : "取消" }}
            </button>
            <button class="ghost-button" type="button" :disabled="!canRetryLastTask" @click="retryLastUserMessage">
              重试
            </button>
          </div>
        </div>
      </section>

      <section class="state-panel" aria-label="沙箱状态">
        <header class="workspace-header">
          <div>
            <p class="eyebrow muted">Sandbox State</p>
            <h2>业务状态面板</h2>
          </div>
          <div class="header-actions">
            <button class="ghost-button" type="button" @click="refreshSandboxState">刷新</button>
            <button class="ghost-button danger" type="button" @click="resetSandbox">重置沙箱</button>
          </div>
        </header>

        <p v-if="stateError" class="error-text">{{ stateError }}</p>

        <div v-else-if="!sandboxState" class="empty-state compact">正在读取沙箱状态。</div>

        <div v-else class="state-grid">
          <article class="state-card">
            <span class="state-label">工单</span>
            <h3>{{ targetTicket?.id }} · {{ targetTicket?.title }}</h3>
            <dl class="state-metrics">
              <div :class="{ changed: didChange('ticket.status') }">
                <dt>状态</dt>
                <dd>{{ targetTicket?.status }}</dd>
              </div>
              <div>
                <dt>优先级</dt>
                <dd>{{ targetTicket?.priority }}</dd>
              </div>
            </dl>
          </article>

          <article class="state-card">
            <span class="state-label">订单</span>
            <h3>{{ targetOrder?.id }} · ¥{{ targetOrder?.amount }}</h3>
            <dl class="state-metrics">
              <div>
                <dt>订单状态</dt>
                <dd>{{ targetOrder?.status }}</dd>
              </div>
              <div :class="{ changed: didChange('order.refundStatus') }">
                <dt>退款状态</dt>
                <dd>{{ targetOrder?.refundStatus }}</dd>
              </div>
            </dl>
          </article>

          <article class="state-card">
            <span class="state-label">客户</span>
            <h3>{{ targetCustomer?.name }}</h3>
            <dl class="state-metrics">
              <div>
                <dt>等级</dt>
                <dd>{{ targetCustomer?.level }}</dd>
              </div>
              <div>
                <dt>风险分</dt>
                <dd>{{ targetCustomer?.riskScore }}</dd>
              </div>
            </dl>
          </article>

          <article class="state-card">
            <span class="state-label">退款</span>
            <h3 :class="{ changedText: didChange('refunds.length') }">
              {{ latestRefund ? latestRefund.id : "暂无退款记录" }}
            </h3>
            <dl class="state-metrics">
              <div :class="{ changed: didChange('refunds.length') }">
                <dt>记录数</dt>
                <dd>{{ targetRefunds.length }}</dd>
              </div>
              <div>
                <dt>最新状态</dt>
                <dd>{{ latestRefund?.status || "none" }}</dd>
              </div>
            </dl>
          </article>

          <article class="state-card state-card-wide">
            <span class="state-label">命中规则</span>
            <h3>{{ matchedPolicy?.title }}</h3>
            <p>{{ matchedPolicy?.content }}</p>
          </article>
        </div>

        <section class="evaluation-panel" aria-label="评测系统">
          <header class="workspace-header compact">
            <div>
              <p class="eyebrow muted">Evaluation</p>
              <h2>评测系统</h2>
            </div>
            <div class="evaluation-actions">
              <button class="ghost-button" type="button" @click="refreshEvaluationRuns">刷新</button>
              <button class="ghost-button" type="button" :disabled="isRunningEvaluation" @click="runEvaluations">
                {{ isRunningEvaluation ? "评测中" : selectedEvaluationGroup === "all" ? "全量评测" : "运行本组" }}
              </button>
            </div>
          </header>

          <p v-if="evaluationError" class="error-text">{{ evaluationError }}</p>

          <div class="evaluation-filters" aria-label="评测分组">
            <button
              type="button"
              class="filter-chip"
              :class="{ active: selectedEvaluationGroup === 'all' }"
              @click="setEvaluationGroup('all')"
            >
              全部 <span>{{ evaluationCases.length }}</span>
            </button>
            <button
              v-for="group in evaluationGroups"
              :key="group.value"
              type="button"
              class="filter-chip"
              :class="{ active: selectedEvaluationGroup === group.value }"
              @click="setEvaluationGroup(group.value)"
            >
              {{ group.label }} <span>{{ group.count }}</span>
            </button>
          </div>

          <div v-if="activeEvaluationRun" class="evaluation-result">
            <div class="evaluation-run-bar">
              <label>
                <span>结果</span>
                <select v-model="selectedEvaluationRunId" aria-label="评测运行记录">
                  <option v-for="run in evaluationRuns.slice(0, 8)" :key="run.id" :value="run.id">
                    {{ formatRunTime(run.createdAt) }} · {{ run.config.model }} · {{ run.summary.passed }}/{{ run.summary.total }}
                  </option>
                </select>
              </label>
              <span class="duration">{{ formatDuration(activeEvaluationRun.summary.durationMs) }}</span>
            </div>

            <dl class="evaluation-summary">
              <div>
                <dt>通过</dt>
                <dd>{{ activeEvaluationGroupSummary?.passed ?? 0 }}</dd>
              </div>
              <div>
                <dt>失败</dt>
                <dd>{{ activeEvaluationGroupSummary?.failed ?? 0 }}</dd>
              </div>
              <div>
                <dt>错误</dt>
                <dd>{{ activeEvaluationGroupSummary?.error ?? 0 }}</dd>
              </div>
              <div>
                <dt>总数</dt>
                <dd>{{ activeEvaluationGroupSummary?.total ?? 0 }}</dd>
              </div>
            </dl>

            <dl class="evaluation-metrics">
              <div>
                <dt>平均耗时</dt>
                <dd>{{ formatDuration(activeEvaluationRun.summary.averageDurationMs) }}</dd>
              </div>
              <div>
                <dt>平均工具</dt>
                <dd>{{ activeEvaluationRun.summary.averageToolCallCount }}</dd>
              </div>
              <div>
                <dt>平均 Token</dt>
                <dd>{{ formatCount(activeEvaluationRun.summary.averageTokenCount) }}</dd>
              </div>
              <div>
                <dt>总 Token</dt>
                <dd>{{ formatCount(activeEvaluationRun.summary.totalTokenCount) }}</dd>
              </div>
            </dl>

            <div class="evaluation-config">
              <span>{{ activeEvaluationRun.config.provider }}</span>
              <span>{{ activeEvaluationRun.config.model }}</span>
              <span>{{ activeEvaluationRun.config.promptVersion }}</span>
              <span>{{ activeEvaluationRun.config.mock ? "Mock" : "Real" }}</span>
            </div>

            <div class="regression-strip">
              <span :class="{ hot: activeEvaluationRun.summary.regressed > 0 }">
                回退 {{ activeEvaluationRun.summary.regressed }}
              </span>
              <span>恢复 {{ activeEvaluationRun.summary.recovered }}</span>
              <span>新增 {{ activeEvaluationRun.summary.newCases }}</span>
              <small v-if="previousEvaluationRun">对比 {{ formatRunTime(previousEvaluationRun.createdAt) }}</small>
              <small v-else>暂无上一轮基线</small>
            </div>

            <div v-if="activeEvaluationRun.summary.failureReasons.length" class="failure-reasons">
              <span class="state-label">失败原因</span>
              <p v-for="reason in activeEvaluationRun.summary.failureReasons.slice(0, 3)" :key="reason">
                {{ reason }}
              </p>
            </div>

            <div class="evaluation-case-list">
              <button
                v-for="evaluationCase in filteredEvaluationCases"
                :key="evaluationCase.id"
                type="button"
                class="evaluation-case-row"
                :class="[
                  getResultForCase(evaluationCase.id) ? `eval-${getResultForCase(evaluationCase.id)?.status}` : '',
                  { active: selectedEvaluationResult?.caseId === evaluationCase.id },
                ]"
                @click="selectEvaluationResult(evaluationCase.id)"
              >
                <div>
                  <span class="state-label">{{ evaluationCase.id }}</span>
                  <strong>{{ evaluationCase.title }}</strong>
                </div>
                <span class="case-status" :class="`eval-text-${getResultForCase(evaluationCase.id)?.status ?? 'pending'}`">
                  {{ getEvaluationStatusLabel(getResultForCase(evaluationCase.id)?.status) }}
                </span>
              </button>
            </div>

            <article v-if="selectedEvaluationResult" class="evaluation-detail">
              <div class="step-header">
                <div>
                  <span class="step-type">{{ selectedEvaluationResult.groupLabel }}</span>
                  <h3>{{ selectedEvaluationResult.title }}</h3>
                </div>
                <span class="case-status" :class="`eval-text-${selectedEvaluationResult.status}`">
                  {{ getEvaluationStatusLabel(selectedEvaluationResult.status) }}
                </span>
              </div>

              <p>{{ getEvaluationCase(selectedEvaluationResult.caseId)?.description }}</p>

              <dl class="evaluation-detail-meta">
                <div>
                  <dt>Run</dt>
                  <dd>{{ selectedEvaluationResult.runId || "未生成" }}</dd>
                </div>
                <div>
                  <dt>耗时</dt>
                  <dd>{{ formatDuration(selectedEvaluationResult.durationMs) }}</dd>
                </div>
                <div>
                  <dt>回归</dt>
                  <dd>{{ getEvaluationStatusLabel(selectedEvaluationResult.regressionStatus) }}</dd>
                </div>
                <div>
                  <dt>失败断言</dt>
                  <dd>{{ selectedEvaluationResult.failedAssertionCount }}</dd>
                </div>
                <div>
                  <dt>工具次数</dt>
                  <dd>{{ selectedEvaluationResult.toolCallCount }}</dd>
                </div>
                <div>
                  <dt>Token</dt>
                  <dd>{{ formatCount(selectedEvaluationResult.tokenUsage.totalTokens) }}</dd>
                </div>
              </dl>

              <p v-if="selectedEvaluationResult.errorMessage" class="error-text">
                {{ selectedEvaluationResult.errorMessage }}
              </p>

              <div class="tool-trace">
                <span class="state-label">工具轨迹</span>
                <p>{{ selectedEvaluationResult.toolNames.length ? selectedEvaluationResult.toolNames.join(" → ") : "无工具调用" }}</p>
              </div>

              <div class="assertion-list">
                <div
                  v-for="assertion in selectedEvaluationResult.assertions"
                  :key="assertion.id"
                  class="assertion-row"
                  :class="{ failed: !assertion.passed }"
                >
                  <span>{{ assertion.passed ? "通过" : "失败" }}</span>
                  <strong>{{ assertion.label }}</strong>
                  <small>期望 {{ assertion.expected }} · 实际 {{ assertion.actual }}</small>
                  <p>{{ assertion.diagnosis }}</p>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="empty-state compact">暂无评测结果</div>
        </section>
      </section>
    </div>
  </main>
</template>
