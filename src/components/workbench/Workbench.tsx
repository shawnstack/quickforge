import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity, Bot as BotIcon, MessageSquare, Moon, PlaneLanding, RotateCw, X } from 'lucide-react'
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
import { BotMascot } from '@/components/bots/mascot/BotMascot'
import { fetchScheduledTasks } from '@/components/scheduled-tasks/scheduled-tasks-data'
import type { ScheduledTask } from '@/components/scheduled-tasks/scheduled-tasks-types'
import { useUIStore } from '@/stores/ui-store'
import './workbench.css'

/**
 * 塔台工作台（设计稿 docs/design/workbench-redesign/workbench-v8-proposal.html）。
 *
 * 主体是「事件」而非空间：bot 心跳与定时任务的 nextRunAt 合并成出港队列，
 * 右栏回答谁在跑 / 谁刚完成 / 舰队名册，顶部 NOTAM 通告卡住的地方。
 * 「在跑」覆盖三类真实运行：busy 的 bot、running 的普通会话（GET /api/agents，
 * 排除 bot/任务会话）。数据全部来自现成端点；进港与到点未醒是会话内观察
 * （刷新即清），不外推未来班次。看板与时钟双主题恒暗（仪器），房间区吃全局 token。
 */

const POLL_MS = 20_000
const TICK_MS = 1_000
const MISSED_GRACE_MS = 90_000
const ARRIVAL_CAP = 8
const INTERVAL_OPTIONS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]

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

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtHm(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtClock(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fmtSpan(ms: number): string {
  const total = Math.max(0, Math.floor(Math.abs(ms) / 1000))
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

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

function isBusy(bot: BotSummary): boolean {
  return Boolean(bot.busy || bot.status === 'running')
}

function mascotStateOf(bot: BotSummary): 'working' | 'idle' | 'sleepy' {
  if (isBusy(bot)) return 'working'
  if (bot.heartbeat?.enabled === false) return 'sleepy'
  return 'idle'
}

/** 出港/抽屉的状态章：在跑是事实优先于历史错误，催醒后立刻有反馈。 */
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

function Switch({ checked, disabled, label, onChange }: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cn('qf-wb__switch', checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  )
}

export function WorkbenchTower({ onClose }: { onClose: () => void }) {
  const [bots, setBots] = useState<BotSummary[] | null>(null)
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
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
  const [actionBusy, setActionBusy] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [inbox, setInbox] = useState('')
  const [busySince, setBusySince] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [sessionSince, setSessionSince] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [entering, setEntering] = useState(false)

  const requestOpenSession = useUIStore((s) => s.requestOpenSession)
  const prevBotsRef = useRef(new Map<string, { busy: boolean; nextRunAt: string | null }>())
  const prevTasksRef = useRef(new Map<string, string | null>())
  const prevSessionsRef = useRef(new Map<string, boolean>())
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null)
  const prevFocusRef = useRef<Element | null>(null)

  const pushToast = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list.slice(-2), { id, tone, text }])
    window.setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id))
    }, 3600)
  }, [])

  /** 会话内观察：busy→idle 记进港；到点超过宽限仍未醒记 warn 通告；普通会话 running→结束记进港。不写服务端。 */
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
          key: `bot:${bot.id}:${at}`,
          kind: 'bot',
          refId: bot.id,
          name: bot.name,
          at,
          ok: !bot.heartbeat?.lastError,
          note: bot.heartbeat?.lastError || bot.heartbeat?.lastIdleReason || '',
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
          key: `task:${task.id}:${run.id}`,
          kind: 'task',
          refId: task.id,
          name: task.title,
          at: Date.parse(run.finishedAt || run.startedAt) || at,
          ok: run.status === 'success',
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
          key: `session:${session.sessionId}:${at}`,
          kind: 'session',
          refId: session.sessionId,
          name: session.title || session.sessionId,
          at,
          ok: session.status === 'idle',
          note: session.status === 'idle' ? '' : session.status,
        })
      }
      prevSessionsRef.current.set(session.sessionId, running)
    }
    setBusySince((prev) => {
      const next = new Map(prev)
      let changed = false
      for (const bot of nextBots) {
        if (isBusy(bot)) {
          if (!next.has(bot.id)) { next.set(bot.id, at); changed = true }
        } else if (next.has(bot.id)) {
          next.delete(bot.id)
          changed = true
        }
      }
      return changed ? next : prev
    })
    setSessionSince((prev) => {
      const next = new Map(prev)
      let changed = false
      for (const session of nextSessions) {
        if (botSessionIds.has(session.sessionId) || taskSessionIds.has(session.sessionId)) continue
        if (session.status === 'running') {
          if (!next.has(session.sessionId)) { next.set(session.sessionId, at); changed = true }
        } else if (next.has(session.sessionId)) {
          next.delete(session.sessionId)
          changed = true
        }
      }
      return changed ? next : prev
    })
    if (newArrivals.length) setArrivals((list) => [...newArrivals.reverse(), ...list].slice(0, ARRIVAL_CAP))
    if (newMissed.length) {
      setMissed((list) => {
        const seen = new Set(list.map((item) => item.key))
        return [...list, ...newMissed.filter((item) => !seen.has(item.key))]
      })
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [nextBots, nextTasks, nextSessions] = await Promise.all([
        fetchBots(),
        fetchScheduledTasks().catch(() => null),
        fetch('/api/agents').then((res) => (res.ok ? res.json() : null)).catch(() => null),
      ])
      setBots(nextBots)
      if (nextTasks) setTasks(nextTasks)
      setSessions(nextSessions?.sessions ?? [])
      setLoadError(null)
      setLastLoadedAt(Date.now())
      observe(nextBots, nextTasks ?? [], nextSessions?.sessions ?? [], Date.now())
    } catch (err) {
      setLoadError(errText(err))
    } finally {
      setRefreshing(false)
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

  // 抽屉开合的焦点管理：打开聚焦关闭按钮，关闭归还焦点给触发元素。
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

  const nextKey = allFlights[0]?.key ?? null
  const botFlightCount = allFlights.filter((f) => f.kind === 'bot').length
  const taskFlightCount = allFlights.length - botFlightCount

  /** 普通会话在跑：status==='running' 且不属于任何 bot / 定时任务会话。 */
  const runningSessions = useMemo(() => {
    const botSessionIds = new Set((bots ?? []).flatMap((b) => [b.sessionId, b.heartbeat?.lastSessionId]).filter((x): x is string => Boolean(x)))
    const taskSessionIds = new Set((tasks ?? []).flatMap((task) => [task.lastSessionId, ...(task.runs ?? []).map((r) => r.sessionId)]).filter((x): x is string => Boolean(x)))
    return (sessions ?? []).filter((s) => s.status === 'running' && !botSessionIds.has(s.sessionId) && !taskSessionIds.has(s.sessionId))
  }, [sessions, bots, tasks])

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

  // 统计互斥：异常 > 休眠 > 待醒，避免同一 bot 被重复计入两档。
  const stats = useMemo(() => {
    const list = bots ?? []
    return {
      running: list.filter(isBusy).length + runningSessions.length,
      errors: list.filter((b) => b.heartbeat?.lastError).length,
      asleep: list.filter((b) => !b.heartbeat?.lastError && b.heartbeat?.enabled === false).length,
      waiting: list.filter((b) => !b.heartbeat?.lastError && b.heartbeat?.enabled !== false && !isBusy(b)).length,
    }
  }, [bots, runningSessions])

  const running = useMemo(
    () => (bots ?? []).filter(isBusy).map((bot) => ({ bot, since: busySince.get(bot.id) ?? now })),
    [bots, now, busySince],
  )

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

  // Esc 优先级：先清搜索，再关抽屉，最后关工作台。
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

  const clock = fmtClock(now)
  const date = new Date(now)
  const intervalOptions = drawerBot && !INTERVAL_OPTIONS.includes(drawerBot.heartbeat.intervalMinutes)
    ? [drawerBot.heartbeat.intervalMinutes, ...INTERVAL_OPTIONS]
    : INTERVAL_OPTIONS
  const nowCount = running.length + runningSessions.length
  const updatedTitle = lastLoadedAt ? `${t('wbUpdatedAt')} ${fmtClock(lastLoadedAt)}` : undefined

  return (
    <div className="qf-wb" role="dialog" aria-modal="true" aria-label={t('workbenchTitle')}>
      <div className="qf-wb__appbar">
        <div className="qf-wb__title"><b>{t('workbenchTitle')}</b><span>TOWER</span></div>
        <div className="qf-wb__clock" aria-label={clock}>
          {clock.split('').map((ch, i) => (
            ch === ':'
              ? <span key={`c${i}`} className="qf-wb__colon">:</span>
              : <span key={`${i}-${ch}`} className="qf-wb__flap"><span>{ch}</span></span>
          ))}
        </div>
        <span className="qf-wb__date">{date.getFullYear()}-{pad(date.getMonth() + 1)}-{pad(date.getDate())}</span>
        <div className="qf-wb__stats">
          <span className="qf-wb__stat" title={t('wbNow')}><i className="qf-wb__dot qf-wb__dot--ok" />{t('wbNow')} <b>{stats.running}</b></span>
          <span className="qf-wb__stat" title={t('wbStatWaiting')}><i className="qf-wb__dot qf-wb__dot--amber" />{t('wbStatWaiting')} <b>{stats.waiting}</b></span>
          <span className="qf-wb__stat" title={t('wbStatAsleep')}><i className="qf-wb__dot" />{t('wbStatAsleep')} <b>{stats.asleep}</b></span>
          <span className="qf-wb__stat" title={t('wbStatErrors')}><i className="qf-wb__dot qf-wb__dot--err" />{t('wbStatErrors')} <b>{stats.errors}</b></span>
          <span className="qf-wb__live" title={updatedTitle}><i />LIVE</span>
        </div>
        <button
          type="button"
          className={cn('qf-wb__iconbtn', refreshing && 'is-spin')}
          onClick={requestRefresh}
          aria-label={t('wbRefresh')}
          title={updatedTitle ?? t('wbRefresh')}
        >
          <RotateCw className="size-4" />
        </button>
        <button type="button" className="qf-wb__iconbtn" onClick={onClose} aria-label={t('workbenchClose')}>
          <X className="size-4" />
        </button>
      </div>

      <div className="qf-wb__runway" aria-hidden="true">
        {Array.from({ length: 26 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}
      </div>

      <div className="qf-wb__notams" role="status">
        {notams.length === 0 ? (
          <div className="qf-wb__notam-clear">{t('wbNotamsClear')}</div>
        ) : notams.map((item) => (
          <div key={item.key} className={cn('qf-wb__notam', item.kind === 'error' && 'qf-wb__notam--error')}>
            <span className="qf-wb__notam-icon">{item.kind === 'error' ? '!' : 'i'}</span>
            <b className="qf-wb__notam-src">{item.name}</b>
            <span className="qf-wb__notam-text">{item.text}</span>
            <span className="qf-wb__notam-actions">
              <button type="button" className="qf-wb__nbtn qf-wb__nbtn--primary" onClick={() => void doWake(item.bot.id)}>
                {t('wbWakeRetry')}
              </button>
              <button type="button" className="qf-wb__nbtn" onClick={() => void enterSession(item.bot)}>
                {t('wbOpenSession')}
              </button>
              <button
                type="button"
                className="qf-wb__nbtn"
                onClick={() => setDismissed((d) => ({ ...d, [item.key]: true }))}
              >
                {t('wbDismiss')}
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="qf-wb__main">
        <section className="qf-wb__board" aria-label={t('wbDepartures')}>
          <div className="qf-wb__board-head">
            <div className="qf-wb__board-title"><b>{t('wbDepartures')}</b><span>DEPARTURES · {t('wbDeparturesSub')}</span></div>
            <div className="qf-wb__board-tools">
              <div className="qf-wb__filters" role="group" aria-label={t('wbDepartures')}>
                <button type="button" className={cn('qf-wb__filter', filter === 'all' && 'is-on')} onClick={() => setFilter('all')}>
                  {t('wbFilterAll')} {allFlights.length}
                </button>
                <button type="button" className={cn('qf-wb__filter', filter === 'bot' && 'is-on')} onClick={() => setFilter('bot')}>
                  {t('wbFilterBots')} {botFlightCount}
                </button>
                <button type="button" className={cn('qf-wb__filter', filter === 'task' && 'is-on')} onClick={() => setFilter('task')}>
                  {t('wbFilterTasks')} {taskFlightCount}
                </button>
              </div>
              <label className="qf-wb__search">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.8-3.8" />
                </svg>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('wbSearch')} aria-label={t('wbSearch')} />
                {query ? (
                  <button
                    type="button"
                    className="qf-wb__search-clear"
                    aria-label={t('wbClearSearch')}
                    title={t('wbClearSearch')}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setQuery('') }}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </label>
            </div>
          </div>
          <div className="qf-wb__cols" aria-hidden="true">
            <span>{t('wbColTime')}</span><span>{t('wbColCountdown')}</span><span>{t('wbColFlight')}</span><span>{t('wbColStatus')}</span>
          </div>
          <div className="qf-wb__rows" aria-busy={bots === null}>
            {loadError ? (
              <div className="qf-wb__fallback qf-wb__fallback--error" role="alert">
                <span>{loadError}</span>
                <button type="button" className="qf-wb__btn" onClick={requestRefresh}>{t('wbRetry')}</button>
              </div>
            ) : null}
            {!loadError && bots === null ? (
              <div className="qf-wb__skeleton" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="qf-wb__skrow"><i /><i /><i /><i /></div>
                ))}
              </div>
            ) : null}
            {!loadError && bots !== null && flights.length === 0 ? (
              <div className="qf-wb__fallback">{bots.length === 0 ? t('workbenchNoBots') : t('wbNoFlights')}</div>
            ) : null}
            {flights.map((flight) => {
              const overdue = flight.at <= now
              const chip = flight.kind === 'bot' ? botChip(flight.bot) : taskChip(flight.task)
              const name = flight.kind === 'bot' ? flight.bot.name : flight.task.title
              const sub = flight.kind === 'bot' ? (flight.bot.projectId ?? flight.bot.id) : (flight.task.projectName ?? flight.task.id)
              return (
                <button
                  key={flight.key}
                  type="button"
                  className={cn('qf-wb__row', flight.key === nextKey && 'is-next')}
                  onClick={() => openDrawer(flight.kind === 'bot' ? { kind: 'bot', id: flight.bot.id } : { kind: 'task', id: flight.task.id })}
                >
                  <span className="qf-wb__cell-time"><b>{fmtHm(flight.at)}</b><i>{dayLabel(flight.at, now)}</i></span>
                  <span className={cn('qf-wb__cell-cd', overdue && 'is-overdue')} title={overdue ? t('wbOverdue') : t('wbColCountdown')}>
                    {overdue ? `+${fmtSpan(now - flight.at)}` : fmtSpan(flight.at - now)}
                  </span>
                  <span className="qf-wb__cell-flight">
                    {flight.kind === 'bot'
                      ? <BotMascot state={mascotStateOf(flight.bot)} size={20} look={flight.bot.mascot} />
                      : <i className="qf-wb__diamond" aria-hidden="true" />}
                    <span className="qf-wb__flight-name">
                      <b>{name}{flight.key === nextKey ? <em className="qf-wb__next">NEXT</em> : null}</b>
                      <i>{sub}</i>
                    </span>
                  </span>
                  <span className={cn('qf-wb__chip', `qf-wb__chip--${chip.tone}`)}><i />{chip.text}</span>
                </button>
              )
            })}
          </div>
          <div className="qf-wb__legend">
            <span><i className="qf-wb__dot qf-wb__dot--ok" />{t('wbLegendBots')}</span>
            <span><i className="qf-wb__diamond" />{t('wbLegendTasks')}</span>
            <span>{t('wbLegendHonest')}</span>
          </div>
        </section>

        <aside className="qf-wb__side">
          <section className="qf-wb__panel">
            <div className="qf-wb__panel-head"><Activity className="qf-wb__panel-icon size-3.5" /><b>{t('wbNow')}</b><span>{nowCount}</span></div>
            {nowCount === 0 ? (
              <div className="qf-wb__panel-empty"><Moon className="size-4" /><span>{t('wbNowEmpty')}</span></div>
            ) : (
              <>
                {running.map(({ bot, since }) => (
                  <button key={bot.id} type="button" className="qf-wb__siderow" onClick={() => openDrawer({ kind: 'bot', id: bot.id })}>
                    <BotMascot state="working" size={20} look={bot.mascot} />
                    <span className="qf-wb__siderow-name">{bot.name}</span>
                    <span className="qf-wb__siderow-meta" title={t('wbSinceObserved')}>{t('wbRunningFor', { time: fmtSpan(now - since) })}</span>
                  </button>
                ))}
                {runningSessions.map((session) => (
                  <button
                    key={session.sessionId}
                    type="button"
                    className="qf-wb__siderow"
                    title={t('wbSession')}
                    aria-label={`${t('wbSession')}: ${session.title || session.sessionId}`}
                    onClick={() => { requestOpenSession(session.sessionId, { skipMetadataPrecheck: true }); onClose() }}
                  >
                    <MessageSquare className="qf-wb__session-icon size-4" />
                    <span className="qf-wb__siderow-name">{session.title || session.sessionId}</span>
                    <span className="qf-wb__siderow-meta" title={t('wbSinceObserved')}>{t('wbRunningFor', { time: fmtSpan(now - (sessionSince.get(session.sessionId) ?? now)) })}</span>
                  </button>
                ))}
              </>
            )}
          </section>
          <section className="qf-wb__panel">
            <div className="qf-wb__panel-head"><PlaneLanding className="qf-wb__panel-icon size-3.5" /><b>{t('wbArrivals')}</b><span>{t('wbArrivalsSession')}</span></div>
            {arrivals.length === 0 ? (
              <div className="qf-wb__panel-empty"><PlaneLanding className="size-4" /><span>{t('wbArrivalsEmpty')}</span></div>
            ) : arrivals.map((item) => (
              <button
                key={item.key}
                type="button"
                className="qf-wb__siderow qf-wb__siderow--static qf-wb__siderow--link"
                onClick={() => openArrival(item)}
                title={item.note || (item.ok ? t('wbRunSuccess') : t('wbRunFailed'))}
              >
                <i className={cn('qf-wb__dot', item.ok ? 'qf-wb__dot--ok' : 'qf-wb__dot--err')} />
                <span className="qf-wb__siderow-name">{item.name}</span>
                <span className="qf-wb__siderow-meta">{item.note || (item.ok ? t('wbRunSuccess') : t('wbRunFailed'))}</span>
                <span className="qf-wb__siderow-time">{fmtHm(item.at)}</span>
              </button>
            ))}
          </section>
          <section className="qf-wb__panel">
            <div className="qf-wb__panel-head"><BotIcon className="qf-wb__panel-icon size-3.5" /><b>{t('wbFleet')}</b><span>{(bots ?? []).length}</span></div>
            {(bots ?? []).length === 0 ? (
              <div className="qf-wb__panel-empty"><BotIcon className="size-4" /><span>{t('workbenchNoBots')}</span></div>
            ) : (bots ?? []).map((bot) => {
              const summary = botStatusSummary(bot, now)
              return (
                <button key={bot.id} type="button" className="qf-wb__siderow" onClick={() => openDrawer({ kind: 'bot', id: bot.id })}>
                  <BotMascot state={mascotStateOf(bot)} size={18} look={bot.mascot} />
                  <span className="qf-wb__siderow-name">{bot.name}</span>
                  <span className={cn('qf-wb__siderow-meta', `qf-wb__tone--${summary.tone}`)}>{isBusy(bot) ? t('wbRunning') : summary.text}</span>
                </button>
              )
            })}
          </section>
        </aside>
      </div>

      {drawer ? (
        <>
          <div className="qf-wb__scrim" onClick={() => setDrawer(null)} />
          <div className="qf-wb__drawer" role="dialog" aria-modal="true" aria-label={drawerBot?.name ?? drawerTask?.title ?? ''}>
            <div className="qf-wb__drawer-scroll">
              {drawerBot ? (
                <>
                  <div className="qf-wb__d-head">
                    <BotMascot state={mascotStateOf(drawerBot)} size={34} look={drawerBot.mascot} />
                    <div className="qf-wb__d-main">
                      <b>{drawerBot.name}</b>
                      <i>{drawerBot.id} · {drawerBot.projectId ?? '—'}</i>
                    </div>
                    <span className={cn('qf-wb__chip', `qf-wb__chip--${botChip(drawerBot).tone}`)}><i />{botChip(drawerBot).text}</span>
                    <button ref={drawerCloseRef} type="button" className="qf-wb__iconbtn" onClick={() => setDrawer(null)} aria-label={t('workbenchClose')}>
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="qf-wb__d-sec">
                    <div className="qf-wb__d-title">{t('wbColStatus')}</div>
                    <div className="qf-wb__kv"><span>{t('wbNextWake')}</span><b>{drawerBot.heartbeat?.nextRunAt ? `${dayLabel(Date.parse(drawerBot.heartbeat.nextRunAt), now)} ${fmtHm(Date.parse(drawerBot.heartbeat.nextRunAt))}` : '—'}</b></div>
                    <div className="qf-wb__kv"><span>{t('wbLastWake')}</span><b>{drawerBot.heartbeat?.lastWakeAt ? `${dayLabel(Date.parse(drawerBot.heartbeat.lastWakeAt), now)} ${fmtHm(Date.parse(drawerBot.heartbeat.lastWakeAt))}` : '—'}</b></div>
                    <div className="qf-wb__kv"><span>{t('wbInterval')}</span><b>{intervalText(drawerBot.heartbeat?.intervalMinutes ?? 60)}</b></div>
                    <div className="qf-wb__kv"><span>{t('wbLastIdle')}</span><b>{drawerBot.heartbeat?.lastIdleReason || '—'}</b></div>
                    <div className="qf-wb__kv"><span>{t('wbLastError')}</span><b className={drawerBot.heartbeat?.lastError ? 'qf-wb__kv-err' : undefined}>{drawerBot.heartbeat?.lastError || '—'}</b></div>
                  </div>
                  <div className="qf-wb__d-sec">
                    <div className="qf-wb__d-title">{t('wbHeartbeat')}</div>
                    <div className="qf-wb__ctl">
                      <span>{t('wbEnableHeartbeat')}</span>
                      <Switch
                        checked={drawerBot.heartbeat?.enabled !== false}
                        disabled={actionBusy}
                        label={t('wbEnableHeartbeat')}
                        onChange={(next) => void doPatch(drawerBot, { enabled: next })}
                      />
                    </div>
                    <div className="qf-wb__ctl">
                      <span>{t('wbIntervalLabel')}</span>
                      <select
                        className="qf-wb__select"
                        value={drawerBot.heartbeat?.intervalMinutes ?? 60}
                        disabled={actionBusy}
                        aria-label={t('wbIntervalLabel')}
                        onChange={(e) => void doPatch(drawerBot, { intervalMinutes: Number(e.target.value) })}
                      >
                        {intervalOptions.map((m) => <option key={m} value={m}>{intervalText(m)}</option>)}
                      </select>
                    </div>
                    <div className="qf-wb__ctl">
                      <span>{t('wbAlwaysWake')}</span>
                      <Switch
                        checked={drawerBot.heartbeat?.alwaysWake === true}
                        disabled={actionBusy}
                        label={t('wbAlwaysWake')}
                        onChange={(next) => void doPatch(drawerBot, { alwaysWake: next })}
                      />
                    </div>
                    <div className="qf-wb__hint">{t('wbAlwaysWakeHint')}</div>
                  </div>
                  <div className="qf-wb__d-actions">
                    <button type="button" className="qf-wb__btn qf-wb__btn--primary" disabled={actionBusy || isBusy(drawerBot)} onClick={() => void doWake(drawerBot.id)}>
                      {t('wbWakeNow')}
                    </button>
                    <button type="button" className="qf-wb__btn" onClick={() => void enterSession(drawerBot)}>{t('wbOpenChat')}</button>
                    <button type="button" className="qf-wb__btn" onClick={() => void doOpenFolder(drawerBot)}>{t('wbOpenFolder')}</button>
                  </div>
                  <div className="qf-wb__d-sec">
                    <div className="qf-wb__d-title">{t('wbInbox')}</div>
                    <textarea
                      className="qf-wb__textarea"
                      rows={3}
                      value={inbox}
                      placeholder={t('wbInboxPlaceholder')}
                      aria-label={t('wbInbox')}
                      onChange={(e) => setInbox(e.target.value)}
                    />
                    <button type="button" className="qf-wb__btn" disabled={actionBusy || !inbox.trim()} onClick={() => void doFeed(drawerBot)}>
                      {t('wbFeed')}
                    </button>
                  </div>
                  <div className="qf-wb__d-sec">
                    <div className="qf-wb__d-title">{t('wbMemory')} · MEMORY.md</div>
                    {memory === null ? <div className="qf-wb__hint">{t('wbLoading')}</div> : (
                      <pre className="qf-wb__pre">{memory.content.slice(0, 600) || t('wbMemoryEmpty')}</pre>
                    )}
                  </div>
                  <div className="qf-wb__d-sec">
                    <div className="qf-wb__d-title">{t('wbGoal')}</div>
                    {goal === null ? <div className="qf-wb__hint">{t('wbLoading')}</div> : goal.objective || goal.status ? (
                      <div className="qf-wb__goal">
                        <b>{goal.objective || '—'}</b>
                        {goal.status ? <span className="qf-wb__goal-status">{goal.status}</span> : null}
                      </div>
                    ) : <div className="qf-wb__hint">{t('wbGoalNone')}</div>}
                  </div>
                </>
              ) : drawerTask ? (
                <>
                  <div className="qf-wb__d-head">
                    <i className="qf-wb__diamond qf-wb__diamond--lg" aria-hidden="true" />
                    <div className="qf-wb__d-main">
                      <b>{drawerTask.title}</b>
                      <i>{drawerTask.id} · {drawerTask.projectName ?? drawerTask.projectId ?? '—'}</i>
                    </div>
                    <span className={cn('qf-wb__chip', `qf-wb__chip--${taskChip(drawerTask).tone}`)}><i />{taskChip(drawerTask).text}</span>
                    <button ref={drawerCloseRef} type="button" className="qf-wb__iconbtn" onClick={() => setDrawer(null)} aria-label={t('workbenchClose')}>
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="qf-wb__d-sec">
                    <div className="qf-wb__d-title">{t('wbSchedule')}</div>
                    <div className="qf-wb__kv"><span>{t('wbColFlight')}</span><b>{scheduleTypeText(drawerTask.scheduleType)}</b></div>
                    <div className="qf-wb__kv"><span>{t('wbScheduleRule')}</span><b>{drawerTask.scheduleType === 'cron' ? (drawerTask.cronExpression || drawerTask.scheduleRule) : drawerTask.scheduleRule}</b></div>
                    <div className="qf-wb__kv"><span>{t('wbNextWake')}</span><b>{drawerTask.nextRunAt ? `${dayLabel(Date.parse(drawerTask.nextRunAt), now)} ${fmtHm(Date.parse(drawerTask.nextRunAt))}` : '—'}</b></div>
                    <div className="qf-wb__kv"><span>{t('wbLastRun')}</span><b>{drawerTask.lastRunAt ? `${dayLabel(Date.parse(drawerTask.lastRunAt), now)} ${fmtHm(Date.parse(drawerTask.lastRunAt))}` : '—'}</b></div>
                  </div>
                  <div className="qf-wb__d-actions">
                    <button
                      type="button"
                      className="qf-wb__btn qf-wb__btn--primary"
                      disabled={!drawerTask.lastSessionId}
                      onClick={() => {
                        if (!drawerTask.lastSessionId) return
                        requestOpenSession(drawerTask.lastSessionId, { skipMetadataPrecheck: true })
                        onClose()
                      }}
                    >
                      {t('wbOpenSession')}
                    </button>
                  </div>
                  <div className="qf-wb__d-sec">
                    <div className="qf-wb__d-title">{t('wbRecentRuns')}</div>
                    {(drawerTask.runs ?? []).length === 0 ? <div className="qf-wb__hint">{t('wbArrivalsEmpty')}</div> : (drawerTask.runs ?? []).slice(0, 5).map((run) => (
                      <div key={run.id} className="qf-wb__run">
                        <i className={cn('qf-wb__dot', run.status === 'success' ? 'qf-wb__dot--ok' : run.status === 'failed' ? 'qf-wb__dot--err' : 'qf-wb__dot--amber')} />
                        <span>{fmtHm(Date.parse(run.startedAt))}</span>
                        <span className="qf-wb__run-note" title={run.errorMessage || run.result || ''}>
                          {run.status === 'running' ? t('wbRunning') : run.status === 'success' ? t('wbRunSuccess') : t('wbRunFailed')}
                          {run.durationMs ? ` · ${fmtSpan(run.durationMs)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      <div className="qf-wb__toasts" role="status">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn('qf-wb__toast', `qf-wb__toast--${toast.tone}`)}
            title={t('wbDismiss')}
            onClick={() => setToasts((list) => list.filter((item) => item.id !== toast.id))}
          >
            <span className="qf-wb__toast-tag">TOWER</span>
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 入口按钮持有开合；portal 到 body 全屏渲染（对外签名与 v6 一致）。 */
export function WorkbenchPortal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return createPortal(<WorkbenchTower onClose={onClose} />, document.body)
}