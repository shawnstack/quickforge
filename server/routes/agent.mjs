import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { createTextAttachment, isTextAttachmentPath } from '../text-attachments.mjs'
import { getSessionFileChanges, rollbackSessionFiles } from '../session-file-backups.mjs'
import { openPathInFileManager } from '../utils/platform.mjs'
import { logger } from '../utils/logger.mjs'
import { resolveModelBinding } from '../model-catalog.mjs'
import {
  createAgent,
  validateAgentHarness,
  runPrompt,
  abortRun,
  steerAgent,
  followUpAgent,
  getSessionState,
  getSessionStatus,
  getSessionEventBus,
  tryAcquireSse,
  releaseSse,
  isSseConnected,
  destroyAgent,
  restoreAgent,
  touchSession,
  listSessions,
  updateSessionAccessMode,
  updateSessionTitle,
  updateSessionYoloMode,
  updateSessionModel,
  updateSessionThinkingLevel,
  updateSessionHarnessConfigOption,
  updateSessionHarnessMode,
  forkSession,
  approveToolCall,
  rejectToolCall,
  answerAsk,
  approveAutoCompact,
  rejectAutoCompact,
  abortToolCall,
  rollbackSessionMessages,
  continueSession,
  stripSplitSessionState,
  agentEvents,
} from '../agent-manager.mjs'
import { channelEvents } from '../channels/registry.mjs'

export async function handleAgentApi(req, res, url, context = {}) {
  const pathname = url.pathname
  const parts = pathname.split('/').filter(Boolean)

  // GET /api/agents — list active sessions
  if (req.method === 'GET' && pathname === '/api/agents') {
    sendJson(res, 200, { sessions: listSessions() })
    return
  }

  // GET /api/agents/events — global SSE event stream for all sessions
  if (req.method === 'GET' && pathname === '/api/agents/events') {
    handleGlobalStream(req, res)
    return
  }

  // All other routes need a session ID: /api/agents/:sessionId/...
  if (parts.length < 3 || parts[1] !== 'agents') {
    const error = new Error('Not found')
    error.statusCode = 404
    throw error
  }

  const sessionId = decodeSegment(parts[2])
  if (!sessionId) {
    const error = new Error('Missing session ID')
    error.statusCode = 400
    throw error
  }

  const subPath = parts.slice(3).join('/')

  // GET /api/agents/:sessionId/stream — SSE event stream
  // HEAD /api/agents/:sessionId/stream — check if SSE is available (200) or taken (409)
  if (subPath === 'stream') {
    if (req.method === 'GET') {
      await handleStream(req, res, sessionId)
      return
    }
    if (req.method === 'HEAD') {
      await handleStreamHead(req, res, sessionId)
      return
    }
  }

  // POST /api/agents/:sessionId/text-attachment — persist a large pasted text as a temporary attachment
  if (req.method === 'POST' && subPath === 'text-attachment') {
    const body = await readJsonBody(req)
    const attachment = await createTextAttachment({ sessionId, text: body?.text, fileName: body?.fileName })
    sendJson(res, 200, { attachment })
    return
  }

  // POST /api/agents/:sessionId/open-text-attachment — open a temporary text attachment in the system file manager
  if (req.method === 'POST' && subPath === 'open-text-attachment') {
    const body = await readJsonBody(req, 16 * 1024)
    const filePath = typeof body?.path === 'string' ? body.path : ''
    if (!isTextAttachmentPath(filePath)) {
      const error = new Error('Invalid text attachment path')
      error.statusCode = 400
      throw error
    }
    await openPathInFileManager(filePath)
    sendJson(res, 200, { ok: true, opened: 'file' })
    return
  }

  // GET /api/agents/:sessionId/file-changes — session-scoped file change summary (shadow backups vs current files)
  if (req.method === 'GET' && subPath === 'file-changes') {
    sendJson(res, 200, await getSessionFileChanges(sessionId))
    return
  }

  // POST /api/agents/:sessionId/rollback-files — restore files modified in this session to their pre-session state
  if (req.method === 'POST' && subPath === 'rollback-files') {
    const result = await rollbackSessionFiles(sessionId)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/prompt — send user message
  if (req.method === 'POST' && subPath === 'prompt') {
    const body = await readJsonBody(req)
    const message = body?.message
    if (!message) {
      const error = new Error('Missing message in request body')
      error.statusCode = 400
      throw error
    }
    const result = await runPrompt(sessionId, message, body?.selectedCapabilities, body?.command, null, context, body?.contextReferences)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/abort — abort current run
  if (req.method === 'POST' && subPath === 'abort') {
    const result = await abortRun(sessionId)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/restore — restore once and return the authoritative state
  if (req.method === 'POST' && subPath === 'restore') {
    const startedAt = performance.now()
    const session = await restoreAgent(sessionId)
    if (!session) {
      const error = new Error('Session not found')
      error.statusCode = 404
      throw error
    }
    const state = getSessionState(sessionId)
    if (!state) {
      const error = new Error('Session not found')
      error.statusCode = 404
      throw error
    }
    logger.debug(`Restored session ${sessionId} for client`, {
      sessionId,
      messageCount: state.messages?.length ?? 0,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    })
    sendJson(res, 200, stripSplitSessionState(state))
    return
  }

  // GET /api/agents/:sessionId/state — get session state
  if (req.method === 'GET' && subPath === 'state') {
    let state = getSessionState(sessionId)
    if (!state) {
      // Try to restore from persistent storage before giving up.
      // This recovers sessions that were evicted by idle timeout.
      await restoreAgent(sessionId)
      state = getSessionState(sessionId)
    }
    if (!state) {
      const error = new Error('Session not found')
      error.statusCode = 404
      throw error
    }
    sendJson(res, 200, stripSplitSessionState(state))
    return
  }

  // GET /api/agents/:sessionId/messages?after=N — incremental message fetch.
  // Split sessions never embed the full message list in state frames; clients
  // materialize the conversation through this lightweight, paginated channel
  // (after = message index; the response reports the server total count so
  // clients can detect truncation/rollback and refetch from zero).
  if (req.method === 'GET' && subPath === 'messages') {
    let state = getSessionState(sessionId)
    if (!state) {
      await restoreAgent(sessionId)
      state = getSessionState(sessionId)
    }
    if (!state) {
      const error = new Error('Session not found')
      error.statusCode = 404
      throw error
    }
    const messages = Array.isArray(state.messages) ? state.messages : []
    const afterParam = Number(new URLSearchParams(url.search).get('after'))
    const after = Number.isInteger(afterParam) && afterParam >= 0 ? afterParam : 0
    const limitParam = Number(new URLSearchParams(url.search).get('limit'))
    const limit = Number.isInteger(limitParam) && limitParam >= 1 ? Math.min(limitParam, 5000) : 500
    const page = messages.slice(after, after + limit)
    sendJson(res, 200, {
      after,
      count: messages.length,
      hasMore: after + page.length < messages.length,
      messages: page,
    })
    return
  }

  // GET /api/agents/:sessionId/status - get lightweight session status
  if (req.method === 'GET' && subPath === 'status') {
    let status = getSessionStatus(sessionId)
    if (!status) {
      // Try to restore from persistent storage before giving up.
      // This recovers sessions that were evicted by idle timeout.
      await restoreAgent(sessionId)
      status = getSessionStatus(sessionId)
    }
    if (!status) {
      const error = new Error('Session not found')
      error.statusCode = 404
      throw error
    }
    sendJson(res, 200, status)
    return
  }

  // POST /api/agents/:sessionId — create/ensure agent
  if (req.method === 'POST' && parts.length === 3) {
    const body = await readJsonBody(req)
    const harness = validateAgentHarness(body?.harness)
    let config
    if (harness === 'quickforge' && (body?.modelRef || body?.model)) {
      const binding = await resolveModelBinding(body, { context, legacySnapshot: body?.model })
      config = { ...body, harness, model: binding.model, modelRef: binding.modelRef, modelAccessContext: context, resolvePersistedModel: true }
    } else {
      config = { ...body, harness, modelAccessContext: context, resolvePersistedModel: true }
    }
    const session = await createAgent(sessionId, config)
    sendJson(res, 200, {
      sessionId: session.sessionId,
      status: session.status,
      scope: session.scope,
      title: session.title,
      source: session.source || undefined,
      harness: session.harness,
      harnessSessionId: session.agent.harnessSessionId || session.harnessSessionId || undefined,
      channelId: session.channelId || undefined,
      channelName: session.channelName || undefined,
      accessMode: session.accessMode,
      yoloMode: session.yoloMode,
    })
    return
  }

  // DELETE /api/agents/:sessionId — destroy agent
  if (req.method === 'DELETE' && parts.length === 3) {
    await destroyAgent(sessionId)
    sendJson(res, 200, { ok: true })
    return
  }

  // POST /api/agents/:sessionId/title — update the authoritative session title
  if (req.method === 'POST' && subPath === 'title') {
    const body = await readJsonBody(req)
    const result = await updateSessionTitle(sessionId, body?.title)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/access-mode — update session Agent access mode
  if (req.method === 'POST' && subPath === 'access-mode') {
    const body = await readJsonBody(req)
    const result = await updateSessionAccessMode(sessionId, body?.accessMode)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/yolo-mode — legacy compatibility for old clients
  if (req.method === 'POST' && subPath === 'yolo-mode') {
    const body = await readJsonBody(req)
    const result = await updateSessionYoloMode(sessionId, body?.yoloMode === true)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/model — update session model
  if (req.method === 'POST' && subPath === 'model') {
    const body = await readJsonBody(req)
    const currentModel = getSessionState(sessionId)?.model
    const binding = await resolveModelBinding(body, {
      context,
      currentModel,
      allowCurrentHidden: true,
      legacySnapshot: body?.model,
    })
    const result = updateSessionModel(sessionId, binding.model, binding.modelRef)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/thinking-level — update session thinking level
  if (req.method === 'POST' && subPath === 'thinking-level') {
    const body = await readJsonBody(req)
    const thinkingLevel = body?.thinkingLevel
    if (!thinkingLevel) {
      const error = new Error('Missing thinkingLevel in request body')
      error.statusCode = 400
      throw error
    }
    const result = updateSessionThinkingLevel(sessionId, thinkingLevel)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/harness/config-option — update an advertised Harness config option
  if (req.method === 'POST' && subPath === 'harness/config-option') {
    const body = await readJsonBody(req)
    if (typeof body?.configId !== 'string' || !body.configId || body.value === undefined) {
      const error = new Error('Missing configId or value in request body')
      error.statusCode = 400
      throw error
    }
    const result = await updateSessionHarnessConfigOption(sessionId, body.configId, body.value)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/harness/mode — update an advertised Harness mode
  if (req.method === 'POST' && subPath === 'harness/mode') {
    const body = await readJsonBody(req)
    if (typeof body?.modeId !== 'string' || !body.modeId) {
      const error = new Error('Missing modeId in request body')
      error.statusCode = 400
      throw error
    }
    const result = await updateSessionHarnessMode(sessionId, body.modeId)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/fork — fork the entire current OpenCode session
  if (req.method === 'POST' && subPath === 'fork') {
    const result = await forkSession(sessionId)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/rollback — roll back from a message index on the authoritative server state
  if (req.method === 'POST' && subPath === 'rollback') {
    const body = await readJsonBody(req)
    const result = await rollbackSessionMessages(sessionId, body?.messageIndex)
    sendJson(res, 200, { ok: true, rollbackIndex: result.rollbackIndex, session: result.session })
    return
  }

  // POST /api/agents/:sessionId/continue — continue generation from last message (retry)
  if (req.method === 'POST' && subPath === 'continue') {
    const result = await continueSession(sessionId, context)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/steer — queue steering message
  if (req.method === 'POST' && subPath === 'steer') {
    const body = await readJsonBody(req)
    const message = body?.message
    if (!message) {
      const error = new Error('Missing message in request body')
      error.statusCode = 400
      throw error
    }
    const result = steerAgent(sessionId, message)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/follow-up — queue follow-up message
  if (req.method === 'POST' && subPath === 'follow-up') {
    const body = await readJsonBody(req)
    const message = body?.message
    if (!message) {
      const error = new Error('Missing message in request body')
      error.statusCode = 400
      throw error
    }
    const result = followUpAgent(sessionId, message)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/approve-tool — approve a pending tool call
  if (req.method === 'POST' && subPath === 'approve-tool') {
    const body = await readJsonBody(req)
    const result = approveToolCall(sessionId, body?.toolCallId)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/reject-tool — reject a pending tool call
  if (req.method === 'POST' && subPath === 'reject-tool') {
    const body = await readJsonBody(req)
    const result = rejectToolCall(sessionId, body?.toolCallId)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/answer-ask — answer or skip a pending ask_user call
  if (req.method === 'POST' && subPath === 'answer-ask') {
    const body = await readJsonBody(req)
    const result = answerAsk(sessionId, body?.askId, { answers: body?.answers, skipped: body?.skipped === true })
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/approve-auto-compact — approve a pending automatic context compaction
  if (req.method === 'POST' && subPath === 'approve-auto-compact') {
    const body = await readJsonBody(req)
    const result = approveAutoCompact(sessionId, body?.approvalId)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/reject-auto-compact — skip a pending automatic context compaction
  if (req.method === 'POST' && subPath === 'reject-auto-compact') {
    const body = await readJsonBody(req)
    const result = rejectAutoCompact(sessionId, body?.approvalId)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/abort-tool — abort a running run_command tool call
  if (req.method === 'POST' && subPath === 'abort-tool') {
    const body = await readJsonBody(req)
    const result = abortToolCall(sessionId, body?.toolCallId)
    sendJson(res, 200, result)
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

/**
 * HEAD request to check whether the SSE stream for a session is available.
 * Returns 200 if available, 409 if already connected, 404 if session not found.
 */
async function handleStreamHead(req, res, sessionId) {
  // Ensure session exists (restore from storage if needed)
  if (!getSessionEventBus(sessionId)) {
    const restored = await restoreAgent(sessionId)
    if (!restored) {
      sendJson(res, 404, { error: 'Session not found' })
      return
    }
  }

  if (isSseConnected(sessionId)) {
    sendJson(res, 409, { error: 'Session is already active in another tab' })
    return
  }

  res.writeHead(200, { 'content-length': '0' })
  res.end()
}

function handleGlobalStream(req, res) {
  let failureLogged = false
  let cleanedUp = false
  const logFailure = (failureType, error) => {
    if (failureLogged || cleanedUp) return
    failureLogged = true
    logger.warn('Global agent SSE connection failure', {
      streamScope: 'global',
      failureType,
      errorName: error instanceof Error ? error.name : typeof error,
    })
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })
  // Flush headers immediately — without a body write they would otherwise sit
  // in the socket buffer until the first 15s ping, delaying the client's onopen.
  res.flushHeaders()

  const keepAlive = setInterval(() => {
    try {
      writeSseKeepAlive(res)
    } catch (error) {
      logFailure('keepalive_write_failed', error)
      cleanup()
    }
  }, 15000)

  const writeEvent = (event) => {
    try {
      writeSseEvent(res, event.type || 'agent_event', event)
    } catch (error) {
      logFailure('event_write_failed', error)
      cleanup()
    }
  }
  // 每个 token delta 一帧 message_update，帧内是完整累积消息：trailing 合并后再写出。
  const updateThrottle = createSseUpdateThrottle({ write: writeEvent })
  const onAgentEvent = (event) => updateThrottle.push(event)

  // 只转发 sessions-changed：process-channel 的 log/status/qrcode 事件量大且只与设置页相关，
  // 混入 agent 流会刷爆客户端。
  const onChannelEvent = (event) => {
    if (event?.type !== 'sessions-changed') return
    try {
      writeSseEvent(res, 'sessions-changed', event)
    } catch (error) {
      logFailure('event_write_failed', error)
      cleanup()
    }
  }

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    clearInterval(keepAlive)
    updateThrottle.dispose()
    agentEvents.removeListener('agent_event', onAgentEvent)
    channelEvents.removeListener('channel_event', onChannelEvent)
    if (!res.writableEnded) {
      res.end()
    }
  }

  agentEvents.on('agent_event', onAgentEvent)
  channelEvents.on('channel_event', onChannelEvent)

  req.on('close', cleanup)
  req.on('error', (error) => {
    logFailure('request_socket_error', error)
    cleanup()
  })
  res.on('error', (error) => {
    logFailure('response_socket_error', error)
    cleanup()
  })
}

async function handleStream(req, res, sessionId) {
  let failureLogged = false
  let cleanedUp = false
  let sseAcquired = false
  const logFailure = (failureType, error) => {
    if (failureLogged || cleanedUp) return
    failureLogged = true
    logger.warn('Session agent SSE connection failure', {
      streamScope: 'session',
      sessionId,
      failureType,
      errorName: error instanceof Error ? error.name : typeof error,
    })
  }
  const releaseConnection = () => {
    if (!sseAcquired) return
    sseAcquired = false
    releaseSse(sessionId)
  }
  // Restore from storage if not already in memory
  let eventBus = getSessionEventBus(sessionId)
  if (!eventBus) {
    const restored = await restoreAgent(sessionId)
    if (restored) {
      eventBus = restored.eventBus
    } else {
      sendJson(res, 404, { error: 'Session not found' })
      return
    }
  }

  // Only one SSE connection per session — reject with 409 so the client can fall back
  if (!tryAcquireSse(sessionId)) {
    sendJson(res, 409, { error: 'Session is already active in another tab' })
    return
  }
  sseAcquired = true

  // Arm the idle timer once on connect (identical to what restore already
  // does); ongoing keep-alive pings above intentionally do not re-arm it.
  touchSession(sessionId)

  // Set SSE headers
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })

  // Send initial state (split sessions send a lightweight summary; clients
  // fetch messages through GET /api/agents/:id/messages)
  const state = getSessionState(sessionId)
  if (state) {
    try {
      writeSseEvent(res, 'state', stripSplitSessionState(state))
    } catch (error) {
      logFailure('initial_state_write_failed', error)
      releaseConnection()
      if (!res.writableEnded) res.end()
      return
    }
  }

  // Keep-alive ping every 15 seconds. The ping itself must NOT touch the
  // session: re-arming the idle timer here would pin every session a client
  // ever opened (with its full message history) in memory for the lifetime
  // of the app. Evicted sessions transparently restore on the next request.
  const keepAlive = setInterval(() => {
    try {
      writeSseKeepAlive(res)
    } catch (error) {
      logFailure('keepalive_write_failed', error)
      cleanup()
    }
  }, 15000)

  // Handle agent events
  const writeEvent = (event) => {
    try {
      writeSseEvent(res, event.type, event)
    } catch (error) {
      logFailure('event_write_failed', error)
      cleanup()
    }
  }
  // 每个 token delta 一帧 message_update，帧内是完整累积消息：trailing 合并后再写出。
  const updateThrottle = createSseUpdateThrottle({ write: writeEvent })
  const onAgentEvent = (event) => updateThrottle.push(event)

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    clearInterval(keepAlive)
    updateThrottle.dispose()
    eventBus.removeListener('agent_event', onAgentEvent)
    releaseConnection()
    if (!res.writableEnded) {
      res.end()
    }
  }

  eventBus.on('agent_event', onAgentEvent)

  req.on('close', cleanup)
  req.on('error', (error) => {
    logFailure('request_socket_error', error)
    cleanup()
  })
  res.on('error', (error) => {
    logFailure('response_socket_error', error)
    cleanup()
  })
}

// message_update 的 trailing 合并窗口（毫秒）：窗口内只写出最后一帧。
export const SSE_MESSAGE_UPDATE_THROTTLE_MS = 50

// res.writableLength 背压阈值（字节）：超过后丢弃可丢弃事件，终态/关键事件永不丢弃。
export const SSE_BACKPRESSURE_BYTES = 4 * 1024 * 1024

// 背压下可丢弃的事件：纯流式增量（下一帧是完整累积消息，message_end 兜底终态）。
// 其余事件（message_end/agent_end/messages_replaced/error/tool_approval_required/
// ask_user_required/state 等）不在名单内，永不丢弃。
const SSE_DROPPABLE_EVENTS = new Set(['message_update', 'tool_execution_update'])

/**
 * 合并 message_update 的 SSE 写入器。
 *
 * 每个 token delta 都会产生一帧 message_update（帧内同时带 message 与
 * assistantMessageEvent.partial 两份完整累积消息），一回合累计写出量 O(N²)；
 * 窗口内只保留最后一帧，窗口到期后写出（trailing 合并）。
 *
 * 顺序保证：任何非 message_update 事件到达时先 flush pending 帧再写该事件，
 * 否则客户端会先按终态清空流式容器、再收到迟到帧，导致已完成消息重复渲染。
 */
export function createSseUpdateThrottle({ write, windowMs = SSE_MESSAGE_UPDATE_THROTTLE_MS }) {
  let pending = null
  let timer = null

  const clearTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }
  const flush = () => {
    clearTimer()
    if (pending === null) return
    const event = pending
    pending = null
    write(event)
  }

  return {
    push(event) {
      if (event?.type !== 'message_update') {
        flush()
        write(event)
        return
      }
      pending = event
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        if (pending === null) return
        const last = pending
        pending = null
        write(last)
      }, windowMs)
    },
    flush,
    dispose() {
      clearTimer()
      pending = null
    },
  }
}

function isSseBackpressured(res) {
  return typeof res.writableLength === 'number' && res.writableLength > SSE_BACKPRESSURE_BYTES
}

function writeSseKeepAlive(res) {
  // ping 可丢弃：慢客户端积压时不继续堆积注释帧。
  if (isSseBackpressured(res)) return
  res.write(': ping\n\n')
}

function writeSseEvent(res, event, data) {
  // 背压保护：慢客户端积压超过阈值时丢弃可丢弃事件；不 await drain，
  // 避免慢客户端拖慢模型 token 流。
  if (SSE_DROPPABLE_EVENTS.has(event) && isSseBackpressured(res)) return
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  // Split multi-line payloads
  const lines = payload.split('\n')
  res.write(`event: ${event}\n`)
  for (const line of lines) {
    res.write(`data: ${line}\n`)
  }
  res.write('\n')
}
