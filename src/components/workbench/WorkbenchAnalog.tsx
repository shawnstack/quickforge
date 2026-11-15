import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  botStatusSummary,
  ensureBotSessionOpen,
  feedBot,
  fetchBotMemory,
  fetchBots,
  openBotWorkspace,
  patchBot,
  splitHeartbeatInterval,
  wakeBot,
  type BotHeartbeat,
  type BotSummary,
} from '@/components/bots/bots-data'
import { fetchScheduledTasks } from '@/components/scheduled-tasks/scheduled-tasks-data'
import type { ScheduledTask } from '@/components/scheduled-tasks/scheduled-tasks-types'
import { fetchTodayStats, formatTokenCount, type TodayStats } from '@/lib/workbench-today-stats'
import { useUIStore } from '@/stores/ui-store'
import {
  fetchOverallRunStats,
  fetchTodayCompletions,
  type Completion,
  type OverallRunStats,
} from './workbench-analog-data'
import { fmtHm, fmtSpan, pad } from './workbench-format'
import { WorkbenchTower } from './Workbench'
import './workbench-analog.css'

/**
 * 工作台 QF-08 硬件拟物视图。
 *
 * 视觉蓝本：V1 拟物设计稿（拉丝金属 / 内凹 CRT / 翻页钟 / 指针仪表 / 机械计数器 / 纸质记录卡）。
 * 数据全部来自现成端点，不保留设计稿里的演示值：bot 心跳与定时任务的 nextRunAt 合并成待运行队列，
 * 今日统计走 sessions-metadata 与 task-runs，异常来自 lastError 快照与到点未醒的会话内观察。
 * 文案沿用 v8 的中性口径（不使用出港 / 舰队隐喻），只保留设备铭牌上的英文仪器标签。
 * 本文件是独立 surface：class 全部以 qf-wba 前缀独占，不改写 v8 的 Workbench.tsx / workbench.css。
 * v8 仅在屏保模式下作为渲染器复用，不作为可选视图暴露。
 */

const POLL_MS = 20_000
const TICK_MS = 1_000
const MISSED_GRACE_MS = 90_000
const ARRIVAL_CAP = 8
const MISSED_CAP = 60
const MATERIAL_KEY = 'qf-workbench-analog-material'

type Material = 'night' | 'day'
type Flight = { key: string; at: number } & (
  | { kind: 'bot'; bot: BotSummary }
  | { kind: 'task'; task: ScheduledTask }
)
type SessionSummary = { sessionId: string; status: string; title?: string; scope?: string; source?: string }
type Arrival = { key: string; kind: 'bot' | 'task' | 'session'; refId: string; name: string; at: number; ok: boolean; note: string }
type MissedNotam = { key: string; botId: string; name: string; due: number }
type Notam = { key: string; kind: 'error' | 'warn'; bot: BotSummary; name: string; text: string }
type DrawerTarget = { kind: 'bot' | 'task'; id: string }
type Toast = { id: number; tone: 'ok' | 'err' | 'info'; text: string }
type Chip = { text: string; tone: 'ok' | 'err' | 'idle' | 'asleep' }

function dayLabel(ts: number, now: number): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOf(new Date(ts)) - startOf(new Date(now))) / 86_400_000)
  if (diff === 0) return t('wbToday')
  if (diff === 1) return t('wbTomorrow')
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

function intervalText(minutes: number): string {
  const { amount, unit } = splitHeartbeatInterval(minutes)
  const key = unit === 'days' ? 'wbUnitDays' : unit === 'hours' ? 'wbUnitHours' : 'wbUnitMinutes'
  return `${amount} ${t(key)}`
}

function scheduleTypeText(type: ScheduledTask['scheduleType']): string {
  switch (type) {
    case 'once': return t('wbTypeOnce')
    case 'interval': return t('wbTypeInterval')
    case 'daily': return t('wbTypeDaily')
    case 'weekly': return t('wbTypeWeekly')
    case 'monthly': return t('wbTypeMonthly')
    default: return t('wbTypeCron')
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 真实数据里 projectId 常是 UUID：搜索仍用原值，展示层不把这串噪音铺到屏上。 */
function displayScope(scope: string): string {
  const s = (scope || '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) ? '' : s
}

function isBusy(bot: BotSummary): boolean {
  return Boolean(bot.busy || bot.status === 'running')
}

function botChip(bot: BotSummary): Chip {
  if (isBusy(bot)) return { text: t('wbRunning'), tone: 'ok' }
  const summary = botStatusSummary(bot)
  if (summary.tone === 'error') return { text: t('wbDelayed'), tone: 'err' }
  if (summary.tone === 'asleep') return { text: summary.text, tone: 'asleep' }
  return { text: t('wbWaiting'), tone: 'idle' }
}

function taskChip(task: ScheduledTask): Chip {
  if (task.status === 'running') return { text: t('wbRunning'), tone: 'ok' }
  if (task.status === 'failed') return { text: t('wbDelayed'), tone: 'err' }
  return { text: t('wbWaiting'), tone: 'idle' }
}

function fmtLeft(ms: number | null): string {
  if (ms === null) return '—'
  if (ms <= 0) return `+${fmtSpan(ms)}`
  const s = Math.floor(ms / 1000)
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

function readMaterial(): Material {
  try { return localStorage.getItem(MATERIAL_KEY) === 'day' ? 'day' : 'night' } catch { return 'night' }
}

/** 翻页钟：数字变化时重新挂载该页，触发 CSS 翻页动画。 */
function FlapClock({ now }: { now: number }) {
  const d = new Date(now)
  const text = `${pad(d.getHours())}${pad(d.getMinutes())}`
  return (
    <div className="qf-wba__flapclock" aria-label={`${pad(d.getHours())}:${pad(d.getMinutes())}`}>
      {text.split('').map((ch, i) => (
        <Fragment key={i}>
          {i === 2 ? <span className="qf-wba__flap qf-wba__flap--colon"><span>:</span></span> : null}
          <span key={`${i}-${ch}`} className="qf-wba__flap qf-wba__is-flip"><span>{ch}</span></span>
        </Fragment>
      ))}
    </div>
  )
}

/** 机械数字滚筒：一位一个鼓轮。 */
function Odo({ text }: { text: string }) {
  return (
    <div className="qf-wba__odo">
      {text.split('').map((ch, i) => (
        <span key={i} className={ch === '.' || ch === 'K' || ch === 'M' ? 'qf-wba__dot' : undefined}>{ch}</span>
      ))}
    </div>
  )
}

function Gauge({ value }: { value: number | null }) {
  const pct = value ?? 0
  const angle = -120 + Math.max(0, Math.min(100, pct)) * 2.4
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = ((-120 + i * 24) * Math.PI) / 180
    const big = i % 5 === 0
    const r1 = big ? 38 : 41
    const r2 = 47
    return {
      x1: 60 + Math.sin(a) * r1,
      y1: 60 - Math.cos(a) * r1,
      x2: 60 + Math.sin(a) * r2,
      y2: 60 - Math.cos(a) * r2,
      big,
    }
  })
  return (
    <div className="qf-wba__gauge">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        {ticks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1.toFixed(1)} y1={tick.y1.toFixed(1)}
            x2={tick.x2.toFixed(1)} y2={tick.y2.toFixed(1)}
            stroke={tick.big ? '#7a6b4e' : '#a89f88'} strokeWidth={tick.big ? 1.8 : 1}
          />
        ))}
        {value !== null ? (
          <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '60px 60px', transition: 'transform 500ms cubic-bezier(.2,0,0,1)' }}>
            <line x1="60" y1="62" x2="60" y2="24" stroke="#b1483a" strokeWidth="2.2" strokeLinecap="round" />
          </g>
        ) : null}
        <circle cx="60" cy="60" r="5" fill="#8e8570" stroke="#4a4334" strokeWidth="1" />
      </svg>
      <div className={cn('qf-wba__gauge__value', value === null && 'qf-wba__is-empty')}>
        {value === null ? '—' : <>{value}<small>%</small></>}
      </div>
    </div>
  )
}

function Switch({ checked, disabled, label, title, onChange }: {
  checked: boolean
  disabled?: boolean
  label: string
  title?: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={cn('qf-wba__switch', checked && 'qf-wba__is-on')}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  )
}

export function WorkbenchAnalog({ onClose }: { onClose: () => void }) {
  const [material, setMaterial] = useState<Material>(readMaterial)
  const [bots, setBots] = useState<BotSummary[] | null>(null)
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null)
  const [today, setToday] = useState<TodayStats | null>(null)
  const [overall, setOverall] = useState<OverallRunStats | null>(null)
  const [completions, setCompletions] = useState<Completion[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [filter, setFilter] = useState<'all' | 'bot' | 'task'>('all')
  const [query, setQuery] = useState('')
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null)
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  const [missed, setMissed] = useState<MissedNotam[]>([])
  const [arrivals, setArrivals] = useState<Arrival[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [memory, setMemory] = useState<{ botId: string; content: string } | null>(null)
  const [goal, setGoal] = useState<{ sessionId: string; objective: string; status: string } | null>(null)
  const [inbox, setInbox] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [entering, setEntering] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  const requestOpenSession = useUIStore((s) => s.requestOpenSession)
  const prevBotsRef = useRef(new Map<string, { busy: boolean; nextRunAt: string | null }>())
  const prevTasksRef = useRef(new Map<string, string | null>())
  const prevSessionsRef = useRef(new Map<string, boolean>())
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null)
  const prevFocusRef = useRef<Element | null>(null)
  // 取数序号：20s 轮询本身会自重叠（一次取数超过 20s，或页面挂起后恢复），requestRefresh 还会让
  // 取数 effect 重跑并立刻再发一轮。判据是「旧响应一个 state 都不许写」——不是少写几个：
  // bots/tasks/today/overall/completions/loadError/lastLoadedAt 全在这个序号后面，finally 里的
  // setRefreshing 同理，否则旧请求的 finally 会把新一轮的刷新状态提前结束。
  const loadRequestRef = useRef(0)

  const pushToast = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list.slice(-2), { id, tone, text }])
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 3600)
  }, [])

  const observe = useCallback((nextBots: BotSummary[], nextTasks: ScheduledTask[], nextSessions: SessionSummary[], at: number) => {
    const newArrivals: Arrival[] = []
    const newMissed: MissedNotam[] = []
    const botSessionIds = new Set(nextBots.flatMap((b) => [b.sessionId, b.heartbeat?.lastSessionId]).filter((x): x is string => Boolean(x)))
    const taskSessionIds = new Set(nextTasks.flatMap((task) => [task.lastSessionId, ...(task.runs ?? []).map((r) => r.sessionId)]).filter((x): x is string => Boolean(x)))
    for (const bot of nextBots) {
      const busy = isBusy(bot)
      const prev = prevBotsRef.current.get(bot.id)
      if (prev?.busy && !busy) {
        newArrivals.push({
          key: `bot:${bot.id}:${at}`, kind: 'bot', refId: bot.id, name: bot.name, at,
          ok: !bot.heartbeat?.lastError, note: bot.heartbeat?.lastError || bot.heartbeat?.lastIdleReason || '',
        })
      }
      if (prev?.nextRunAt && !busy && bot.heartbeat?.enabled) {
        const due = Date.parse(prev.nextRunAt)
        const woke = bot.heartbeat?.lastWakeAt ? Date.parse(bot.heartbeat.lastWakeAt) : Number.NaN
        if (Number.isFinite(due) && at - due > MISSED_GRACE_MS && !(Number.isFinite(woke) && woke >= due - 60_000)) {
          newMissed.push({ key: `miss:${bot.id}:${prev.nextRunAt}`, botId: bot.id, name: bot.name, due })
        }
      }
      prevBotsRef.current.set(bot.id, { busy, nextRunAt: bot.heartbeat?.nextRunAt ?? null })
    }
    for (const task of nextTasks) {
      const run = task.runs?.[0]
      const prevKey = prevTasksRef.current.get(task.id)
      if (run && prevKey && prevKey !== run.id && run.status !== 'running') {
        newArrivals.push({
          key: `task:${task.id}:${run.id}`, kind: 'task', refId: task.id, name: task.title,
          at: Date.parse(run.finishedAt || run.startedAt) || at, ok: run.status === 'success',
          note: run.errorMessage || run.result || '',
        })
      }
      prevTasksRef.current.set(task.id, run?.id ?? null)
    }
    for (const session of nextSessions) {
      if (botSessionIds.has(session.sessionId) || taskSessionIds.has(session.sessionId)) continue
      const running = session.status === 'running'
      const prev = prevSessionsRef.current.get(session.sessionId)
      if (prev && !running) {
        newArrivals.push({
          key: `session:${session.sessionId}:${at}`, kind: 'session', refId: session.sessionId,
          name: session.title || session.sessionId, at, ok: session.status === 'idle',
          note: session.status === 'idle' ? '' : session.status,
        })
      }
      prevSessionsRef.current.set(session.sessionId, running)
    }
    if (newArrivals.length) setArrivals((list) => [...newArrivals.reverse(), ...list].slice(0, ARRIVAL_CAP))
    if (newMissed.length) {
      setMissed((list) => {
        const seen = new Set(list.map((item) => item.key))
        return [...list, ...newMissed.filter((item) => !seen.has(item.key))].slice(-MISSED_CAP)
      })
    }
    // 轮询间可能有 bot / 任务 / 会话被删掉，别让观察表无限累积。
    const liveBots = new Set(nextBots.map((b) => b.id))
    for (const id of prevBotsRef.current.keys()) if (!liveBots.has(id)) prevBotsRef.current.delete(id)
    const liveTasks = new Set(nextTasks.map((x) => x.id))
    for (const id of prevTasksRef.current.keys()) if (!liveTasks.has(id)) prevTasksRef.current.delete(id)
    const liveSessions = new Set(nextSessions.map((x) => x.sessionId))
    for (const id of prevSessionsRef.current.keys()) if (!liveSessions.has(id)) prevSessionsRef.current.delete(id)
  }, [])

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    try {
      const [nextBots, nextTasks, nextSessions, nextToday, nextCompletions, nextOverall] = await Promise.all([
        fetchBots(),
        fetchScheduledTasks().catch(() => null),
        fetch('/api/agents').then((res) => (res.ok ? res.json() : null)).catch(() => null),
        fetchTodayStats(),
        fetchTodayCompletions().catch(() => [] as Completion[]),
        fetchOverallRunStats().catch(() => null),
      ])
      // 旧响应（已被更新的 load 抢先）：一个 state 都不许写，含 observe 的观察表。
      if (requestId !== loadRequestRef.current) return
      setBots(nextBots)
      if (nextTasks) setTasks(nextTasks)
      setToday(nextToday)
      setCompletions(nextCompletions)
      setOverall(nextOverall)
      setLoadError(null)
      setLastLoadedAt(Date.now())
      observe(nextBots, nextTasks ?? [], nextSessions?.sessions ?? [], Date.now())
    } catch (err) {
      if (requestId !== loadRequestRef.current) return
      setLoadError(errText(err))
    } finally {
      if (requestId === loadRequestRef.current) setRefreshing(false)
    }
  }, [observe])

  const requestRefresh = useCallback(() => {
    setRefreshing(true)
    setRefreshTick((n) => n + 1)
  }, [])

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0)
    const poll = window.setInterval(() => void load(), POLL_MS)
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => { window.clearTimeout(kickoff); window.clearInterval(poll); window.clearInterval(tick) }
  }, [load, refreshTick])

  useEffect(() => {
    if (drawer) {
      prevFocusRef.current = document.activeElement
      const raf = requestAnimationFrame(() => drawerCloseRef.current?.focus())
      return () => cancelAnimationFrame(raf)
    }
    const prev = prevFocusRef.current
    prevFocusRef.current = null
    if (prev instanceof HTMLElement) prev.focus()
    return undefined
  }, [drawer])

  const allFlights = useMemo(() => {
    const list: Flight[] = []
    for (const bot of bots ?? []) {
      const at = bot.heartbeat?.enabled && bot.heartbeat.nextRunAt ? Date.parse(bot.heartbeat.nextRunAt) : Number.NaN
      if (Number.isFinite(at)) list.push({ key: `bot:${bot.id}`, at, kind: 'bot', bot })
    }
    for (const task of tasks ?? []) {
      if (task.status === 'paused' || task.status === 'completed') continue
      const at = task.nextRunAt ? Date.parse(task.nextRunAt) : Number.NaN
      if (Number.isFinite(at)) list.push({ key: `task:${task.id}`, at, kind: 'task', task })
    }
    return list.sort((a, b) => a.at - b.at)
  }, [bots, tasks])

  const flights = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allFlights.filter((flight) => {
      if (filter !== 'all' && flight.kind !== filter) return false
      if (!q) return true
      const name = flight.kind === 'bot' ? flight.bot.name : flight.task.title
      const sub = flight.kind === 'bot' ? (flight.bot.projectId ?? '') : (flight.task.projectName ?? flight.task.projectId ?? '')
      return name.toLowerCase().includes(q) || sub.toLowerCase().includes(q)
    })
  }, [allFlights, filter, query])

  const nextFlight = allFlights[0] ?? null
  const nextKey = nextFlight?.key ?? null
  const botFlightCount = allFlights.filter((f) => f.kind === 'bot').length
  const taskFlightCount = allFlights.length - botFlightCount

  const notams = useMemo(() => {
    const list: Notam[] = []
    for (const bot of bots ?? []) {
      const err = bot.heartbeat?.lastError
      if (err) list.push({ key: `err:${bot.id}:${err}`, kind: 'error', bot, name: bot.name, text: err })
    }
    for (const item of missed) {
      const bot = (bots ?? []).find((b) => b.id === item.botId)
      if (!bot) continue
      const woke = bot.heartbeat?.lastWakeAt ? Date.parse(bot.heartbeat.lastWakeAt) : Number.NaN
      if (isBusy(bot) || (Number.isFinite(woke) && woke >= item.due - 60_000)) continue
      list.push({ key: item.key, kind: 'warn', bot, name: item.name, text: t('wbNotamMissed') })
    }
    return list.filter((item) => !dismissed[item.key])
  }, [bots, missed, dismissed])

  const hasError = notams.some((item) => item.kind === 'error')

  // 今日有定时任务运行就用今日口径；今日 0 次则退到全部历史运行的真实计数，
  // 并在界面标明「累计」，既不把 0 次运行画成 0%，也不让表盘一直空着。
  const rateWindow = today?.taskRuns && today.taskSuccess != null
    ? { runs: today.taskRuns, success: today.taskSuccess, scope: 'today' as const }
    : overall && overall.runs && overall.success != null
      ? { runs: overall.runs, success: overall.success, scope: 'all' as const }
      : null
  const successRate = rateWindow
    ? Math.max(0, Math.min(100, Math.round((rateWindow.success / rateWindow.runs) * 100)))
    : null

  // 纸卡 = 今日历史完成快照 + 打开工作台之后观察到的实时完成；同一会话实时事件优先。
  const displayArrivals = useMemo(() => {
    const merged = new Map<string, Arrival>()
    for (const item of completions) {
      merged.set(item.sessionId, {
        key: item.key, kind: 'session', refId: item.sessionId, name: item.name,
        at: item.at, ok: item.ok, note: item.ok ? '' : item.status,
      })
    }
    for (const item of arrivals) merged.set(item.refId, item)
    return [...merged.values()].sort((a, b) => b.at - a.at).slice(0, ARRIVAL_CAP)
  }, [arrivals, completions])

  const drawerBot = drawer?.kind === 'bot' ? (bots ?? []).find((b) => b.id === drawer.id) ?? null : null
  const drawerTask = drawer?.kind === 'task' ? (tasks ?? []).find((x) => x.id === drawer.id) ?? null : null

  const openDrawer = (target: DrawerTarget) => {
    setDrawer(target)
    setInbox('')
    setMemory(null)
    setGoal(null)
    if (target.kind !== 'bot') return
    void fetchBotMemory(target.id)
      .then((m) => setMemory({ botId: target.id, content: m.content }))
      .catch(() => setMemory({ botId: target.id, content: '' }))
    const bot = (bots ?? []).find((b) => b.id === target.id)
    const sessionId = bot?.sessionId ?? bot?.heartbeat?.lastSessionId ?? null
    if (!sessionId) return
    void fetch(`/api/agents/${encodeURIComponent(sessionId)}/status`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        const g = payload?.goal
        setGoal({
          sessionId,
          objective: typeof g?.objective === 'string' ? g.objective : '',
          status: typeof g?.status === 'string' ? g.status : '',
        })
      })
      .catch(() => setGoal({ sessionId, objective: '', status: '' }))
  }

  const openArrival = (item: Arrival) => {
    if (item.kind === 'bot') openDrawer({ kind: 'bot', id: item.refId })
    else if (item.kind === 'task') openDrawer({ kind: 'task', id: item.refId })
    else {
      requestOpenSession(item.refId, { skipMetadataPrecheck: true })
      onClose()
    }
  }

  const enterSession = useCallback(async (bot: BotSummary) => {
    if (entering) return
    setEntering(true)
    try {
      const sessionId = await ensureBotSessionOpen(bot.id)
      requestOpenSession(sessionId, { skipMetadataPrecheck: true })
      onClose()
    } catch (err) {
      pushToast('err', t('wbToastFailed', { error: errText(err) }))
    } finally {
      setEntering(false)
    }
  }, [entering, onClose, pushToast, requestOpenSession])

  const doWake = useCallback(async (botId: string) => {
    setActionBusy(true)
    try {
      const res = await wakeBot(botId)
      pushToast(res.woke ? 'ok' : 'info', res.woke ? t('wbToastWoke') : t('wbToastWakeSkipped', { reason: res.reason }))
      setRefreshTick((n) => n + 1)
    } catch (err) {
      pushToast('err', t('wbToastFailed', { error: errText(err) }))
    } finally {
      setActionBusy(false)
    }
  }, [pushToast])

  const doPatch = useCallback(async (bot: BotSummary, heartbeat: Partial<BotHeartbeat>) => {
    setActionBusy(true)
    try {
      const next = await patchBot(bot.id, { heartbeat })
      setBots((list) => (list ?? []).map((b) => (b.id === next.id ? next : b)))
      pushToast('ok', t('wbToastSaved'))
    } catch (err) {
      pushToast('err', t('wbToastFailed', { error: errText(err) }))
    } finally {
      setActionBusy(false)
    }
  }, [pushToast])

  const doFeed = useCallback(async (bot: BotSummary) => {
    const text = inbox.trim()
    if (!text) return
    setActionBusy(true)
    try {
      await feedBot(bot.id, text)
      setInbox('')
      pushToast('ok', t('wbToastFed'))
    } catch (err) {
      pushToast('err', t('wbToastFailed', { error: errText(err) }))
    } finally {
      setActionBusy(false)
    }
  }, [inbox, pushToast])

  const doOpenFolder = useCallback(async (bot: BotSummary) => {
    try {
      await openBotWorkspace(bot.id)
    } catch (err) {
      pushToast('err', t('wbToastFailed', { error: errText(err) }))
    }
  }, [pushToast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (query) { setQuery(''); return }
      if (drawer) setDrawer(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, onClose, query])

  const date = new Date(now)
  const nextName = nextFlight ? (nextFlight.kind === 'bot' ? nextFlight.bot.name : nextFlight.task.title) : '—'
  const nextPlan = nextFlight
    ? nextFlight.kind === 'bot'
      ? `HEARTBEAT / ${intervalText(nextFlight.bot.heartbeat?.intervalMinutes ?? 60)}`
      : scheduleTypeText(nextFlight.task.scheduleType)
    : ''
  const nextScope = nextFlight
    ? nextFlight.kind === 'bot'
      ? (nextFlight.bot.projectId ?? '')
      : (nextFlight.task.projectName ?? nextFlight.task.projectId ?? '')
    : ''
  const nextSub = nextFlight ? [displayScope(nextScope), nextPlan].filter(Boolean).join(' · ') : t('wbNoFlights')
  const updatedTitle = lastLoadedAt ? `${t('wbUpdatedAt')} ${fmtHm(lastLoadedAt)}` : undefined
  const intervalOptions = drawerBot && ![5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].includes(drawerBot.heartbeat.intervalMinutes)
    ? [drawerBot.heartbeat.intervalMinutes, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]
    : [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]

  return (
    <div className="qf-wba" data-material={material} role="dialog" aria-modal="true" aria-label={t('workbenchTitle')}>
      {/* 控制台自视口顶部起铺满；材质切换并入铭牌控件，不设说明条 */}

      <div className="qf-wba__unit qf-wba__rise">
        <i className="qf-wba__screw qf-wba__screw--tl" /><i className="qf-wba__screw qf-wba__screw--tr" />
        <i className="qf-wba__screw qf-wba__screw--bl" /><i className="qf-wba__screw qf-wba__screw--br" />

        <header className="qf-wba__plate">
          <div className="qf-wba__plate__mark">
            <i />
            <div className="qf-wba__plate__txt"><b>QUICKFORGE</b><span>OPERATIONS CONSOLE / MODEL QF-08</span></div>
          </div>
          <FlapClock now={now} />
          <span className="qf-wba__plate__date">{date.getFullYear()} / {pad(date.getMonth() + 1)} / {pad(date.getDate())} · LOCAL</span>
          <div className="qf-wba__plate__right">
            <span className="qf-wba__power"><i className={cn('qf-wba__led', hasError && 'qf-wba__led--err', !hasError && 'qf-wba__led--amber', 'qf-wba__led--blink')} />POWER</span>
            <button
              className="qf-wba__metalbtn"
              type="button"
              aria-label={material === 'night' ? t('wbaMaterialDay') : t('wbaMaterialNight')}
              title={material === 'night' ? t('wbaMaterialDay') : t('wbaMaterialNight')}
              onClick={() => setMaterial((m) => {
                const next = m === 'night' ? 'day' : 'night'
                try { localStorage.setItem(MATERIAL_KEY, next) } catch { /* 存储不可用时仅本次生效 */ }
                return next
              })}
            >◐</button>
            <button className={cn('qf-wba__metalbtn', refreshing && 'qf-wba__is-spin')} type="button" onClick={requestRefresh} title={updatedTitle ?? t('wbRefresh')}>
              ↻ {t('wbRefresh')}
            </button>
            <button className="qf-wba__metalbtn" type="button" onClick={onClose}>{t('workbenchClose')}</button>
          </div>
        </header>

        {notams.length ? (
          <div className="qf-wba__notams">
            {notams.map((item) => (
              <div key={item.key} className={cn('qf-wba__notam', item.kind === 'error' && 'qf-wba__is-error')} role="status">
                <span className="qf-wba__n-led"><i className={cn('qf-wba__led', item.kind === 'error' ? 'qf-wba__led--err' : 'qf-wba__led--amber', 'qf-wba__led--blink')} />NOTAM</span>
                <span className="qf-wba__n-src" title={item.name}>{item.name}</span>
                <span className="qf-wba__n-text" title={item.text}>{item.text}</span>
                <span className="qf-wba__n-time qf-wba__mono">{fmtHm(now)}</span>
                <span className="qf-wba__n-actions">
                  <button className="qf-wba__metalbtn" type="button" onClick={() => void doWake(item.bot.id)}>{t('wbWakeRetry')}</button>
                  <button className="qf-wba__metalbtn" type="button" onClick={() => void enterSession(item.bot)}>{t('wbOpenSession')}</button>
                  <button className="qf-wba__metalbtn" type="button" onClick={() => setDismissed((d) => ({ ...d, [item.key]: true }))}>{t('wbDismiss')}</button>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="qf-wba__deck">
          <section className="qf-wba__module">
            <div className="qf-wba__crt">
              <div className="qf-wba__crt__head">
                <span className="qf-wba__ch">NEXT EVENT</span>
                <span className="qf-wba__live"><i />LIVE</span>
              </div>
              <div className="qf-wba__crt__hero">
                <div>
                  <span className="qf-wba__tag">◆ NEXT</span>
                  <h1>{nextName} <small>{nextFlight ? (nextFlight.kind === 'bot' ? 'HEARTBEAT' : 'TASK') : '—'}</small></h1>
                  <p>{nextSub}</p>
                </div>
                <div className="qf-wba__timer">
                  <strong>{nextFlight ? fmtLeft(nextFlight.at - now) : '--:--'}</strong>
                  <span>UNTIL WAKE</span>
                </div>
              </div>
              <div className="qf-wba__runway">
                <div className="qf-wba__line" />
                {allFlights.slice(0, 4).map((flight, i) => (
                  <Fragment key={flight.key}>
                    <i style={{ left: `${Math.min(92, 5 + i * 23)}%` }} />
                    <em style={{ left: `${Math.min(92, 5 + i * 23)}%` }}>{fmtHm(flight.at)}</em>
                  </Fragment>
                ))}
              </div>
              <div className="qf-wba__crt__tools">
                <div className="qf-wba__switchbar" role="group" aria-label={t('wbDepartures')}>
                  {([['all', t('wbFilterAll'), allFlights.length], ['bot', t('wbFilterBots'), botFlightCount], ['task', t('wbFilterTasks'), taskFlightCount]] as const).map(([key, label, count]) => (
                    <button key={key} type="button" className={cn(filter === key && 'qf-wba__is-on')} onClick={() => setFilter(key)}>
                      {label} {count}
                    </button>
                  ))}
                </div>
                <div className="qf-wba__search">
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`${t('wbSearch')}`} aria-label={t('wbSearch')} />
                  <button className={cn('qf-wba__clear', query && 'qf-wba__is-on')} type="button" aria-label={t('wbClearSearch')} onClick={() => setQuery('')}>×</button>
                </div>
              </div>
              <div className="qf-wba__rowhead"><span>{t('wbColTime')}</span><span>{t('wbColFlight')}</span><span>{t('wbColStatus')}</span><span>ETA</span></div>
              <ul className="qf-wba__rows" aria-busy={bots === null}>
                {loadError ? (
                  <li className="qf-wba__fallback" role="alert">
                    <span>{loadError}</span>
                    <button className="qf-wba__crtbtn" type="button" onClick={requestRefresh}>{t('wbRetry')}</button>
                  </li>
                ) : null}
                {!loadError && bots === null
                  ? [0, 1, 2, 3].map((i) => <li key={i} className="qf-wba__skrow"><i /><i /><i /><i /></li>)
                  : null}
                {!loadError && bots !== null && flights.length === 0
                  ? <li className="qf-wba__f-empty">{bots.length === 0 ? t('workbenchNoBots') : t('wbNoFlights')}</li>
                  : null}
                {flights.map((flight) => {
                  const chip = flight.kind === 'bot' ? botChip(flight.bot) : taskChip(flight.task)
                  const name = flight.kind === 'bot' ? flight.bot.name : flight.task.title
                  const sub = flight.kind === 'bot' ? (flight.bot.projectId ?? flight.bot.id) : (flight.task.projectName ?? flight.task.projectId ?? flight.task.id)
                  const isNext = flight.key === nextKey
                  return (
                    <li key={flight.key}>
                      <button
                        type="button"
                        className={cn('qf-wba__frow', 'qf-wba__rise', isNext && 'qf-wba__is-next')}
                        title={t('wbOpenDetailHint')}
                        onClick={() => openDrawer(flight.kind === 'bot' ? { kind: 'bot', id: flight.bot.id } : { kind: 'task', id: flight.task.id })}
                      >
                        <span className="qf-wba__f-time">{fmtHm(flight.at)}</span>
                        <span style={{ minWidth: 0 }}>
                          <span className="qf-wba__f-name">
                            <i className={cn('qf-wba__f-dot', chip.tone === 'err' && 'qf-wba__f-dot--err', isNext && 'qf-wba__f-dot--amber')} />
                            <span>{name}</span>
                          </span>
                          <span className="qf-wba__f-scope">{[displayScope(sub), flight.kind === 'bot' ? `HEARTBEAT / ${intervalText(flight.bot.heartbeat?.intervalMinutes ?? 60)}` : scheduleTypeText(flight.task.scheduleType)].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="qf-wba__f-state">{chip.text}</span>
                        <span className={cn('qf-wba__f-count', isNext && 'qf-wba__f-count--next')}>{fmtLeft(flight.at - now)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="qf-wba__crt__foot">
                <button
                  className="qf-wba__crtbtn"
                  type="button"
                  disabled={!nextFlight}
                  onClick={() => nextFlight && openDrawer(nextFlight.kind === 'bot' ? { kind: 'bot', id: nextFlight.bot.id } : { kind: 'task', id: nextFlight.task.id })}
                >
                  ▸ {t('wbOpenDetailHint')}
                </button>
                <button
                  className="qf-wba__crtbtn"
                  type="button"
                  disabled={!nextFlight || nextFlight.kind !== 'bot'}
                  onClick={() => nextFlight?.kind === 'bot' && void doWake(nextFlight.bot.id)}
                >
                  ⚡ {t('wbWakeNow')}
                </button>
              </div>
            </div>
          </section>

          <aside className="qf-wba__module">
            <div className="qf-wba__gaugebox">
              <div title={rateWindow?.scope === 'all' ? t('wbaRateAllHint') : t('wbTodayTasksHint')}>
                <Gauge value={successRate} />
                <div className="qf-wba__gauge__cap">SUCCESS RATE</div>
              </div>
              <div className="qf-wba__gauge__side">
                <div className="qf-wba__g-label">
                  {rateWindow?.scope === 'all' ? `ALL RUNS / ${t('wbaRateAll')}` : `TODAY / ${t('wbToday')}`}
                </div>
                <div className="qf-wba__g-sub">{rateWindow ? `${rateWindow.success} / ${rateWindow.runs} RUNS` : '0 RUNS'}</div>
              </div>
            </div>
            <div className="qf-wba__counters">
              <div className="qf-wba__counter"><div className="qf-wba__c-label">SESSIONS</div><Odo text={today?.sessions != null ? String(today.sessions) : '—'} /></div>
              <div className="qf-wba__counter"><div className="qf-wba__c-label">TOKENS</div><Odo text={today?.tokens != null ? formatTokenCount(today.tokens) : '—'} /></div>
              <div className="qf-wba__counter"><div className="qf-wba__c-label">RUNS</div><Odo text={today?.taskRuns != null ? String(today.taskRuns) : '—'} /></div>
            </div>

            <div className="qf-wba__papers">
              <div className="qf-wba__paper">
                <h3>{t('wbArrivals')} <em>TODAY</em></h3>
                <div className="qf-wba__paper__rows">
                  {displayArrivals.length === 0
                    ? <div className="qf-wba__p-empty">{t('wbaArrivalsEmpty')}</div>
                    : displayArrivals.map((item) => (
                      <button key={item.key} className="qf-wba__p-row" type="button" onClick={() => openArrival(item)} title={item.note || ''}>
                        <i className={cn('qf-wba__p-mark', !item.ok && 'qf-wba__p-mark--err')} />
                        <span className="qf-wba__p-name">{item.name}</span>
                        <span className="qf-wba__p-meta">{fmtHm(item.at)}</span>
                      </button>
                    ))}
                </div>
              </div>
              <div className="qf-wba__paper">
                <h3>{t('wbFleet')} <em>ROSTER {String((bots ?? []).length).padStart(2, '0')}</em></h3>
                <div className="qf-wba__paper__rows">
                  {(bots ?? []).length === 0
                    ? <div className="qf-wba__p-empty">{t('workbenchNoBots')}</div>
                    : (bots ?? []).map((bot) => {
                      const chip = botChip(bot)
                      return (
                        <button key={bot.id} className="qf-wba__p-row" type="button" onClick={() => openDrawer({ kind: 'bot', id: bot.id })} title={t('wbOpenDetailHint')}>
                          <i className={cn('qf-wba__p-mark', chip.tone === 'err' && 'qf-wba__p-mark--err', (chip.tone === 'idle' || chip.tone === 'asleep') && 'qf-wba__p-mark--idle')} />
                          <span className="qf-wba__p-name">{bot.name}</span>
                          <span className="qf-wba__p-meta">{chip.text}</span>
                        </button>
                      )
                    })}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className={cn('qf-wba__scrim', drawer && 'qf-wba__is-on')} onClick={() => setDrawer(null)} />
      <aside className={cn('qf-wba__drawer', drawer && 'qf-wba__is-on')} aria-hidden={!drawer} role="dialog" aria-modal="true" aria-label={drawerBot?.name ?? drawerTask?.title ?? ''}>
        <i className="qf-wba__screw qf-wba__screw--tl" /><i className="qf-wba__screw qf-wba__screw--tr" />
        <i className="qf-wba__screw qf-wba__screw--bl" /><i className="qf-wba__screw qf-wba__screw--br" />
        <div className="qf-wba__drawer__inner">
          <div className="qf-wba__clip" />
          <div className="qf-wba__drawer__top">
            <div style={{ minWidth: 0 }}>
              <h3>{drawerBot?.name ?? drawerTask?.title ?? '—'}</h3>
              <p>{drawerBot ? `${drawerBot.id} / BOT HEARTBEAT` : drawerTask ? `${drawerTask.id} / SCHEDULED TASK` : '—'}</p>
            </div>
            <button ref={drawerCloseRef} className="qf-wba__iconbtn" type="button" style={{ marginLeft: 'auto' }} aria-label={t('workbenchClose')} onClick={() => setDrawer(null)}>×</button>
          </div>
          {drawerBot ? (
            <>
              <dl className="qf-wba__kv">
                <dt>{t('wbColStatus')}</dt><dd>{botChip(drawerBot).text}</dd>
                <dt>{t('wbNextWake')}</dt><dd>{drawerBot.heartbeat?.nextRunAt ? `${dayLabel(Date.parse(drawerBot.heartbeat.nextRunAt), now)} ${fmtHm(Date.parse(drawerBot.heartbeat.nextRunAt))}` : '—'}</dd>
                <dt>{t('wbLastWake')}</dt><dd>{drawerBot.heartbeat?.lastWakeAt ? `${dayLabel(Date.parse(drawerBot.heartbeat.lastWakeAt), now)} ${fmtHm(Date.parse(drawerBot.heartbeat.lastWakeAt))}` : '—'}</dd>
                <dt>{t('wbInterval')}</dt><dd>{intervalText(drawerBot.heartbeat?.intervalMinutes ?? 60)}</dd>
                <dt>{t('wbLastIdle')}</dt><dd>{drawerBot.heartbeat?.lastIdleReason || '—'}</dd>
                <dt>{t('wbLastError')}</dt><dd className={drawerBot.heartbeat?.lastError ? 'qf-wba__kv-err' : undefined}>{drawerBot.heartbeat?.lastError || '—'}</dd>
              </dl>
              <div className="qf-wba__paper-sect">
                <h4>{t('wbHeartbeat')} / CONTROLS</h4>
                <div className="qf-wba__ctl">
                  <span>{t('wbEnableHeartbeat')}</span>
                  <Switch checked={drawerBot.heartbeat?.enabled !== false} disabled={actionBusy} label={t('wbEnableHeartbeat')} onChange={(next) => void doPatch(drawerBot, { enabled: next })} />
                </div>
                <div className="qf-wba__ctl">
                  <span>{t('wbIntervalLabel')}</span>
                  <select value={drawerBot.heartbeat?.intervalMinutes ?? 60} disabled={actionBusy} aria-label={t('wbIntervalLabel')} onChange={(e) => void doPatch(drawerBot, { intervalMinutes: Number(e.target.value) })}>
                    {intervalOptions.map((m) => <option key={m} value={m}>{intervalText(m)}</option>)}
                  </select>
                </div>
                <div className="qf-wba__ctl">
                  <span title={t('wbAlwaysWakeHint')}>{t('wbAlwaysWake')}</span>
                  <Switch checked={drawerBot.heartbeat?.alwaysWake === true} disabled={actionBusy} label={t('wbAlwaysWake')} title={t('wbAlwaysWakeHint')} onChange={(next) => void doPatch(drawerBot, { alwaysWake: next })} />
                </div>
              </div>
              <div className="qf-wba__paper-sect">
                <h4>{t('wbInbox')} / NOTE</h4>
                <textarea className="qf-wba__textarea" rows={2} value={inbox} placeholder={t('wbInboxPlaceholder')} aria-label={t('wbInbox')} onChange={(e) => setInbox(e.target.value)} />
                <button className="qf-wba__pbtn" type="button" disabled={actionBusy || !inbox.trim()} onClick={() => void doFeed(drawerBot)}>{t('wbFeed')}</button>
              </div>
              <div className="qf-wba__paper-sect">
                <h4>{t('wbMemory')} · MEMORY.md</h4>
                <p>{memory === null ? t('wbLoading') : (memory.content.slice(0, 220) || t('wbMemoryEmpty'))}</p>
              </div>
              <div className="qf-wba__paper-sect">
                <h4>{t('wbGoal')} / LAST RUN</h4>
                <p>{goal === null ? t('wbLoading') : (goal.objective || goal.status || t('wbGoalNone'))}</p>
              </div>
            </>
          ) : drawerTask ? (
            <>
              <dl className="qf-wba__kv">
                <dt>{t('wbSchedule')}</dt><dd>{scheduleTypeText(drawerTask.scheduleType)}</dd>
                <dt>{t('wbScheduleRule')}</dt><dd>{drawerTask.scheduleType === 'cron' ? (drawerTask.cronExpression || drawerTask.scheduleRule) : drawerTask.scheduleRule}</dd>
                <dt>{t('wbColStatus')}</dt><dd>{taskChip(drawerTask).text}</dd>
                <dt>{t('wbNextWake')}</dt><dd>{drawerTask.nextRunAt ? `${dayLabel(Date.parse(drawerTask.nextRunAt), now)} ${fmtHm(Date.parse(drawerTask.nextRunAt))}` : '—'}</dd>
                <dt>{t('wbLastRun')}</dt><dd>{drawerTask.lastRunAt ? `${dayLabel(Date.parse(drawerTask.lastRunAt), now)} ${fmtHm(Date.parse(drawerTask.lastRunAt))}` : '—'}</dd>
              </dl>
              <div className="qf-wba__paper-sect">
                <h4>{t('wbRecentRuns')} / LAST RUN</h4>
                {(drawerTask.runs ?? []).length === 0
                  ? <p>{t('wbArrivalsEmpty')}</p>
                  : (drawerTask.runs ?? []).slice(0, 4).map((run) => (
                    <p key={run.id}>{fmtHm(Date.parse(run.startedAt))} · {run.status === 'running' ? t('wbRunning') : run.status === 'success' ? t('wbRunSuccess') : t('wbRunFailed')}{run.errorMessage ? ` · ${run.errorMessage}` : ''}</p>
                  ))}
              </div>
            </>
          ) : null}
        </div>
        <div className="qf-wba__drawer__acts">
          {drawerBot ? (
            <>
              <button className="qf-wba__pbtn" type="button" disabled={actionBusy || isBusy(drawerBot)} onClick={() => void doWake(drawerBot.id)}>{t('wbWakeNow')}</button>
              <button className="qf-wba__pbtn" type="button" disabled={entering} onClick={() => void enterSession(drawerBot)}>{t('wbOpenChat')}</button>
              <button className="qf-wba__pbtn" type="button" onClick={() => void doOpenFolder(drawerBot)}>{t('wbOpenFolder')}</button>
            </>
          ) : drawerTask ? (
            <button
              className="qf-wba__pbtn"
              type="button"
              disabled={!drawerTask.lastSessionId}
              onClick={() => {
                if (!drawerTask.lastSessionId) return
                requestOpenSession(drawerTask.lastSessionId, { skipMetadataPrecheck: true })
                onClose()
              }}
            >
              {t('wbOpenSession')}
            </button>
          ) : null}
        </div>
      </aside>

      <div className="qf-wba__toasts" role="status">
        {toasts.map((toast) => (
          <div key={toast.id} className={cn('qf-wba__toast', `qf-wba__toast--${toast.tone}`)} title={t('wbDismiss')} onClick={() => setToasts((list) => list.filter((item) => item.id !== toast.id))}>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 工作台入口：QF-08 拟物视图是唯一的工作台视图，不提供旧版切换。
 * 屏保模式仍交给 v8 渲染器（仅内部复用，不作为可选视图暴露），既有屏保能力不回归。
 * 对外签名与 ConversationHeader 的调用保持一致。
 */
export function WorkbenchPortal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const screensaverMode = useUIStore((s) => s.workbenchScreensaverMode)

  if (!open) return null
  if (screensaverMode !== 'off') return createPortal(<WorkbenchTower onClose={onClose} />, document.body)
  return createPortal(<WorkbenchAnalog onClose={onClose} />, document.body)
}
