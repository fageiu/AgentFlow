import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

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
