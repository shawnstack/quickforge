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

/**
 * 吉祥物外观：与服务端 `bot.mascot` 一一对应。
 * `showOnComposer` 控制主区输入框上方那只大吉祥物（侧栏行首的小吉祥物不受它管）。
 */
export type BotMascot = {
  body: string
  eye: string
  animated: boolean
  showOnComposer: boolean
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
  /** 手动排序位（服务端 reorder 维护）；null = 老记录，按创建时间兜底。 */
  sortOrder?: number | null
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

/** 整组重排：服务端重编 sortOrder 并按新顺序返回全部 bot。 */
export async function reorderBots(orderedIds: string[]): Promise<BotSummary[]> {
  const payload = await requestJson<{ bots: BotSummary[] }>('/api/bots/reorder', {
    method: 'PUT',
    body: JSON.stringify({ orderedIds }),
  })
  return payload.bots ?? []
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

/** 心跳间隔下限，与服务端 `MIN_HEARTBEAT_MINUTES` 对齐：低于它的输入会向上夹紧。 */
export const MIN_HEARTBEAT_MINUTES = 5

/** 间隔输入的单位。服务端只认分钟，单位只是输入时的换算。 */
export type HeartbeatIntervalUnit = 'minutes' | 'hours' | 'days'

const UNIT_MINUTES: Record<HeartbeatIntervalUnit, number> = { minutes: 1, hours: 60, days: 1440 }

/**
 * 分钟数 → 「数值 + 单位」：优先用能整除的最大单位回显。
 * 120 显示成「2 小时」、90 保持「90 分钟」——不把用户设的 90 分钟假装成 1.5 小时。
 */
export function splitHeartbeatInterval(minutes: number): { amount: string; unit: HeartbeatIntervalUnit } {
  const value = Math.max(MIN_HEARTBEAT_MINUTES, Math.round(Number(minutes) || MIN_HEARTBEAT_MINUTES))
  if (value % 1440 === 0) return { amount: String(value / 1440), unit: 'days' }
  if (value % 60 === 0) return { amount: String(value / 60), unit: 'hours' }
  return { amount: String(value), unit: 'minutes' }
}

/**
 * 「数值 + 单位」→ 分钟数。
 * 返回 null 表示这次输入不能提交（空、0、负数、非数字）——调用方据此保留原值，不要猜。
 */
export function heartbeatIntervalMinutes(
  amountInput: string | number,
  unit: HeartbeatIntervalUnit,
): number | null {
  const raw = typeof amountInput === 'number' ? amountInput : Number(String(amountInput).trim())
  if (!Number.isFinite(raw) || raw <= 0) return null
  const minutes = Math.round(raw * (UNIT_MINUTES[unit] ?? 1))
  return Math.max(MIN_HEARTBEAT_MINUTES, minutes)
}

/** 在系统文件管理器里打开这个 bot 的目录。服务端只放行本机调用，远端会拿到 403。 */
export async function openBotWorkspace(botId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/open-in-explorer`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

/** 投喂：写进 .bot/inbox.md。服务端只提前节拍不直接唤醒，30 秒内 runner 会叫醒它。 */
export async function feedBot(botId: string, text: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/bots/${encodeURIComponent(botId)}/inbox`, {
    method: 'POST',
    body: JSON.stringify({ text }),
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
  /** 催醒：立刻跑一跳（跳过判活）。在忙时按钮自己会禁用。 */
  onWake: (bot: BotSummary) => void
  /** 拖动排序：给出新顺序的 bot id 列表，由宿主乐观应用并落盘。 */
  onReorder?: (orderedIds: string[]) => void
  onToggleMode: () => void
  onStartNew: () => void
}
