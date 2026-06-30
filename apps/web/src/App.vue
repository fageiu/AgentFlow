<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { AgentRun, AgentRunEvent, AgentStep } from '@agentflow/shared'

type UiStatus = AgentRun['status'] | 'idle'

const sampleTask =
  '处理工单 T-1001：判断客户是否符合退款规则，必要时创建退款并更新工单状态。'
const task = ref(sampleTask)
const steps = ref<AgentStep[]>([])
const status = ref<UiStatus>('idle')
const runId = ref('')
const errorMessage = ref('')
let eventSource: EventSource | undefined

const isRunning = computed(() => status.value === 'running')
const statusLabel = computed(() => {
  const labels: Record<UiStatus, string> = {
    idle: '待执行',
    running: '执行中',
    waiting_approval: '待审批',
    completed: '已完成',
    failed: '失败',
  }

  return labels[status.value]
})
function closeStream() {
  eventSource?.close()
  eventSource = undefined
}

function readEvent(event: Event): AgentRunEvent | undefined {
  const message = event as MessageEvent<string>

  if (!message.data) {
    return undefined
  }

  // SSE 的 data 字段是后端 JSON.stringify 后的事件载荷，这里统一还原成共享事件类型。
  return JSON.parse(message.data) as AgentRunEvent
}

function applyRunEvent(event: Event) {
  const payload = readEvent(event)

  if (!payload) {
    return
  }

  if (payload.kind === 'run_started') {
    runId.value = payload.run.id
    status.value = payload.run.status
    steps.value = []
    return
  }

  if (payload.kind === 'step') {
    // 每收到一个 step，就追加一张时间线卡片；不要覆盖已有步骤。
    steps.value = [...steps.value, payload.step]
    return
  }

  if (payload.kind === 'run_completed') {
    runId.value = payload.run.id
    status.value = payload.run.status
    steps.value = payload.run.steps
    closeStream()
    return
  }

  errorMessage.value = payload.message
  status.value = 'failed'
  closeStream()
}

function runTask() {
  const nextTask = task.value.trim()

  if (!nextTask || isRunning.value) {
    return
  }

  closeStream()
  steps.value = []
  runId.value = ''
  errorMessage.value = ''
  status.value = 'running'

  // EventSource 只能发 GET 请求，所以任务内容通过 query string 传给后端 SSE 接口。
  const url = new URL('http://127.0.0.1:3001/agent/run/stream')
  url.searchParams.set('task', nextTask)
  eventSource = new EventSource(url)

  // 后端按事件名推送 run_started / step / run_completed，前端分别监听并更新状态。
  eventSource.addEventListener('run_started', applyRunEvent)
  eventSource.addEventListener('step', applyRunEvent)
  eventSource.addEventListener('run_completed', applyRunEvent)
  eventSource.addEventListener('error', (event) => {
    const payload = readEvent(event)

    if (payload?.kind === 'error') {
      errorMessage.value = payload.message
    } else if (status.value === 'running') {
      errorMessage.value = '执行流连接中断，请确认后端服务是否正在运行。'
    }

    if (status.value === 'running') {
      status.value = 'failed'
      closeStream()
    }
  })
}

onBeforeUnmount(closeStream)
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

      <button
        type="button"
        :disabled="isRunning || !task.trim()"
        @click="runTask"
      >
        {{ isRunning ? '执行中...' : '开始执行' }}
      </button>

      <dl class="run-meta">
        <div>
          <dt>状态</dt>
          <dd>{{ statusLabel }}</dd>
        </div>
        <div>
          <dt>Run ID</dt>
          <dd>{{ runId || '未生成' }}</dd>
        </div>
      </dl>

      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
    </section>

    <section class="workspace" aria-label="执行工作区">
      <header class="workspace-header">
        <div>
          <p class="eyebrow muted">Execution Trace</p>
          <h2>实时执行时间线</h2>
        </div>
        <span class="status-pill" :class="`status-${status}`">{{
          statusLabel
        }}</span>
      </header>

      <div v-if="steps.length === 0" class="empty-state">
        输入任务后启动
        Agent，执行计划、工具调用、观察结果和最终报告会按流式事件追加到这里。
      </div>

      <div v-else class="timeline">
        <article
          v-for="(step, index) in steps"
          :key="step.id"
          class="step-card"
          :class="`step-${step.type}`"
        >
          <div class="step-index">{{ index + 1 }}</div>
          <div class="step-body">
            <div class="step-header">
              <div>
                <span class="step-type">{{ step.type.replace('_', ' ') }}</span>
                <h3>{{ step.title }}</h3>
              </div>
              <span v-if="step.durationMs" class="duration"
                >{{ step.durationMs }}ms</span
              >
            </div>

            <p v-if="step.toolName" class="tool-name">{{ step.toolName }}</p>
            <pre>{{ step.detail }}</pre>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>
