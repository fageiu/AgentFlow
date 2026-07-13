import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentPlan, AgentRun, AgentStep, EvaluationCase } from "@agentflow/shared";

test("非明确退款任务的 Action Planner 写入计划应归一化为空计划", async () => {
  const testDataDir = join(process.cwd(), ".agentflow-test-data");

  // executor 会初始化持久化模块，必须先指定测试目录，避免污染后续故障注入用例。
  process.env.LLM_MOCK = "true";
  process.env.AGENTFLOW_DATA_DIR = testDataDir;
  rmSync(testDataDir, { force: true, recursive: true });

  const { constrainActionPlan } = await import("./executor.js");
  const unsafePlan: AgentPlan = {
    version: 1,
    summary: "同步非退款咨询工单状态。",
    steps: [
      {
        id: "sync-ticket",
        title: "同步工单状态",
        objective: "更新已处理状态",
        allowedTools: ["updateTicketStatus"],
        requiresApproval: false,
      },
    ],
  };

  const constrained = constrainActionPlan(
    unsafePlan,
    "处理工单 T-1002：客户咨询补开发票，判断是否需要退款并给出处理结论。",
    { ticket: { id: "T-1002", category: "invoice" } },
  );

  assert.deepEqual(constrained.steps, []);
  assert.ok(/阻止业务写入/.test(constrained.summary));
});

test("确定性 Judge 应根据结构化 Outcome 判断业务结论而非回复措辞", async () => {
  const { deriveAgentOutcome } = await import("./outcome.js");
  const { scoreEvaluationCase } = await import("../eval/evaluationScorer.js");
  const { getSandboxState, resetSandboxState } = await import("../tools/sandboxTools.js");
  const now = new Date().toISOString();
  const run: AgentRun = {
    id: "run-judge-equivalent-text",
    task: "核查合同升级是否需要退款。",
    status: "completed",
    createdAt: now,
    completedAt: now,
    steps: [
      {
        id: "final-step",
        type: "final",
        title: "处理结果",
        detail: "相关情况已核查完毕，后续请参考规则处理。",
        status: "completed",
      },
    ],
  };
  run.outcome = deriveAgentOutcome(run);
  const evaluationCase: EvaluationCase = {
    id: "judge-equivalent-text",
    group: "safety",
    groupLabel: "异常安全",
    title: "结构化 Outcome 断言",
    description: "验证确定性 Judge 不依赖自然语言中的固定退款短语。",
    task: run.task,
    expectations: {
      runStatus: "completed",
      outcomeDecision: "no_refund",
      totalRefundCount: 0,
    },
  };

  resetSandboxState();
  const result = scoreEvaluationCase({
    case: evaluationCase,
    durationMs: 0,
    run,
    sandboxState: structuredClone(getSandboxState()),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.outcomeDecision, "no_refund");
  assert.ok(result.assertions.some((item) => item.id === "outcome-decision" && item.passed));
});

test("人工拒绝退款审批后不产生任何业务副作用", async () => {
  const testDataDir = join(process.cwd(), ".agentflow-test-data");

  // 测试必须使用确定性的 Mock Provider，并隔离持久化文件，避免污染本地 Demo 数据。
  process.env.LLM_MOCK = "true";
  process.env.AGENTFLOW_DATA_DIR = testDataDir;
  rmSync(testDataDir, { force: true, recursive: true });

  const { runAgentTask } = await import("./executor.js");
  const { getSandboxState, resetSandboxState } = await import("../tools/sandboxTools.js");
  const { clearRuns } = await import("../trace/runStore.js");

  resetSandboxState();

  try {
    const before = structuredClone(getSandboxState());
    const run = await runAgentTask(
      "处理工单 T-1001：判断退款条件，必要时创建退款并更新工单状态。",
      "reject",
    );
    const after = structuredClone(getSandboxState());
    const approvalStep = run.steps.find((step) => step.type === "approval");

    assert.equal(run.status, "completed");
    assert.equal(run.outcome?.decision, "manual_review");
    assert.deepEqual(run.outcome?.performedActions, [], "审批拒绝后的结构化 Outcome 不得声称执行过写入");
    assert.equal(approvalStep?.approvalRequest?.status, "rejected");
    assert.equal(after.refunds.length, 0, "审批拒绝后不得创建退款记录");
    assert.equal(
      after.orders.find((order) => order.id === "O-7001")?.refundStatus,
      "none",
      "审批拒绝后订单退款状态必须保持不变",
    );
    assert.equal(
      after.tickets.find((ticket) => ticket.id === "T-1001")?.status,
      "open",
      "审批拒绝后工单不得进入 waiting_approval",
    );
    assert.ok(
      !run.steps.some((step) => step.type === "tool_call" && step.toolName === "updateTicketStatus"),
      "审批拒绝后不得继续执行状态写入工具",
    );
    assert.deepEqual(after, before, "审批拒绝路径应保持完整业务状态零副作用");
  } finally {
    resetSandboxState();
    clearRuns();
    rmSync(testDataDir, { force: true, recursive: true });
  }
});

test("任务未明说发票时仍应依据工单上下文禁止误退款", async () => {
  const testDataDir = join(process.cwd(), ".agentflow-test-data");

  process.env.LLM_MOCK = "true";
  process.env.AGENTFLOW_DATA_DIR = testDataDir;
  rmSync(testDataDir, { force: true, recursive: true });

  const { runAgentTask } = await import("./executor.js");
  const { getSandboxState, resetSandboxState } = await import("../tools/sandboxTools.js");
  const { clearRuns } = await import("../trace/runStore.js");

  resetSandboxState();

  try {
    const run = await runAgentTask("处理工单 T-1002：判断该咨询是否涉及退款，如不涉及只给出处理结论。");
    const state = structuredClone(getSandboxState());

    assert.equal(run.status, "completed");
    assert.equal(run.outcome?.decision, "no_refund");
    assert.deepEqual(run.outcome?.performedActions, []);
    assert.equal(state.refunds.length, 0, "发票咨询不得产生退款记录");
    assert.equal(state.orders.find((order) => order.id === "O-7002")?.refundStatus, "none");
    assert.equal(state.tickets.find((ticket) => ticket.id === "T-1002")?.status, "open");
    assert.ok(!run.steps.some((step) => step.toolName === "createRefund"), "不得进入退款审批或执行退款工具");
    assert.ok(!run.steps.some((step) => step.type === "approval"), "非退款咨询不得触发人工审批");
  } finally {
    resetSandboxState();
    clearRuns();
    rmSync(testDataDir, { force: true, recursive: true });
  }
});

test("重复退款应通过工具 operation 元数据派生 already_satisfied Outcome", async () => {
  const testDataDir = join(process.cwd(), ".agentflow-test-data");

  process.env.LLM_MOCK = "true";
  process.env.AGENTFLOW_DATA_DIR = testDataDir;
  rmSync(testDataDir, { force: true, recursive: true });

  const { runAgentTask } = await import("./executor.js");
  const { clearRuns } = await import("../trace/runStore.js");
  const { getSandboxState, resetSandboxState } = await import("../tools/sandboxTools.js");
  const task = "处理工单 T-1001：判断客户是否符合退款规则，必要时创建退款并更新工单状态。";

  resetSandboxState();

  try {
    const firstRun = await runAgentTask(task);
    const secondRun = await runAgentTask(task);

    assert.equal(firstRun.outcome?.decision, "refund_required");
    assert.deepEqual(firstRun.outcome?.performedActions, ["createRefund", "updateTicketStatus"]);
    assert.equal(secondRun.outcome?.decision, "already_satisfied");
    assert.deepEqual(secondRun.outcome?.performedActions, [], "幂等复用不得声称产生新的业务写入");
    assert.equal(getSandboxState().refunds.length, 1);
  } finally {
    resetSandboxState();
    clearRuns();
    rmSync(testDataDir, { force: true, recursive: true });
  }
});

test("退款待审批期间禁止把工单关闭", async () => {
  const { createRefund, getSandboxState, resetSandboxState, updateTicketStatus } = await import("../tools/sandboxTools.js");

  resetSandboxState();

  try {
    createRefund("O-7001", 6800, "状态机约束测试");
    let thrown: unknown;

    try {
      updateTicketStatus("T-1001", "closed");
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof Error, "待审批退款对应工单必须拒绝 closed 状态");
    assert.ok(thrown.message.includes("must remain waiting_approval"));
    assert.equal(getSandboxState().tickets.find((ticket) => ticket.id === "T-1001")?.status, "open");
  } finally {
    resetSandboxState();
  }
});

test("run 启动后立即取消应停止后续步骤并保存 cancelled 快照", async () => {
  const testDataDir = join(process.cwd(), ".agentflow-test-data");

  process.env.LLM_MOCK = "true";
  process.env.AGENTFLOW_DATA_DIR = testDataDir;
  rmSync(testDataDir, { force: true, recursive: true });

  const { cancelAgentRun } = await import("./cancelRun.js");
  const { streamAgentTask } = await import("./executor.js");
  const { clearRuns, getRun } = await import("../trace/runStore.js");
  const { getSandboxState, resetSandboxState } = await import("../tools/sandboxTools.js");

  resetSandboxState();

  try {
    const before = structuredClone(getSandboxState());
    const stream = streamAgentTask("处理工单 T-1001：判断退款条件，必要时创建退款并更新工单状态。");
    const started = await stream.next();

    assert.equal(started.value?.kind, "run_started");
    if (!started.value || started.value.kind !== "run_started") {
      throw new Error("流式执行必须先返回 run_started");
    }

    const cancelled = cancelAgentRun(started.value.run.id, "测试立即取消");
    assert.equal(cancelled.status, "accepted");

    const result = await stream.next();
    assert.equal(result.value?.kind, "run_cancelled");
    if (!result.value || result.value.kind !== "run_cancelled") {
      throw new Error("取消后必须返回 run_cancelled");
    }

    assert.equal(result.value.run.status, "cancelled");
    assert.equal(result.value.run.outcome?.decision, "cancelled");
    assert.equal(result.value.run.steps.length, 0, "立即取消后不应继续生成计划或调用工具");
    assert.equal(getRun(result.value.run.id)?.status, "cancelled");
    assert.deepEqual(getSandboxState(), before, "立即取消不得产生业务副作用");
  } finally {
    resetSandboxState();
    clearRuns();
    rmSync(testDataDir, { force: true, recursive: true });
  }
});

test("等待审批时取消应拒绝审批、保持零副作用并结束 run", async () => {
  const testDataDir = join(process.cwd(), ".agentflow-test-data");

  process.env.LLM_MOCK = "true";
  process.env.AGENTFLOW_DATA_DIR = testDataDir;
  rmSync(testDataDir, { force: true, recursive: true });

  const { cancelAgentRun } = await import("./cancelRun.js");
  const { streamAgentTask } = await import("./executor.js");
  const { clearRuns } = await import("../trace/runStore.js");
  const { getSandboxState, resetSandboxState } = await import("../tools/sandboxTools.js");

  resetSandboxState();

  try {
    const before = structuredClone(getSandboxState());
    const stream = streamAgentTask("处理工单 T-1001：判断退款条件，必要时创建退款并更新工单状态。");
    let event = (await stream.next()).value;

    while (event && event.kind !== "approval_required") {
      event = (await stream.next()).value;
    }

    assert.ok(event && event.kind === "approval_required", "退款工具执行前必须进入人工审批");
    if (!event || event.kind !== "approval_required") {
      throw new Error("未进入预期的审批状态");
    }

    const cancellation = cancelAgentRun(event.run.id, "审批期间取消");
    assert.equal(cancellation.status, "accepted");
    if (cancellation.status === "accepted") {
      assert.equal(cancellation.approvalResolved, true, "取消应唤醒等待中的审批 Promise");
    }

    const cancelledEvent = await stream.next();
    assert.equal(cancelledEvent.value?.kind, "run_cancelled");
    if (!cancelledEvent.value || cancelledEvent.value.kind !== "run_cancelled") {
      throw new Error("审批期间取消后必须返回 run_cancelled");
    }

    const approvalStep = cancelledEvent.value.run.steps.find((step: AgentStep) => step.type === "approval");
    assert.equal(cancelledEvent.value.run.outcome?.decision, "cancelled");
    assert.deepEqual(cancelledEvent.value.run.outcome?.performedActions, []);
    assert.equal(approvalStep?.status, "cancelled");
    assert.equal(approvalStep?.approvalRequest?.status, "rejected");
    assert.equal(approvalStep?.approvalRequest?.reason, "审批期间取消");
    assert.deepEqual(getSandboxState(), before, "审批期间取消不得执行高风险工具或产生业务副作用");
  } finally {
    resetSandboxState();
    clearRuns();
    rmSync(testDataDir, { force: true, recursive: true });
  }
});

test("取消服务应校验 run 生命周期并保持重复请求幂等", async () => {
  const testDataDir = join(process.cwd(), ".agentflow-test-data");

  process.env.AGENTFLOW_DATA_DIR = testDataDir;
  rmSync(testDataDir, { force: true, recursive: true });

  const { cancelAgentRun } = await import("./cancelRun.js");
  const { clearRunCancel, getRunCancel, registerRunControl } = await import("./runControl.js");
  const { clearRuns, saveRun } = await import("../trace/runStore.js");

  const createStoredRun = (id: string, status: "running" | "completed" | "cancelled") => ({
    id,
    task: "取消状态测试",
    status,
    steps: [],
    createdAt: new Date().toISOString(),
  });

  try {
    assert.equal(cancelAgentRun("run-not-found").status, "not_found");
    assert.equal(getRunCancel("run-not-found"), undefined, "不存在的 run 不得遗留取消标记");

    saveRun(createStoredRun("run-completed", "completed"));
    assert.equal(cancelAgentRun("run-completed").status, "not_cancellable");
    assert.equal(getRunCancel("run-completed"), undefined, "已完成 run 不得写入取消标记");

    saveRun(createStoredRun("run-cancelled", "cancelled"));
    assert.equal(cancelAgentRun("run-cancelled").status, "already_cancelled");

    saveRun(createStoredRun("run-active", "running"));
    const signal = registerRunControl("run-active");
    const first = cancelAgentRun("run-active", "第一次取消");
    const second = cancelAgentRun("run-active", "第二次取消");

    assert.equal(signal.aborted, true, "取消活跃 run 时必须同步触发 AbortSignal");
    assert.equal(first.status, "accepted");
    assert.equal(second.status, "accepted");
    if (first.status === "accepted" && second.status === "accepted") {
      assert.deepEqual(second.cancellation, first.cancellation, "重复取消必须复用第一次取消结果");
    }
  } finally {
    clearRunCancel("run-active");
    clearRuns();
    rmSync(testDataDir, { force: true, recursive: true });
  }
});

test("工具调用循环超限应归类为执行器保护错误", async () => {
  const { normalizeAgentError } = await import("./errors.js");
  const error = normalizeAgentError(new Error("LLM tool calling loop exceeded 10 turns."));

  assert.equal(error.code, "AGENT_LOOP_LIMIT_EXCEEDED");
  assert.equal(error.category, "system");
  assert.equal(error.retryable, true);
});

test("类型化错误应保留稳定错误码并合并执行上下文", async () => {
  const {
    BusinessDataNotFoundError,
    LlmResponseFormatError,
    getAgentErrorHttpStatus,
    normalizeAgentError,
  } = await import("./errors.js");
  const businessError = normalizeAgentError(new BusinessDataNotFoundError("Ticket", "T-9999"), {
    phase: "tool_call",
  });
  const responseError = normalizeAgentError(new LlmResponseFormatError("LLM response is not valid JSON."));

  assert.equal(businessError.code, "BUSINESS_DATA_NOT_FOUND");
  assert.equal(businessError.details?.entity, "Ticket");
  assert.equal(businessError.details?.phase, "tool_call");
  assert.equal(responseError.code, "LLM_RESPONSE_FORMAT_ERROR");
  assert.equal(responseError.category, "llm");
  assert.equal(getAgentErrorHttpStatus(businessError), 404);
  assert.equal(getAgentErrorHttpStatus(responseError), 502);
});

test("Provider 应对 5xx 有限重试并在恢复后返回真实结果", async () => {
  const originalFetch = globalThis.fetch;
  const envKeys = [
    "LLM_MOCK",
    "LLM_PROVIDER",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_FALLBACK_ON_ERROR",
    "LLM_MAX_RETRIES",
    "LLM_REQUEST_TIMEOUT_MS",
  ] as const;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let attempts = 0;

  process.env.LLM_MOCK = "false";
  process.env.LLM_PROVIDER = "openai-compatible";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://provider.test/v1";
  process.env.LLM_FALLBACK_ON_ERROR = "false";
  process.env.LLM_MAX_RETRIES = "2";
  process.env.LLM_REQUEST_TIMEOUT_MS = "1000";
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts < 3) {
      return new Response("temporary unavailable", {
        status: 503,
        headers: { "Retry-After": "0" },
      });
    }

    return new Response(JSON.stringify({
      choices: [{ message: { content: "provider recovered" } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const { generateText } = await import("../llm/provider.js");
    const result = await generateText({ system: "test", user: "test" });

    assert.equal(attempts, 3);
    assert.equal(result.text, "provider recovered");
    assert.equal(result.isMock, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("Provider 超时应产生稳定错误码，fallback 应显式保留降级来源", async () => {
  const originalFetch = globalThis.fetch;
  const envKeys = [
    "LLM_MOCK",
    "LLM_PROVIDER",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_FALLBACK_ON_ERROR",
    "LLM_MAX_RETRIES",
    "LLM_REQUEST_TIMEOUT_MS",
  ] as const;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.LLM_MOCK = "false";
  process.env.LLM_PROVIDER = "openai-compatible";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://provider.test/v1";
  process.env.LLM_MAX_RETRIES = "0";
  process.env.LLM_REQUEST_TIMEOUT_MS = "10";
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });

  try {
    const { normalizeAgentError } = await import("./errors.js");
    const { generateText } = await import("../llm/provider.js");
    process.env.LLM_FALLBACK_ON_ERROR = "false";
    let timeoutError: unknown;

    try {
      await generateText({ system: "test", user: "test" });
    } catch (error) {
      timeoutError = error;
    }

    assert.equal(normalizeAgentError(timeoutError).code, "LLM_TIMEOUT");

    process.env.LLM_FALLBACK_ON_ERROR = "true";
    const fallback = await generateText({ system: "test", user: "test" });
    assert.equal(fallback.isMock, true);
    assert.equal(fallback.fallback?.provider, "openai-compatible");
    assert.equal(fallback.fallback?.model.length ? true : false, true);
    assert.ok(/timed out/i.test(fallback.fallback?.reason ?? ""));
    assert.ok(!fallback.text.includes("[Mock fallback"), "结构化输出不得混入 fallback 调试文本");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("退款创建后续写入失败时应回滚部分业务副作用", async () => {
  const testDataDir = join(process.cwd(), ".agentflow-test-data");

  process.env.LLM_MOCK = "true";
  process.env.AGENTFLOW_DATA_DIR = testDataDir;
  rmSync(testDataDir, { force: true, recursive: true });

  const { runAgentTask } = await import("./executor.js");
  const { clearRuns } = await import("../trace/runStore.js");
  const { toolRegistry } = await import("../tools/toolRegistry.js");
  const { getSandboxState, resetSandboxState } = await import("../tools/sandboxTools.js");
  const originalUpdateTicketStatus = toolRegistry.updateTicketStatus.execute;

  resetSandboxState();
  toolRegistry.updateTicketStatus.execute = () => {
    throw new Error("Injected updateTicketStatus failure.");
  };

  try {
    let thrown: unknown;
    try {
      await runAgentTask("处理工单 T-1001：判断退款条件，必要时创建退款并更新工单状态。");
    } catch (error) {
      thrown = error;
    }

    const state = getSandboxState();
    assert.ok(thrown instanceof Error, "后续状态写入失败时 run 必须失败");
    assert.equal(state.refunds.length, 0, "回滚后不得残留已创建退款");
    assert.equal(state.orders.find((order) => order.id === "O-7001")?.refundStatus, "none");
    assert.equal(state.tickets.find((ticket) => ticket.id === "T-1001")?.status, "open");
  } finally {
    toolRegistry.updateTicketStatus.execute = originalUpdateTicketStatus;
    resetSandboxState();
    clearRuns();
    rmSync(testDataDir, { force: true, recursive: true });
  }
});

test("模型返回非法 JSON 时应归类为响应格式错误", async () => {
  const originalFetch = globalThis.fetch;
  const envKeys = [
    "LLM_MOCK",
    "LLM_PROVIDER",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_FALLBACK_ON_ERROR",
    "LLM_MAX_RETRIES",
  ] as const;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  process.env.LLM_MOCK = "false";
  process.env.LLM_PROVIDER = "openai-compatible";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://provider.test/v1";
  process.env.LLM_FALLBACK_ON_ERROR = "false";
  process.env.LLM_MAX_RETRIES = "0";
  globalThis.fetch = async () => new Response("not-json", { status: 200 });

  try {
    const { normalizeAgentError } = await import("./errors.js");
    const { generateText } = await import("../llm/provider.js");
    let thrown: unknown;

    try {
      await generateText({ system: "test", user: "test" });
    } catch (error) {
      thrown = error;
    }

    assert.equal(normalizeAgentError(thrown).code, "LLM_RESPONSE_FORMAT_ERROR");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("工具参数缺失时应返回可诊断的校验错误", async () => {
  const { normalizeAgentError } = await import("./errors.js");
  const { runTool } = await import("../tools/toolRegistry.js");
  let thrown: unknown;

  try {
    runTool("createRefund", { orderId: "O-7001" });
  } catch (error) {
    thrown = error;
  }

  const normalized = normalizeAgentError(thrown, { phase: "fault_injection" });
  assert.equal(normalized.code, "TOOL_INPUT_VALIDATION_ERROR");
  assert.equal(normalized.category, "tool");
  assert.ok(Array.isArray(normalized.details?.issues));
});

test("持久化目录不可写时应进入降级并返回结构化错误", async () => {
  const testDataDir = join(process.cwd(), ".agentflow-test-data");
  const { normalizeAgentError } = await import("./errors.js");
  const { getPersistenceHealth, writePersistentState } = await import("../storage/persistentState.js");

  rmSync(testDataDir, { force: true, recursive: true });
  // 用普通文件占据数据目录路径，稳定模拟 mkdir/write 失败，无需修改真实目录权限。
  writeFileSync(testDataDir, "blocked", "utf8");

  try {
    let thrown: unknown;
    try {
      writePersistentState({
        version: 1,
        conversations: [],
        runs: [],
        pendingApprovals: [],
        evaluationRuns: [],
      });
    } catch (error) {
      thrown = error;
    }

    assert.equal(normalizeAgentError(thrown).code, "STORAGE_WRITE_ERROR");
    assert.equal(getPersistenceHealth().degraded, true);
  } finally {
    rmSync(testDataDir, { force: true, recursive: true });
  }
});
