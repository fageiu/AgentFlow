import {
  customers,
  orders,
  policies,
  resetSandboxSeed,
  refunds,
  tickets,
} from "../sandbox/seed.js";
import type { RefundStatus, Ticket, TicketStatus } from "@agentflow/shared";

export interface SearchTicketsInput {
  status?: TicketStatus;
  priority?: Ticket["priority"];
  customerId?: string;
  keyword?: string;
}

/** 查询全部工单摘要，供 Agent 处理“列出/查看所有工单”这类只读任务。 */
export function listTickets() {
  return tickets.map((ticket) => ({ ...ticket }));
}

/** 按状态、优先级、客户或关键词筛选工单，保持查询类任务不需要读取全量沙箱。 */
export function searchTickets(input: SearchTicketsInput) {
  const keyword = input.keyword?.trim().toLowerCase();

  return tickets
    .filter((ticket) => !input.status || ticket.status === input.status)
    .filter((ticket) => !input.priority || ticket.priority === input.priority)
    .filter((ticket) => !input.customerId || ticket.customerId === input.customerId)
    .filter((ticket) => {
      if (!keyword) {
        return true;
      }

      return [
        ticket.id,
        ticket.title,
        ticket.description,
        ticket.customerId,
        ticket.orderId,
      ].some((value) => value.toLowerCase().includes(keyword));
    })
    .map((ticket) => ({ ...ticket }));
}

/** 根据工单 ID 查询模拟工单，不存在时抛错让执行链路进入错误处理。 */
export function getTicket(ticketId: string) {
  const ticket = tickets.find((item) => item.id === ticketId);
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }
  return ticket;
}

/** 根据客户 ID 查询模拟客户信息。 */
export function getCustomer(customerId: string) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }
  return customer;
}

/** 根据订单 ID 查询模拟订单，为退款判断提供金额、状态和完成时间。 */
export function getOrder(orderId: string) {
  const order = orders.find((item) => item.id === orderId);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }
  return order;
}

/**
 * 根据业务表达检索模拟政策规则。
 * 先精确命中，再使用别名和包含匹配，避免 LLM 使用“发票补开”这类自然语言时因规则库 keyword 不完全相等而失败。
 */
export function searchPolicy(keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  const policyAliases: Record<string, string> = {
    "发票补开": "发票",
    "补开发票": "发票",
    "发票开具": "发票",
    "开票": "发票",
    "服务不可用": "sla",
    "服务中断": "sla",
    "补偿": "sla",
    "合同升级": "upgrade",
    "升级咨询": "upgrade",
    "升级": "upgrade",
    "订单取消": "cancel",
  };
  const aliasMatch = Object.entries(policyAliases)
    .sort(([left], [right]) => right.length - left.length)
    .find(([phrase]) => normalizedKeyword.includes(phrase))?.[1];
  const canonicalKeyword = policyAliases[normalizedKeyword] ?? aliasMatch ?? normalizedKeyword;
  const policy = policies.find((item) => item.keyword === canonicalKeyword)
    ?? policies.find((item) => canonicalKeyword.includes(item.keyword) || item.keyword.includes(canonicalKeyword));

  if (!policy) {
    throw new Error(`Policy not found: ${keyword}`);
  }

  return {
    ...policy,
    queryKeyword: keyword,
    matchedKeyword: policy.keyword,
  };
}

/**
 * 更新工单状态，并校验退款状态与工单状态的一致性。
 * 关键状态不能只由 LLM 决定，避免退款未创建或已被拒绝时仍把工单写成待审批。
 */
export function updateTicketStatus(ticketId: string, status: TicketStatus) {
  const ticket = getTicket(ticketId);

  if (ticket.status === status) {
    return ticket;
  }

  const order = getOrder(ticket.orderId);
  const requiredRefundStatus: Partial<Record<TicketStatus, RefundStatus>> = {
    waiting_approval: "pending_approval",
    refunded: "created",
    rejected: "rejected",
  };
  const requiredStatus = requiredRefundStatus[status];

  if (requiredStatus && order.refundStatus !== requiredStatus) {
    throw new Error(
      `Cannot update ticket ${ticketId} to ${status}: order ${order.id} refund status must be ${requiredStatus}, current is ${order.refundStatus}.`,
    );
  }

  ticket.status = status;
  return ticket;
}

/** 创建退款记录，并同步订单退款状态。 */
export function createRefund(orderId: string, amount: number, reason: string, status: RefundStatus = "pending_approval") {
  const order = getOrder(orderId);
  const existingRefund = refunds.find((item) => item.orderId === orderId && item.status === status);

  if (existingRefund) {
    order.refundStatus = existingRefund.status;
    return existingRefund;
  }

  if (amount <= 0) {
    throw new Error("Refund amount must be greater than 0.");
  }

  if (amount > order.amount) {
    throw new Error(`Refund amount ${amount} exceeds order amount ${order.amount}.`);
  }

  const refund = {
    id: `R-${String(refunds.length + 1).padStart(4, "0")}`,
    orderId,
    amount,
    reason,
    status,
    createdAt: new Date().toISOString(),
  };

  refunds.push(refund);
  order.refundStatus = status;

  return refund;
}

/** 返回当前沙箱状态，方便前端后续做状态面板或评测断言。 */
export function getSandboxState() {
  return {
    tickets,
    customers,
    orders,
    policies,
    refunds,
  };
}

/** 重置沙箱状态，便于反复演示同一个 Agent 任务。 */
export function resetSandboxState() {
  resetSandboxSeed();
  return getSandboxState();
}
