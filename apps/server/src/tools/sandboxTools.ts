import { customers, policies, tickets } from "../sandbox/seed.js";

export function getTicket(ticketId: string) {
  const ticket = tickets.find((item) => item.id === ticketId);
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }
  return ticket;
}

export function getCustomer(customerId: string) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) {
    throw new Error(`Customer not found: ${customerId}`);
  }
  return customer;
}

export function searchPolicy(keyword: string) {
  const policy = policies.find((item) => item.keyword === keyword);
  if (!policy) {
    throw new Error(`Policy not found: ${keyword}`);
  }
  return policy;
}
