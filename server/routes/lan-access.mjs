import { sendJson, readJsonBody } from '../utils/response.mjs'
import { getLanUrls } from '../utils/network.mjs'
import { logger } from '../utils/logger.mjs'
import { parseCookies } from '../share-store.mjs'
import {
  issueLanAccessToken,
  lanAccessCookieName,
  readLanAccessStatus,
  revokeLanAccessToken,
  revokeLanAccessTokenById,
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
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#171717" media="(prefers-color-scheme: dark)" />
  <link rel="icon" href="/favicon.svg" />
  <title>QuickForge 局域网访问</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
      --background: #ffffff;
      --foreground: #171717;
      --muted-foreground: #737373;
      --border: #e5e5e5;
      --input-border: #dedede;
      --surface: #ffffff;
      --surface-muted: #fafafa;
      --primary: #171717;
      --primary-hover: #292929;
      --primary-foreground: #fafafa;
      --danger: #dc2626;
      --shadow: 0 10px 26px -18px rgba(15, 23, 42, .48);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-width: 0; min-height: 100%; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 32px 20px;
      background: var(--background);
      color: var(--foreground);
      -webkit-font-smoothing: antialiased;
    }
    main { width: min(100%, 440px); }
    .intro { display: flex; align-items: center; gap: 13px; margin-bottom: 30px; }
    .brand-mark {
      display: grid;
      width: 46px;
      height: 46px;
      flex: 0 0 auto;
      place-items: center;
      border: 1px solid var(--border);
      border-radius: 13px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .brand-mark img { width: 29px; height: 29px; }
    .eyebrow {
      margin: 0 0 2px;
      color: var(--muted-foreground);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .1em;
    }
    h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.02em; line-height: 1.35; }
    .subtitle { margin: 3px 0 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.5; }
    form {
      padding: 22px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    label { display: block; margin-bottom: 9px; font-size: 14px; font-weight: 500; }
    .input-wrap { position: relative; }
    .input-icon {
      position: absolute;
      top: 50%;
      left: 13px;
      width: 17px;
      height: 17px;
      color: var(--muted-foreground);
      pointer-events: none;
      transform: translateY(-50%);
    }
    input {
      width: 100%;
      height: 44px;
      border: 1px solid var(--input-border);
      border-radius: 12px;
      outline: none;
      background: var(--surface);
      color: var(--foreground);
      padding: 0 13px 0 40px;
      font: inherit;
      font-size: 14px;
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }
    input::placeholder { color: var(--muted-foreground); opacity: .7; }
    input:hover { border-color: color-mix(in srgb, var(--foreground) 24%, var(--border)); }
    input:focus {
      border-color: color-mix(in srgb, var(--foreground) 30%, var(--border));
      box-shadow: var(--shadow);
    }
    input[aria-invalid="true"] { border-color: color-mix(in srgb, var(--danger) 60%, var(--border)); }
    button {
      width: 100%;
      height: 44px;
      margin-top: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 0;
      border-radius: 12px;
      background: var(--primary);
      color: var(--primary-foreground);
      font: inherit;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 150ms ease, opacity 150ms ease;
    }
    button:hover:not(:disabled) { background: var(--primary-hover); }
    button:active:not(:disabled) { opacity: .88; }
    button:focus-visible { outline: 2px solid color-mix(in srgb, var(--foreground) 28%, transparent); outline-offset: 3px; }
    button:disabled { cursor: default; opacity: .62; }
    .button-icon { width: 16px; height: 16px; }
    .spinner { display: none; width: 15px; height: 15px; animation: spin .8s linear infinite; }
    button.is-loading .button-icon { display: none; }
    button.is-loading .spinner { display: block; }
    .error {
      min-height: 20px;
      margin: 10px 0 -2px;
      color: var(--danger);
      font-size: 13px;
      line-height: 20px;
    }
    .note {
      display: flex;
      gap: 9px;
      margin: 17px 3px 0;
      color: var(--muted-foreground);
      font-size: 12px;
      line-height: 1.65;
    }
    .note svg { width: 15px; height: 15px; flex: 0 0 auto; margin-top: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: #171717;
        --foreground: #fafafa;
        --muted-foreground: #a3a3a3;
        --border: #353535;
        --input-border: #404040;
        --surface: #1d1d1d;
        --surface-muted: #262626;
        --primary: #e5e5e5;
        --primary-hover: #fafafa;
        --primary-foreground: #171717;
        --danger: #f87171;
        --shadow: 0 10px 26px -18px rgba(0, 0, 0, .9);
      }
    }
    @media (max-width: 480px) {
      body { place-items: start center; padding-top: max(28px, 8vh); }
      .intro { margin-bottom: 24px; }
      form { padding: 20px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <main>
    <header class="intro">
      <div class="brand-mark" aria-hidden="true"><img src="/favicon.svg" alt="" /></div>
      <div>
        <p class="eyebrow">QUICKFORGE</p>
        <h1>验证局域网访问</h1>
        <p class="subtitle">输入主机端设置的访问密码，继续进入工作区。</p>
      </div>
    </header>

    <form id="unlock-form">
      <label for="password">访问密码</label>
      <div class="input-wrap">
        <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <rect x="4.5" y="10" width="15" height="10" rx="2.5"></rect>
          <path d="M8 10V7.5a4 4 0 0 1 8 0V10"></path>
        </svg>
        <input
          id="password"
          type="password"
          autocomplete="current-password"
          placeholder="请输入访问密码"
          aria-describedby="error"
          aria-invalid="false"
          autofocus
        />
      </div>
      <button id="submit" type="submit">
        <svg class="spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".25" stroke-width="3"></circle>
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path>
        </svg>
        <span id="button-label">进入 QuickForge</span>
        <svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </button>
      <p id="error" class="error" role="alert" aria-live="polite"></p>
    </form>

    <p class="note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M12 3 5 6v5c0 4.6 2.9 8.4 7 10 4.1-1.6 7-5.4 7-10V6l-7-3Z" stroke-linejoin="round"></path>
        <path d="m9.5 12 1.7 1.7 3.6-3.7" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span>密码仅用于验证本次局域网访问，不会保存在此设备。</span>
    </p>
  </main>
  <script>
    const form = document.getElementById('unlock-form')
    const password = document.getElementById('password')
    const button = document.getElementById('submit')
    const buttonLabel = document.getElementById('button-label')
    const error = document.getElementById('error')

    password.addEventListener('input', () => {
      error.textContent = ''
      password.setAttribute('aria-invalid', 'false')
    })

    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (button.disabled) return

      error.textContent = ''
      password.setAttribute('aria-invalid', 'false')
      button.disabled = true
      button.classList.add('is-loading')
      buttonLabel.textContent = '正在验证…'

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
        password.setAttribute('aria-invalid', 'true')
        password.focus()
      } finally {
        button.disabled = false
        button.classList.remove('is-loading')
        buttonLabel.textContent = '进入 QuickForge'
      }
    })
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
      const result = await issueLanAccessToken(body?.password, {
        remoteAddress: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      })
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
    const token = parseCookies(req.headers.cookie).get(lanAccessCookieName())
    await revokeLanAccessToken(token)
    clearLanCookie(res)
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'POST' && pathname === '/api/lan-access/revoke') {
    requireLocal(context)
    const body = await readJsonBody(req, 1024)
    const status = await revokeLanAccessTokenById(body?.id)
    logger.info('LAN access session revoked.', { sessionId: body?.id })
    sendJson(res, 200, { ok: true, ...status })
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
