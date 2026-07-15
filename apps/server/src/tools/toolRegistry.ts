import { z } from "zod";
import type { JsonObjectSchema, LlmToolDefinition } from "../llm/types.js";
import {
  createRefund,
  getCustomer,
  getOrder,
  getSandboxState,
  getTicket,
  listTickets,
  resetSandboxState,
  searchPolicy,
  searchTickets,
  updateTicketStatus,
} from "./sandboxTools.js";

export type ToolRiskLevel = "read" | "write" | "high";

export interface SandboxToolDefinition {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  inputSchema: z.ZodType<unknown>;
  jsonSchema: JsonObjectSchema;
  execute(input: unknown): unknown;
}

const getTicketInputSchema = z.object({
  ticketId: z.string(),
});

const searchTicketsInputSchema = z.object({
  status: z.enum(["open", "waiting_approval", "refunded", "rejected", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  customerId: z.string().optional(),
  keyword: z.string().optional(),
});

const getCustomerInputSchema = z.object({
  customerId: z.string(),
});

const getOrderInputSchema = z.object({
  orderId: z.string(),
});

const searchPolicyInputSchema = z.object({
  keyword: z.string(),
});

const updateTicketStatusInputSchema = z.object({
  ticketId: z.string(),
  status: z.enum(["open", "waiting_approval", "refunded", "rejected", "closed"]),
});

const createRefundInputSchema = z.object({
  orderId: z.string(),
  amount: z.number().positive(),
  reason: z.string(),
});

const emptyInputSchema = z.object({}).optional();

const emptyJsonSchema: JsonObjectSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const jsonSchemas = {
  listTickets: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  searchTickets: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["open", "waiting_approval", "refunded", "rejected", "closed"],
        description: "可选工单状态筛选条件。",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "可选优先级筛选条件。",
      },
      customerId: { type: "string", description: "可选客户 ID 筛选条件。" },
      keyword: { type: "string", description: "可选关键词，会匹配工单 ID、标题、描述、客户 ID 或订单 ID。" },
    },
    additionalProperties: false,
  },
  getTicket: {
    type: "object",
    properties: {
      ticketId: { type: "string", description: "工单 ID，例如 T-1001。" },
    },
    required: ["ticketId"],
    additionalProperties: false,
  },
  getCustomer: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户 ID，来自工单 customerId。" },
    },
    required: ["customerId"],
    additionalProperties: false,
  },
  getOrder: {
    type: "object",
    properties: {
      orderId: { type: "string", description: "订单 ID，来自工单 orderId。" },
    },
    required: ["orderId"],
    additionalProperties: false,
  },
  searchPolicy: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "规则关键词，必须依据工单诉求选择：refund、approval、发票、cancel、sla、upgrade、duplicate-refund 或 security。",
      },
    },
    required: ["keyword"],
    additionalProperties: false,
  },
  updateTicketStatus: {
    type: "object",
    properties: {
      ticketId: { type: "string", description: "需要更新状态的工单 ID。" },
      status: {
        type: "string",
        enum: ["open", "waiting_approval", "refunded", "rejected", "closed"],
        description: "工单新状态。",
      },
    },
    required: ["ticketId", "status"],
    additionalProperties: false,
  },
  createRefund: {
    type: "object",
    properties: {
      orderId: { type: "string", description: "需要创建退款的订单 ID。" },
      amount: { type: "number", exclusiveMinimum: 0, description: "退款金额，必须大于 0。" },
      reason: { type: "string", description: "退款原因，会写入退款记录。" },
    },
    required: ["orderId", "amount", "reason"],
    additionalProperties: false,
  },
} satisfies Record<string, JsonObjectSchema>;

export const toolRegistry = {
  listTickets: {
    name: "listTickets",
    description: "查询当前沙箱中的全部工单列表，适合回答“查询所有工单”“列出工单”等只读任务。",
    riskLevel: "read",
    inputSchema: emptyInputSchema,
    jsonSchema: jsonSchemas.listTickets,
    execute() {
      return listTickets();
    },
  },
  searchTickets: {
    name: "searchTickets",
    description: "按状态、优先级、客户或关键词筛选工单，适合回答待处理、高优先级、某客户相关工单等查询任务。",
    riskLevel: "read",
    inputSchema: searchTicketsInputSchema,
    jsonSchema: jsonSchemas.searchTickets,
    execute(input) {
      const parsed = searchTicketsInputSchema.parse(input);
      return searchTickets(parsed);
    },
  },
  getTicket: {
    name: "getTicket",
    description: "根据工单 ID 查询工单详情。",
    riskLevel: "read",
    inputSchema: getTicketInputSchema,
    jsonSchema: jsonSchemas.getTicket,
    execute(input) {
      const parsed = getTicketInputSchema.parse(input);
      return getTicket(parsed.ticketId);
    },
  },
  getCustomer: {
    name: "getCustomer",
    description: "根据客户 ID 查询客户等级、风险分和合同价值。",
    riskLevel: "read",
    inputSchema: getCustomerInputSchema,
    jsonSchema: jsonSchemas.getCustomer,
    execute(input) {
      const parsed = getCustomerInputSchema.parse(input);
      return getCustomer(parsed.customerId);
    },
  },
  getOrder: {
    name: "getOrder",
    description: "根据订单 ID 查询订单金额、完成时间和退款状态。",
    riskLevel: "read",
    inputSchema: getOrderInputSchema,
    jsonSchema: jsonSchemas.getOrder,
    execute(input) {
      const parsed = getOrderInputSchema.parse(input);
      return getOrder(parsed.orderId);
    },
  },
  searchPolicy: {
    name: "searchPolicy",
    description: "根据关键词检索业务规则。",
    riskLevel: "read",
    inputSchema: searchPolicyInputSchema,
    jsonSchema: jsonSchemas.searchPolicy,
    execute(input) {
      const parsed = searchPolicyInputSchema.parse(input);
      return searchPolicy(parsed.keyword);
    },
  },
  updateTicketStatus: {
    name: "updateTicketStatus",
    description: "更新工单状态，会改变沙箱业务数据。",
    riskLevel: "write",
    inputSchema: updateTicketStatusInputSchema,
    jsonSchema: jsonSchemas.updateTicketStatus,
    execute(input) {
      const parsed = updateTicketStatusInputSchema.parse(input);
      const previousStatus = getTicket(parsed.ticketId).status;
      const ticket = updateTicketStatus(parsed.ticketId, parsed.status);
      return {
        ...ticket,
        operation: previousStatus === parsed.status ? "unchanged" : "updated",
      };
    },
  },
  createRefund: {
    name: "createRefund",
    description: "创建退款记录，高风险操作，默认进入待审批状态。",
    riskLevel: "high",
    inputSchema: createRefundInputSchema,
    jsonSchema: jsonSchemas.createRefund,
    execute(input) {
      const parsed = createRefundInputSchema.parse(input);
      const existingRefund = getSandboxState().refunds.find(
        (refund) => refund.orderId === parsed.orderId && refund.status === "pending_approval",
      );
      const refund = createRefund(parsed.orderId, parsed.amount, parsed.reason);
      return {
        ...refund,
        operation: existingRefund ? "reused" : "created",
      };
    },
  },
  getSandboxState: {
    name: "getSandboxState",
    description: "读取当前沙箱全量状态，便于前端展示或评测断言。",
    riskLevel: "read",
    inputSchema: emptyInputSchema,
    jsonSchema: emptyJsonSchema,
    execute() {
      return getSandboxState();
    },
  },
  resetSandboxState: {
    name: "resetSandboxState",
    description: "重置沙箱状态，恢复初始工单、订单和退款记录。",
    riskLevel: "write",
    inputSchema: emptyInputSchema,
    jsonSchema: emptyJsonSchema,
    execute() {
      return resetSandboxState();
    },
  },
} satisfies Record<string, SandboxToolDefinition>;

export type ToolName = keyof typeof toolRegistry;

const agentToolNames = [
  "listTickets",
  "searchTickets",
  "getTicket",
  "getCustomer",
  "getOrder",
  "searchPolicy",
  "createRefund",
  "updateTicketStatus",
] satisfies ToolName[];

export type AgentToolName = (typeof agentToolNames)[number];

export function isToolName(name: string): name is ToolName {
  return name in toolRegistry;
}

export function isAgentToolName(name: string): name is AgentToolName {
  return (agentToolNames as readonly string[]).includes(name);
}

/** 将业务工具转换为 LLM tools，executor 不需要知道具体 JSON Schema 细节。 */
export function listAgentTools(): LlmToolDefinition[] {
  return agentToolNames.map((name) => {
    const tool = toolRegistry[name];

    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema,
    };
  });
}

/** 统一执行工具：先用 schema 校验入参，再调用具体业务函数。 */
export function runTool(name: ToolName, input: unknown) {
  const tool = toolRegistry[name];
  const parsedInput = tool.inputSchema.parse(input);
  const output = tool.execute(parsedInput);

  return {
    tool,
    input: parsedInput,
    output,
  };
}
