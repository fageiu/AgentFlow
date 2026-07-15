<script setup lang="ts">
import type { Customer, Order, Policy, Refund, SandboxState, Ticket } from "@agentflow/shared";

defineProps<{
  stateError: string;
  sandboxState?: SandboxState;
  selectedTicketId: string;
  contextualTicketId?: string;
  targetTicket?: Ticket;
  targetOrder?: Order;
  targetCustomer?: Customer;
  targetRefunds: Refund[];
  latestRefund?: Refund;
  matchedPolicy?: Policy;
  didChange: (path: "ticket.status" | "order.refundStatus" | "refunds.length") => boolean;
}>();

const emit = defineEmits<{
  refresh: [];
  reset: [];
  "select-ticket": [ticketId: string];
}>();

function handleTicketChange(event: Event) {
  emit("select-ticket", (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="right-panel-content">
    <header class="workspace-header">
      <div>
        <p class="eyebrow muted">Sandbox State</p>
        <h2>业务状态</h2>
      </div>
      <div class="header-actions">
        <button class="ghost-button" type="button" @click="$emit('refresh')">刷新</button>
        <button class="ghost-button danger" type="button" @click="$emit('reset')">重置沙箱</button>
      </div>
    </header>

    <p v-if="stateError" class="error-text">{{ stateError }}</p>

    <div v-else-if="!sandboxState" class="empty-state compact">正在读取沙箱状态。</div>

    <template v-else>
      <section class="business-context-picker" aria-label="业务上下文选择">
        <div class="context-picker-copy">
          <span class="state-label">当前查看</span>
          <strong>
            {{ targetTicket
              ? `${targetTicket.id} · ${targetTicket.title}`
              : selectedTicketId
                ? `${selectedTicketId} · 工单不存在`
                : "全部业务概览" }}
          </strong>
        </div>
        <label class="ticket-select-field">
          <span class="sr-only">选择工单</span>
          <select :value="selectedTicketId" @change="handleTicketChange">
            <option value="">全部工单</option>
            <option v-if="selectedTicketId && !targetTicket" :value="selectedTicketId" disabled>
              {{ selectedTicketId }} · 工单不存在
            </option>
            <option v-for="ticket in sandboxState.tickets" :key="ticket.id" :value="ticket.id">
              {{ ticket.id }} · {{ ticket.title }}
            </option>
          </select>
        </label>
        <span v-if="contextualTicketId && selectedTicketId === contextualTicketId" class="context-source task">
          跟随当前任务
        </span>
        <span v-else-if="selectedTicketId" class="context-source">手动查看</span>
        <span v-else class="context-source overview">任务未指定工单</span>
      </section>

      <div v-if="!targetTicket" class="business-overview">
        <div class="overview-callout">
          <span class="overview-icon" aria-hidden="true">⌁</span>
          <div>
            <strong>
              {{ selectedTicketId ? `未找到 ${selectedTicketId} 对应的业务数据` : "当前任务没有明确的工单上下文" }}
            </strong>
            <p>
              {{ selectedTicketId
                ? "可能是工单号输入有误或沙箱数据尚未同步，可从列表选择其他工单。"
                : "这里展示沙箱概览。可选择任一工单查看关联客户、订单、退款和规则。" }}
            </p>
          </div>
        </div>

        <dl class="overview-metrics">
          <div>
            <dt>工单</dt>
            <dd>{{ sandboxState.tickets.length }}</dd>
          </div>
          <div>
            <dt>待处理</dt>
            <dd>{{ sandboxState.tickets.filter((ticket) => ticket.status === "open").length }}</dd>
          </div>
          <div>
            <dt>退款记录</dt>
            <dd>{{ sandboxState.refunds.length }}</dd>
          </div>
        </dl>

        <div class="ticket-overview-list">
          <button
            v-for="ticket in sandboxState.tickets"
            :key="ticket.id"
            type="button"
            class="ticket-overview-item"
            @click="emit('select-ticket', ticket.id)"
          >
            <span>
              <strong>{{ ticket.id }}</strong>
              <small>{{ ticket.title }}</small>
            </span>
            <span class="ticket-overview-meta">
              <small>{{ ticket.priority }}</small>
              <b :class="`ticket-status status-${ticket.status}`">{{ ticket.status }}</b>
            </span>
          </button>
        </div>
      </div>

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
        <span class="state-label">关联规则</span>
        <template v-if="matchedPolicy">
          <h3>{{ matchedPolicy.title }}</h3>
          <p>{{ matchedPolicy.content }}</p>
        </template>
        <div v-else class="policy-empty">
          <strong>暂无匹配规则</strong>
          <p>当前工单没有可由标题或描述可靠定位的规则。</p>
        </div>
      </article>
      </div>
    </template>
  </div>
</template>
