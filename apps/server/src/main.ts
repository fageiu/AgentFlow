import cors from "@fastify/cors";
import Fastify from "fastify";
import type { AgentRunEvent } from "@agentflow/shared";
import { runAgentTask, streamAgentTask } from "./agent/executor.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

app.get("/health", async () => ({ ok: true }));

app.post<{ Body: { task: string } }>("/agent/run", async (request) => {
  return runAgentTask(request.body.task);
});

app.get<{ Querystring: { task?: string } }>("/agent/run/stream", async (request, reply) => {
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

  const writeEvent = (event: AgentRunEvent) => {
    // SSE 格式要求每条消息以空行结尾；event 是前端 addEventListener 使用的事件名。
    reply.raw.write(`event: ${event.kind}\n`);
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // 执行器是 async generator，每 yield 一次就立即推给浏览器。
    for await (const event of streamAgentTask(task)) {
      writeEvent(event);
    }
  } catch (error) {
    writeEvent({
      kind: "error",
      message: error instanceof Error ? error.message : "Unknown agent execution error.",
    });
  } finally {
    reply.raw.end();
  }
});

await app.listen({ host: "127.0.0.1", port: 3001 });
