import { agentEvents } from '../agent-session-events.mjs'
import { agentSessions } from '../agent-session-store.mjs'
import { logger } from '../utils/logger.mjs'
import { HOOK_EVENTS, readHooksSettings } from './hooks-settings.mjs'
import { executeHook } from './hook-executor.mjs'

const HOOK_EVENT_TYPES = new Set(HOOK_EVENTS)
const MAX_RECENT_EXECUTIONS = 50

// Module-level settings cache: loaded once on engine start and refreshed
// after every successful `hooks-settings` PUT (see routes/storage.mjs). An
// event that races a settings write simply uses the previous snapshot.
let hooksSettings = { enabled: true, hooks: [] }
let hookEventListener = null
const recentExecutions = []

export async function refreshHooksSettings() {
  hooksSettings = await readHooksSettings()
  return hooksSettings
}

export function getRecentHookExecutions() {
  return recentExecutions.slice()
}

export function pushHookExecution(record) {
  recentExecutions.push(record)
  if (recentExecutions.length > MAX_RECENT_EXECUTIONS) {
    recentExecutions.splice(0, recentExecutions.length - MAX_RECENT_EXECUTIONS)
  }
  return record
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
  hookEventListener = handleAgentEventForHooks
  agentEvents.on('agent_event', hookEventListener)
}

export function stopHookEngine() {
  if (!hookEventListener) return
  agentEvents.removeListener('agent_event', hookEventListener)
  hookEventListener = null
}
