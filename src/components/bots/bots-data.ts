import { t } from '@/lib/i18n'

export type BotHeartbeat = {
  enabled: boolean
  intervalMinutes: number
  nextRunAt: string | null
  lastWakeAt: string | null
  lastSessionId: string | null
  wakeCount: number
  idleCount: number
  lastIdleReason: string | null
  lastError: string | null
}

/** 吉祥物外观：与服务端 `bot.mascot` 一一对应。 */
export type BotMascot = {
  body: string
  eye: string
  animated: boolean
}

export type BotSummary = {
  id: string
  name: string
  workspacePath: string
  memoryFile: string
  projectId: string | null
  sessionId: string | null
  thinkingLevel: string
  accessMode: string
  heartbeat: BotHeartbeat
  mascot: BotMascot
  createdAt: string
  updatedAt: string
  busy?: boolean
  status?: string
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
  return payload as T
}

export async function fetchBots(): Promise<BotSummary[]> {
  const payload = await requestJson<{ bots: BotSummary[] }>('/api/bots')
  return payload.bots ?? []
}

export async function createBot(name: string): Promise<BotSummary> {
  const payload = await requestJson<{ bot: BotSummary }>('/api/bots', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return payload.bot
}

export type BotPatch = {
  name?: string
  thinkingLevel?: string
  heartbeat?: Partial<BotHeartbeat>
  mascot?: Partial<BotMascot>
}

export async function patchBot(botId: string, patch: BotPatch): Promise<BotSummary> {
  const payload = await requestJson<{ bot: BotSummary }>(`/api/bots/${encodeURIComponent(botId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return payload.bot
}

export async function deleteBot(botId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}`, { method: 'DELETE' })
}

export async function fetchBotMemory(botId: string): Promise<{ content: string; file: string }> {
  return requestJson<{ content: string; file: string }>(`/api/bots/${encodeURIComponent(botId)}/memory`)
}

export async function saveBotMemory(botId: string, content: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/memory`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

/** 打开 bot 前先确保它那条会话在场；返回真正可用的 sessionId。 */
export async function ensureBotSessionOpen(botId: string): Promise<string> {
  const payload = await requestJson<{ sessionId: string }>(
    `/api/bots/${encodeURIComponent(botId)}/session`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  return payload.sessionId
}

export async function wakeBot(botId: string): Promise<{ woke: boolean; reason: string }> {
  return requestJson<{ woke: boolean; reason: string }>(`/api/bots/${encodeURIComponent(botId)}/wake`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export type BotStatusTone = 'busy' | 'error' | 'asleep' | 'idle'

export type BotStatusSummary = {
  /** 侧栏行右侧那行小字。 */
  text: string
  /** 只影响文字颜色：出错用警示色，其余弱化。 */
  tone: BotStatusTone
}

/** 相对时间：分钟以内算「刚刚」，再往上给分钟 / 小时 / 天。 */
export function formatBotAwakeAgo(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return t('botStatusJustNow')
  const minutes = Math.round(elapsedMs / 60_000)
  if (minutes < 60) return t('botStatusMinutesAgo', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('botStatusHoursAgo', { n: hours })
  return t('botStatusDaysAgo', { n: Math.round(hours / 24) })
}

/**
 * 侧栏每行的状态小字：它现在在干什么，或者上一次是什么时候醒的。
 *
 * 优先级从上到下 —— 越靠上越是「需要人知道」：出错压过在忙，在忙压过睡着，
 * 睡着压过「多久没醒」。心跳时间只在没事发生时才显示，不让时间把异常盖掉。
 *
 * 为什么不靠吉祥物动画表达：侧栏那只是 18px，眼睛的动作在这个尺寸上看不出来。
 * 运行状态按设计规范该保留文字（DESIGN_LANGUAGE「状态说明应保留文字」）。
 */
export function botStatusSummary(bot: BotSummary, now = Date.now()): BotStatusSummary {
  if (bot.heartbeat?.lastError) return { text: t('botStatusError'), tone: 'error' }
  if (bot.busy || bot.status === 'running') return { text: t('botStatusBusy'), tone: 'busy' }
  if (bot.heartbeat?.enabled === false) return { text: t('botStatusAsleep'), tone: 'asleep' }
  const lastWake = bot.heartbeat?.lastWakeAt ? Date.parse(bot.heartbeat.lastWakeAt) : Number.NaN
  if (!Number.isFinite(lastWake)) return { text: t('botStatusNever'), tone: 'idle' }
  return { text: formatBotAwakeAgo(now - lastWake), tone: 'idle' }
}

/**
 * 侧栏在 bot 模式下需要的一切。整包传是为了不给 ChatSidebar 加八个 prop ——
 * 那个文件已经一千多行，每多一个 prop 就多三处接线。
 */
export type BotSidebarProps = {
  mode: boolean
  bots: BotSummary[]
  activeBotId?: string
  loading?: boolean
  error?: string | null
  onSelect: (bot: BotSummary) => void
  onOpenSettings: (bot: BotSummary) => void
  onToggleMode: () => void
  onStartNew: () => void
}
