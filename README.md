# AgentFlow Sandbox

Enterprise workflow AI agent sandbox and evaluation platform.

## Scope

This project simulates an enterprise ticket workflow. An agent can read tickets, inspect customers and orders, search policies, request approval for risky actions, update business state, and produce an execution trace.

## Modules

- `apps/web`: agent workspace UI.
- `apps/server`: Node.js API, sandbox data, tools, and agent executor.
- `packages/shared`: shared TypeScript types.
- `docs`: roadmap, architecture notes, and resume material.

## First milestone

- Chat/task input.
- SSE execution events.
- Ticket/customer/order/policy sandbox data.
- Tool call timeline.
- Final handling report.
