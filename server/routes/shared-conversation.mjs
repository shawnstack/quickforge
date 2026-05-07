import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readSessionValue } from '../storage.mjs'
import { abortRun, restoreAgent, runPrompt, getSessionState } from '../agent-manager.mjs'
import {
  assertShareActive,
  issueConversationShareToken,
  parseCookies,
  readConversationShare,
  rollbackSharedSessionMessages,
  shareCookieName,
  verifySharePassword,
  verifyShareToken,
} from '../share-store.mjs'

const MAX_SHARED_MESSAGE_BYTES = 64 * 1024

function publicSharePayload(record) {
  return {
    id: record.id,
    permission: record.permission,
    title: record.titleSnapshot,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    scope: record.scope,
    projectId: record.projectId,
  }
}

function sanitizeMessage(message) {
  if (!message || typeof message !== 'object') return message
  if (message.role === 'system') return null
  return message
}

function sanitizeSession(session, record) {
  const messages = Array.isArray(session?.messages) ? session.messages.map(sanitizeMessage).filter(Boolean) : []
  return {
    id: record.id,
    title: session?.title || record.titleSnapshot || 'New chat',
    permission: record.permission,
    expiresAt: record.expiresAt,
    scope: record.scope,
    projectId: record.projectId,
    messages,
    isStreaming: Boolean(session?.isStreaming || session?.taskStatus === 'running'),
    taskStatus: session?.taskStatus,
  }
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
}

function messageFromBody(body, record, req) {
  const content = typeof body?.content === 'string' ? body.content : typeof body?.message === 'string' ? body.message : ''
  if (!content.trim()) {
    const error = new Error('Missing message content')
    error.statusCode = 400
    throw error
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_SHARED_MESSAGE_BYTES) {
    const error = new Error('Message is too large')
    error.statusCode = 413
    throw error
  }
  return {
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    metadata: {
      source: 'lan-share',
      shareId: record.id,
      permission: record.permission,
      remoteAddress: req.socket.remoteAddress,
    },
  }
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

export async function handleSharedConversationApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)
  const shareId = decodeSegment(parts[2])
  const action = parts[3]

  if (!shareId) {
    const error = new Error('Missing share id')
    error.statusCode = 400
    throw error
  }

  if (req.method === 'POST' && action === 'unlock') {
    const body = await readJsonBody(req)
    const record = await readConversationShare(shareId)
    assertShareActive(record)
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

  if (req.method === 'GET' && action === 'session') {
    sendJson(res, 200, await sharedSessionPayload(record))
    return
  }

  if (req.method === 'POST' && action === 'message') {
    assertOperate(record)
    const body = await readJsonBody(req)
    await restoreAgent(record.sessionId)
    const result = await runPrompt(record.sessionId, messageFromBody(body, record, req))
    sendJson(res, 200, result)
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
