<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { AgentRun, ConversationMessage } from "@agentflow/shared";
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
  status: UiStatus;
  statusLabel: string;
  isBusy: boolean;
  isRunning: boolean;
  canRetryLastTask: boolean;
  resolvingApproval: boolean;
  cancellingRun: boolean;
}>();

const emit = defineEmits<{
  "update:draft": [value: string];
  send: [];
  cancel: [];
  retry: [];
  resolveApproval: [action: "approve" | "reject", messageId: string];
}>();

const conversationEl = ref<HTMLElement>();
const composerInput = ref<HTMLTextAreaElement>();

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
          v-if="message.role === 'assistant' && (message.steps?.length ?? 0) > 0 && isAssistantTerminal(message)"
          :run="message.run"
          :fallback-error-message="message.errorMessage"
          :final-message="getAssistantFinalMessage(message)"
        />
      </article>
    </div>

    <div class="composer">
      <textarea
        ref="composerInput"
        :value="draft"
        aria-label="任务输入"
        placeholder="输入下一条任务，例如：处理工单 T-1001..."
        @input="$emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
        @keydown="handleComposerKeydown"
      />
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
