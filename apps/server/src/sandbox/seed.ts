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
    {
      id: "T-1003",
      customerId: "C-9003",
      orderId: "O-7003",
      title: "企业客户服务不可用投诉",
      description: "企业客户反馈核心接口连续两小时不可用，要求核查 SLA 并给出补偿方案。",
      status: "open",
      priority: "high",
    },
    {
      id: "T-1004",
      customerId: "C-9004",
      orderId: "O-7004",
      title: "合同升级咨询",
      description: "VIP 客户希望从专业版升级到企业版，需要确认合同金额、升级规则和下一步流程。",
      status: "open",
      priority: "low",
    },
    {
      id: "T-1005",
      customerId: "C-9005",
      orderId: "O-7005",
      title: "订单取消后费用说明",
      description: "客户订单已取消，咨询是否还会产生费用以及是否需要客服记录处理意见。",
      status: "open",
      priority: "medium",
    },
    {
      id: "T-1006",
      customerId: "C-9006",
      orderId: "O-7006",
      title: "高风险客户关闭工单请求",
      description: "高风险企业客户要求立即关闭投诉工单，需要判断是否应进入人工审批。",
      status: "waiting_approval",
      priority: "high",
    },
    {
      id: "T-1007",
      customerId: "C-9003",
      orderId: "O-7007",
      title: "重复退款申请核查",
      description: "企业客户再次提交退款诉求，需要核查是否存在重复申请风险。",
      status: "open",
      priority: "medium",
    },
    {
      id: "T-1008",
      customerId: "C-9004",
      orderId: "O-7008",
      title: "SLA 知识问答",
      description: "客户询问服务等级协议中的响应时间口径，不涉及订单退款或状态变更。",
      status: "closed",
      priority: "low",
    },
    {
      id: "T-1009",
      customerId: "C-9005",
      orderId: "O-7009",
      title: "发票抬头更正失败",
      description: "客户补开发票时发现抬头信息错误，上一轮处理被拒绝，需要重新说明原因。",
      status: "rejected",
      priority: "medium",
    },
    {
      id: "T-1010",
      customerId: "C-9001",
      orderId: "O-7010",
      title: "续费折扣争议",
      description: "VIP 客户认为续费折扣未按合同执行，要求客服核对订单和合同升级政策。",
      status: "open",
      priority: "high",
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
    {
      id: "C-9003",
      name: "北辰制造",
      level: "enterprise",
      riskScore: 18,
      contractValue: 360000,
    },
    {
      id: "C-9004",
      name: "云澜教育",
      level: "vip",
      riskScore: 8,
      contractValue: 86000,
    },
    {
      id: "C-9005",
      name: "微光零售",
      level: "standard",
      riskScore: 27,
      contractValue: 15600,
    },
    {
      id: "C-9006",
      name: "远航能源",
      level: "enterprise",
      riskScore: 42,
      contractValue: 520000,
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
    {
      id: "O-7003",
      customerId: "C-9003",
      amount: 42800,
      paidAt: "2026-06-01",
      completedAt: "2026-06-03",
      status: "completed",
      refundStatus: "none",
    },
    {
      id: "O-7004",
      customerId: "C-9004",
      amount: 16800,
      paidAt: "2026-06-22",
      completedAt: "2026-06-25",
      status: "completed",
      refundStatus: "none",
    },
    {
      id: "O-7005",
      customerId: "C-9005",
      amount: 980,
      paidAt: "2026-04-15",
      completedAt: "2026-04-15",
      status: "cancelled",
      refundStatus: "none",
    },
    {
      id: "O-7006",
      customerId: "C-9006",
      amount: 78000,
      paidAt: "2026-06-05",
      completedAt: "2026-06-20",
      status: "completed",
      refundStatus: "none",
    },
    {
      id: "O-7007",
      customerId: "C-9003",
      amount: 12600,
      paidAt: "2026-05-19",
      completedAt: "2026-05-29",
      status: "completed",
      refundStatus: "none",
    },
    {
      id: "O-7008",
      customerId: "C-9004",
      amount: 3600,
      paidAt: "2026-03-08",
      completedAt: "2026-03-10",
      status: "completed",
      refundStatus: "none",
    },
    {
      id: "O-7009",
      customerId: "C-9005",
      amount: 640,
      paidAt: "2026-05-12",
      completedAt: "2026-05-14",
      status: "completed",
      refundStatus: "none",
    },
    {
      id: "O-7010",
      customerId: "C-9001",
      amount: 23800,
      paidAt: "2026-06-28",
      completedAt: "2026-06-30",
      status: "paid",
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
    {
      id: "P-cancel-001",
      keyword: "cancel",
      title: "订单取消咨询规则",
      content: "订单已取消且未完成交付时，应优先说明费用状态和后续恢复路径，不应默认进入退款流程。",
    },
    {
      id: "P-sla-001",
      keyword: "sla",
      title: "SLA 服务不可用处理规则",
      content: "企业客户服务不可用超过 60 分钟时，应记录影响范围并升级给值班经理，补偿方案需结合合同等级确认。",
    },
    {
      id: "P-upgrade-001",
      keyword: "upgrade",
      title: "合同升级处理规则",
      content: "合同升级应核对客户等级、当前订单金额和目标版本，不涉及退款时不得创建退款记录。",
    },
    {
      id: "P-duplicate-refund-001",
      keyword: "duplicate-refund",
      title: "重复退款核查规则",
      content: "重复退款申请需要先核查既有退款记录和订单退款状态，避免为同一订单创建多条待审批退款。",
    },
    {
      id: "P-security-001",
      keyword: "security",
      title: "高风险关闭工单规则",
      content: "高风险客户或高优先级投诉的关闭动作必须由人工审批确认，Agent 不应直接关闭工单。",
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
