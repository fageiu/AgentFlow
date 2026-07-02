<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { AgentRun, AgentRunEvent, AgentRunSummary, AgentStep, SandboxState } from "@agentflow/shared";

type UiStatus = AgentRun["status"] | "idle";

const API_BASE_URL = "http://127.0.0.1:3001";
const sampleTask = "处理工单 T-1001：判断客户是否符合退款规则，必要时创建退款并更新工单状态。";

const task = ref(sampleTask);
const steps = ref<AgentStep[]>([]);
const status = ref<UiStatus>("idle");
const runId = ref("");
const errorMessage = ref("");
const sandboxState = ref<SandboxState>();
const baselineState = ref<SandboxState>();
const stateError = ref("");
const runHistory = ref<AgentRunSummary[]>([]);
const historyError = ref("");
const resolvingApproval = ref(false);
let eventSource: EventSource | undefined;

const isRunning = computed(() => status.value === "running");
const isBusy = computed(() => status.value === "running" || status.value === "waiting_approval");
const requestedTicketId = computed(() => extractTicketId(task.value) ?? "T-1001");
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

/** 从任务文本中提取目标工单号，让沙箱状态面板跟随当前处理对象。 */
function extractTicketId(value: string) {
  return value.match(/T-\d+/i)?.[0].toUpperCase();
}

/** 拉取当前沙箱状态，页面初始化和 Agent 执行完成后都会调用。 */
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

/** 拉取历史运行摘要列表，侧边栏只展示轻量信息。 */
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

/** 点击历史记录后读取完整 run 快照，并恢复到当前时间线区域。 */
async function loadRunFromHistory(historyRunId: string) {
  try {
    historyError.value = "";
    closeStream();

    const response = await fetch(`${API_BASE_URL}/agent/runs/${historyRunId}`);

    if (!response.ok) {
      throw new Error(`Run detail request failed: ${response.status}`);
    }

    const run = await response.json() as AgentRun;
    task.value = run.task;
    runId.value = run.id;
    status.value = run.status;
    steps.value = run.steps;
    errorMessage.value = "";
    baselineState.value = undefined;
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : "运行历史读取失败";
  }
}

/** 清理后端内存中的 trace 历史，同时重置前端列表。 */
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

function updateApprovalStep(payload: Extract<AgentRunEvent, { kind: "approval_resolved" }>) {
  steps.value = steps.value.map((step) => {
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
  });
}

/** 批准或拒绝当前 run 的待审批高风险工具调用，SSE 会继续推送后续事件。 */
async function resolveApproval(action: "approve" | "reject") {
  if (!runId.value || resolvingApproval.value) {
    return;
  }

  try {
    resolvingApproval.value = true;
    errorMessage.value = "";
    const response = await fetch(`${API_BASE_URL}/agent/runs/${runId.value}/${action}`, {
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
    errorMessage.value = error instanceof Error ? error.message : "人工审批请求失败";
  } finally {
    resolvingApproval.value = false;
  }
}

/** 重置后端内存沙箱，并清理前端本次运行留下的 trace 和变化基线。 */
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
    steps.value = [];
    runId.value = "";
    errorMessage.value = "";
    status.value = "idle";
  } catch (error) {
    stateError.value = error instanceof Error ? error.message : "沙箱重置失败";
  }
}

/** 根据执行前快照判断字段是否发生变化，用于状态面板高亮。 */
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

  // SSE 的 data 字段是后端 JSON.stringify 后的事件载荷，这里统一还原成共享事件类型。
  return JSON.parse(message.data) as AgentRunEvent;
}

async function applyRunEvent(event: Event) {
  const payload = readEvent(event);

  if (!payload) {
    return;
  }

  if (payload.kind === "run_started") {
    runId.value = payload.run.id;
    status.value = payload.run.status;
    steps.value = [];
    return;
  }

  if (payload.kind === "step") {
    steps.value = [...steps.value, payload.step];
    return;
  }

  if (payload.kind === "approval_required") {
    runId.value = payload.run.id;
    status.value = payload.run.status;
    steps.value = [...steps.value, payload.step];
    return;
  }

  if (payload.kind === "approval_resolved") {
    runId.value = payload.run.id;
    status.value = payload.run.status;
    updateApprovalStep(payload);
    return;
  }

  if (payload.kind === "run_completed") {
    runId.value = payload.run.id;
    status.value = payload.run.status;
    steps.value = payload.run.steps;
    closeStream();
    await refreshSandboxState();
    await refreshRunHistory();
    return;
  }

  errorMessage.value = payload.message;
  status.value = "failed";
  closeStream();
}

async function runTask() {
  const nextTask = task.value.trim();

  if (!nextTask || isBusy.value) {
    return;
  }

  closeStream();
  await refreshSandboxState();
  baselineState.value = cloneState(sandboxState.value);
  steps.value = [];
  runId.value = "";
  errorMessage.value = "";
  resolvingApproval.value = false;
  status.value = "running";

  // EventSource 只能发 GET 请求，所以任务内容通过 query string 传给后端 SSE 接口。
  const url = new URL(`${API_BASE_URL}/agent/run/stream`);
  url.searchParams.set("task", nextTask);
  eventSource = new EventSource(url);

  eventSource.addEventListener("run_started", applyRunEvent);
  eventSource.addEventListener("step", applyRunEvent);
  eventSource.addEventListener("approval_required", applyRunEvent);
  eventSource.addEventListener("approval_resolved", applyRunEvent);
  eventSource.addEventListener("run_completed", applyRunEvent);
  eventSource.addEventListener("error", (event) => {
    const payload = readEvent(event);

    if (payload?.kind === "error") {
      errorMessage.value = payload.message;
    } else if (status.value === "running") {
      errorMessage.value = "执行流连接中断，请确认后端服务是否正在运行。";
    }

    if (status.value === "running") {
      status.value = "failed";
      closeStream();
    }
  });
}

onMounted(() => {
  void refreshSandboxState();
  void refreshRunHistory();
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

      <label class="field">
        <span>任务</span>
        <textarea v-model="task" aria-label="任务输入" />
      </label>

      <button type="button" :disabled="isBusy || !task.trim()" @click="runTask">
        {{ isRunning ? "执行中..." : status === "waiting_approval" ? "等待审批" : "开始执行" }}
      </button>

      <dl class="run-meta">
        <div>
          <dt>状态</dt>
          <dd>{{ statusLabel }}</dd>
        </div>
        <div>
          <dt>Run ID</dt>
          <dd>{{ runId || "未生成" }}</dd>
        </div>
      </dl>

      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

      <section class="history-panel" aria-label="运行历史">
        <header class="history-header">
          <div>
            <p class="eyebrow muted">Run History</p>
            <h2>运行历史</h2>
          </div>
          <div class="history-actions">
            <button class="ghost-button" type="button" @click="refreshRunHistory">刷新</button>
            <button class="ghost-button danger" type="button" :disabled="runHistory.length === 0" @click="clearRunHistory">
              清空
            </button>
          </div>
        </header>

        <p v-if="historyError" class="error-text">{{ historyError }}</p>

        <div v-else-if="runHistory.length === 0" class="empty-state compact">暂无运行历史</div>

        <div v-else class="history-list">
          <button
            v-for="historyRun in runHistory"
            :key="historyRun.id"
            class="history-item"
            type="button"
            @click="loadRunFromHistory(historyRun.id)"
          >
            <span class="history-task">{{ historyRun.task }}</span>
            <span class="history-meta">
              {{ formatRunTime(historyRun.createdAt) }} · {{ historyRun.stepCount }} steps · {{ historyRun.status }}
            </span>
          </button>
        </div>
      </section>
    </section>

    <div class="content-stack">
      <section class="workspace" aria-label="执行工作区">
        <header class="workspace-header">
          <div>
            <p class="eyebrow muted">Execution Trace</p>
            <h2>实时执行时间线</h2>
          </div>
          <span class="status-pill" :class="`status-${status}`">{{ statusLabel }}</span>
        </header>

        <div v-if="steps.length === 0" class="empty-state">
          输入任务后启动 Agent，执行计划、工具调用、观察结果、人工审批和最终报告会按流式事件追加到这里。
        </div>

        <div v-else class="timeline">
          <article v-for="(step, index) in steps" :key="step.id" class="step-card" :class="`step-${step.type}`">
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
                <button type="button" class="approve-button" :disabled="resolvingApproval" @click="resolveApproval('approve')">
                  批准
                </button>
                <button type="button" class="reject-button" :disabled="resolvingApproval" @click="resolveApproval('reject')">
                  拒绝
                </button>
              </div>
            </div>
          </article>
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
