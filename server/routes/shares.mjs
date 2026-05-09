import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readSessionValue } from '../storage.mjs'
import { getLanUrls } from '../utils/network.mjs'
import {
  createConversationShare,
  listConversationShares,
  revokeConversationShare,
} from '../share-store.mjs'

function localBaseUrl(req, port) {
  const forwardedProto = req.headers['x-forwarded-proto']
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'http'
  const host = req.headers.host || `127.0.0.1:${port}`
  return `${protocol}://${host}`
}

function clipboardText({ url }) {
  return url
}

function shareUrlForRequest(req, shareId, port) {
  const lanBase = getLanUrls(port)[0]
  const baseUrl = lanBase || localBaseUrl(req, port)
  return `${baseUrl}/share/${encodeURIComponent(shareId)}`
}

export async function handleSharesApi(req, res, url, context = {}) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/shares') {
    const sessionId = url.searchParams.get('sessionId') || undefined
    const shares = await listConversationShares(sessionId)
    sendJson(res, 200, {
      shares: shares.map((share) => ({
        ...share,
        url: shareUrlForRequest(req, share.id, context.port),
      })),
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/shares') {
    const body = await readJsonBody(req)
    const sessionId = body?.sessionId
    const permission = body?.permission
    const passwordProvided = typeof body?.password === 'string'
    const password = passwordProvided ? body.password.trim() : undefined
    const expiresAt = typeof body?.expiresAt === 'string' && body.expiresAt ? body.expiresAt : undefined

    const session = sessionId ? await readSessionValue(sessionId) : null
    if (!session) {
      const error = new Error('Session not found')
      error.statusCode = 404
      throw error
    }

    const share = await createConversationShare({
      sessionId,
      permission,
      password: passwordProvided ? password : undefined,
      expiresAt,
      titleSnapshot: session.title,
      scope: session.scope,
      projectId: session.projectId,
      createdFromHost: req.socket.remoteAddress,
    })
    const shareUrl = shareUrlForRequest(req, share.id, context.port)
    const text = clipboardText({ url: shareUrl })
    sendJson(res, 201, {
      ok: true,
      share,
      url: shareUrl,
      password: passwordProvided ? password : undefined,
      clipboardText: text,
      lanUrls: getLanUrls(context.port),
    })
    return
  }

  if (req.method === 'DELETE' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'shares') {
    const shareId = decodeSegment(parts[2])
    const share = await revokeConversationShare(shareId)
    sendJson(res, 200, { ok: true, share })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
