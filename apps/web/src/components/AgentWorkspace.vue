<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { AgentRun, ConversationMessage, LlmPublicConfig } from "@agentflow/shared";
import { formatRunTime } from "../utils/format";
import { getRunStatusLabel } from "../utils/labels";
import { getFinalStepMessage, getTraceSteps } from "../utils/trace";
import AgentErrorSummary from "./AgentErrorSummary.vue";
import AgentRunFlow from "./AgentRunFlow.vue";
import AgentRunSummary from "./AgentRunSummary.vue";

type UiStatus = AgentRun["status"] | "idle";

defineProps<{
  messages: ConversationMessage[];
  draft: string;
  taskPlaceholder: string;
  status: UiStatus;
  statusLabel: string;
  isBusy: boolean;
  isRunning: boolean;
  canRetryLastTask: boolean;
  resolvingApproval: boolean;
  cancellingRun: boolean;
  modelConfig?: LlmPublicConfig;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  send: [];
  cancel: [];
  retry: [];
  resolveApproval: [action: "approve" | "reject", messageId: string];
  openSettings: [];
}>();

const conversationEl = ref<HTMLElement>();
const composerInput = ref<HTMLTextAreaElement>();
const starterTasks = [
  {
    eyebrow: "退款处理",
    title: "判断并处理退款申请",
    task: "处理工单 T-1001：判断客户是否符合退款规则，必要时创建退款并更新工单状态。",
  },
  {
    eyebrow: "服务核查",
    title: "核查企业客户 SLA 投诉",
    task: "查询工单 T-1003 的客户、订单与适用规则，给出 SLA 核查结果和补偿建议，不执行写入操作。",
  },
  {
    eyebrow: "批量查询",
    title: "汇总高优先级待处理工单",
    task: "查询所有 open 状态的高优先级工单，汇总工单号、客户名称和当前业务状态。",
  },
];

function scrollToBottom() {
  void nextTick(() => {
    if (conversationEl.value) {
      conversationEl.value.scrollTop = conversationEl.value.scrollHeight;
    }
  });
}

function focusComposer() {
  void nextTick(() => composerInput.value?.focus());
}

/** 快捷任务只写入编辑器，由用户确认后再触发 Agent run。 */
function selectStarterTask(task: string) {
  emit("update:draft", task);
  focusComposer();
}

function handleComposerKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    emit("send");
  }
}

function getVisibleTraceSteps(message: ConversationMessage) {
  return getTraceSteps(message.steps);
}

function getAssistantFinalMessage(message: ConversationMessage) {
  return getFinalStepMessage(message.steps) ?? message.content;
}

function isAssistantActive(message: ConversationMessage) {
  return message.status === "running" || message.status === "waiting_approval";
}

function isAssistantTerminal(message: ConversationMessage) {
  return message.status === "completed" || message.status === "failed" || message.status === "cancelled";
}

function shouldShowRunFlow(message: ConversationMessage) {
  return message.role === "assistant" && (getVisibleTraceSteps(message).length > 0 || isAssistantActive(message));
}

function shouldShowMessageContent(message: ConversationMessage) {
  return message.role === "user" || (message.role === "assistant" && !shouldShowRunFlow(message));
}

defineExpose({
  scrollToBottom,
  focusComposer,
});
</script>

<template>
  <section class="workspace conversation-workspace" aria-label="会话工作区">
    <header class="workspace-header">
      <div>
        <p class="eyebrow muted">Conversation Workspace</p>
        <h2>会话式执行工作台</h2>
      </div>
      <div class="workspace-header-controls">
        <button class="model-config-trigger" type="button" @click="$emit('openSettings')">
          <span class="model-config-dot" :class="{ active: modelConfig?.apiKeyConfigured || modelConfig?.mock }"></span>
          <span>
            <small>当前模型</small>
            <strong>{{ modelConfig?.model ?? "读取中…" }}</strong>
          </span>
          <span aria-hidden="true">⚙</span>
        </button>
        <span class="status-pill" :class="`status-${status}`">{{ statusLabel }}</span>
      </div>
    </header>

    <div ref="conversationEl" class="conversation-list">
      <section v-if="messages.length === 0" class="conversation-empty-state" aria-label="开始 Agent 任务">
        <div class="empty-state-intro">
          <span class="empty-state-kicker">Ready for a run</span>
          <h3>把业务目标交给 Agent，<br />每一步都有据可查</h3>
          <p>
            输入工单号和期望结果即可开始。Agent 会读取业务上下文、制定方案，并在需要写入或审批时明确展示操作。
          </p>

          <ol class="run-preview" aria-label="Agent 执行流程">
            <li><span>01</span><strong>读取上下文</strong></li>
            <li><span>02</span><strong>制定方案</strong></li>
            <li><span>03</span><strong>调用工具</strong></li>
            <li><span>04</span><strong>生成结论</strong></li>
          </ol>
        </div>

        <div class="starter-task-panel">
          <div class="starter-task-heading">
            <div>
              <span class="state-label">任务模板</span>
              <strong>从常见场景开始</strong>
            </div>
            <small>点击后可继续编辑</small>
          </div>

          <button
            v-for="(starter, index) in starterTasks"
            :key="starter.title"
            type="button"
            class="starter-task"
            @click="selectStarterTask(starter.task)"
          >
            <span class="starter-task-index">0{{ index + 1 }}</span>
            <span>
              <small>{{ starter.eyebrow }}</small>
              <strong>{{ starter.title }}</strong>
            </span>
            <span class="starter-task-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </section>

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
            {{ getRunStatusLabel(message.status) }}
          </span>
        </div>
        <p v-if="shouldShowMessageContent(message)" class="message-content">
          {{ message.content }}
        </p>

        <AgentErrorSummary
          v-if="message.role === 'assistant' && (message.run?.error || message.errorMessage) && !(message.steps?.length)"
          :error="message.run?.error"
          :fallback-message="message.errorMessage"
        />
        <p v-else-if="message.errorMessage && !(message.steps?.length)" class="error-text">{{ message.errorMessage }}</p>

        <AgentRunFlow
          v-if="shouldShowRunFlow(message)"
          :steps="getVisibleTraceSteps(message)"
          :status="message.status"
          :message-id="message.id"
          :resolving-approval="resolvingApproval"
          @resolve-approval="$emit('resolveApproval', $event, message.id)"
        />

        <AgentRunSummary
          v-if="message.role === 'assistant' && Boolean(message.run) && isAssistantTerminal(message)"
          :run="message.run"
          :fallback-error-message="message.errorMessage"
          :final-message="getAssistantFinalMessage(message)"
        />
      </article>
    </div>

    <div class="composer">
      <div class="composer-input-shell">
        <div class="composer-label-row">
          <label for="agent-task-composer">任务指令</label>
          <span>Ctrl / ⌘ + Enter 发送</span>
        </div>
        <textarea
          id="agent-task-composer"
          ref="composerInput"
          :value="draft"
          aria-label="任务输入"
          :placeholder="taskPlaceholder"
          @input="$emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
          @keydown="handleComposerKeydown"
        />
      </div>
      <div class="composer-actions">
        <button type="button" :disabled="isBusy || !draft.trim()" @click="$emit('send')">
          {{ isRunning ? "执行中..." : status === "waiting_approval" ? "等待审批" : "发送" }}
        </button>
        <button
          class="ghost-button danger"
          type="button"
          :disabled="!isBusy || cancellingRun"
          @click="$emit('cancel')"
        >
          {{ cancellingRun ? "取消中" : "取消" }}
        </button>
        <button class="ghost-button" type="button" :disabled="!canRetryLastTask" @click="$emit('retry')">
          重试
        </button>
      </div>
    </div>
  </section>
</template>
