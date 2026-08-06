import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readSessionValue } from '../storage.mjs'
import { listModelCatalog, resolveModelBinding } from '../model-catalog.mjs'
import { sendSessionAsset } from './session-assets.mjs'
import { abortRun, restoreAgent, runPrompt, getSessionState, getSessionEventBus, updateSessionModel, updateSessionThinkingLevel } from '../agent-manager.mjs'
import {
  assertShareActive,
  issueConversationShareToken,
  onConversationShareInvalidated,
  parseCookies,
  readConversationShare,
  rollbackSharedSessionMessages,
  shareCookieName,
  verifySharePassword,
  verifyShareToken,
} from '../share-store.mjs'

const MAX_SHARED_MESSAGE_BYTES = 64 * 1024
const CLIENT_MESSAGE_ID_FIELD = 'quickforgeClientMessageId'
const CLIENT_MESSAGE_ID_MAX_LENGTH = 128

function sanitizedClientMessageId(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > CLIENT_MESSAGE_ID_MAX_LENGTH) return undefined
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : undefined
}

function objectMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function attachClientMessageId(message, clientMessageId) {
  if (!clientMessageId) return message
  return {
    ...message,
    metadata: {
      ...objectMetadata(message.metadata),
      [CLIENT_MESSAGE_ID_FIELD]: clientMessageId,
    },
  }
}

function publicSharePayload(record) {
  return {
    id: record.id,
    permission: record.permission,
    title: record.titleSnapshot,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    scope: record.scope,
    projectId: record.projectId,
    hasPassword: Boolean(record.passwordHash),
    allowCloudUsage: record.allowCloudUsage === true,
  }
}

function sanitizeMessage(message) {
  if (!message || typeof message !== 'object') return message
  if (message.role === 'system') return null
  return message
}

function sanitizeContextCompaction(compaction) {
  if (!compaction || typeof compaction !== 'object') return null
  return {
    ...compaction,
    summaryMessage: sanitizeMessage(compaction.summaryMessage),
  }
}

function sanitizeSession(session, record) {
  const messages = Array.isArray(session?.messages) ? session.messages.map(sanitizeMessage).filter(Boolean) : []
  return {
    id: record.id,
    shareId: record.id,
    sessionId: record.sessionId,
    title: session?.title || record.titleSnapshot || 'New chat',
    permission: record.permission,
    expiresAt: record.expiresAt,
    scope: record.scope,
    projectId: record.projectId,
    systemPrompt: '',
    model: sanitizeModel(session?.model),
    thinkingLevel: session?.thinkingLevel || 'off',
    tools: Array.isArray(session?.tools) ? session.tools : [],
    yoloMode: Boolean(session?.yoloMode),
    messages,
    contextCompaction: sanitizeContextCompaction(session?.contextCompaction),
    contextUsage: null,
    isStreaming: Boolean(session?.isStreaming || session?.taskStatus === 'running'),
    taskStatus: session?.taskStatus || session?.status,
    errorMessage: session?.errorMessage,
  }
}

function sanitizeModel(model) {
  if (!model || typeof model !== 'object') return { provider: 'shared', id: 'shared' }
  return {
    ...model,
    apiKey: undefined,
    key: undefined,
    headers: undefined,
  }
}

function sanitizeEvent(event) {
  if (!event || typeof event !== 'object') return event
  const next = { ...event }
  if (next.message) next.message = sanitizeMessage(next.message)
  if (Array.isArray(next.messages)) next.messages = next.messages.map(sanitizeMessage).filter(Boolean)
  if (next.contextCompaction?.summaryMessage) {
    next.contextCompaction = sanitizeContextCompaction(next.contextCompaction)
  }
  delete next.contextUsage
  return next
}

function writeSseEvent(res, event, data) {
  const payload = JSON.stringify(data)
  res.write(`event: ${event}\n`)
  for (const line of payload.split('\n')) {
    res.write(`data: ${line}\n`)
  }
  res.write('\n')
}

async function handleSharedEvents(req, res, record) {
  await restoreAgent(record.sessionId)
  const eventBus = getSessionEventBus(record.sessionId)
  if (!eventBus) {
    const error = new Error('Session not found')
    error.statusCode = 404
    throw error
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })

  writeSseEvent(res, 'state', await sharedSessionPayload(record))

  let cleanedUp = false
  let expirationTimeout
  let removeShareInvalidationListener = () => undefined

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    clearInterval(keepAlive)
    if (expirationTimeout) clearTimeout(expirationTimeout)
    removeShareInvalidationListener()
    eventBus.removeListener('agent_event', onAgentEvent)
    if (!res.writableEnded) res.end()
  }

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      cleanup()
    }
  }, 15000)

  const onAgentEvent = (event) => {
    try {
      const payload = sanitizeEvent(event)
      writeSseEvent(res, payload.type || 'agent_event', payload)
    } catch {
      cleanup()
    }
  }

  removeShareInvalidationListener = onConversationShareInvalidated(({ shareId }) => {
    if (shareId === record.id) cleanup()
  })
  const scheduleExpiration = () => {
    if (!record.expiresAt || cleanedUp) return
    const delay = Date.parse(record.expiresAt) - Date.now()
    if (delay <= 0) {
      cleanup()
      return
    }
    expirationTimeout = setTimeout(scheduleExpiration, Math.min(delay, 2_147_483_647))
  }
  scheduleExpiration()

  eventBus.on('agent_event', onAgentEvent)
  req.on('close', cleanup)
  req.on('error', cleanup)
  res.on('error', cleanup)
}

function passwordRequiredError() {
  const error = new Error('Editable shares require a non-empty password')
  error.statusCode = 403
  return error
}

function setShareCookie(res, shareId, token) {
  const maxAge = 60 * 60 * 24 * 7
  const cookie = [
    `${shareCookieName(shareId)}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Path=/`,
  ].join('; ')
  res.setHeader('Set-Cookie', cookie)
}

async function requireShareAuth(req, shareId) {
  const record = await readConversationShare(shareId)
  assertShareActive(record)
  if (!record.passwordHash) return record
  const token = parseCookies(req.headers.cookie).get(shareCookieName(shareId))
  if (!verifyShareToken(record, token)) {
    const error = new Error('Share authentication required')
    error.statusCode = 401
    throw error
  }
  return record
}

function assertOperate(record) {
  if (record.permission !== 'operate') {
    const error = new Error('This shared conversation is read-only.')
    error.statusCode = 403
    throw error
  }
  if (!record.passwordHash) {
    throw passwordRequiredError()
  }
}

function messageFromBody(body, record, req) {
  const content = typeof body?.content === 'string'
    ? body.content
    : typeof body?.message === 'string'
      ? body.message
      : typeof body?.message?.content === 'string'
        ? body.message.content
        : ''
  const attachments = Array.isArray(body?.message?.attachments) ? body.message.attachments : undefined
  if (!content.trim() && !attachments?.length) {
    const error = new Error('Missing message content')
    error.statusCode = 400
    throw error
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_SHARED_MESSAGE_BYTES) {
    const error = new Error('Message is too large')
    error.statusCode = 413
    throw error
  }
  const clientMessageId = sanitizedClientMessageId(body?.clientMessageId)
    || sanitizedClientMessageId(body?.message?.metadata?.[CLIENT_MESSAGE_ID_FIELD])
  const metadata = {
    ...objectMetadata(body?.message?.metadata),
    source: 'lan-share',
    shareId: record.id,
    permission: record.permission,
    remoteAddress: req.socket.remoteAddress,
  }
  if (clientMessageId) metadata[CLIENT_MESSAGE_ID_FIELD] = clientMessageId
  const message = {
    role: attachments?.length ? 'user-with-attachments' : 'user',
    content,
    timestamp: body?.message?.timestamp || new Date().toISOString(),
    metadata,
  }
  if (attachments?.length) message.attachments = attachments
  return attachClientMessageId(message, clientMessageId)
}

async function sharedSessionPayload(record) {
  const activeState = getSessionState(record.sessionId)
  if (activeState) return sanitizeSession(activeState, record)
  const session = await readSessionValue(record.sessionId)
  if (!session) {
    const error = new Error('Session not found')
    error.statusCode = 404
    throw error
  }
  return sanitizeSession(session, record)
}

export async function handleSharedConversationApi(req, res, url, context = {}) {
  const parts = url.pathname.split('/').filter(Boolean)
  const shareId = decodeSegment(parts[2])
  const action = parts[3]
  const actionId = parts[4]

  if (!shareId) {
    const error = new Error('Missing share id')
    error.statusCode = 400
    throw error
  }

  if (req.method === 'POST' && action === 'unlock') {
    const body = await readJsonBody(req)
    const record = await readConversationShare(shareId)
    assertShareActive(record)
    if (record.permission === 'operate' && !record.passwordHash) {
      throw passwordRequiredError()
    }
    const ok = await verifySharePassword(record, body?.password)
    if (!ok) {
      const error = new Error('Invalid share password')
      error.statusCode = 401
      throw error
    }
    const { token, share } = await issueConversationShareToken(shareId)
    setShareCookie(res, shareId, token)
    sendJson(res, 200, { ok: true, share: publicSharePayload(share), permission: share.permission, title: share.titleSnapshot, expiresAt: share.expiresAt })
    return
  }

  if (req.method === 'GET' && action === 'meta') {
    const record = await readConversationShare(shareId)
    assertShareActive(record)
    sendJson(res, 200, { share: publicSharePayload(record) })
    return
  }

    const record = await requireShareAuth(req, shareId)
    if (record.permission === 'operate' && !record.passwordHash) throw passwordRequiredError()

    if (req.method === 'GET' && action === 'assets' && actionId) {
      const bucket = record.scope === 'project'
        ? { scope: 'project', projectId: record.projectId }
        : { scope: 'global' }
      await sendSessionAsset(res, bucket, record.sessionId, decodeSegment(actionId))
      return
    }

    if (req.method === 'GET' && action === 'session') {
    sendJson(res, 200, await sharedSessionPayload(record))
    return
  }

  if (req.method === 'GET' && action === 'models') {
    assertOperate(record)
    const session = await sharedSessionPayload(record)
    const models = await listModelCatalog({
      context: { ...context, allowCloud: record.allowCloudUsage === true },
      currentModel: session.model,
    })
    const providers = []
    for (const model of models) {
      let provider = providers.find((item) => item.id === model.provider)
      if (!provider) {
        provider = { id: model.provider, name: model.provider, type: model.api, baseUrl: model.baseUrl, models: [] }
        providers.push(provider)
      }
      provider.models.push(sanitizeModel(model))
    }
    sendJson(res, 200, { providers })
    return
  }

  if (req.method === 'GET' && action === 'events') {
    await handleSharedEvents(req, res, record)
    return
  }

  if (req.method === 'POST' && action === 'message') {
    assertOperate(record)
    const body = await readJsonBody(req)
    await restoreAgent(record.sessionId)
    const result = await runPrompt(
      record.sessionId,
      messageFromBody(body, record, req),
      [],
      body?.command,
      null,
      { ...context, allowCloud: record.allowCloudUsage === true, source: 'shared' },
    )
    sendJson(res, 200, result)
    return
  }

  if (req.method === 'POST' && action === 'model') {
    assertOperate(record)
    const body = await readJsonBody(req)
    await restoreAgent(record.sessionId)
    const currentModel = getSessionState(record.sessionId)?.model
    const binding = await resolveModelBinding(body, {
      context: { ...context, allowCloud: record.allowCloudUsage === true, source: 'shared' },
      currentModel,
      allowCurrentHidden: true,
      legacySnapshot: body?.model,
    })
    sendJson(res, 200, updateSessionModel(record.sessionId, sanitizeModel(binding.model), binding.modelRef))
    return
  }

  if (req.method === 'POST' && action === 'thinking-level') {
    assertOperate(record)
    const body = await readJsonBody(req)
    const thinkingLevel = body?.thinkingLevel
    if (!thinkingLevel || typeof thinkingLevel !== 'string') {
      const error = new Error('Missing thinkingLevel in request body')
      error.statusCode = 400
      throw error
    }
    await restoreAgent(record.sessionId)
    sendJson(res, 200, updateSessionThinkingLevel(record.sessionId, thinkingLevel))
    return
  }

  if (req.method === 'POST' && action === 'abort') {
    assertOperate(record)
    const result = await abortRun(record.sessionId)
    sendJson(res, 200, result)
    return
  }

  if (req.method === 'POST' && action === 'rollback') {
    assertOperate(record)
    const body = await readJsonBody(req)
    const result = await rollbackSharedSessionMessages(record, body?.messageIndex)
    sendJson(res, 200, { ok: true, rollbackIndex: result.rollbackIndex, session: sanitizeSession(result.session, record) })
    return
  }

  const error = new Error('This operation is not allowed for shared conversations.')
  error.statusCode = 403
  throw error
}
