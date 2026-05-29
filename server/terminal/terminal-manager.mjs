import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readTerminalShellConfig, resolveTerminalShellProfile } from '../project-config.mjs'
import { logger } from '../utils/logger.mjs'

const require = createRequire(import.meta.url)
const MAX_SESSIONS = Math.max(1, Number(process.env.QUICKFORGE_MAX_TERMINALS || 6))
const TERMINAL_DISABLED = process.env.QUICKFORGE_TERMINAL === '0'
const RECONNECT_GRACE_MS = Number(process.env.QUICKFORGE_TERMINAL_RECONNECT_MS || 5 * 60 * 1000)
const IDLE_TIMEOUT_MS = Number(process.env.QUICKFORGE_TERMINAL_IDLE_MS || 30 * 60 * 1000)

const sessions = new Map()
let cleanupTimer = null
let pty = null
let ptyLoadError = null

function loadPty() {
  if (pty) return pty
  if (ptyLoadError) throw ptyLoadError

  try {
    pty = require('node-pty')
    return pty
  } catch (error) {
    ptyLoadError = createError('Terminal requires node-pty. Install optional terminal dependencies to enable it.', 503)
    ptyLoadError.cause = error
    throw ptyLoadError
  }
}

function detectShellSync() {
  if (process.env.QUICKFORGE_TERMINAL_SHELL) return process.env.QUICKFORGE_TERMINAL_SHELL
  if (process.platform === 'win32') return 'cmd.exe'
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
}

async function detectShell(shellProfileId) {
  if (process.env.QUICKFORGE_TERMINAL_SHELL) return process.env.QUICKFORGE_TERMINAL_SHELL
  try {
    const profile = await resolveTerminalShellProfile(shellProfileId)
    if (profile?.command && profile.command !== 'auto') return profile.command
  } catch (error) {
    logger.warn('Failed to read terminal shell profile', { error: error?.message })
  }
  return detectShellSync()
}

function createError(message, statusCode = 500) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function serializeSession(session) {
  return {
    id: session.id,
    name: session.name,
    projectId: session.projectId,
    cwd: session.cwd,
    shell: session.shell,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    exited: session.exited,
    exitCode: session.exitCode,
    signal: session.signal,
  }
}

function send(client, message) {
  if (client.readyState === client.OPEN) {
    client.send(JSON.stringify(message), (error) => {
      if (error) logger.warn('Failed to send terminal websocket message', { error: error?.message })
    })
  }
}

function broadcast(session, message) {
  for (const client of session.clients) send(client, message)
}

function scheduleCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const session of sessions.values()) {
      const disconnectedTooLong = session.clients.size === 0 && now - session.disconnectedAt > RECONNECT_GRACE_MS
      const idleTooLong = now - session.touchedAt > IDLE_TIMEOUT_MS
      if (session.exited || disconnectedTooLong || idleTooLong) {
        destroyTerminalSession(session.id)
      }
    }
    if (sessions.size === 0) {
      clearInterval(cleanupTimer)
      cleanupTimer = null
    }
  }, 60 * 1000)
  cleanupTimer.unref?.()
}

export async function terminalCapabilities() {
  const config = await readTerminalShellConfig()
  const configuredShell = process.env.QUICKFORGE_TERMINAL_SHELL
    ? process.env.QUICKFORGE_TERMINAL_SHELL
    : config.terminalShell
  const shell = await detectShell()
  const terminalAvailable = !TERMINAL_DISABLED && (() => {
    try {
      loadPty()
      return true
    } catch {
      return false
    }
  })()

  return {
    enabled: terminalAvailable,
    localOnly: true,
    maxSessions: MAX_SESSIONS,
    shell: terminalAvailable ? shell : null,
    configuredShell: configuredShell || 'auto',
    terminalShellProfiles: config.profiles,
    defaultTerminalShellProfileId: config.defaultProfileId,
    terminalShellOverride: Boolean(process.env.QUICKFORGE_TERMINAL_SHELL),
    reason: TERMINAL_DISABLED
      ? 'Terminal is disabled by QUICKFORGE_TERMINAL=0.'
      : (terminalAvailable ? null : 'Terminal requires node-pty. Install optional terminal dependencies to enable it.'),
  }
}

export function listTerminalSessions(projectId) {
  return [...sessions.values()]
    .filter((session) => !projectId || session.projectId === projectId)
    .map(serializeSession)
}

export async function createTerminalSession({ cwd, projectId = null, name, cols = 120, rows = 30, shellProfileId, shellProfileName }) {
  if (TERMINAL_DISABLED) throw createError('Terminal is disabled', 403)
  if (sessions.size >= MAX_SESSIONS) throw createError(`Maximum terminal sessions reached (${MAX_SESSIONS})`, 429)

  const profile = await resolveTerminalShellProfile(shellProfileId)
  const shell = await detectShell(profile?.id)
  const ptyModule = loadPty()
  const id = randomUUID()
  const now = new Date().toISOString()
  const profileName = typeof shellProfileName === 'string' && shellProfileName.trim() ? shellProfileName.trim() : profile?.name || ''
  const ptyProcess = ptyModule.spawn(shell, [], {
    name: 'xterm-256color',
    cols: Math.max(20, Number(cols) || 120),
    rows: Math.max(8, Number(rows) || 30),
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      QUICKFORGE_TERMINAL: '1',
    },
  })

  const session = {
    id,
    name: String(name || profileName || `Terminal ${sessions.size + 1}`),
    projectId,
    cwd,
    shell,
    pty: ptyProcess,
    clients: new Set(),
    cols: Math.max(20, Number(cols) || 120),
    rows: Math.max(8, Number(rows) || 30),
    createdAt: now,
    updatedAt: now,
    touchedAt: Date.now(),
    disconnectedAt: Date.now(),
    exited: false,
    exitCode: null,
    signal: null,
  }

  ptyProcess.onData((data) => {
    session.touchedAt = Date.now()
    session.updatedAt = new Date().toISOString()
    broadcast(session, { type: 'output', data })
  })

  ptyProcess.onExit(({ exitCode, signal }) => {
    session.exited = true
    session.exitCode = exitCode
    session.signal = signal
    session.updatedAt = new Date().toISOString()
    broadcast(session, { type: 'exit', exitCode, signal })
  })

  sessions.set(id, session)
  scheduleCleanup()
  return serializeSession(session)
}

export function attachTerminalClient(sessionId, client) {
  const session = sessions.get(sessionId)
  if (!session) throw createError('Terminal session not found', 404)

  session.clients.add(client)
  session.touchedAt = Date.now()
  session.updatedAt = new Date().toISOString()
  send(client, { type: 'ready', session: serializeSession(session) })

  client.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString('utf8'))
      session.touchedAt = Date.now()
      session.updatedAt = new Date().toISOString()

      if (message.type === 'input' && typeof message.data === 'string' && !session.exited) {
        session.pty.write(message.data)
      } else if (message.type === 'resize' && !session.exited) {
        const cols = Math.max(20, Number(message.cols) || session.cols)
        const rows = Math.max(8, Number(message.rows) || session.rows)
        session.cols = cols
        session.rows = rows
        session.pty.resize(cols, rows)
      } else if (message.type === 'ping') {
        send(client, { type: 'pong' })
      }
    } catch (error) {
      send(client, { type: 'error', message: error instanceof Error ? error.message : 'Invalid terminal message' })
    }
  })

  client.on('error', (error) => {
    logger.warn('Terminal websocket client error', { sessionId, error: error?.message })
    session.clients.delete(client)
    session.disconnectedAt = Date.now()
  })

  client.on('close', () => {
    session.clients.delete(client)
    session.disconnectedAt = Date.now()
  })

  if (session.exited) {
    send(client, { type: 'exit', exitCode: session.exitCode, signal: session.signal })
  }
}

export function destroyTerminalSession(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return false
  sessions.delete(sessionId)
  for (const client of session.clients) {
    try { client.close() } catch { /* ignore */ }
  }
  try {
    if (!session.exited) session.pty.kill()
  } catch (error) {
    logger.warn('Failed to kill terminal session', { sessionId, error: error?.message })
  }
  return true
}

export function shutdownTerminalSessions() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
  for (const sessionId of [...sessions.keys()]) destroyTerminalSession(sessionId)
}

export async function platformInfo() {
  return { platform: os.platform(), shell: await detectShell() }
}
