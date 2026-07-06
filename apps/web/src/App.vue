<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunSummary,
  ConversationMessage,
  ConversationSession,
  ConversationSessionSummary,
  SandboxState,
} from "@agentflow/shared";

type UiStatus = AgentRun["status"] | "idle";

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
const resolvingApproval = ref(false);
const conversationEl = ref<HTMLElement>();
let eventSource: EventSource | undefined;

const activeAssistantMessage = computed(() =>
  messages.value.find((message) => message.id === activeAssistantMessageId.value && message.role === "assistant"),
);
const activeRun = computed(() => activeAssistantMessage.value?.run);
const activeSteps = computed(() => activeAssistantMessage.value?.steps ?? []);
const status = computed<UiStatus>(() => activeAssistantMessage.value?.status ?? "idle");
const isRunning = computed(() => status.value === "running");
const isBusy = computed(() => status.value === "running" || status.value === "waiting_approval");
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

const statusLabel = computed(() => {
  const labels: Record<UiStatus, string> = {
    idle: "待执行",
    running: "执行中",
    waiting_approval: "待审批",
    completed: "已完成",
    failed: "失败",
  };

  return labels[status.value];
});

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
    messages.value = session.messages;
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
  } catch (error) {
    conversationError.value = error instanceof Error ? error.message : "会话创建失败";
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
          <button
            v-for="conversation in conversations"
            :key="conversation.id"
            class="history-item"
            :class="{ active: conversation.id === activeConversationId }"
            type="button"
            @click="loadConversation(conversation.id)"
          >
            <span class="history-task">{{ conversation.title }}</span>
            <span class="history-meta">
              {{ formatRunTime(conversation.updatedAt) }} · {{ conversation.messageCount }} messages
            </span>
          </button>
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
            v-model="draft"
            aria-label="任务输入"
            placeholder="输入下一条任务，例如：处理工单 T-1001..."
            @keydown="handleComposerKeydown"
          />
          <button type="button" :disabled="isBusy || !draft.trim()" @click="sendMessage">
            {{ isRunning ? "执行中..." : status === "waiting_approval" ? "等待审批" : "发送" }}
          </button>
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
      </section>
    </div>
  </main>
</template>
