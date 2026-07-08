<script setup lang="ts">
import type { Customer, Order, Policy, Refund, SandboxState, Ticket } from "@agentflow/shared";

defineProps<{
  stateError: string;
  sandboxState?: SandboxState;
  targetTicket?: Ticket;
  targetOrder?: Order;
  targetCustomer?: Customer;
  targetRefunds: Refund[];
  latestRefund?: Refund;
  matchedPolicy?: Policy;
  didChange: (path: "ticket.status" | "order.refundStatus" | "refunds.length") => boolean;
}>();

defineEmits<{
  refresh: [];
  reset: [];
}>();
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
  </div>
</template>
