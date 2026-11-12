// agent-manager 模块拆分（god-module-decomposition ⑤）事件扇出+落库：
// agent 生命周期事件订阅（tool timing/runtime 执行记录、goal 证据登记、
// 失败回合尾部错误消息合成、agent_end 状态收尾与权威持久化 flush、
// 首条用户消息 session_created 广播与 AI 标题调度）、goal run 持久化后
// 结算（afterGoalRunPersisted）与标题生成簿记从 agent-manager.mjs 逐字
// 搬移至此；canApplyGeneratedTitle 经 agent-manager.mjs facade re-export，
// 对外行为与注释语义不变。

import {
  emitSessionEvent,
  addToolTimingToEvent,
  updateRuntimeToolExecution,
  appendAssistantErrorMessageOnce,
  markLatestAssistantProcessFinished,
} from './agent-session-events.mjs'
import {
  failGoalRunOnPersist,
  finishGoalRun,
  recordGoalToolExecution,
} from './goal/engine.mjs'
import {
  persistSession,
  scheduleSessionPersist,
  flushSessionPersist,
} from './agent-persistence.mjs'
import { clearSessionTurn } from './agent-turn-ids.mjs'
import { resetIdleTimer } from './agent-idle-recycler.mjs'
import { generateAiTitle } from './session-utils.mjs'
import { logger } from './utils/logger.mjs'

// Goal continuations are scheduled only from here: after the run's final state
// was persisted successfully. persistSession/flushSessionPersist return null on
// CAS conflict or write failure, which must never lead to another round.
export async function afterGoalRunPersisted(session, persisted, endStatus) {
  if (!session.goalRun) return
  // Explicit prompt-settle barrier: settlement must not race the run's own
  // `.finally` cleanup (which clears the active command state and turn id).
  // Waiting for the prompt promise makes the ordering deterministic instead of
  // depending on when the async persist flush happens to resolve.
  const promptSettled = session.activePromptPromise
  if (promptSettled) {
    try {
      await promptSettled
    } catch {
      endStatus = 'error'
    }
  }
  if (!persisted) {
    await failGoalRunOnPersist(session)
    return
  }
  try {
    await finishGoalRun(session, { status: endStatus })
  } catch (error) {
    logger.error(`Failed to settle goal run for session ${session.sessionId}:`, error, { sessionId: session.sessionId })
  }
}

export function canApplyGeneratedTitle(session, generationId, expectedTitle) {
  return session.titleGenerationId === generationId
    && session.titleSource === 'fallback'
    && session.title === expectedTitle
}

export function scheduleSessionTitleGeneration(session, userMessage) {
  if (session.titleSource !== 'fallback') return
  if (session.titleGenerationPromise && session.titleGenerationPromiseId === session.titleGenerationId) return
  const generationId = ++session.titleGenerationId
  const expectedTitle = session.title
  const promise = generateAiTitle([userMessage], session.model, session.thinkingLevel, session.getApiKey)
    .then(async (aiTitle) => {
      if (!aiTitle || aiTitle === 'New chat') return
      if (!canApplyGeneratedTitle(session, generationId, expectedTitle)) return
      session.title = aiTitle
      session.titleSource = 'ai'
      await persistSession(session)
      emitSessionEvent(session, { type: 'title_updated', title: aiTitle, titleSource: 'ai' })
    })
    .catch((err) => {
      logger.warn(`Title generation failed for session ${session.sessionId}:`, err.message || err, { sessionId: session.sessionId })
    })
    .finally(() => {
      if (session.titleGenerationPromise === promise) {
        session.titleGenerationPromise = null
        session.titleGenerationPromiseId = null
      }
    })
  session.titleGenerationPromise = promise
  session.titleGenerationPromiseId = generationId
}

/**
 * Subscribe to the session agent's lifecycle events and forward them to the
 * session event bus, tracking run status and triggering persistence.
 * Extracted verbatim from createAgent's agent.subscribe wiring; the session's
 * own agent/sessionId are used so the behavior matches the original closure.
 */
export function subscribeAgentSessionEvents(session) {
  const agent = session.agent
  const sessionId = session.sessionId
  agent.subscribe(async (event) => {
    // The pi-agent-core agent loop emits agent_end with `messages` that only
    // contains messages generated during THIS run (newMessages), not the
    // complete session history.  Replace with the authoritative full state
    // before forwarding to clients.
    const timedEvent = addToolTimingToEvent(session, event)
    updateRuntimeToolExecution(session, timedEvent)
    // Goal evidence trust: record successful verification tool executions for
    // the current goal version (control-plane/delegation/skill/memory tools are
    // ignored inside the runner).
    if (timedEvent.type === 'tool_execution_end') recordGoalToolExecution(session, timedEvent)
    const eventEndStatus = event.type === 'agent_end'
      ? session.agent.signal?.aborted
        ? 'aborted'
        : session.agent.state.errorMessage
          ? 'error'
          : 'idle'
      : undefined
    if (timedEvent.type === 'agent_end') {
      markLatestAssistantProcessFinished(agent.state.messages)
      // Ensure a failed run is visible in the conversation. Most failures emit
      // an assistant error message through the agent loop (handleRunFailure),
      // but a few paths (e.g. concurrent-run rejection) only set
      // `state.errorMessage`. Append an error message so the user sees the
      // reason at the end of the transcript instead of only a toast.
      // 用户主动停止（signal 已 abort）不算失败：pi-agent-core 已落一条
      // stopReason='aborted' 的终态消息（前端显示灰色「已停止」），不再追加
      // "Request was aborted" 错误消息与重试/继续入口；同时清掉
      // state.errorMessage，避免状态面板把用户停止报成错误。
      if (session.agent.signal?.aborted) session.agent.state.errorMessage = undefined
      const runError = session.agent.state.errorMessage
      if (runError) {
        agent.state.messages = appendAssistantErrorMessageOnce(agent.state.messages, runError, session.model)
      }
    }
    const forwardEvent = timedEvent.type === 'agent_end'
      ? {
          ...timedEvent,
          ...(timedEvent.messages ? { messages: agent.state.messages } : {}),
          status: eventEndStatus,
          ...(session.agent.state.errorMessage && timedEvent.errorMessage === undefined ? { errorMessage: session.agent.state.errorMessage } : {}),
        }
      : timedEvent

    const shouldForwardEvent = !(timedEvent.type === 'agent_end' && session.abortEndEmitted)
    if (shouldForwardEvent) {
      emitSessionEvent(session, forwardEvent)
    }

    // Track status
    if (event.type === 'agent_start') {
      session.abortEndEmitted = false
      session.status = 'running'
      session.startedAt = session.startedAt ?? new Date().toISOString()
      session.finishedAt = null
      // Persist running state immediately so a browser refresh still shows the green dot.
      // Brand-new runs have no messages until the first user message_end; persisting
      // here would only trigger the empty-session cleanup path.
      if (session.agent.state.messages.length > 0) {
        persistSession(session).catch((err) =>
          logger.error(`Failed to persist session on start ${sessionId}:`, err, { sessionId }),
        )
      }
    }

    if (event.type === 'agent_end') {
      clearSessionTurn(sessionId)
      session.abortPending = false
      session.abortEndEmitted = false
      session.status = eventEndStatus || (session.agent.state.errorMessage ? 'error' : 'idle')
      session.finishedAt = new Date().toISOString()
      session.toolTimings?.clear()
      resetIdleTimer(session)

      // Persist after run ends. Flush any debounced write so the final state is durable.
      flushSessionPersist(session)
        .then((metadata) => {
          // Goal continuations start only after the run truly finished AND the
          // final state was persisted. A null result (CAS conflict / failure)
          // pauses the goal instead of continuing on an unpersisted state.
          void afterGoalRunPersisted(session, metadata, eventEndStatus)
        })
        .catch((err) => {
          logger.error(`Failed to persist session ${sessionId}:`, err, { sessionId })
          void afterGoalRunPersisted(session, null, eventEndStatus)
        })
    }

    if (event.type === 'message_end') {
      const isUserMessage = event.message?.role === 'user' || event.message?.role === 'user-with-attachments'
      const isInitialUserMessage = isUserMessage && (event.isInitialUserMessage === true || session.agent.state.messages.length === 1)
      if (isInitialUserMessage) {
        try {
          const metadata = await flushSessionPersist(session)
          if (metadata && isInitialUserMessage) {
            if (!session.sessionCreatedEmitted) {
              session.sessionCreatedEmitted = true
              emitSessionEvent(session, { type: 'session_created', metadata })
            }
            scheduleSessionTitleGeneration(session, event.message)
          }
        } catch (err) {
          logger.error(`Failed to persist user message for session ${sessionId}:`, err, { sessionId })
        }
      } else {
        // Debounced persist for crash recovery; coalesces the many message_end
        // events within a single run into infrequent full-session writes.
        scheduleSessionPersist(session)
      }
    }
  })
}
