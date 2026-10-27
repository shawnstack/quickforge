import { agentSessions } from './agent-session-store.mjs'
import { getPendingApprovalForSession, getPendingAutoCompactApprovalForSession } from './approval-store.mjs'
import { getPendingAskForSession } from './ask-store.mjs'

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
      pendingAutoCompactApproval: getPendingAutoCompactApprovalForSession(session.sessionId),
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

  return { getSessionState, isSessionFileRollbackBusy, getSessionStatus, tryAcquireSse, isSseConnected, releaseSse, getSessionEventBus }
}
