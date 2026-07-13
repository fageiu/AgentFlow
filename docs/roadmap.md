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

## Week 9

- Run cancellation contract and cancel API.
- Executor stops at step boundaries and emits `run_cancelled`.
- Frontend cancel and retry controls in the conversation composer.
- Restored conversations mark interrupted running messages as retryable.
- Assistant messages show their own execution status.

## Week 10

- Local JSON persistence for conversations, run history, and current-process pending approval metadata.
- Store APIs keep their existing call semantics while writing through `.agentflow-data/server-state.json`.
- Server startup reloads conversation and run snapshots from disk.
- Recovered `running` or `waiting_approval` runs are downgraded to failed/interrupted snapshots because executor promises cannot survive process restart.
- Stale pending approval metadata is cleared on restart to avoid approving a request that no executor can resume.

## Week 11

- Evaluation case contract for repeatable Agent regression tasks.
- Nine built-in deterministic cases covering VIP refund approval, non-refund invoice handling, invalid ticket safety, lowercase ticket normalization, and refund idempotency.
- Batch evaluation runner that resets sandbox state per case and reuses the normal Agent execution path.
- Rule-based scorer checks tools, approval behavior, run status, and final sandbox state.
- Evaluation APIs for cases, running suites, listing history, and reading run details.
- Frontend evaluation panel with case list, pass/fail summary, and assertion-level results.

## Week 12

- Evaluation cases are grouped by capability: refund flow, approval boundary, knowledge retrieval, safety, and idempotency.
- Evaluation results include assertion diagnosis, tool traces, failed assertion counts, and approval behavior snapshots.
- Each evaluation run compares against the previous completed run and marks cases as regressed, recovered, unchanged, or new.
- Frontend evaluation panel supports group filtering, running a single capability group, recent-run selection, regression summary, and per-case detail inspection.
- Persisted Week 11 evaluation results are normalized on load so older local data remains readable after the Week 12 contract expansion.

## Week 13

- Evaluation set expanded to twelve built-in cases, reaching the original 10-20 golden task target range.
- Agent runs collect LLM call count, tool call count, model names, and token usage from provider responses when available.
- Mock and fallback LLM calls provide estimated token usage so local demos still show complete evaluation metrics.
- Evaluation summaries report success rate inputs, average duration, average tool calls, total tool calls, average tokens, total tokens, models, and failure reasons.
- Evaluation runs persist provider, model, prompt version, and mock/real mode, enabling comparison across different model or prompt configurations.
- Frontend evaluation panel shows model/prompt configuration, token metrics, average tool calls, top failure reasons, and A/B comparison between two evaluation runs.
- Right-side context is split into enterprise-style tabs for business state, evaluation runs, and evaluation comparison, with each view extracted into a dedicated Vue component.

## Week 14

- Frontend shell begins structural decomposition: conversation sidebar and Agent workspace are extracted from `App.vue`.
- Frontend API calls are centralized under `apps/web/src/api`, including sandbox, conversations, Agent run control, approval, and evaluation requests.
- Shared frontend formatting and status-label helpers are centralized under `apps/web/src/utils`, reducing duplicated presentation logic across evaluation panels.
- Agent run trace rendering is extracted into `RunTraceTimeline.vue`, keeping approval controls colocated with step cards.
- Evaluation view derivation moves into `useEvaluationView()`, separating filtering, active run selection, group summaries, and A/B comparison metrics from the shell component.

## Week 14.5

- Agent tool registry adds read-only ticket query tools: `listTickets` for all tickets and `searchTickets` for status, priority, customer, or keyword filtering.
- Prompt guidance now distinguishes query/list/filter tasks from processing tasks, keeping query answers read-only and avoiding refund or ticket-status writes.
- Mock Tool Calling supports ticket query tasks so local demos can answer "查询所有工单" without an API key.
- Evaluation suite expands to fifteen golden tasks with query cases for all tickets, high-priority tickets, and customer-specific ticket lookup.
- Deterministic judge supports final-message exclusion assertions to catch query results that include unrelated tickets.

## Week 14.6

- Sandbox seed data expands from two fixed examples to a richer mini business world: ten tickets, six customers, ten orders, and eight policies.
- New sample tickets cover refund, invoice, SLA outage, contract upgrade, order cancellation, high-risk closure, duplicate refund, and knowledge Q&A scenarios.
- Initial refund records remain empty so existing evaluation cases can continue asserting that read-only or non-refund tasks do not create refunds.

## Week 14.7

- Agent execution adds a dedicated error handling layer with normalized error codes, categories, retry hints, and user-facing messages.
- Tool failures now create failed trace steps instead of disappearing into route-level exceptions.
- Failed runs persist structured `error` metadata and stream SSE `error` events with the latest run snapshot.
- Evaluation safety cases assert `BUSINESS_DATA_NOT_FOUND`, covering missing-ticket paths without triggering approval or write tools.

## Week 15

- GitHub Actions quality gate runs server tests, workspace type checks, production builds, and the complete Mock Golden Task suite.
- Evaluation failures and execution errors return a non-zero exit code, preventing regressed changes from passing the gate.
- CI publishes the generated Markdown summary and retains Markdown/JSON evaluation reports as downloadable artifacts.
- Real-model evaluation remains a separately authorized release check so pull requests do not incur API costs.

## Week 15.1

- Agent runs persist a structured Outcome containing a server-derived decision, performed write actions, evidence references, and the model-authored user message.
- Outcome decisions are derived from trusted run status, approval resolution, and executed tool trace rather than natural-language claims.
- Deterministic evaluation supports `outcomeDecision` assertions, preventing semantically correct model wording changes from creating false regressions.
- Legacy persisted runs remain readable without an Outcome; interrupted runs recovered after restart receive a failed Outcome.
