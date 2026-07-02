import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AgentRunEvent } from "@agentflow/shared";
import { getPendingApprovalByRun, resolveApprovalForRun } from "./approval/approvalStore.js";
import { runAgentTask, streamAgentTask } from "./agent/executor.js";
import { clearRuns, getRun, listRuns } from "./trace/runStore.js";
import { getSandboxState, resetSandboxState } from "./tools/sandboxTools.js";

/** 普通执行接口的请求体，主要用于非流式调试。 */
interface RunAgentBody {
  task: string;
}

/** SSE 执行接口的查询参数，EventSource 只能通过 GET 传参。 */
interface StreamAgentQuery {
  task?: string;
}

/** 历史 trace 明细接口的路径参数。 */
interface RunHistoryParams {
  runId: string;
}

interface ResolveApprovalBody {
  reason?: string;
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

/** 健康检查接口，用于确认后端服务是否已经启动。 */
app.get("/health", async () => ({ ok: true }));

/** 沙箱状态接口，前端用它展示 Agent 工具调用后的业务状态变化。 */
app.get("/sandbox/state", async () => getSandboxState());

/** 沙箱重置接口，用于反复演示时恢复初始工单、订单和退款状态。 */
app.post("/sandbox/reset", async () => resetSandboxState());

/** 运行历史摘要接口，前端侧边栏用它展示最近执行过的 trace。 */
app.get("/agent/runs", async () => listRuns());

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

  // 接管原始响应流，Fastify 后续不会再自动序列化返回值，适合手写 SSE。
  reply.hijack();
  reply.raw.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });

  try {
    // 执行器是 async generator，每 yield 一次就立即推给浏览器。
    for await (const event of streamAgentTask(task)) {
      writeSseEvent(reply, event);
    }
  } catch (error) {
    writeSseEvent(reply, {
      kind: "error",
      message: error instanceof Error ? error.message : "Unknown agent execution error.",
    });
  } finally {
    reply.raw.end();
  }
}

app.post<{ Body: RunAgentBody }>("/agent/run", handleRunAgent);
app.get<{ Querystring: StreamAgentQuery }>("/agent/run/stream", handleRunAgentStream);
app.get<{ Params: RunHistoryParams }>("/agent/runs/:runId", handleGetAgentRun);
app.get<{ Params: RunHistoryParams }>("/agent/runs/:runId/approval", handleGetPendingApproval);
app.post<{ Body: ResolveApprovalBody; Params: RunHistoryParams }>("/agent/runs/:runId/approve", handleApproveRun);
app.post<{ Body: ResolveApprovalBody; Params: RunHistoryParams }>("/agent/runs/:runId/reject", handleRejectRun);
app.delete("/agent/runs", handleClearAgentRuns);

await app.listen({ host: "127.0.0.1", port: 3001 });
