import type { Customer, Order, Policy, Refund, Ticket } from "@agentflow/shared";

function createInitialTickets(): Ticket[] {
  return [
    {
      id: "T-1001",
      customerId: "C-9001",
      orderId: "O-7001",
      title: "客户申请退款",
      description: "VIP 客户反馈近期购买的企业版服务未达到预期，希望根据合同规则申请退款。",
      status: "open",
      priority: "high",
    },
    {
      id: "T-1002",
      customerId: "C-9002",
      orderId: "O-7002",
      title: "普通客户咨询发票",
      description: "客户希望补开发票，不涉及退款或敏感业务状态变更。",
      status: "open",
      priority: "medium",
    },
  ];
}

function createInitialCustomers(): Customer[] {
  return [
    {
      id: "C-9001",
      name: "恒星科技",
      level: "vip",
      riskScore: 12,
      contractValue: 120000,
    },
    {
      id: "C-9002",
      name: "青柠设计",
      level: "standard",
      riskScore: 3,
      contractValue: 9800,
    },
  ];
}

function createInitialOrders(): Order[] {
  return [
    {
      id: "O-7001",
      customerId: "C-9001",
      amount: 6800,
      paidAt: "2026-06-10",
      completedAt: "2026-06-18",
      status: "completed",
      refundStatus: "none",
    },
    {
      id: "O-7002",
      customerId: "C-9002",
      amount: 1200,
      paidAt: "2026-05-02",
      completedAt: "2026-05-05",
      status: "completed",
      refundStatus: "none",
    },
  ];
}

function createInitialPolicies(): Policy[] {
  return [
    {
      id: "P-refund-001",
      keyword: "refund",
      title: "VIP 客户退款规则",
      content: "VIP 客户在订单完成 30 天内可进入快速退款审批，金额超过 5000 元需要人工确认。",
    },
    {
      id: "P-risk-001",
      keyword: "approval",
      title: "高风险操作审批规则",
      content: "退款、关闭高优先级工单、修改客户等级等操作必须进入人工审批流程。",
    },
    {
      id: "P-invoice-001",
      keyword: "发票",
      title: "发票咨询处理规则",
      content: "补开发票属于普通客服咨询，应核对客户和订单信息后记录处理意见，不应创建退款或进入高风险审批。",
    },
  ];
}

export const tickets: Ticket[] = createInitialTickets();
export const customers: Customer[] = createInitialCustomers();
export const orders: Order[] = createInitialOrders();
export const policies: Policy[] = createInitialPolicies();
export const refunds: Refund[] = [];

/** 重置内存沙箱数据，保证演示时可以回到初始业务状态。 */
export function resetSandboxSeed() {
  tickets.splice(0, tickets.length, ...createInitialTickets());
  customers.splice(0, customers.length, ...createInitialCustomers());
  orders.splice(0, orders.length, ...createInitialOrders());
  policies.splice(0, policies.length, ...createInitialPolicies());
  refunds.splice(0, refunds.length);
}
