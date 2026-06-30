import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AgentRunEvent } from "@agentflow/shared";
import { runAgentTask, streamAgentTask } from "./agent/executor.js";

/** 普通执行接口的请求体，主要用于非流式调试。 */
interface RunAgentBody {
  task: string;
}

/** SSE 执行接口的查询参数，EventSource 只能通过 GET 传参。 */
interface StreamAgentQuery {
  task?: string;
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

/** 健康检查接口，用于确认后端服务是否已经启动。 */
app.get("/health", async () => ({ ok: true }));

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

await app.listen({ host: "127.0.0.1", port: 3001 });
