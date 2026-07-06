import type {
  AgentRun,
  AgentStep,
  ConversationMessage,
  ConversationSession,
  ConversationSessionSummary,
} from "@agentflow/shared";

const sessions = new Map<string, ConversationSession>();

/** 生成内存会话和消息使用的短 id，方便前端调试时辨认来源。 */
function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 统一生成 ISO 时间戳，保证会话排序和消息排序字段一致。 */
function now() {
  return new Date().toISOString();
}

/** 深拷贝会话快照，避免调用方直接修改内存 store 中的对象引用。 */
function cloneSession(session: ConversationSession): ConversationSession {
  return JSON.parse(JSON.stringify(session)) as ConversationSession;
}

/** 将完整会话压缩成侧边栏摘要，避免列表接口一次返回完整 trace。 */
function toSummary(session: ConversationSession): ConversationSessionSummary {
  const lastMessage = session.messages.at(-1);

  return {
    id: session.id,
    title: session.title,
    messageCount: session.messages.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    activeRunId: session.activeRunId,
    lastMessagePreview: lastMessage?.content,
  };
}

/** 根据首条任务推断会话标题，过长时截断以保证侧边栏可读。 */
function inferTitle(task: string) {
  const compact = task.replace(/\s+/g, " ").trim();
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact || "新会话";
}

/** 创建内存会话，这是当前可恢复工作台的持久化边界。 */
export function createConversation(title = "新会话"): ConversationSession {
  const createdAt = now();
  const session: ConversationSession = {
    id: createId("conv"),
    title,
    messages: [],
    createdAt,
    updatedAt: createdAt,
  };

  sessions.set(session.id, cloneSession(session));
  return cloneSession(session);
}

/** 返回会话摘要列表，按更新时间倒序排列，供前端左侧栏展示。 */
export function listConversations(): ConversationSessionSummary[] {
  return [...sessions.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(toSummary);
}

/** 按 id 读取完整会话，包含消息、AgentRun 快照和嵌入式步骤。 */
export function getConversation(conversationId: string): ConversationSession | undefined {
  const session = sessions.get(conversationId);
  return session ? cloneSession(session) : undefined;
}

/** 删除单个空闲会话；仍有活跃 run 的会话不删除，避免执行流和 UI 状态失去对应关系。 */
export function deleteConversation(conversationId: string): "deleted" | "not_found" | "active_run" {
  const session = sessions.get(conversationId);

  if (!session) {
    return "not_found";
  }

  if (session.activeRunId) {
    return "active_run";
  }

  sessions.delete(conversationId);
  return "deleted";
}

/** 新增或替换一条消息，避免 SSE 重连或前端乐观渲染导致重复 user/assistant 消息。 */
export function upsertConversationMessage(conversationId: string, message: ConversationMessage) {
  const session = sessions.get(conversationId);

  if (!session) {
    return undefined;
  }

  const nextMessages = session.messages.filter((item) => item.id !== message.id);
  nextMessages.push(message);
  session.messages = nextMessages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  session.updatedAt = now();

  if (session.messages.length === 1 && message.role === "user") {
    session.title = inferTitle(message.content);
  }

  sessions.set(session.id, cloneSession(session));
  return cloneSession(session);
}

/** 更新指定消息，供 SSE 事件逐步补齐 assistant 回复的状态、run 和 trace。 */
export function updateConversationMessage(
  conversationId: string,
  messageId: string,
  update: (message: ConversationMessage) => ConversationMessage,
) {
  const session = sessions.get(conversationId);

  if (!session) {
    return undefined;
  }

  let didUpdate = false;
  session.messages = session.messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    didUpdate = true;
    return update(message);
  });

  if (!didUpdate) {
    return undefined;
  }

  session.updatedAt = now();
  sessions.set(session.id, cloneSession(session));
  return cloneSession(session);
}

/** 让 assistant 消息始终对齐最新 run 状态和嵌入式 trace。 */
export function updateAssistantRunMessage(
  conversationId: string,
  messageId: string,
  patch: {
    content?: string;
    errorMessage?: string;
    run?: AgentRun;
    status?: ConversationMessage["status"];
    steps?: AgentStep[];
  },
) {
  const session = updateConversationMessage(conversationId, messageId, (message) => ({
    ...message,
    ...patch,
  }));

  if (session && patch.run) {
    const stored = sessions.get(conversationId);

    if (stored) {
      stored.activeRunId =
        patch.run.status === "completed" || patch.run.status === "failed" || patch.run.status === "cancelled"
          ? undefined
          : patch.run.id;
      stored.updatedAt = now();
      sessions.set(stored.id, cloneSession(stored));
      return cloneSession(stored);
    }
  }

  return session;
}

/** 清空进程内会话数据，方便本地演示或测试时重置。 */
export function clearConversations() {
  sessions.clear();
}
