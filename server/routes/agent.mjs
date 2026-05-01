import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import {
  createAgent,
  runPrompt,
  abortRun,
  steerAgent,
  followUpAgent,
  getSessionState,
  getSessionEventBus,
  destroyAgent,
  listSessions,
  updateSessionModel,
} from '../agent-manager.mjs'

export async function handleAgentApi(req, res, url) {
  const pathname = url.pathname
  const parts = pathname.split('/').filter(Boolean)

  // GET /api/agents — list active sessions
  if (req.method === 'GET' && pathname === '/api/agents') {
    sendJson(res, 200, { sessions: listSessions() })
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
  if (req.method === 'GET' && subPath === 'stream') {
    await handleStream(req, res, sessionId)
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
    const result = await runPrompt(sessionId, message)
    sendJson(res, 200, result)
    return
  }

  // POST /api/agents/:sessionId/abort — abort current run
  if (req.method === 'POST' && subPath === 'abort') {
    const result = abortRun(sessionId)
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

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

// ---------------------------------------------------------------------------
// SSE stream handler
// ---------------------------------------------------------------------------

function handleStream(req, res, sessionId) {
  const eventBus = getSessionEventBus(sessionId)
  if (!eventBus) {
    sendJson(res, 404, { error: 'Session not found' })
    return
  }

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

  // Keep-alive ping every 15 seconds
  const keepAlive = setInterval(() => {
    res.write(': ping\n\n')
  }, 15000)

  // Handle agent events
  const onAgentEvent = (event) => {
    try {
      writeSseEvent(res, event.type, event)
    } catch {
      // Connection closed — clean up
      cleanup()
    }
  }

  const cleanup = () => {
    clearInterval(keepAlive)
    eventBus.removeListener('agent_event', onAgentEvent)
    if (!res.writableEnded) {
      res.end()
    }
  }

  eventBus.on('agent_event', onAgentEvent)

  // Clean up on connection close
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
