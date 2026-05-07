import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readSessionValue } from '../storage.mjs'
import { getLanUrls } from '../utils/network.mjs'
import {
  createConversationShare,
  generateSharePassword,
  listConversationShares,
  revokeConversationShare,
} from '../share-store.mjs'

function localBaseUrl(req, port) {
  const forwardedProto = req.headers['x-forwarded-proto']
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || 'http'
  const host = req.headers.host || `127.0.0.1:${port}`
  return `${protocol}://${host}`
}

function clipboardText({ url, password, permission, expiresAt }) {
  const isOperate = permission === 'operate'
  return [
    isOperate ? 'QuickForge 对话分享【高危可操作】' : 'QuickForge 对话分享',
    '',
    `链接：${url}`,
    `密码：${password}`,
    `权限：${isOperate ? '可操作原对话（禁止 Fork）' : '仅阅读'}`,
    `有效期：${expiresAt ? new Date(expiresAt).toLocaleString() : '永久，需手动撤销'}`,
    '',
    isOperate
      ? '⚠ 警告：拥有链接和密码的人只能操作这一个原对话，但对方的消息、停止生成、回滚等操作会直接影响你的本机原对话。如果该对话启用了 YOLO 或本地工具，对方可能通过对话间接触发本机文件读写或命令执行。请只发给完全信任的人。'
      : '请确保你和分享对象处于同一局域网。',
  ].join('\n')
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
    sendJson(res, 200, { shares: await listConversationShares(sessionId) })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/shares') {
    const body = await readJsonBody(req)
    const sessionId = body?.sessionId
    const permission = body?.permission
    const password = typeof body?.password === 'string' && body.password.trim()
      ? body.password.trim()
      : generateSharePassword()
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
      password,
      expiresAt,
      titleSnapshot: session.title,
      scope: session.scope,
      projectId: session.projectId,
      createdFromHost: req.socket.remoteAddress,
    })
    const shareUrl = shareUrlForRequest(req, share.id, context.port)
    const text = clipboardText({ url: shareUrl, password, permission, expiresAt })
    sendJson(res, 201, {
      ok: true,
      share,
      url: shareUrl,
      password,
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
