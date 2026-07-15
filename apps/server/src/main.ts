import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AgentRunEvent, ConversationMessage } from "@agentflow/shared";
import type { LlmConfigUpdate, LlmConnectionTestResult } from "@agentflow/shared";
import { z } from "zod";
import { getPendingApprovalByRun, resolveApprovalForRun } from "./approval/approvalStore.js";
import { getAgentErrorHttpStatus, normalizeAgentError } from "./agent/errors.js";
import { runAgentTask, streamAgentTask } from "./agent/executor.js";
import { cancelAgentRun } from "./agent/cancelRun.js";
import {
  clearConversations,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateAssistantRunMessage,
  upsertConversationMessage,
} from "./conversation/conversationStore.js";
import { listEvaluationCases } from "./eval/evaluationCases.js";
import { runEvaluationSuite } from "./eval/evaluationRunner.js";
import { clearEvaluationRuns, getEvaluationRun, listEvaluationRuns } from "./eval/evaluationStore.js";
import { clearRuns, getRun, listRuns } from "./trace/runStore.js";
import { getSandboxState, resetSandboxState } from "./tools/sandboxTools.js";
import { getPersistenceHealth } from "./storage/persistentState.js";
import { createLlmConfigCandidate, getPublicLlmConfig, updateLlmConfig } from "./llm/config.js";
import { testLlmConnection } from "./llm/provider.js";

/** 普通执行接口的请求体，主要用于非流式调试。 */
interface RunAgentBody {
  task: string;
}

/** SSE 执行接口的查询参数，EventSource 只能通过 GET 传参。 */
interface StreamAgentQuery {
  task?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}

/** 历史 trace 明细接口的路径参数。 */
interface RunHistoryParams {
  runId: string;
}

/** 会话详情接口的路径参数，用于恢复指定工作台会话。 */
interface ConversationParams {
  conversationId: string;
}

/** 创建会话接口的请求体，title 可由前端传入，也可由后端后续根据首条任务推断。 */
interface CreateConversationBody {
  title?: string;
}

interface ResolveApprovalBody {
  reason?: string;
}

interface CancelRunBody {
  reason?: string;
}

interface RunEvaluationBody {
  caseIds?: string[];
}

interface EvaluationRunParams {
  evaluationRunId: string;
}

const llmConfigSchema = z.object({
  provider: z.enum(["mock", "openai-compatible"]),
  baseUrl: z.string().trim().url().max(500),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(1_000).optional(),
  clearApiKey: z.boolean().optional(),
  mock: z.boolean(),
  fallbackOnError: z.boolean(),
  requestTimeoutMs: z.number().int().min(1_000).max(300_000),
  maxRetries: z.number().int().min(0).max(10),
}).strict();

const app = Fastify({ logger: true });

/** 所有非 SSE 路由统一返回结构化错误，避免 Fastify 默认响应泄露内部异常文本。 */
app.setErrorHandler((error, request, reply) => {
  const agentError = normalizeAgentError(error, {
    phase: "http_route",
    method: request.method,
    url: request.url,
  });

  return reply.code(getAgentErrorHttpStatus(agentError)).send({
    message: agentError.userMessage,
    error: agentError,
  });
});

await app.register(cors, {
  origin: true,
});

/** 健康检查接口，用于确认后端服务是否已经启动。 */
app.get("/health", async () => ({ ok: true, persistence: getPersistenceHealth() }));

/** 获取脱敏后的当前模型配置，任何情况下都不向浏览器返回 API Key。 */
app.get("/llm/config", async () => getPublicLlmConfig());

/** 使用尚未保存的候选配置测试真实模型连接，Mock 模式只验证本地配置。 */
app.post<{ Body: LlmConfigUpdate }>("/llm/config/test", async (request): Promise<LlmConnectionTestResult> => {
  const input = llmConfigSchema.parse(request.body);
  const config = createLlmConfigCandidate(input);
  const result = await testLlmConnection(config);

  return {
    ok: true,
    provider: config.provider,
    model: config.model,
    mode: result.mode,
    latencyMs: result.latencyMs,
    message: result.mode === "mock" ? "Mock 模式可用" : "模型连接成功",
  };
});

/** 保存当前进程的模型配置；前端会在执行期间禁止调用，避免一个 Run 中途换模型。 */
app.put<{ Body: LlmConfigUpdate }>("/llm/config", async (request, reply) => {
  const input = llmConfigSchema.parse(request.body);
  const hasActiveRun = listRuns().some((run) => run.status === "running" || run.status === "waiting_approval");
  const hasActiveEvaluation = listEvaluationRuns().some((run) => run.status === "running");

  if (hasActiveRun || hasActiveEvaluation) {
    return reply.code(409).send({ message: "当前有任务正在执行，结束后才能切换模型配置。" });
  }

  return updateLlmConfig(input);
});

/** 沙箱状态接口，前端用它展示 Agent 工具调用后的业务状态变化。 */
app.get("/sandbox/state", async () => getSandboxState());

/** 沙箱重置接口，用于反复演示时恢复初始工单、订单和退款状态。 */
app.post("/sandbox/reset", async () => resetSandboxState());

/** 评测用例列表接口，前端用它展示当前内置回归集。 */
app.get("/eval/cases", async () => listEvaluationCases());

/** 评测运行历史接口，返回最近批量评测的完整结果快照。 */
app.get("/eval/runs", async () => listEvaluationRuns());

/** 触发一次批量评测；可传 caseIds 只跑部分用例，默认执行全部内置用例。 */
app.post<{ Body: RunEvaluationBody }>("/eval/runs", async (request) => runEvaluationSuite(request.body?.caseIds));

/** 清空评测运行历史，方便本地演示或重新对比模型/Prompt 效果。 */
app.delete("/eval/runs", async () => {
  clearEvaluationRuns();
  return { ok: true };
});

/** 单次评测详情接口，便于后续从列表跳转到完整断言结果。 */
app.get<{ Params: EvaluationRunParams }>("/eval/runs/:evaluationRunId", async (request, reply) => {
  const evaluationRun = getEvaluationRun(request.params.evaluationRunId);

  if (!evaluationRun) {
    return reply.code(404).send({ message: "Evaluation run not found." });
  }

  return evaluationRun;
});

/** 运行历史摘要接口，前端侧边栏用它展示最近执行过的 trace。 */
app.get("/agent/runs", async () => listRuns());

/** 可恢复会话摘要接口，前端左侧栏用它展示最近的工作台会话。 */
app.get("/agent/conversations", async () => listConversations());

/** 新建会话接口，用户点击“新建”或首次发送任务时会创建一个空会话。 */
app.post<{ Body: CreateConversationBody }>("/agent/conversations", async (request) =>
  createConversation(request.body?.title),
);

/** 读取完整会话详情，包含用户消息、Agent 回复以及嵌入在回复下的 run trace。 */
async function handleGetConversation(
  request: FastifyRequest<{ Params: ConversationParams }>,
  reply: FastifyReply,
) {
  const conversation = getConversation(request.params.conversationId);

  if (!conversation) {
    return reply.code(404).send({ message: "Conversation not found." });
  }

  return conversation;
}

/** 清空当前进程内的会话存储，主要用于本地演示时重置工作台上下文。 */
async function handleClearConversations() {
  clearConversations();
  return { ok: true };
}

/** 删除指定会话；运行中或等待审批的会话会返回 409，要求用户先取消或完成 run。 */
async function handleDeleteConversation(
  request: FastifyRequest<{ Params: ConversationParams }>,
  reply: FastifyReply,
) {
  const result = deleteConversation(request.params.conversationId);

  if (result === "not_found") {
    return reply.code(404).send({ message: "Conversation not found." });
  }

  if (result === "active_run") {
    return reply.code(409).send({ message: "Conversation has an active run." });
  }

  return { ok: true };
}

/** 单条运行历史明细接口，点击历史记录时恢复完整执行时间线。 */
async function handleGetAgentRun(
  request: FastifyRequest<{ Params: RunHistoryParams }>,
  reply: FastifyReply,
) {
  const run = getRun(request.params.runId);

  if (!run) {
    return reply.code(404).send({ message: "Agent run not found." });
  }

  return run;
}

/** 清空当前进程内的运行历史，方便本地演示时重新开始。 */
async function handleClearAgentRuns() {
  clearRuns();
  return { ok: true };
}

/** 查看当前 run 是否有等待中的人工审批，便于前端刷新后恢复审批卡片状态。 */
async function handleGetPendingApproval(
  request: FastifyRequest<{ Params: RunHistoryParams }>,
  reply: FastifyReply,
) {
  const approval = getPendingApprovalByRun(request.params.runId);

  if (!approval) {
    return reply.code(404).send({ message: "Pending approval not found." });
  }

  return approval;
}

/** 批准当前 run 等待中的高风险工具调用，executor 会被唤醒并继续执行工具。 */
async function handleApproveRun(
  request: FastifyRequest<{ Body: ResolveApprovalBody; Params: RunHistoryParams }>,
  reply: FastifyReply,
) {
  const approval = resolveApprovalForRun(request.params.runId, {
    status: "approved",
    reason: request.body?.reason,
  });

  if (!approval) {
    return reply.code(404).send({ message: "Pending approval not found." });
  }

  return approval;
}

/** 拒绝当前 run 等待中的高风险工具调用，executor 会把拒绝结果交回 LLM 生成结论。 */
async function handleRejectRun(
  request: FastifyRequest<{ Body: ResolveApprovalBody; Params: RunHistoryParams }>,
  reply: FastifyReply,
) {
  const approval = resolveApprovalForRun(request.params.runId, {
    status: "rejected",
    reason: request.body?.reason ?? "人工拒绝高风险工具调用。",
  });

  if (!approval) {
    return reply.code(404).send({ message: "Pending approval not found." });
  }

  return approval;
}

/** 取消正在执行或等待审批的 run；若 run 卡在审批点，会先拒绝审批来唤醒 executor。 */
async function handleCancelRun(
  request: FastifyRequest<{ Body: CancelRunBody; Params: RunHistoryParams }>,
  reply: FastifyReply,
) {
  const result = cancelAgentRun(request.params.runId, request.body?.reason ?? "用户取消执行");

  if (result.status === "not_found") {
    return reply.code(404).send({ message: "Agent run not found." });
  }

  if (result.status === "not_cancellable") {
    return reply.code(409).send({
      message: `Agent run is already ${result.run.status}.`,
      status: result.run.status,
    });
  }

  if (result.status === "already_cancelled") {
    return {
      ok: true,
      alreadyCancelled: true,
      status: result.run.status,
    };
  }

  return {
    ok: true,
    cancellation: result.cancellation,
    approvalResolved: result.approvalResolved,
  };
}

/**
 * 非流式 Agent 执行接口。
 * 这个接口会等完整执行结束后一次性返回 AgentRun，适合测试和脚本调试。
 */
async function handleRunAgent(request: FastifyRequest<{ Body: RunAgentBody }>) {
  return runAgentTask(request.body.task);
}

/**
 * 按 SSE 协议写出单个事件。
 * event 字段用于前端 addEventListener 匹配事件名，data 字段承载 JSON payload。
 */
function writeSseEvent(reply: FastifyReply, event: AgentRunEvent) {
  reply.raw.write(`event: ${event.kind}\n`);
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** 生成前后端都可追踪的消息 id，避免 SSE 重连或重复写入时无法定位消息。 */
function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 读取当前 assistant 消息已保存的步骤，后续 step 事件会基于它追加。 */
function getAssistantSteps(conversationId: string, assistantMessageId: string) {
  return getConversation(conversationId)?.messages.find((message) => message.id === assistantMessageId)?.steps ?? [];
}

/** 将 SSE 执行事件同步写入可恢复会话，使刷新页面后仍能看到消息和 trace。 */
function persistRunEventToConversation(conversationId: string, assistantMessageId: string, event: AgentRunEvent) {
  if (event.kind === "run_started") {
    updateAssistantRunMessage(conversationId, assistantMessageId, {
      run: event.run,
      status: event.run.status,
      steps: [],
      errorMessage: "",
    });
    return;
  }

  if (event.kind === "step") {
    updateAssistantRunMessage(conversationId, assistantMessageId, {
      steps: [...getAssistantSteps(conversationId, assistantMessageId), event.step],
    });
    return;
  }

  if (event.kind === "approval_required" || event.kind === "approval_resolved") {
    updateAssistantRunMessage(conversationId, assistantMessageId, {
      run: event.run,
      status: event.run.status,
      steps: event.run.steps,
    });
    return;
  }

  if (event.kind === "run_completed") {
    updateAssistantRunMessage(conversationId, assistantMessageId, {
      content: "Agent 已完成本次任务。",
      run: event.run,
      status: event.run.status,
      steps: event.run.steps,
    });
    return;
  }

  if (event.kind === "run_cancelled") {
    updateAssistantRunMessage(conversationId, assistantMessageId, {
      content: "Agent 执行已取消。",
      run: event.run,
      status: event.run.status,
      steps: event.run.steps,
      // 会话恢复后也必须保持取消与失败语义分离。
      errorMessage: "",
    });
    return;
  }

  if (event.kind === "error") {
    updateAssistantRunMessage(conversationId, assistantMessageId, {
      content: event.error?.userMessage ?? event.message,
      run: event.run,
      status: event.run?.status ?? "failed",
      steps: event.run?.steps ?? getAssistantSteps(conversationId, assistantMessageId),
      errorMessage: event.message,
    });
  }
}

/**
 * 流式 Agent 执行接口。
 * 前端点击执行后会连接这里，后端每生成一个 AgentRunEvent 就立即推送给浏览器。
 */
async function handleRunAgentStream(
  request: FastifyRequest<{ Querystring: StreamAgentQuery }>,
  reply: FastifyReply,
) {
  const task = request.query.task?.trim();

  if (!task) {
    return reply.code(400).send({ message: "Missing task query parameter." });
  }

  const conversation = request.query.conversationId
    ? getConversation(request.query.conversationId)
    : createConversation(task);

  if (!conversation) {
    return reply.code(404).send({ message: "Conversation not found." });
  }

  // 前端会先乐观渲染这两条消息，后端使用相同 id 写入，避免刷新恢复时重复。
  const createdAt = new Date().toISOString();
  const userMessage: ConversationMessage = {
    id: request.query.userMessageId?.trim() || createMessageId("user"),
    role: "user",
    content: task,
    createdAt,
  };
  const assistantMessage: ConversationMessage = {
    id: request.query.assistantMessageId?.trim() || createMessageId("assistant"),
    role: "assistant",
    content: "正在执行 Agent 任务...",
    createdAt,
    steps: [],
    status: "running",
  };

  upsertConversationMessage(conversation.id, userMessage);
  upsertConversationMessage(conversation.id, assistantMessage);

  // 接管原始响应流，Fastify 后续不会再自动序列化返回值，适合手写 SSE。
  reply.hijack();
  reply.raw.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });

  let activeRunId: string | undefined;
  let streamFinished = false;
  const handleClientDisconnect = () => {
    if (!streamFinished && activeRunId) {
      cancelAgentRun(activeRunId, "SSE 客户端连接已断开");
    }
  };
  reply.raw.on("close", handleClientDisconnect);

  try {
    // 执行器是 async generator，每 yield 一次就立即推给浏览器。
    for await (const event of streamAgentTask(task)) {
      if (event.kind === "run_started") {
        activeRunId = event.run.id;
      }
      persistRunEventToConversation(conversation.id, assistantMessage.id, event);
      writeSseEvent(reply, event);
    }
    streamFinished = true;
  } catch (error) {
    const agentError = normalizeAgentError(error, {
      phase: "sse_route",
      conversationId: conversation.id,
      assistantMessageId: assistantMessage.id,
    });
    updateAssistantRunMessage(conversation.id, assistantMessage.id, {
      status: "failed",
      content: agentError.userMessage,
      errorMessage: agentError.userMessage,
    });
    if (!reply.raw.destroyed && !reply.raw.writableEnded) {
      writeSseEvent(reply, {
        kind: "error",
        message: agentError.userMessage,
        error: agentError,
      });
    }
  } finally {
    streamFinished = true;
    reply.raw.off("close", handleClientDisconnect);
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  }
}

app.post<{ Body: RunAgentBody }>("/agent/run", handleRunAgent);
app.get<{ Querystring: StreamAgentQuery }>("/agent/run/stream", handleRunAgentStream);
app.get<{ Params: ConversationParams }>("/agent/conversations/:conversationId", handleGetConversation);
app.delete("/agent/conversations", handleClearConversations);
app.delete<{ Params: ConversationParams }>("/agent/conversations/:conversationId", handleDeleteConversation);
app.get<{ Params: RunHistoryParams }>("/agent/runs/:runId", handleGetAgentRun);
app.get<{ Params: RunHistoryParams }>("/agent/runs/:runId/approval", handleGetPendingApproval);
app.post<{ Body: ResolveApprovalBody; Params: RunHistoryParams }>("/agent/runs/:runId/approve", handleApproveRun);
app.post<{ Body: ResolveApprovalBody; Params: RunHistoryParams }>("/agent/runs/:runId/reject", handleRejectRun);
app.post<{ Body: CancelRunBody; Params: RunHistoryParams }>("/agent/runs/:runId/cancel", handleCancelRun);
app.delete("/agent/runs", handleClearAgentRuns);

await app.listen({ host: "127.0.0.1", port: 3001 });
