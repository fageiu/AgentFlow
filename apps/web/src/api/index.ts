import type {
  AgentRun,
  AgentRunSummary,
  ConversationSession,
  ConversationSessionSummary,
  EvaluationCase,
  EvaluationRun,
  SandboxState,
} from "@agentflow/shared";

export const API_BASE_URL = "http://127.0.0.1:3001";

async function readJson<T>(response: Response, failureMessage: string) {
  if (!response.ok) {
    throw new Error(`${failureMessage}: ${response.status}`);
  }

  return await response.json() as T;
}

function postJson<T>(path: string, body: unknown, failureMessage: string) {
  return fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).then((response) => readJson<T>(response, failureMessage));
}

export function fetchSandboxState() {
  return fetch(`${API_BASE_URL}/sandbox/state`).then((response) =>
    readJson<SandboxState>(response, "Sandbox state request failed"),
  );
}

export function resetSandboxState() {
  return postJson<SandboxState>("/sandbox/reset", {}, "Sandbox reset request failed");
}

export function fetchRunHistory() {
  return fetch(`${API_BASE_URL}/agent/runs`).then((response) =>
    readJson<AgentRunSummary[]>(response, "Run history request failed"),
  );
}

export function fetchRunDetail(runId: string) {
  return fetch(`${API_BASE_URL}/agent/runs/${runId}`).then((response) =>
    readJson<AgentRun>(response, "Run detail request failed"),
  );
}

export async function clearRunHistoryRequest() {
  const response = await fetch(`${API_BASE_URL}/agent/runs`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error(`Run history clear request failed: ${response.status}`);
  }
}

export function fetchEvaluationCases() {
  return fetch(`${API_BASE_URL}/eval/cases`).then((response) =>
    readJson<EvaluationCase[]>(response, "Evaluation cases request failed"),
  );
}

export function fetchEvaluationRuns() {
  return fetch(`${API_BASE_URL}/eval/runs`).then((response) =>
    readJson<EvaluationRun[]>(response, "Evaluation runs request failed"),
  );
}

export function createEvaluationRun(caseIds: string[] | undefined) {
  return postJson<EvaluationRun>(
    "/eval/runs",
    caseIds ? { caseIds } : {},
    "Evaluation run request failed",
  );
}

export async function clearEvaluationRunsRequest() {
  const response = await fetch(`${API_BASE_URL}/eval/runs`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error(`Evaluation runs clear request failed: ${response.status}`);
  }
}

export function fetchConversations() {
  return fetch(`${API_BASE_URL}/agent/conversations`).then((response) =>
    readJson<ConversationSessionSummary[]>(response, "Conversation list request failed"),
  );
}

export function fetchConversation(conversationId: string) {
  return fetch(`${API_BASE_URL}/agent/conversations/${conversationId}`).then((response) =>
    readJson<ConversationSession>(response, "Conversation detail request failed"),
  );
}

export function createConversation(title = "新会话") {
  return postJson<ConversationSession>("/agent/conversations", { title }, "Conversation create request failed");
}

export async function deleteConversation(conversationId: string) {
  const response = await fetch(`${API_BASE_URL}/agent/conversations/${conversationId}`, { method: "DELETE" });

  if (response.status === 409) {
    throw new Error("该会话仍有任务在执行，请完成或取消后再删除。");
  }

  if (!response.ok) {
    throw new Error(`Conversation delete request failed: ${response.status}`);
  }
}

export async function resolveRunApproval(runId: string, action: "approve" | "reject", reason: string) {
  const response = await fetch(`${API_BASE_URL}/agent/runs/${runId}/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    throw new Error(`Approval ${action} request failed: ${response.status}`);
  }
}

export async function cancelRun(runId: string, reason: string) {
  const response = await fetch(`${API_BASE_URL}/agent/runs/${runId}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    throw new Error(`Run cancel request failed: ${response.status}`);
  }
}

// SSE 入口需要保留 URL 构造逻辑，避免组件散落拼接 query 参数。
export function createAgentRunStreamUrl(params: {
  task: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
}) {
  const url = new URL(`${API_BASE_URL}/agent/run/stream`);
  url.searchParams.set("task", params.task);
  url.searchParams.set("conversationId", params.conversationId);
  url.searchParams.set("userMessageId", params.userMessageId);
  url.searchParams.set("assistantMessageId", params.assistantMessageId);
  return url;
}
