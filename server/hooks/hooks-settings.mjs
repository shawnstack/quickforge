import { readStore } from '../storage.mjs'

export const HOOKS_SETTINGS_KEY = 'hooks-settings'

// Keep in sync with the frontend hooks settings schema. Server-side
// normalization is deliberately lenient: unknown fields are ignored, hooks
// with an unusable action are dropped, and a malformed payload falls back to
// the defaults so a broken settings blob can never take the engine down.
export const HOOK_EVENTS = [
  'agent_start',
  'agent_end',
  'tool_execution_start',
  'tool_execution_end',
  'tool_approval_required',
  'error',
]

export const DEFAULT_HOOK_TIMEOUT_SECONDS = 10
export const MIN_HOOK_TIMEOUT_SECONDS = 1
export const MAX_HOOK_TIMEOUT_SECONDS = 300

export const DEFAULT_HOOKS_SETTINGS = Object.freeze({ enabled: true, hooks: [] })

const HOOK_EVENT_SET = new Set(HOOK_EVENTS)

function clampTimeoutSeconds(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_HOOK_TIMEOUT_SECONDS
  return Math.min(MAX_HOOK_TIMEOUT_SECONDS, Math.max(MIN_HOOK_TIMEOUT_SECONDS, Math.round(parsed)))
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeHookHeaders(value) {
  if (!Array.isArray(value)) return []
  const headers = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.name !== 'string' || !entry.name.trim()) continue
    headers.push({ name: entry.name.trim(), value: typeof entry.value === 'string' ? entry.value : '' })
  }
  return headers
}

/**
 * A hook action is exactly one of `command` or `webhook`. Anything else (or a
 * malformed variant) makes the whole hook unusable, so it returns null and the
 * caller drops the hook instead of storing something that can never run.
 */
function normalizeHookAction(action) {
  if (!action || typeof action !== 'object') return null

  if (action.type === 'command') {
    if (typeof action.command !== 'string' || !action.command.trim()) return null
    return { type: 'command', command: action.command }
  }

  if (action.type === 'webhook') {
    if (typeof action.url !== 'string' || !isHttpUrl(action.url)) return null
    const normalized = {
      type: 'webhook',
      url: action.url,
      method: action.method === 'GET' ? 'GET' : 'POST',
    }
    const headers = normalizeHookHeaders(action.headers)
    if (headers.length > 0) normalized.headers = headers
    if (typeof action.bodyTemplate === 'string' && action.bodyTemplate) normalized.bodyTemplate = action.bodyTemplate
    return normalized
  }

  return null
}

/**
 * Normalize a single hook definition. Unknown fields are ignored; `index`
 * only seeds a deterministic fallback id for legacy/partial payloads.
 */
export function normalizeHook(value, index = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const action = normalizeHookAction(value.action)
  if (!action) return null

  const events = Array.isArray(value.events)
    ? [...new Set(value.events.filter((event) => HOOK_EVENT_SET.has(event)))]
    : []
  const id = typeof value.id === 'string' && value.id.trim() ? value.id : `hook-${index}`

  return {
    id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : id,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    events,
    action,
    timeoutSeconds: clampTimeoutSeconds(value.timeoutSeconds),
    silentOnFailure: value.silentOnFailure === true,
  }
}

export function normalizeHooksSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { enabled: true, hooks: [] }
  const hooks = Array.isArray(value.hooks)
    ? value.hooks.map((hook, index) => normalizeHook(hook, index)).filter(Boolean)
    : []
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    hooks,
  }
}

/**
 * Fail-open settings read: a broken store must never block the engine, so it
 * falls back to the (empty, enabled) defaults instead of throwing.
 */
export async function readHooksSettings() {
  try {
    const settings = await readStore('settings')
    return normalizeHooksSettings(settings?.[HOOKS_SETTINGS_KEY])
  } catch {
    return { enabled: true, hooks: [] }
  }
}
