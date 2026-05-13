import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import {
  createAgent,
  runPrompt,
  abortRun,
  steerAgent,
  followUpAgent,
  getSessionState,
  getSessionEventBus,
  tryAcquireSse,
  releaseSse,
  isSseConnected,
  destroyAgent,
  restoreAgent,
  touchSession,
  listSessions,
  updateSessionYoloMode,
  updateSessionModel,
  updateSessionThinkingLevel,
  approveToolCall,
  rejectToolCall,
  replaceSessionMessages,
  rollbackSessionMessages,
  agentEvents,
} from '../agent-manager.mjs'

export async function handleAgentApi(req, res, url) {
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

  // POST /api/agents/:sessionId/prompt — send user message
  if (req.method === 'POST' && subPath === 'prompt') {
    const body = await readJsonBody(req)
    const message = body?.message
    if (!message) {
      const error = new Error('Missing message in request body')
      error.statusCode = 400
      throw error
    }
    const result = await runPrompt(sessionId, message)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/abort — abort current run
  if (req.method === 'POST' && subPath === 'abort') {
    const result = await abortRun(sessionId)
    sendJson(res, 200, result)
    return
  }

  // GET /api/agents/:sessionId/state — get session state
  if (req.method === 'GET' && subPath === 'state') {
    const state = getSessionState(sessionId)
    if (!state) {
      const error = new Error('Session not found')
      error.statusCode = 404
      throw error
    }
    sendJson(res, 200, state)
    return
  }

  // POST /api/agents/:sessionId — create/ensure agent
  if (req.method === 'POST' && parts.length === 3) {
    const body = await readJsonBody(req)
    const session = await createAgent(sessionId, body)
    sendJson(res, 200, {
      sessionId: session.sessionId,
      status: session.status,
      scope: session.scope,
      title: session.title,
    })
    return
  }

  // DELETE /api/agents/:sessionId — destroy agent
  if (req.method === 'DELETE' && parts.length === 3) {
    await destroyAgent(sessionId)
    sendJson(res, 200, { ok: true })
    return
  }

  // POST /api/agents/:sessionId/yolo-mode — update session YOLO mode
  if (req.method === 'POST' && subPath === 'yolo-mode') {
    const body = await readJsonBody(req)
    const result = await updateSessionYoloMode(sessionId, body?.yoloMode === true)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/model — update session model
  if (req.method === 'POST' && subPath === 'model') {
    const body = await readJsonBody(req)
    const model = body?.model
    if (!model) {
      const error = new Error('Missing model in request body')
      error.statusCode = 400
      throw error
    }
    const result = updateSessionModel(sessionId, model)
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

  // POST /api/agents/:sessionId/messages — replace session messages (legacy rollback/sync)
  if (req.method === 'POST' && subPath === 'messages') {
    const body = await readJsonBody(req)
    const messages = body?.messages
    if (!Array.isArray(messages)) {
      const error = new Error('Missing messages array in request body')
      error.statusCode = 400
      throw error
    }
    const state = await replaceSessionMessages(sessionId, messages)
    sendJson(res, 200, { ok: true, messages: state?.messages })
    return
  }

  // POST /api/agents/:sessionId/rollback — roll back from a message index on the authoritative server state
  if (req.method === 'POST' && subPath === 'rollback') {
    const body = await readJsonBody(req)
    const result = await rollbackSessionMessages(sessionId, body?.messageIndex)
    sendJson(res, 200, { ok: true, rollbackIndex: result.rollbackIndex, session: result.session })
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
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      cleanup()
    }
  }, 15000)

  const onAgentEvent = (event) => {
    try {
      writeSseEvent(res, event.type || 'agent_event', event)
    } catch {
      cleanup()
    }
  }

  const cleanup = () => {
    clearInterval(keepAlive)
    agentEvents.removeListener('agent_event', onAgentEvent)
    if (!res.writableEnded) {
      res.end()
    }
  }

  agentEvents.on('agent_event', onAgentEvent)

  req.on('close', cleanup)
  req.on('error', cleanup)
  res.on('error', cleanup)
}

async function handleStream(req, res, sessionId) {
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

  // Reset idle timer — active SSE connection keeps session alive
  touchSession(sessionId)

  // Set SSE headers
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })

  // Send initial state
  const state = getSessionState(sessionId)
  if (state) {
    writeSseEvent(res, 'state', state)
  }

  // Keep-alive ping every 15 seconds — also resets idle timer
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n')
      touchSession(sessionId)
    } catch {
      cleanup()
    }
  }, 15000)

  // Handle agent events
  const onAgentEvent = (event) => {
    try {
      writeSseEvent(res, event.type, event)
    } catch {
      cleanup()
    }
  }

  const cleanup = () => {
    clearInterval(keepAlive)
    eventBus.removeListener('agent_event', onAgentEvent)
    releaseSse(sessionId)
    if (!res.writableEnded) {
      res.end()
    }
  }

  eventBus.on('agent_event', onAgentEvent)

  req.on('close', cleanup)
  req.on('error', cleanup)
  res.on('error', cleanup)
}

function writeSseEvent(res, event, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  // Split multi-line payloads
  const lines = payload.split('\n')
  res.write(`event: ${event}\n`)
  for (const line of lines) {
    res.write(`data: ${line}\n`)
  }
  res.write('\n')
}
