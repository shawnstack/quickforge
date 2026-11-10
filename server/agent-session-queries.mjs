import { agentSessions } from './agent-session-store.mjs'
import { getPendingApprovalForSession } from './approval-store.mjs'
import { getPendingAskForSession } from './ask-store.mjs'
import { messageLogVersion } from './message-log.mjs'

// Inject projections to avoid a runtime dependency back to the manager facade.
export function createSessionQueries({ sessionGoal, messagesWithRuntimeToolExecutions, runtimePendingToolCalls, getSessionContextUsage, listBackgroundCommands = () => [], getWriteLease = () => null }) {


  /**
   * Get the current state of a session (for page refresh recovery).
   */
  function getSessionState(sessionId) {
    const session = agentSessions.get(sessionId)
    if (!session) return null

    const messages = messagesWithRuntimeToolExecutions(session)
    return {
      sessionId: session.sessionId,
      scope: session.scope,
      projectId: session.projectId,
      source: session.source || undefined,
      accessMode: session.accessMode,
      yoloMode: session.yoloMode,
      systemPrompt: session.agent.state.systemPrompt,
      model: session.model,
      modelRef: session.modelRef || undefined,
      thinkingLevel: session.thinkingLevel,
      title: session.title,
      titleSource: session.titleSource,
      createdAt: session.createdAt,
      lastModified: session.lastModified,
      stateVersion: session.stateVersion || 0,
      /**
       * 消息日志版本：只在消息数组真的变化时递增，与 `stateVersion`（每个
       * 事件都 +1，含 token delta）分离。客户端用它判断「我持有的消息是否
       * 落后」，而不是拿 `stateVersion` 当快照版本用。
       */
      logVersion: messageLogVersion(session),
      messageStorage: session.persistedMessageStorage === 'split' ? 'split' : undefined,
      status: session.status,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      tools: session.agent.state.tools,
      messages,
      pendingToolCalls: runtimePendingToolCalls(session),
      backgroundCommands: listBackgroundCommands(session.sessionId),
      contextCompaction: session.contextCompaction,
      /**
       * In-flight compaction notice or null (see COMPACTION_NOTICE_PHASES in
       * auto-compaction.mjs). Part of the state projection so a page reload or a
       * late-joining client sees "summarizing" instead of an idle-looking panel.
       */
      compactionNotice: session.compactionNotice ?? null,
      contextUsage: getSessionContextUsage(session),
      pendingToolApproval: getPendingApprovalForSession(session.sessionId),
      pendingAsk: getPendingAskForSession(session.sessionId),
      isStreaming: session.abortPending ? false : session.agent.state.isStreaming,
      errorMessage: session.agent.state.errorMessage,
      persistDegraded: session.persistDegraded ? true : undefined,
      /**
       * Session write lease (see server/session-lease.mjs). Clients use it to
       * decide whether the composer is writable; the server still enforces it
       * per write route. `null` means nobody holds it (legacy single-client
       * behaviour: every client may write).
       */
      lease: getWriteLease(session.sessionId),
      goal: sessionGoal(session),
    }
  }


  /**
   * Get a lightweight status snapshot for SSE-first state recovery.
   */
  // Unlike the UI status snapshot, abortPending must remain busy until the
  // underlying stream/tools actually stop. Used by file rollback under its lock.
  function isSessionFileRollbackBusy(sessionId) {
    const session = agentSessions.get(sessionId)
    return Boolean(session && (
      session.agent?.state?.isStreaming || session.abortPending ||
      runtimePendingToolCalls(session).length || getPendingApprovalForSession(sessionId)
    ))
  }


  function getSessionStatus(sessionId) {
    const session = agentSessions.get(sessionId)
    if (!session) return null

    const messages = session.agent.state.messages || []
    const lastMessage = messages[messages.length - 1]
    return {
      sessionId: session.sessionId,
      scope: session.scope,
      projectId: session.projectId,
      source: session.source || undefined,
      title: session.title,
      createdAt: session.createdAt,
      lastModified: session.lastModified,
      stateVersion: session.stateVersion || 0,
      logVersion: messageLogVersion(session),
      status: session.status,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
      isStreaming: session.abortPending ? false : session.agent.state.isStreaming,
      errorMessage: session.agent.state.errorMessage,
      messageCount: messages.length,
      lastMessageTimestamp: lastMessage?.timestamp ?? null,
      persistDegraded: session.persistDegraded ? true : undefined,
      lease: getWriteLease(session.sessionId),
      goal: sessionGoal(session),
    }
  }


  /**
   * Try to claim the SSE slot for a session. Returns true if acquired, false if
   * another tab already holds the SSE connection for this session.
   */
  function tryAcquireSse(sessionId) {
    const session = agentSessions.get(sessionId)
    if (!session || session.sseConnected) return false
    session.sseConnected = true
    return true
  }


  /**
   * Check whether a session already has an active SSE connection, without
   * acquiring it. For use by lightweight HEAD probes.
   */
  function isSseConnected(sessionId) {
    const session = agentSessions.get(sessionId)
    return session ? session.sseConnected : false
  }


  /**
   * Release the SSE slot for a session.
   */
  function releaseSse(sessionId) {
    const session = agentSessions.get(sessionId)
    if (session) session.sseConnected = false
  }


  /**
   * Get the event bus for a session (for SSE connections).
   */
  function getSessionEventBus(sessionId) {
    const session = agentSessions.get(sessionId)
    return session?.eventBus ?? null
  }


  /**
   * Context budget for one session — the "fuel gauge" a model uses to decide
   * whether it still has room to work, or should wrap up and hand off.
   *
   * Deliberately NOT folded into `getSessionStatus`: that snapshot is polled by
   * clients while streaming, and the estimator walks every message. A separate
   * route keeps the hot path cheap.
   */
  function getSessionContextBudget(sessionId) {
    const session = agentSessions.get(sessionId)
    if (!session) return null
    const messages = session.agent?.state?.messages
    return {
      sessionId: session.sessionId,
      modelId: session.model?.id ?? null,
      modelRef: session.modelRef || undefined,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      usage: getSessionContextUsage(session) ?? null,
    }
  }

  return { getSessionState, isSessionFileRollbackBusy, getSessionStatus, getSessionContextBudget, tryAcquireSse, isSseConnected, releaseSse, getSessionEventBus }
}
