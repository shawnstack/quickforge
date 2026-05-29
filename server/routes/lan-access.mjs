import { sendJson, readJsonBody } from '../utils/response.mjs'
import { getLanUrls } from '../utils/network.mjs'
import { logger } from '../utils/logger.mjs'
import {
  issueLanAccessToken,
  lanAccessCookieName,
  readLanAccessStatus,
  revokeLanAccessTokens,
  updateLanAccessSettings,
} from '../lan-access-store.mjs'

const MAX_FAILED_ATTEMPTS = 5
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000
const LOCK_MS = 5 * 60 * 1000
const ATTEMPT_CLEANUP_MS = 5 * 60 * 1000
const attempts = new Map()
let cleanupTimer = null

function cleanupAttempts() {
  const now = Date.now()
  for (const [key, state] of attempts) {
    if (state.resetAt <= now && state.lockedUntil <= now) attempts.delete(key)
  }
  if (attempts.size === 0 && cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

function scheduleAttemptCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(cleanupAttempts, ATTEMPT_CLEANUP_MS)
  cleanupTimer.unref?.()
}

function remoteKey(req) {
  return String(req.socket.remoteAddress || 'unknown')
}

function attemptState(req) {
  const key = remoteKey(req)
  const now = Date.now()
  const state = attempts.get(key)
  if (!state || state.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + ATTEMPT_WINDOW_MS, lockedUntil: 0 }
    attempts.set(key, fresh)
    scheduleAttemptCleanup()
    return fresh
  }
  return state
}

function assertNotLocked(req) {
  const state = attemptState(req)
  if (state.lockedUntil > Date.now()) {
    const error = new Error('Too many failed attempts. Please try again later.')
    error.statusCode = 429
    throw error
  }
}

function recordFailure(req) {
  const state = attemptState(req)
  state.count += 1
  if (state.count >= MAX_FAILED_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCK_MS
    state.count = 0
    state.resetAt = Date.now() + ATTEMPT_WINDOW_MS
  }
}

function clearFailures(req) {
  attempts.delete(remoteKey(req))
}

function setLanCookie(res, token, maxAge) {
  const cookie = [
    `${lanAccessCookieName()}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(1, Number(maxAge) || 1)}`,
    'Path=/',
  ].join('; ')
  res.setHeader('Set-Cookie', cookie)
}

function clearLanCookie(res) {
  res.setHeader('Set-Cookie', `${lanAccessCookieName()}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`)
}

function requireLocal(context) {
  if (!context.isLocalRequest) {
    const error = new Error('LAN access settings can only be changed from this machine.')
    error.statusCode = 403
    throw error
  }
}

export function renderLanUnlockPage(res) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QuickForge 局域网访问</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #e5e7eb; }
    main { width: min(420px, calc(100vw - 32px)); border: 1px solid rgba(148,163,184,.3); border-radius: 20px; padding: 28px; background: rgba(15,23,42,.92); box-shadow: 0 24px 80px rgba(0,0,0,.35); }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 18px; color: #94a3b8; line-height: 1.6; }
    label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 600; }
    input { width: 100%; box-sizing: border-box; height: 42px; border-radius: 10px; border: 1px solid #334155; background: #020617; color: #f8fafc; padding: 0 12px; font-size: 15px; }
    button { width: 100%; height: 42px; margin-top: 14px; border: 0; border-radius: 10px; background: #2563eb; color: white; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .6; cursor: default; }
    .error { min-height: 20px; margin-top: 12px; color: #fca5a5; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>QuickForge 局域网访问</h1>
    <p>请输入本机设置中配置的局域网访问密码。</p>
    <label for="password">访问密码</label>
    <input id="password" type="password" autocomplete="current-password" autofocus />
    <button id="submit" type="button">进入 QuickForge</button>
    <div id="error" class="error" role="alert"></div>
  </main>
  <script>
    const password = document.getElementById('password')
    const button = document.getElementById('submit')
    const error = document.getElementById('error')
    async function unlock() {
      error.textContent = ''
      button.disabled = true
      try {
        const response = await fetch('/api/lan-access/unlock', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: password.value })
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : '密码错误')
        window.location.reload()
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : '密码错误'
      } finally {
        button.disabled = false
      }
    }
    button.addEventListener('click', unlock)
    password.addEventListener('keydown', (event) => { if (event.key === 'Enter') unlock() })
  </script>
</body>
</html>`
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html)
}

export async function handleLanAccessApi(req, res, url, context = {}) {
  const pathname = url.pathname

  if (req.method === 'GET' && pathname === '/api/lan-access/status') {
    const status = await readLanAccessStatus()
    if (context.isLocalRequest) {
      sendJson(res, 200, { ...status, lanUrls: getLanUrls(context.port) })
    } else {
      sendJson(res, 200, { enabled: status.enabled, requiresPassword: status.enabled && status.hasPassword })
    }
    return
  }

  if (req.method === 'PUT' && pathname === '/api/lan-access/settings') {
    requireLocal(context)
    const body = await readJsonBody(req)
    const status = await updateLanAccessSettings({
      enabled: Boolean(body?.enabled),
      password: typeof body?.password === 'string' ? body.password : undefined,
      sessionTtlHours: body?.sessionTtlHours,
    })
    logger.info('LAN access settings updated.', { enabled: status.enabled })
    sendJson(res, 200, { ok: true, ...status, lanUrls: getLanUrls(context.port) })
    return
  }

  if (req.method === 'POST' && pathname === '/api/lan-access/unlock') {
    assertNotLocked(req)
    const body = await readJsonBody(req, 1024)
    try {
      const result = await issueLanAccessToken(body?.password)
      setLanCookie(res, result.token, result.maxAge)
      clearFailures(req)
      logger.info('LAN access unlock succeeded.', { remoteAddress: req.socket.remoteAddress })
      sendJson(res, 200, { ok: true, expiresAt: result.expiresAt })
    } catch (error) {
      if (error?.statusCode === 401) {
        recordFailure(req)
        logger.warn('LAN access unlock failed.', { remoteAddress: req.socket.remoteAddress })
      }
      throw error
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/lan-access/logout') {
    clearLanCookie(res)
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'POST' && pathname === '/api/lan-access/revoke-all') {
    requireLocal(context)
    const status = await revokeLanAccessTokens()
    logger.info('LAN access tokens revoked.')
    sendJson(res, 200, { ok: true, ...status })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
