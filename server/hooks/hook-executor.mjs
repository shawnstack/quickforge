import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { terminateProcessTree } from '../utils/process-tree.mjs'
import {
  DEFAULT_HOOK_TIMEOUT_SECONDS,
  MAX_HOOK_TIMEOUT_SECONDS,
  MIN_HOOK_TIMEOUT_SECONDS,
} from './hooks-settings.mjs'

const OUTPUT_TAIL_LIMIT = 4000

function clampTimeoutSeconds(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_HOOK_TIMEOUT_SECONDS
  return Math.min(MAX_HOOK_TIMEOUT_SECONDS, Math.max(MIN_HOOK_TIMEOUT_SECONDS, Math.round(parsed)))
}

function tailOutput(value) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  return text.length > OUTPUT_TAIL_LIMIT ? text.slice(text.length - OUTPUT_TAIL_LIMIT) : text
}

/**
 * Replace `{{variable}}` placeholders in hook commands, URLs, headers and body
 * templates. Unknown variables (and variables without a value) resolve to an
 * empty string, so templates never leak raw placeholders into a command line.
 */
export function substituteVariables(text, ctx = {}) {
  if (typeof text !== 'string') return ''
  const values = {
    event: ctx.event,
    'session.id': ctx.sessionId,
    'session.project': ctx.project,
    'session.projectPath': ctx.projectPath,
    'tool.name': ctx.toolName,
    message: ctx.message,
  }
  return text.replace(/\{\{\s*[\w.-]+\s*\}\}/g, (match) => {
    const key = match.slice(2, -2).trim()
    const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined
    return value === undefined || value === null ? '' : String(value)
  })
}

function executeCommandHook(hook, ctx, record, startedAtMs) {
  const command = substituteVariables(hook.action.command, ctx)
  const timeoutMs = clampTimeoutSeconds(hook.timeoutSeconds) * 1000

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, { shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      record.status = 'error'
      record.output = tailOutput(error?.message || String(error))
      resolve(record)
      return
    }

    let output = ''
    let timedOut = false
    let settled = false

    const appendOutput = (chunk) => {
      output += chunk?.toString?.() || ''
    }
    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)

    const timer = setTimeout(() => {
      timedOut = true
      // terminateProcessTree escalates SIGTERM→SIGKILL (taskkill /T on
      // Windows) and always settles, so even a wedged child cannot leave the
      // promise dangling forever.
      terminateProcessTree(child)
        .catch(() => {})
        .then(() => settle())
    }, timeoutMs)
    timer.unref?.()

    // Both `close` and `error` settle; the guard keeps the promise idempotent.
    const settle = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      record.durationMs = Math.max(0, Date.now() - startedAtMs)
      record.output = tailOutput(output)
      record.status = timedOut ? 'timeout' : record.exitCode === 0 ? 'success' : 'error'
      resolve(record)
    }

    child.once('close', (code) => {
      if (typeof code === 'number') record.exitCode = code
      settle()
    })
    child.once('error', (error) => {
      record.output = tailOutput(error?.message || String(error))
      settle()
    })
  })
}

async function executeWebhookHook(hook, ctx, record, startedAtMs) {
  const action = hook.action
  const url = substituteVariables(action.url, ctx)
  const method = action.method === 'GET' ? 'GET' : 'POST'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), clampTimeoutSeconds(hook.timeoutSeconds) * 1000)
  timer.unref?.()

  try {
    const headers = {}
    for (const entry of Array.isArray(action.headers) ? action.headers : []) {
      if (!entry || typeof entry !== 'object') continue
      if (typeof entry.name !== 'string' || !entry.name.trim()) continue
      headers[entry.name.trim()] = substituteVariables(typeof entry.value === 'string' ? entry.value : '', ctx)
    }

    let body
    if (method === 'POST') {
      const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')
      if (!hasContentType) headers['content-type'] = 'application/json'
      body = typeof action.bodyTemplate === 'string' && action.bodyTemplate
        ? substituteVariables(action.bodyTemplate, ctx)
        : JSON.stringify({
          event: ctx.event ?? '',
          sessionId: ctx.sessionId ?? '',
          project: ctx.project ?? '',
          tool: ctx.toolName ?? '',
          message: ctx.message ?? '',
          at: new Date().toISOString(),
        })
    }

    const response = await fetch(url, { method, headers, body, signal: controller.signal })
    record.httpStatus = response.status
    const responseText = await response.text().catch(() => '')
    record.output = tailOutput(responseText)
    record.status = response.ok ? 'success' : 'error'
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      record.status = 'timeout'
    } else {
      record.status = 'error'
      record.output = tailOutput(error?.message || String(error))
    }
  } finally {
    clearTimeout(timer)
    record.durationMs = Math.max(0, Date.now() - startedAtMs)
  }
}

/**
 * Execute one hook against a resolved context. Never throws: every failure
 * mode (bad action, non-zero exit, non-2xx HTTP, timeout, crash) converges
 * into the returned execution record.
 */
export async function executeHook(hook, ctx = {}, options = {}) {
  const startedAtMs = Date.now()
  const record = {
    id: randomUUID(),
    hookId: typeof hook?.id === 'string' ? hook.id : '',
    hookName: typeof hook?.name === 'string' ? hook.name : '',
    event: typeof ctx.event === 'string' ? ctx.event : '',
    startedAt: new Date(startedAtMs).toISOString(),
    durationMs: 0,
    status: 'error',
  }
  if (options.test === true) record.test = true

  try {
    if (hook?.action?.type === 'command') {
      await executeCommandHook(hook, ctx, record, startedAtMs)
    } else if (hook?.action?.type === 'webhook') {
      await executeWebhookHook(hook, ctx, record, startedAtMs)
    } else {
      record.output = 'Invalid hook action'
    }
  } catch (error) {
    record.status = 'error'
    record.output = tailOutput(error?.message || String(error))
  } finally {
    record.durationMs = Math.max(0, Date.now() - startedAtMs)
  }
  return record
}
