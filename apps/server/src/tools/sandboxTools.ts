import { customers, policies, tickets } from "../sandbox/seed.js";

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

/** 根据关键词检索模拟政策规则，后续可替换为 RAG 或数据库检索。 */
export function searchPolicy(keyword: string) {
  const policy = policies.find((item) => item.keyword === keyword);
  if (!policy) {
    throw new Error(`Policy not found: ${keyword}`);
  }
  return policy;
}
