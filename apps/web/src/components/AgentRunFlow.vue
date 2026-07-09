<script setup lang="ts">
import type { AgentRun, AgentStep } from "@agentflow/shared";
import AgentStepDetail from "./AgentStepDetail.vue";

defineProps<{
  steps: AgentStep[];
  status?: AgentRun["status"] | "idle";
  messageId: string;
  resolvingApproval: boolean;
}>();

defineEmits<{
  resolveApproval: [action: "approve" | "reject", messageId: string];
}>();
</script>

<template>
  <section class="run-flow embedded" aria-label="Agent 执行流程">
    <div class="run-flow-header">
      <div>
        <span class="run-flow-kicker">Execution Flow</span>
        <strong>任务执行流程</strong>
      </div>
      <span>{{ status === "running" ? `已记录 ${steps.length} 步` : `${steps.length} 步` }}</span>
    </div>

    <div class="run-flow-list">
      <AgentStepDetail
        v-for="(step, index) in steps"
        :key="step.id"
        :step="step"
        :index="index"
        :message-id="messageId"
        :resolving-approval="resolvingApproval"
        @resolve-approval="$emit('resolveApproval', $event, messageId)"
      />

      <article v-if="status === 'running'" class="run-flow-step run-flow-step-running run-flow-step-pending">
        <div class="run-flow-rail">
          <span class="run-flow-dot">{{ steps.length + 1 }}</span>
        </div>

        <div class="run-flow-step-main">
          <div class="run-flow-step-line">
            <div class="run-flow-step-title">
              <span>执行中</span>
              <strong>{{ steps.length === 0 ? "正在生成执行计划" : "等待下一步执行事件" }}</strong>
            </div>

            <div class="run-flow-step-meta">
              <span class="run-flow-state">流式等待</span>
            </div>
          </div>

          <p class="run-flow-step-summary">
            {{ steps.length === 0 ? "已建立执行连接，正在等待模型返回第一段计划。" : "上一阶段已写入 trace，正在等待模型、工具或最终回复返回。" }}
          </p>
        </div>
      </article>
    </div>
  </section>
</template>
