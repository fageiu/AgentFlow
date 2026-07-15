<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunSummary,
  ConversationMessage,
  ConversationSession,
  ConversationSessionSummary,
  EvaluationCase,
  EvaluationRun,
  LlmConfigUpdate,
  LlmConnectionTestResult,
  LlmPublicConfig,
  SandboxState,
} from "@agentflow/shared";
import AgentWorkspace from "./components/AgentWorkspace.vue";
import BusinessContextPanel from "./components/BusinessContextPanel.vue";
import ConversationSidebar from "./components/ConversationSidebar.vue";
import EvaluationComparePanel from "./components/EvaluationComparePanel.vue";
import EvaluationRunPanel from "./components/EvaluationRunPanel.vue";
import ModelSettingsDialog from "./components/ModelSettingsDialog.vue";
import {
  cancelRun,
  clearEvaluationRunsRequest,
  clearRunHistoryRequest,
  createAgentRunStreamUrl,
  createConversation,
  createEvaluationRun,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  fetchEvaluationCases,
  fetchEvaluationRuns,
  fetchLlmConfig,
  fetchRunDetail,
  fetchRunHistory,
  fetchSandboxState,
  resetSandboxState,
  resolveRunApproval,
  saveLlmConfig,
  testLlmConfig,
} from "./api";
import { useEvaluationView, type EvaluationGroupFilter } from "./composables/useEvaluationView";
import { getRunStatusLabel } from "./utils/labels";

type UiStatus = AgentRun["status"] | "idle";
type RightPanel = "business" | "evaluation" | "comparison";

const taskPlaceholder = "例如：处理工单 T-1001，判断客户是否符合退款规则，必要时创建退款并更新工单状态。";

const draft = ref("");
const messages = ref<ConversationMessage[]>([]);
const activeAssistantMessageId = ref("");
const focusedTask = ref("");
const selectedBusinessTicketId = ref("");
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
const clearingEvaluationRuns = ref(false);
const selectedEvaluationGroup = ref<EvaluationGroupFilter>("all");
const selectedEvaluationCaseId = ref("");
const selectedEvaluationRunId = ref("");
const selectedComparisonRunId = ref("");
const activeRightPanel = ref<RightPanel>("business");
const resolvingApproval = ref(false);
const cancellingRun = ref(false);
const deletingConversationId = ref("");
const llmConfig = ref<LlmPublicConfig>();
const llmConfigDialogOpen = ref(false);
const llmConfigError = ref("");
const llmConfigTesting = ref(false);
const llmConfigSaving = ref(false);
const llmConfigTestResult = ref<LlmConnectionTestResult>();
const workspaceRef = ref<InstanceType<typeof AgentWorkspace>>();
let eventSource: EventSource | undefined;

const activeAssistantMessage = computed(() =>
  messages.value.find((message) => message.id === activeAssistantMessageId.value && message.role === "assistant"),
);
const activeRun = computed(() => activeAssistantMessage.value?.run);
const status = computed<UiStatus>(() => activeAssistantMessage.value?.status ?? "idle");
const isRunning = computed(() => status.value === "running");
const isBusy = computed(() => status.value === "running" || status.value === "waiting_approval");
const canRetryLastTask = computed(() => messages.value.some((message) => message.role === "user") && !isBusy.value);
const isModelConfigLocked = computed(() => isBusy.value || isRunningEvaluation.value);
const contextualTicketId = computed(() => extractTicketId(focusedTask.value));
const targetTicket = computed(() =>
  sandboxState.value?.tickets.find((ticket) => ticket.id === selectedBusinessTicketId.value),
);
const targetOrder = computed(() => sandboxState.value?.orders.find((order) => order.id === targetTicket.value?.orderId));
const targetCustomer = computed(() =>
  sandboxState.value?.customers.find((customer) => customer.id === targetTicket.value?.customerId),
);
const targetRefunds = computed(() =>
  targetOrder.value ? sandboxState.value?.refunds.filter((refund) => refund.orderId === targetOrder.value?.id) ?? [] : [],
);
const latestRefund = computed(() => targetRefunds.value.at(-1));
const policySearchTerms: Record<string, string[]> = {
  refund: ["退款"],
  approval: ["审批", "人工确认"],
  发票: ["发票"],
  cancel: ["订单取消", "取消订单", "取消后"],
  sla: ["sla", "服务不可用"],
  upgrade: ["合同升级", "升级咨询"],
  "duplicate-refund": ["重复退款"],
  security: ["高风险", "关闭工单"],
};
const matchedPolicy = computed(() => {
  if (!targetTicket.value || !sandboxState.value) {
    return undefined;
  }

  const searchableTicket = `${targetTicket.value.title} ${targetTicket.value.description}`.toLowerCase();

  // 以匹配词数量和长度共同计分，优先选择“重复退款”“服务不可用”等更具体的规则。
  return sandboxState.value.policies
    .map((policy) => ({
      policy,
      score: (policySearchTerms[policy.keyword] ?? [policy.keyword]).reduce(
        (total, term) => searchableTicket.includes(term.toLowerCase()) ? total + term.length : total,
        0,
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.policy;
});
const {
  activeEvaluationRun,
  previousEvaluationRun,
  comparableEvaluationRuns,
  comparisonEvaluationRun,
  evaluationGroups,
  filteredEvaluationCases,
  selectedEvaluationResult,
  activeEvaluationGroupSummary,
  selectedEvaluationCaseIds,
  evaluationComparisonMetrics,
  evaluationCaseComparisons,
} = useEvaluationView({
  evaluationCases,
  evaluationRuns,
  selectedEvaluationGroup,
  selectedEvaluationCaseId,
  selectedEvaluationRunId,
  selectedComparisonRunId,
});

const statusLabel = computed(() => {
  return getRunStatusLabel(status.value);
});

function setEvaluationGroup(group: EvaluationGroupFilter) {
  selectedEvaluationGroup.value = group;
  selectedEvaluationCaseId.value = "";
}

function selectEvaluationResult(caseId: string) {
  selectedEvaluationCaseId.value = caseId;
}

function selectComparisonRun(runId: string) {
  selectedComparisonRunId.value = runId;
  activeRightPanel.value = "comparison";
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

/** 根据当前任务同步右侧业务上下文；未指定工单时回到业务概览。 */
function focusBusinessContext(task: string) {
  focusedTask.value = task;
  selectedBusinessTicketId.value = extractTicketId(task) ?? "";
}

function scrollConversationToBottom() {
  workspaceRef.value?.scrollToBottom();
}

function focusComposer() {
  workspaceRef.value?.focusComposer();
}

function resetConversationWorkspace() {
  closeStream();
  activeConversationId.value = "";
  messages.value = [];
  activeAssistantMessageId.value = "";
  draft.value = "";
  focusBusinessContext("");
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
    sandboxState.value = await fetchSandboxState();
  } catch (error) {
    stateError.value = error instanceof Error ? error.message : "沙箱状态获取失败";
  }
}

async function refreshLlmConfig() {
  try {
    llmConfig.value = await fetchLlmConfig();
    llmConfigError.value = "";
  } catch (error) {
    llmConfigError.value = error instanceof Error ? error.message : "模型配置读取失败";
  }
}

function openLlmConfigDialog() {
  llmConfigDialogOpen.value = true;
  llmConfigError.value = "";
  llmConfigTestResult.value = undefined;
  void refreshLlmConfig();
}

async function testModelConfig(input: LlmConfigUpdate) {
  llmConfigTesting.value = true;
  llmConfigError.value = "";
  llmConfigTestResult.value = undefined;

  try {
    llmConfigTestResult.value = await testLlmConfig(input);
  } catch (error) {
    llmConfigError.value = error instanceof Error ? error.message : "模型连接测试失败";
  } finally {
    llmConfigTesting.value = false;
  }
}

async function saveModelConfig(input: LlmConfigUpdate) {
  if (isModelConfigLocked.value) {
    llmConfigError.value = "当前任务尚未结束，暂时不能切换模型。";
    return;
  }

  llmConfigSaving.value = true;
  llmConfigError.value = "";

  try {
    llmConfig.value = await saveLlmConfig(input);
    llmConfigDialogOpen.value = false;
    llmConfigTestResult.value = undefined;
  } catch (error) {
    llmConfigError.value = error instanceof Error ? error.message : "模型配置保存失败";
  } finally {
    llmConfigSaving.value = false;
  }
}

async function refreshRunHistory() {
  try {
    historyError.value = "";
    runHistory.value = await fetchRunHistory();
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : "运行历史获取失败";
  }
}

async function loadRunFromHistory(historyRunId: string) {
  try {
    historyError.value = "";
    closeStream();

    const run = await fetchRunDetail(historyRunId);
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

    focusBusinessContext(run.task);
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
    await clearRunHistoryRequest();
    runHistory.value = [];
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : "运行历史清空失败";
  }
}

async function refreshEvaluationCases() {
  try {
    evaluationError.value = "";
    evaluationCases.value = await fetchEvaluationCases();
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : "评测用例获取失败";
  }
}

async function refreshEvaluationRuns() {
  try {
    evaluationError.value = "";
    evaluationRuns.value = await fetchEvaluationRuns();
    selectedEvaluationRunId.value = evaluationRuns.value.some((run) => run.id === selectedEvaluationRunId.value)
      ? selectedEvaluationRunId.value
      : evaluationRuns.value[0]?.id ?? "";
    selectedComparisonRunId.value = evaluationRuns.value.some((run) => run.id === selectedComparisonRunId.value)
      ? selectedComparisonRunId.value
      : evaluationRuns.value.find((run) => run.id !== selectedEvaluationRunId.value)?.id ?? "";
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : "评测结果获取失败";
  }
}

async function runEvaluations() {
  try {
    evaluationError.value = "";
    isRunningEvaluation.value = true;
    const evaluationRun = await createEvaluationRun(
      selectedEvaluationGroup.value === "all" ? undefined : selectedEvaluationCaseIds.value,
    );
    evaluationRuns.value = [evaluationRun, ...evaluationRuns.value.filter((run) => run.id !== evaluationRun.id)];
    selectedEvaluationRunId.value = evaluationRun.id;
    selectedComparisonRunId.value = evaluationRuns.value.find((run) => run.id !== evaluationRun.id)?.id ?? "";
    selectedEvaluationCaseId.value =
      evaluationRun.results.find((result) => result.status !== "passed")?.caseId ?? evaluationRun.results[0]?.caseId ?? "";
    activeRightPanel.value = "evaluation";
    await refreshSandboxState();
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : "评测运行失败";
  } finally {
    isRunningEvaluation.value = false;
  }
}

async function clearEvaluationRuns() {
  if (isRunningEvaluation.value || clearingEvaluationRuns.value) {
    return;
  }

  if (!window.confirm("确定清空所有评测记录吗？这不会删除会话或 Agent 运行历史。")) {
    return;
  }

  try {
    evaluationError.value = "";
    clearingEvaluationRuns.value = true;
    await clearEvaluationRunsRequest();
    evaluationRuns.value = [];
    selectedEvaluationRunId.value = "";
    selectedComparisonRunId.value = "";
    selectedEvaluationCaseId.value = "";
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : "评测记录清空失败";
  } finally {
    clearingEvaluationRuns.value = false;
  }
}

async function refreshConversations() {
  try {
    conversationError.value = "";
    conversations.value = await fetchConversations();
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

    const session = await fetchConversation(conversationId);
    activeConversationId.value = session.id;
    messages.value = normalizeRestoredMessages(session);
    activeAssistantMessageId.value = selectLatestAssistantMessage(session);
    focusBusinessContext([...session.messages].reverse().find((message) => message.role === "user")?.content ?? "");
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

    const session = await createConversation();
    activeConversationId.value = session.id;
    messages.value = [];
    activeAssistantMessageId.value = "";
    draft.value = "";
    focusBusinessContext("");
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

    await deleteConversation(conversationId);
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

  const session = await createConversation();
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
    await resolveRunApproval(
      targetRunId,
      action,
      action === "approve" ? "人工批准高风险工具调用。" : "人工拒绝高风险工具调用。",
    );
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
    await cancelRun(runId, "用户取消执行");
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
    sandboxState.value = await resetSandboxState();
    baselineState.value = undefined;
  } catch (error) {
    stateError.value = error instanceof Error ? error.message : "沙箱重置失败";
  }
}

function didChange(path: "ticket.status" | "order.refundStatus" | "refunds.length") {
  if (!baselineState.value || !sandboxState.value) {
    return false;
  }

  const beforeTicket = baselineState.value.tickets.find((ticket) => ticket.id === selectedBusinessTicketId.value);
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
      // 取消是用户主动终止，不应复用失败态错误字段。
      errorMessage: undefined,
    }));
    closeStream();
    await refreshSandboxState();
    await refreshConversations();
    scrollConversationToBottom();
    return;
  }

  if (payload.kind === "error") {
    updateActiveAssistant((message) => ({
      ...message,
      run: payload.run ?? message.run,
      status: payload.run?.status ?? "failed",
      steps: payload.run?.steps ?? message.steps,
      content: payload.error?.userMessage ?? payload.message,
      errorMessage: payload.message,
    }));
    closeStream();
    await refreshSandboxState();
    await refreshConversations();
    scrollConversationToBottom();
    return;
  }
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
  focusBusinessContext(nextTask);

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

  const url = createAgentRunStreamUrl({
    task: nextTask,
    conversationId,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
  });
  eventSource = new EventSource(url);

  eventSource.addEventListener("run_started", applyRunEvent);
  eventSource.addEventListener("step", applyRunEvent);
  eventSource.addEventListener("approval_required", applyRunEvent);
  eventSource.addEventListener("approval_resolved", applyRunEvent);
  eventSource.addEventListener("run_completed", applyRunEvent);
  eventSource.addEventListener("run_cancelled", applyRunEvent);
  eventSource.addEventListener("error", (event) => {
    const payload = readEvent(event);

    if (payload?.kind === "error") {
      void applyRunEvent(event);
      return;
    }
    const errorMessage = "执行流连接中断，请确认后端服务是否正在运行。";

    updateActiveAssistant((message) => ({
      ...message,
      status: "failed",
      errorMessage,
    }));
    closeStream();
  });
}

onMounted(() => {
  void refreshSandboxState();
  void refreshLlmConfig();
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
    <ConversationSidebar
      :status-label="statusLabel"
      :status="status"
      :active-run-id="activeRun?.id"
      :conversations="conversations"
      :active-conversation-id="activeConversationId"
      :conversation-error="conversationError"
      :is-conversation-deleting="isConversationDeleting"
      :get-conversation-delete-disabled="getConversationDeleteDisabled"
      @refresh="refreshConversations"
      @create="createNewConversation"
      @load="loadConversation"
      @delete="deleteConversationItem"
    />

    <div class="content-stack">
      <AgentWorkspace
        ref="workspaceRef"
        v-model:draft="draft"
        :task-placeholder="taskPlaceholder"
        :messages="messages"
        :status="status"
        :status-label="statusLabel"
        :is-busy="isBusy"
        :is-running="isRunning"
        :can-retry-last-task="canRetryLastTask"
        :resolving-approval="resolvingApproval"
        :cancelling-run="cancellingRun"
        :model-config="llmConfig"
        @send="sendMessage"
        @cancel="cancelActiveRun"
        @retry="retryLastUserMessage"
        @resolve-approval="resolveApproval"
        @open-settings="openLlmConfigDialog"
      />

      <section class="state-panel context-panel" aria-label="右侧上下文面板">
        <nav class="right-panel-tabs" aria-label="上下文视图">
          <button
            type="button"
            :class="{ active: activeRightPanel === 'business' }"
            @click="activeRightPanel = 'business'"
          >
            业务状态
          </button>
          <button
            type="button"
            :class="{ active: activeRightPanel === 'evaluation' }"
            @click="activeRightPanel = 'evaluation'"
          >
            评测系统
          </button>
          <button
            type="button"
            :class="{ active: activeRightPanel === 'comparison' }"
            :disabled="evaluationRuns.length < 2"
            @click="activeRightPanel = 'comparison'"
          >
            评测对比
          </button>
        </nav>

        <BusinessContextPanel
          v-if="activeRightPanel === 'business'"
          :state-error="stateError"
          :sandbox-state="sandboxState"
          :selected-ticket-id="selectedBusinessTicketId"
          :contextual-ticket-id="contextualTicketId"
          :target-ticket="targetTicket"
          :target-order="targetOrder"
          :target-customer="targetCustomer"
          :target-refunds="targetRefunds"
          :latest-refund="latestRefund"
          :matched-policy="matchedPolicy"
          :did-change="didChange"
          @select-ticket="selectedBusinessTicketId = $event"
          @refresh="refreshSandboxState"
          @reset="resetSandbox"
        />

        <EvaluationRunPanel
          v-else-if="activeRightPanel === 'evaluation'"
          :evaluation-error="evaluationError"
          :evaluation-cases="evaluationCases"
          :evaluation-groups="evaluationGroups"
          :filtered-evaluation-cases="filteredEvaluationCases"
          :evaluation-runs="evaluationRuns"
          :active-evaluation-run="activeEvaluationRun"
          :active-evaluation-group-summary="activeEvaluationGroupSummary"
          :previous-evaluation-run="previousEvaluationRun"
          :selected-evaluation-group="selectedEvaluationGroup"
          :selected-evaluation-run-id="selectedEvaluationRunId"
          :selected-evaluation-result="selectedEvaluationResult"
          :is-running-evaluation="isRunningEvaluation"
          :clearing-evaluation-runs="clearingEvaluationRuns"
          @refresh="refreshEvaluationRuns"
          @clear="clearEvaluationRuns"
          @run="runEvaluations"
          @select-group="setEvaluationGroup"
          @select-run="selectedEvaluationRunId = $event"
          @select-case="selectEvaluationResult"
        />

        <EvaluationComparePanel
          v-else
          :active-evaluation-run="activeEvaluationRun"
          :comparison-evaluation-run="comparisonEvaluationRun"
          :comparable-evaluation-runs="comparableEvaluationRuns"
          :selected-comparison-run-id="selectedComparisonRunId"
          :evaluation-comparison-metrics="evaluationComparisonMetrics"
          :evaluation-case-comparisons="evaluationCaseComparisons"
          @select-comparison-run="selectComparisonRun"
        />
      </section>
    </div>

    <ModelSettingsDialog
      :open="llmConfigDialogOpen"
      :config="llmConfig"
      :busy="isModelConfigLocked"
      :testing="llmConfigTesting"
      :saving="llmConfigSaving"
      :error="llmConfigError"
      :test-result="llmConfigTestResult"
      @close="llmConfigDialogOpen = false"
      @test="testModelConfig"
      @save="saveModelConfig"
    />
  </main>
</template>

