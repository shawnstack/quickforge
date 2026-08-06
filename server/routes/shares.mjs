import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readSessionValue } from '../storage.mjs'
import { getLanUrls, isTailscaleAddress } from '../utils/network.mjs'
import {
  createConversationShare,
  deleteConversationShare,
  listConversationShares,
  restoreConversationShare,
  revokeConversationShare,
  updateConversationShare,
  updateConversationShareExpiration,
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
    const allowCloudUsage = permission === 'operate' && body?.allowCloudUsage === true
    if (allowCloudUsage && context.isLocalRequest === false
      && !(context.remoteAuthorized === true && isTailscaleAddress(context.remoteAddress))) {
      const error = new Error('QuickForge Cloud sharing can only be enabled locally or from an authorized Tailscale client.')
      error.statusCode = 403
      throw error
    }

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
      allowCloudUsage,
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

  if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'shares') {
    const shareId = decodeSegment(parts[2])
    const action = parts[3]

    if (req.method === 'POST' && action === 'disable') {
      const share = await revokeConversationShare(shareId)
      sendJson(res, 200, { ok: true, share })
      return
    }

    if (req.method === 'POST' && action === 'restore') {
      const body = await readJsonBody(req)
      const expiresAt = typeof body?.expiresAt === 'string' && body.expiresAt ? body.expiresAt : undefined
      const currentShares = await listConversationShares()
      const current = currentShares.find((share) => share.id === shareId)
      if (!current) {
        const error = new Error('Share not found')
        error.statusCode = 404
        throw error
      }
      const session = current.sessionId ? await readSessionValue(current.sessionId) : null
      if (!session) {
        const error = new Error('Session not found')
        error.statusCode = 404
        throw error
      }
      const share = await restoreConversationShare(shareId, expiresAt)
      sendJson(res, 200, { ok: true, share })
      return
    }

    if (req.method === 'POST' && action === 'expiration') {
      const body = await readJsonBody(req)
      const expiresAt = typeof body?.expiresAt === 'string' && body.expiresAt ? body.expiresAt : undefined
      const share = await updateConversationShareExpiration(shareId, expiresAt)
      sendJson(res, 200, { ok: true, share })
      return
    }

    if (req.method === 'POST' && action === 'update') {
      const body = await readJsonBody(req)
      const permission = body?.permission
      const password = typeof body?.password === 'string' ? body.password : undefined
      const expiresAt = typeof body?.expiresAt === 'string' && body.expiresAt ? body.expiresAt : undefined
      const allowCloudUsage = body?.allowCloudUsage
      if (allowCloudUsage === true && context.isLocalRequest === false
        && !(context.remoteAuthorized === true && isTailscaleAddress(context.remoteAddress))) {
        const error = new Error('QuickForge Cloud sharing can only be enabled locally or from an authorized Tailscale client.')
        error.statusCode = 403
        throw error
      }
      const share = await updateConversationShare(shareId, { permission, password, expiresAt, allowCloudUsage })
      sendJson(res, 200, { ok: true, share })
      return
    }

    if (req.method === 'DELETE' && action === 'permanent') {
      const share = await deleteConversationShare(shareId)
      sendJson(res, 200, { ok: true, share })
      return
    }
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
