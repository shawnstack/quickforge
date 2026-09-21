import { agentEvents } from '../agent-session-events.mjs'
import { agentSessions } from '../agent-session-store.mjs'
import { logger } from '../utils/logger.mjs'
import { readStore, writeStore } from '../storage.mjs'
import { HOOK_EVENTS, readHooksSettings } from './hooks-settings.mjs'
import { executeHook } from './hook-executor.mjs'

const HOOK_EVENT_TYPES = new Set(HOOK_EVENTS)

// Execution log capacity, applied to both the in-memory buffer and the
// persisted store (trimmed from the tail, i.e. the oldest records).
export const HOOK_EXECUTIONS_LIMIT = 300

// Debounce window for persisting the execution log after a push. The
// in-memory buffer stays the authoritative read path; the persisted store is
// a best-effort snapshot restored on engine start.
const HOOK_EXECUTIONS_PERSIST_DELAY_MS = 3000

const HOOK_EXECUTIONS_PAGE_DEFAULT_LIMIT = 20
const HOOK_EXECUTIONS_PAGE_MAX_LIMIT = 100

// Module-level settings cache: loaded once on engine start and refreshed
// after every successful `hooks-settings` PUT (see routes/storage.mjs). An
// event that races a settings write simply uses the previous snapshot.
let hooksSettings = { enabled: true, hooks: [] }
let hookEventListener = null

// Execution log. ORDER CONVENTION: index 0 is the NEWEST record, so the
// array is newest-first and pagination is a stable slice.
const recentExecutions = []
let persistTimer = null
let persistPending = false

export async function refreshHooksSettings() {
  hooksSettings = await readHooksSettings()
  return hooksSettings
}

export function getRecentHookExecutions() {
  return recentExecutions.slice()
}

export function pushHookExecution(record) {
  recentExecutions.unshift(record)
  if (recentExecutions.length > HOOK_EXECUTIONS_LIMIT) {
    recentExecutions.length = HOOK_EXECUTIONS_LIMIT
  }
  scheduleExecutionPersist()
  return record
}

function normalizePageLimit(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return HOOK_EXECUTIONS_PAGE_DEFAULT_LIMIT
  return Math.min(HOOK_EXECUTIONS_PAGE_MAX_LIMIT, Math.max(1, parsed))
}

function normalizePageOffset(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

/**
 * Paged view over the execution log (newest-first). `limit` defaults to 20
 * and is clamped to 1..100; `offset` defaults to 0 and is floored at 0.
 * Out-of-range offsets yield an empty page while `total` still reflects the
 * full buffer size.
 */
export function getHookExecutionsPage({ limit, offset } = {}) {
  const normalizedLimit = normalizePageLimit(limit)
  const normalizedOffset = normalizePageOffset(offset)
  return {
    executions: normalizedOffset >= recentExecutions.length
      ? []
      : recentExecutions.slice(normalizedOffset, normalizedOffset + normalizedLimit),
    total: recentExecutions.length,
    limit: normalizedLimit,
    offset: normalizedOffset,
  }
}

function scheduleExecutionPersist() {
  persistPending = true
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void flushHookExecutionPersist()
  }, HOOK_EXECUTIONS_PERSIST_DELAY_MS)
  // The debounce timer must never hold the event loop open on idle.
  if (typeof persistTimer.unref === 'function') persistTimer.unref()
}

async function flushHookExecutionPersist() {
  if (!persistPending) return
  try {
    await writeStore('hook-executions', recentExecutions.slice())
    persistPending = false
  } catch (error) {
    // Persistence is best-effort: warn, never throw, and keep the dirty flag
    // so a later flush (e.g. engine stop) retries the whole-buffer overwrite.
    logger.warn('Failed to persist hook executions:', error?.message || error)
  }
}

async function loadRecentHookExecutions() {
  try {
    const stored = await readStore('hook-executions')
    const valid = Array.isArray(stored) ? stored.slice(0, HOOK_EXECUTIONS_LIMIT) : []
    recentExecutions.length = 0
    recentExecutions.push(...valid)
  } catch (error) {
    // Fail-open: an unreadable store leaves the in-memory log untouched
    // (empty on a fresh start) instead of taking the engine down.
    logger.warn('Failed to load hook executions on engine start:', error?.message || error)
  }
}

function messageForEvent(event) {
  if (event.type === 'error') return typeof event.error === 'string' ? event.error : ''
  if (event.type === 'agent_end') return typeof event.errorMessage === 'string' ? event.errorMessage : ''
  return ''
}

function buildHookContext(event) {
  const sessionId = typeof event.sessionId === 'string' ? event.sessionId : ''
  const session = sessionId ? agentSessions.get(sessionId) : null
  const project = session?.projectContext?.project
  return {
    event: event.type,
    sessionId,
    project: typeof project?.name === 'string' ? project.name : '',
    projectPath: typeof project?.path === 'string' ? project.path : '',
    toolName: typeof event.toolName === 'string' ? event.toolName : '',
    message: messageForEvent(event),
  }
}

/**
 * Shared handler for the global agent event bus. Fire-and-forget: a hook
 * failure never propagates back into the agent event stream. Exported for
 * direct testing; the engine subscription is a thin wrapper over it.
 */
export function handleAgentEventForHooks(event) {
  if (!event || typeof event !== 'object') return
  if (!HOOK_EVENT_TYPES.has(event.type)) return
  if (!hooksSettings.enabled) return

  const ctx = buildHookContext(event)
  for (const hook of hooksSettings.hooks) {
    if (!hook.enabled) continue
    if (!hook.events.includes(event.type)) continue
    void executeHook(hook, ctx)
      .then((record) => {
        // silentOnFailure keeps failed executions out of the in-memory log;
        // successful runs are still recorded.
        if (hook.silentOnFailure && record.status !== 'success') return
        pushHookExecution(record)
      })
      .catch((error) => logger.warn(`Hook ${hook.name || hook.id} failed unexpectedly:`, error?.message || error))
  }
}

export async function startHookEngine() {
  if (hookEventListener) return
  // Initial settings load is fail-open: a broken store falls back to the
  // defaults (see readHooksSettings) and the subscription still installs.
  try {
    await refreshHooksSettings()
  } catch (error) {
    logger.error('Failed to load hooks settings on engine start:', error)
  }
  await loadRecentHookExecutions()
  hookEventListener = handleAgentEventForHooks
  agentEvents.on('agent_event', hookEventListener)
}

export async function stopHookEngine() {
  if (hookEventListener) {
    agentEvents.removeListener('agent_event', hookEventListener)
    hookEventListener = null
  }
  // Cancel any pending debounce and flush once, so the last window of
  // executions is not lost on shutdown.
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  await flushHookExecutionPersist()
}
