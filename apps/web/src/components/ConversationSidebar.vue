<script setup lang="ts">
import type { AgentRun, ConversationSessionSummary } from "@agentflow/shared";
import { formatRunTime } from "../utils/format";

type UiStatus = AgentRun["status"] | "idle";

defineProps<{
  statusLabel: string;
  status: UiStatus;
  activeRunId?: string;
  conversations: ConversationSessionSummary[];
  activeConversationId: string;
  conversationError: string;
  isConversationDeleting: (conversationId: string) => boolean;
  getConversationDeleteDisabled: (conversation: ConversationSessionSummary) => boolean;
}>();

defineEmits<{
  refresh: [];
  create: [];
  load: [conversationId: string];
  delete: [conversationId: string];
}>();
</script>

<template>
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
        <dd>{{ activeRunId || "未生成" }}</dd>
      </div>
    </dl>

    <section class="history-panel" aria-label="会话列表">
      <header class="history-header">
        <div>
          <p class="eyebrow muted">Conversations</p>
          <h2>会话</h2>
        </div>
        <div class="history-actions">
          <button class="ghost-button" type="button" @click="$emit('refresh')">刷新</button>
          <button class="ghost-button" type="button" @click="$emit('create')">新建</button>
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
          <button class="history-select" type="button" @click="$emit('load', conversation.id)">
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
            @click="$emit('delete', conversation.id)"
          >
            {{ isConversationDeleting(conversation.id) ? "..." : "删" }}
          </button>
        </div>
      </div>
    </section>
  </section>
</template>
