# Roadmap

## Week 1

- Project skeleton.
- Mock agent executor.
- Basic task workspace UI.

## Week 2

- Ticket, customer, order, and policy sandbox tools.
- Tool registry and typed tool schemas.
- Refund creation and ticket status update tools.

## Week 3

- Planner-executor loop.
- SSE event stream.
- Trace persistence: in-memory run history, detail API, and frontend restore entry.

## Week 4

- Timeline UI.
- Tool call details.
- Sandbox state panel.

## Week 5

- OpenAI-compatible LLM Tool Calling loop.
- Tool registry JSON Schema export for model-visible tools.
- Mock fallback emits standard tool calls, so local demos keep the same execution path.

## Week 6

- Human approval gate for high-risk tools.
- SSE events for `approval_required` and `approval_resolved`.
- Frontend approval card with approve/reject actions.
- Approval decision is returned to the LLM so execution can continue or produce a rejection-aware final answer.

## Week 7

- Conversation workspace UI.
- Single-session multi-turn message stream.
- Each user message starts one Agent run.
- Agent run trace is embedded under the corresponding assistant message.
- Run history remains as an audit and restore entry.

## Week 8

- Recoverable conversation session model.
- In-memory conversation store for session summaries and full message restore.
- SSE execution persists user and assistant messages into the active conversation.
- Frontend sidebar switches from run history to conversation list.
- Users can create, switch, and continue conversations while run history remains an audit API.
