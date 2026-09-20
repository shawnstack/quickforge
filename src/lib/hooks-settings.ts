import type { AppStorage } from '@/storage'
import type { AppTextKey } from '@/lib/i18n'

export const HOOKS_SETTINGS_KEY = 'hooks-settings'

export const HOOK_EVENTS = [
  'agent_start',
  'agent_end',
  'tool_execution_start',
  'tool_execution_end',
  'tool_approval_required',
  'error',
] as const

export type HookEvent = typeof HOOK_EVENTS[number]

export type HookWebhookHeader = { name: string; value: string }

export type HookAction =
  | { type: 'command'; command: string }
  | {
    type: 'webhook'
    url: string
    method: 'POST' | 'GET'
    headers?: HookWebhookHeader[]
    bodyTemplate?: string
  }

export type HookConfig = {
  id: string
  name: string
  enabled: boolean
  events: HookEvent[]
  action: HookAction
  timeoutSeconds: number
  silentOnFailure: boolean
}

export type HooksSettings = {
  enabled: boolean
  hooks: HookConfig[]
}

export type HookExecutionStatus = 'success' | 'error' | 'timeout'

export type HookExecutionRecord = {
  id: string
  hookId: string
  hookName: string
  /** 手动测试运行（POST /api/hooks/test）使用合成事件 'test'，不会出现在执行日志里。 */
  event: HookEvent | 'test'
  startedAt: string
  durationMs: number
  status: HookExecutionStatus
  exitCode?: number
  httpStatus?: number
  output?: string
  test?: boolean
}

export const HOOK_EVENT_LABEL_KEYS: Record<HookEvent, AppTextKey> = {
  agent_start: 'hooksEventAgentStart',
  agent_end: 'hooksEventAgentEnd',
  tool_execution_start: 'hooksEventToolExecutionStart',
  tool_execution_end: 'hooksEventToolExecutionEnd',
  tool_approval_required: 'hooksEventToolApprovalRequired',
  error: 'hooksEventError',
}

export const HOOK_VARIABLES = [
  '{{event}}',
  '{{session.id}}',
  '{{session.project}}',
  '{{session.projectPath}}',
  '{{tool.name}}',
  '{{message}}',
] as const

export const DEFAULT_HOOK_TIMEOUT_SECONDS = 10
export const MIN_HOOK_TIMEOUT_SECONDS = 1
export const MAX_HOOK_TIMEOUT_SECONDS = 300

export const DEFAULT_HOOKS_SETTINGS: HooksSettings = { enabled: true, hooks: [] }

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function clampHookTimeoutSeconds(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_HOOK_TIMEOUT_SECONDS
  return Math.min(MAX_HOOK_TIMEOUT_SECONDS, Math.max(MIN_HOOK_TIMEOUT_SECONDS, Math.round(parsed)))
}

function normalizeEvents(value: unknown): HookEvent[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(HOOK_EVENTS)
  const events: HookEvent[] = []
  for (const item of value) {
    if (typeof item === 'string' && allowed.has(item) && !events.includes(item as HookEvent)) {
      events.push(item as HookEvent)
    }
  }
  return events
}

/** 动作二选一：command 需要非空命令，webhook 需要 http/https URL；非法动作的 Hook 整体丢弃。 */
function normalizeAction(value: unknown): HookAction | null {
  if (!value || typeof value !== 'object') return null
  const action = value as Record<string, unknown>
  if (action.type === 'command') {
    const command = typeof action.command === 'string' ? action.command : ''
    if (!command.trim()) return null
    return { type: 'command', command }
  }
  if (action.type === 'webhook') {
    const url = typeof action.url === 'string' ? action.url.trim() : ''
    if (!isValidHttpUrl(url)) return null
    const method = action.method === 'GET' ? 'GET' : 'POST'
    const headers: HookWebhookHeader[] = []
    if (Array.isArray(action.headers)) {
      for (const raw of action.headers) {
        if (!raw || typeof raw !== 'object') continue
        const header = raw as Record<string, unknown>
        const name = typeof header.name === 'string' ? header.name : ''
        if (!name.trim()) continue
        headers.push({ name, value: typeof header.value === 'string' ? header.value : '' })
      }
    }
    const bodyTemplate = typeof action.bodyTemplate === 'string' ? action.bodyTemplate : ''
    return {
      type: 'webhook',
      url,
      method,
      ...(headers.length > 0 ? { headers } : {}),
      ...(bodyTemplate.trim() ? { bodyTemplate } : {}),
    }
  }
  return null
}

function normalizeHook(value: unknown, index: number): HookConfig | null {
  if (!value || typeof value !== 'object') return null
  const hook = value as Record<string, unknown>
  const action = normalizeAction(hook.action)
  if (!action) return null
  const id = typeof hook.id === 'string' && hook.id.trim() ? hook.id : `hook_${index}`
  return {
    id,
    name: typeof hook.name === 'string' ? hook.name : '',
    enabled: hook.enabled === undefined ? true : hook.enabled === true,
    events: normalizeEvents(hook.events),
    action,
    timeoutSeconds: clampHookTimeoutSeconds(hook.timeoutSeconds),
    silentOnFailure: hook.silentOnFailure === true,
  }
}

export function normalizeHooksSettings(value: unknown): HooksSettings {
  if (!value || typeof value !== 'object') return { enabled: true, hooks: [] }
  const settings = value as Record<string, unknown>
  const rawHooks = Array.isArray(settings.hooks) ? settings.hooks : []
  const hooks: HookConfig[] = []
  for (const raw of rawHooks) {
    const hook = normalizeHook(raw, hooks.length)
    if (hook) hooks.push(hook)
  }
  return {
    enabled: settings.enabled === undefined ? true : settings.enabled === true,
    hooks,
  }
}

export async function loadHooksSettings(storage: AppStorage): Promise<HooksSettings> {
  return normalizeHooksSettings(await storage.settings.get<unknown>(HOOKS_SETTINGS_KEY))
}

export async function saveHooksSettings(storage: AppStorage, settings: HooksSettings): Promise<void> {
  await storage.settings.set(HOOKS_SETTINGS_KEY, normalizeHooksSettings(settings))
}
