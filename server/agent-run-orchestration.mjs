// agent-manager 模块拆分（god-module-decomposition ⑤）run 编排：
// runPrompt / continueSession / requestSessionCompaction / abortRun /
// abortToolCall / steerAgent / followUpAgent（含 goal 互斥门与重试消息
// 规范化）从 agent-manager.mjs 逐字搬移至此；全部为公共 API 经
// agent-manager.mjs facade re-export，行为与注释语义不变。

import { agentSessions } from './agent-session-store.mjs'
import {
  syncSessionFromStorage,
  restoreAgent,
  refreshSessionModelBinding,
  refreshMemoryState,
  refreshWorkingMemoryState,
} from './agent-session-lifecycle.mjs'
import { resetIdleTimer } from './agent-idle-recycler.mjs'
import { resolveCommandState } from './agent-prompt-commands.mjs'
import {
  resetSessionCompaction,
  summarySession,
  compactSession,
  compactSessionNow,
  clearSession,
} from './agent-compaction.mjs'
import {
  requestForceCompaction,
  lastCompactionMessageIndex,
  syncCompactionIndex,
} from './auto-compaction.mjs'
import {
  activeGoalStatus,
  beginGoalRun,
  clearTerminalGoal,
  notifyGoalAbort,
  sessionGoal,
} from './goal/engine.mjs'
import { isGoalTerminalStatus } from './agent-goal-state.mjs'
import { generateTitle } from './session-utils.mjs'
import {
  contextReferencesFromMessage,
  contextReferencesPrompt,
  validatePromptContextReferences,
  validateContextReferences,
  withCanonicalContextReferences,
} from './context-references.mjs'
import {
  normalizeSelectedCapabilities,
  selectedCapabilitiesFromMessage,
  selectedCapabilityPrompt,
  withCanonicalSelectedCapabilities,
} from './selected-capabilities.mjs'
import {
  beginSessionTurn,
  endSessionTurn,
  clearSessionTurn,
} from './agent-turn-ids.mjs'
import {
  emitSessionEvent,
  updateSessionMessages,
  getSessionContextUsage,
  appendAssistantErrorMessageOnce,
  assistantTextMessage,
} from './agent-session-events.mjs'
import { persistSession, flushSessionPersist } from './agent-persistence.mjs'
import { afterGoalRunPersisted } from './agent-run-events.mjs'
import { pendingApprovals } from './approval-store.mjs'
import { abortRunningCommand } from './tools/index.mjs'
import { logger } from './utils/logger.mjs'

const ABORT_IDLE_WAIT_TIMEOUT_MS = 3000

/**
 * Send a user message to the agent and start the agent loop.
 * Returns immediately; events are streamed via the event bus.
 */
export async function runPrompt(sessionId, message, selectedCapabilities = [], promptCommand = null, transientContextPrompt = null, modelAccessContext = null, contextReferences = undefined) {
  let session = await syncSessionFromStorage(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  // Settlement owns the transcript even after streaming stops. Reject before
  // command resolution: text-only /skill and /clear bypass the active-goal gate.
  if (session.agent.state.isStreaming || session.abortPending || session.goalRunSettling) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes.'), {
      statusCode: 409,
      errorCode: 'GENERATION_ALREADY_RUNNING',
    })
  }

  // Validate references before model refresh, memory refresh, idle timers, title,
  // message persistence, or agent_start side effects.
  const initialUserMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: new Date().toISOString() }
    : message
  const canonicalContextReferences = await validatePromptContextReferences(contextReferences, session)
  const canonicalSelectedCapabilities = normalizeSelectedCapabilities(selectedCapabilities)
  const canonicalInitialUserMessage = withCanonicalSelectedCapabilities(
    withCanonicalContextReferences(initialUserMessage, canonicalContextReferences),
    canonicalSelectedCapabilities,
  )

  if (modelAccessContext) session.modelAccessContext = modelAccessContext
  // Request-scoped source (e.g. 'shared') must gate goal mode for THIS request
  // only; it is threaded explicitly instead of being read back from the session,
  // which would permanently disable the owner after a shared visitor prompted.
  const requestSource = modelAccessContext && typeof modelAccessContext === 'object'
    ? modelAccessContext.source ?? null
    : null
  await refreshSessionModelBinding(session)
  await refreshMemoryState(session)
  await refreshWorkingMemoryState(session)
  resetIdleTimer(session)

  const commandState = await resolveCommandState(session, canonicalInitialUserMessage, promptCommand, requestSource)
  const resolvedUserMessage = commandState.userMessage ?? canonicalInitialUserMessage

  if (commandState.textResponse) {
    session.agent.state.messages = [
      ...session.agent.state.messages,
      canonicalInitialUserMessage,
      assistantTextMessage(commandState.textResponse, session.model),
    ]
    await persistSession(session)
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'agent_end', messages })
    return { sessionId, status: session.status }
  }

  if (commandState.clear) {
    return clearSession(session)
  }

  if (commandState.summary) {
    return summarySession(session, canonicalInitialUserMessage, commandState.summary)
  }

  if (commandState.compact) {
    return compactSession(session, canonicalInitialUserMessage, commandState.compact)
  }

  // Goal mode is mutually exclusive with ordinary prompts and retries: an
  // active goal owns the session until it is paused, cancelled or accepted.
  if (!commandState.goalRun && activeGoalStatus(session)) {
    throw Object.assign(new Error('This chat has an active goal. Use the goal card to pause, cancel or revise it before sending another message.'), {
      statusCode: 409,
      errorCode: 'GOAL_ACTIVE',
    })
  }
  // A finished goal no longer occupies the card once the user moves on.
  if (!commandState.goalRun && sessionGoal(session) && isGoalTerminalStatus(session.goal.status)) {
    await clearTerminalGoal(session)
  }
  if (commandState.goalRun) await beginGoalRun(session, commandState.goalRun.kind)

  const userMessage = resolvedUserMessage

  // Set a meaningful fallback immediately. The AI title request starts only
  // after the first user message has been persisted by the message_end handler.
  if (session.titleSource === 'default' && session.title === 'New chat') {
    const simpleTitle = generateTitle([userMessage])
    session.titleSource = 'fallback'
    if (simpleTitle !== 'New chat') {
      session.title = simpleTitle
    }
  }

  session.activeCommandName = commandState.commandName ?? null
  session.activeCommandPermissions = commandState.permissions ?? null
  session.activeCommandPrompt = commandState.commandPrompt ?? null
  session.activeCapabilityPrompt = selectedCapabilityPrompt(canonicalSelectedCapabilities)
  const referencePrompt = contextReferencesPrompt(canonicalContextReferences)
  session.activeTransientContextPrompt = [
    typeof transientContextPrompt === 'string' && transientContextPrompt.trim() ? transientContextPrompt : null,
    referencePrompt,
  ].filter(Boolean).join('\n\n') || null

  // A user-triggered main run defines exactly one rollback turn: journaled
  // writes during this run (including subagent writes attributed here) share
  // its id. Synthetic paths above (command text responses, /clear, summary,
  // compaction) return earlier and stay unattributed.
  const turnId = beginSessionTurn(sessionId)
  // Ownership token: the run's cleanup must only clear command state it
  // installed, so a goal continuation that starts before this run's `.finally`
  // runs (immediate persist flush) keeps its own prompt/permissions.
  const commandToken = {}
  session.activeCommandToken = commandToken

  // Fire and forget — events come through eventBus
  const promptPromise = session.agent.prompt(userMessage)
  // Explicit settle barrier consumed by afterGoalRunPersisted: goal settlement
  // waits for the prompt to settle instead of assuming the async persist flush
  // ordered the cleanup below.
  session.activePromptPromise = promptPromise
  promptPromise.catch((err) => {
    logger.error(`Agent prompt error for session ${sessionId}:`, err, { sessionId })
    const errorMessage = err.message || 'Unknown error'
    // Surface the failure at the end of the conversation itself so the user
    // sees the reason in the transcript, not only via toast/notification.
    session.agent.state.messages = appendAssistantErrorMessageOnce(
      session.agent.state.messages,
      errorMessage,
      session.model,
    )
    session.agent.state.errorMessage = errorMessage
    session.agent.state.isStreaming = false
    session.status = 'error'
    session.finishedAt = new Date().toISOString()
    const messages = session.agent.state.messages
    emitSessionEvent(session, { type: 'message_end', messages })
    emitSessionEvent(session, { type: 'error', error: errorMessage })
    emitSessionEvent(session, { type: 'agent_end', messages, errorMessage, status: 'error' })
    // This synthetic agent_end bypasses the agent's own subscribe hook, so a
    // goal run must be settled explicitly here — and only after the final state
    // is persisted, exactly like the real agent_end path.
    flushSessionPersist(session)
      .then((metadata) => {
        void afterGoalRunPersisted(session, metadata, 'error')
      })
      .catch((persistErr) => {
        logger.error(`Failed to persist session ${sessionId} after prompt error:`, persistErr, { sessionId })
        void afterGoalRunPersisted(session, null, 'error')
      })
  }).finally(() => {
    if (session.activePromptPromise === promptPromise) session.activePromptPromise = null
    endSessionTurn(sessionId, turnId)
    if (session.activeCommandToken !== commandToken) return
    session.activeCommandToken = null
    session.activeCommandName = null
    session.activeCommandPermissions = null
    session.activeCommandPrompt = null
    session.activeCapabilityPrompt = null
    session.activeTransientContextPrompt = null
  })

  return { sessionId, status: session.status }
}

/**
 * Validate the user message a client asks to append when retrying a turn that
 * already produced tool results. Only the role, content, timestamp and
 * attachments are taken from the client; capabilities and context references
 * are re-derived on the server.
 */
function normalizeRetryAppendMessage(message) {
  const role = message?.role
  if (role !== 'user' && role !== 'user-with-attachments') {
    throw Object.assign(new Error('Retry append requires a user message.'), { statusCode: 400 })
  }
  const content = message?.content
  const hasContent = typeof content === 'string'
    ? content.trim().length > 0
    : Array.isArray(content) && content.length > 0
  if (!hasContent) {
    throw Object.assign(new Error('Retry append requires non-empty message content.'), { statusCode: 400 })
  }
  const timestamp = Number.isFinite(message?.timestamp) && message.timestamp > 0 ? message.timestamp : Date.now()
  const next = { role, content, timestamp }
  if (Array.isArray(message?.attachments)) next.attachments = message.attachments
  return next
}

/**
 * Continue generation from the current last message (must be a user or
 * tool-result message).  Used by the retry button.
 *
 * Two modes:
 *  - plain retry: trims messages to keep up to and including the last user
 *    message, removing the assistant response that follows it, then regenerates
 *    in place.
 *  - append retry (caller passes `appendMessage`): the whole history is kept and
 *    the given user message is appended instead, so tool calls the failed turn
 *    already completed stay in the model transcript and the model does not redo
 *    its side effects.
 */
/**
 * 会话主动请求压缩（`POST /api/agents/:sessionId/compact`）。
 *
 * 两条路径，取决于请求到达时这个会话是否正在跑：
 *  - **空闲**：同步压完，返回压缩前后用量与摘要正文。效果等同 `/compact`，
 *    但不往对话里插系统文本——调用方是脚本，回执走响应体。
 *  - **在跑**（会话给自己请求时必然命中这条）：不抢正在进行的生成，只登记
 *    一次性的强制压缩标记，由下一次模型请求前的 transformSessionContext
 *    消费。压缩完成后这一轮继续跑，摘要就是它下一眼看到的历史。
 *
 * 「在跑就排队」不是妥协：一个会话不可能在自己 streaming 的同时同步压掉
 * 自己的上下文，那条路只会撞上 409 或撕裂正在写的消息数组。
 *
 * 写权限（会话写入租约）由调用方以 `assertWriteAccess` 回调注入，检查点放在
 * running 判定**之后**、两条分支各自的入口，原因有二：
 *  - 在跑的分支只写内存里的 forceCompaction 标记（不落库、不广播），租约没有
 *    需要保护的东西；而会话给自己请求压缩时必然命中这条分支，此刻租约几乎必然
 *    被正在查看该会话的浏览器窗口持有。放在路由入口拦，等于让这条能力永远 409。
 *  - 空闲分支会往消息数组里插摘要并持久化，那是真正的写，必须继续受租约约束。
 * 回调而非直接判定，是因为租约身份来自请求头（浏览器窗口），只有路由层看得见。
 */
export async function requestSessionCompaction(sessionId, options = {}) {
  let session = agentSessions.get(sessionId)
  if (!session) session = await restoreAgent(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404, errorCode: 'SESSION_NOT_FOUND' })
  }

  const assertWriteAccess = typeof options.assertWriteAccess === 'function' ? options.assertWriteAccess : null
  const usageBefore = getSessionContextUsage(session)
  const running = Boolean(session.agent.state.isStreaming || session.abortPending)
  if (running) {
    // selfRequest 只由路由层按「自我请求头」判定，用来收窄这条豁免：非自我
    // 调用方在会话运行中依然要持有租约，行为与豁免前一致。
    if (!options.selfRequest) assertWriteAccess?.()
    requestForceCompaction(session, { reason: options.reason || 'agent_request' })
    return {
      sessionId,
      scheduled: true,
      compacted: false,
      reason: 'deferred_to_next_model_request',
      usageBefore,
    }
  }

  assertWriteAccess?.()
  const result = await compactSessionNow(session, { usage: usageBefore })
  return { sessionId, scheduled: false, usageBefore, ...result }
}

export async function continueSession(sessionId, modelAccessContext = null, appendMessage = null) {
  let session = agentSessions.get(sessionId)
  if (!session) session = await restoreAgent(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  if (session.agent.state.isStreaming) {
    throw Object.assign(new Error('Generation is still running. Stop it or wait until it finishes.'), {
      statusCode: 409,
      errorCode: 'GENERATION_ALREADY_RUNNING',
    })
  }
  // Retrying is an ordinary run: it cannot interleave with an active goal.
  if (activeGoalStatus(session)) {
    throw Object.assign(new Error('This chat has an active goal. Use the goal card to pause, cancel or revise it before retrying.'), {
      statusCode: 409,
      errorCode: 'GOAL_ACTIVE',
    })
  }
  if (sessionGoal(session) && isGoalTerminalStatus(session.goal.status)) {
    await clearTerminalGoal(session)
  }
  if (modelAccessContext) session.modelAccessContext = modelAccessContext
  const requestSource = modelAccessContext && typeof modelAccessContext === 'object'
    ? modelAccessContext.source ?? null
    : null
  await refreshSessionModelBinding(session)

  const messages = Array.isArray(session.agent.state.messages) ? session.agent.state.messages : []

  // Find the last user message and trim everything after it (the assistant response)
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' || messages[i].role === 'user-with-attachments') {
      lastUserIndex = i
      break
    }
  }
  if (lastUserIndex < 0) {
    throw Object.assign(new Error('Cannot continue: no user message found.'), { statusCode: 400 })
  }

  const lastUserMessage = messages[lastUserIndex]
  const canonicalContextReferences = await validateContextReferences(contextReferencesFromMessage(lastUserMessage), session)
  const canonicalSelectedCapabilities = normalizeSelectedCapabilities(selectedCapabilitiesFromMessage(lastUserMessage))
  const canonicalLastUserMessage = withCanonicalSelectedCapabilities(
    withCanonicalContextReferences(lastUserMessage, canonicalContextReferences),
    canonicalSelectedCapabilities,
  )
  const commandState = await resolveCommandState(session, canonicalLastUserMessage, null, requestSource)
  // Append mode: the client asks to keep the failed turn and add one user
  // message after it, so the tool calls that already ran stay in the transcript.
  const appendedUserMessage = appendMessage
    ? withCanonicalSelectedCapabilities(
        withCanonicalContextReferences(normalizeRetryAppendMessage(appendMessage), canonicalContextReferences),
        canonicalSelectedCapabilities,
      )
    : null
  const continuedUserMessage = appendedUserMessage ?? commandState.userMessage ?? canonicalLastUserMessage
  const trimmedMessages = appendedUserMessage
    ? messages.concat(continuedUserMessage)
    : messages.slice(0, lastUserIndex).concat(continuedUserMessage)
  updateSessionMessages(session, trimmedMessages)
  // 同一套判定：压缩消息还在就保留压缩，被截断就自然失效。
  const retryCompactionIndex = lastCompactionMessageIndex(trimmedMessages)
  const retryLegacyCut = Number(session.contextCompaction?.compactedUpToIndex) || 0
  if (retryCompactionIndex >= 0) {
    syncCompactionIndex(session, retryCompactionIndex, trimmedMessages.length, trimmedMessages[retryCompactionIndex])
    session.lastTransformedContextMessages = null
  } else if (session.contextCompaction && retryLegacyCut > 0 && lastUserIndex >= retryLegacyCut) {
    session.lastTransformedContextMessages = null
  } else if (session.contextCompaction) {
    resetSessionCompaction(session)
  }

  resetIdleTimer(session)
  session.activeCommandName = commandState.commandName ?? null
  session.activeCommandPermissions = commandState.permissions ?? null
  session.activeCommandPrompt = commandState.commandPrompt ?? null
  session.activeCapabilityPrompt = selectedCapabilityPrompt(canonicalSelectedCapabilities)
  session.activeTransientContextPrompt = contextReferencesPrompt(canonicalContextReferences)

  // Same attribution rule as runPrompt: a retry run is one rollback turn of
  // its own (the frontend groups it with the original run's turn id).
  beginSessionTurn(sessionId)

  session.agent.continue().catch((err) => {
    logger.error(`Agent continue error for session ${sessionId}:`, err, { sessionId })
    emitSessionEvent(session, { type: 'error', error: err.message || 'Unknown error' })
  }).finally(() => {
    clearSessionTurn(sessionId)
    session.activeCommandName = null
    session.activeCommandPermissions = null
    session.activeCommandPrompt = null
    session.activeCapabilityPrompt = null
    session.activeTransientContextPrompt = null
  })

  return { sessionId, status: 'running' }
}

/**
 * Abort the current agent run.
 */
export async function abortRun(sessionId) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  // Clean up any pending tool approvals for this session
  for (const [_toolCallId, approval] of pendingApprovals) {
    if (approval.sessionId === sessionId) {
      approval.reject(new Error('Run aborted'))
    }
  }

  // A user stop also stops the goal: no continuation is scheduled, and the
  // card shows pausing until the run really settles.
  await notifyGoalAbort(session)

  session.agent.abort()
  let idleWaitTimer
  const becameIdle = await Promise.race([
    session.agent.waitForIdle().then(() => true),
    new Promise((resolve) => {
      idleWaitTimer = setTimeout(() => resolve(false), ABORT_IDLE_WAIT_TIMEOUT_MS)
      idleWaitTimer.unref?.()
    }),
  ])
  clearTimeout(idleWaitTimer)
  if (!becameIdle) {
    session.abortPending = true
    logger.warn(`Agent ${sessionId} did not become idle within ${ABORT_IDLE_WAIT_TIMEOUT_MS}ms after abort`, { sessionId })
  }

  if (session.status === 'running') {
    session.status = 'aborted'
    session.finishedAt = new Date().toISOString()
    persistSession(session).catch((err) =>
      logger.error(`Failed to persist aborted session ${sessionId}:`, err, { sessionId }),
    )
    session.abortEndEmitted = true
    const event = {
      type: 'agent_end',
      status: 'aborted',
      messages: session.agent.state.messages,
    }
    emitSessionEvent(session, event)
  }

  return { sessionId, aborted: true }
}

export function abortToolCall(sessionId, toolCallId) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  const aborted = abortRunningCommand(toolCallId)
  if (!aborted) {
    throw Object.assign(new Error('No running command for this tool call'), { statusCode: 404 })
  }
  return { aborted: true, toolCallId }
}

/**
 * Steering/follow-up bypass runPrompt's goal exclusivity check, so they must
 * reject an active goal themselves: a goal run owns the turn structure and a
 * queued user message would interleave with it (or silently derail the goal).
 */
function assertNoActiveGoal(session, verb) {
  const goal = activeGoalStatus(session)
  if (!goal) return
  throw Object.assign(new Error(`This chat has an active goal (${goal.status}). Use the goal card to pause, cancel or revise it before you ${verb}.`), {
    statusCode: 409,
    errorCode: 'GOAL_ACTIVE',
  })
}

/**
 * Queue a steering message to inject after the current assistant turn.
 */
export function steerAgent(sessionId, message) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  assertNoActiveGoal(session, 'steer the run')

  const agentMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message

  session.agent.steer(agentMessage)
  return { sessionId, steered: true }
}

/**
 * Queue a follow-up message to process after the agent would otherwise stop.
 */
export function followUpAgent(sessionId, message) {
  const session = agentSessions.get(sessionId)
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }
  assertNoActiveGoal(session, 'queue a follow-up')

  const agentMessage = typeof message === 'string'
    ? { role: 'user', content: message, timestamp: Date.now() }
    : message

  session.agent.followUp(agentMessage)
  return { sessionId, followUp: true }
}
