/* eslint-disable react-refresh/only-export-components -- exports the notice components plus the pure connection helpers (tier threshold, duration format, help rows) covered by tests. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import {
  getSseConnectionState,
  requestSseReconnectNow,
  subscribeSseConnectionState,
  type SseConnectionStatus,
} from '@/lib/server-agent'
import { isMobileShell, isRemoteQuickForgeClient } from '@/lib/mobile-server'

/**
 * SSE connection notices, previously three imperative DOM controllers:
 * `reconnect-notice.ts`, `model-retry-notice.ts` and `unreachable-strip.ts`.
 *
 * All three were find-or-create injectors that pinned themselves into the
 * message list (or above the composer) and then kept their own `setInterval`
 * countdowns alive, re-asserting placement on every decoration pass because a
 * list rebuild dropped them. React owns the nodes now, so placement is a JSX
 * position and the countdowns are component state driven by one interval.
 *
 * Timing constants are the decoration's, unchanged — the CSS animations key off
 * the same class names and data attributes.
 */

/**
 * How long the backend must stay unreachable before the Tier-1 inline row hands
 * over to the Tier-2 persistent composer strip.
 */
export const UNREACHABLE_STRIP_AFTER_MS = 30000

const RECONNECTED_AUTO_DISMISS_MS = 2200
const RECONNECTED_RESTARTED_DISMISS_MS = 4000
const LEAVE_ANIMATION_MS = 340
const MODEL_RETRY_LEAVE_ANIMATION_MS = 340
const COUNTDOWN_TICK_MS = 1000

/**
 * Current SSE connection status, kept in sync with the shared SSE client.
 *
 * The initial value is read lazily, and the effect subscribes (the client only
 * broadcasts on transitions). The one synchronous re-read covers the gap
 * between the initial state and the subscription being installed.
 */
export function useSseConnectionStatus(): SseConnectionStatus | null {
  const [status, setStatus] = useState<SseConnectionStatus | null>(() => getSseConnectionState())
  useEffect(() => {
    // Bridge an external store that can change between the lazy initializer and
    // the subscription being installed (the client only broadcasts transitions).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(getSseConnectionState())
    return subscribeSseConnectionState((next) => setStatus(next))
  }, [])
  return status
}

/**
 * Same-second ticking clock for the countdown texts.
 *
 * The controllers each owned a `setInterval(…, 1000)`; this shares one per
 * mounted notice and stops as soon as the notice disappears. Every update comes
 * from the interval callback, never synchronously in the effect body.
 */
function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 21 19H3z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.1" />
    </svg>
  )
}

function secondsUntil(target: number, now: number): number {
  return Math.max(0, Math.ceil((target - now) / 1000))
}

/** True once the outage has lasted long enough for the Tier-2 strip to take over. */
export function unreachableStripOwns(status: SseConnectionStatus | null, now: number): boolean {
  if (!status || status.status !== 'reconnecting' || status.unreachableSince === undefined) return false
  return now - status.unreachableSince >= UNREACHABLE_STRIP_AFTER_MS
}

/**
 * Inline row at the end of the message list while the SSE stream retries
 * (Tier 1). Hands over to `UnreachableStrip` once the backend has been
 * unreachable for `UNREACHABLE_STRIP_AFTER_MS`.
 *
 * The recovery row ("Reconnected") is an episode: it appears only after a loss
 * was actually observed (a stale `connected` snapshot at mount must not flash),
 * it is held for 2.2s (4s when the server restarted, and a late `restarted`
 * upgrade restarts that hold), then it plays the 340ms leave animation. Once
 * dismissed, a replayed `restarted` upgrade cannot bring it back.
 */
export function ReconnectNotice({ status }: { status: SseConnectionStatus | null }) {
  const reconnecting = status?.status === 'reconnecting' ? status : null
  const unreachableWaiting = Boolean(reconnecting?.unreachable)
  const now = useSecondTick(Boolean(reconnecting))
  const [recoveryPhase, setRecoveryPhase] = useState<'none' | 'visible' | 'leaving' | 'done'>('none')
  const sawLossRef = useRef(false)
  const holdTimersRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimersRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!status) return undefined
    if (status.status === 'reconnecting' || status.status === 'failed') {
      sawLossRef.current = true
      // A new outage cancels any recovery episode still on screen. The loss
      // branches below never render the recovery row, so this reset is not a
      // visible transition — it only has to happen when the phase is not
      // already 'none' to avoid a pointless render.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset of an episode phase in response to external store changes
      if (recoveryPhase !== 'none') setRecoveryPhase('none')
      return undefined
    }
    if (status.status !== 'connected') return undefined
    // Mount-time `connected` is a finished episode, not a recovery to announce.
    if (!sawLossRef.current) return undefined
    // Already dismissed: a replayed/late `restarted` upgrade must not resurrect it.
    if (recoveryPhase === 'done') return undefined

    setRecoveryPhase('visible')
    const holdMs = status.restarted ? RECONNECTED_RESTARTED_DISMISS_MS : RECONNECTED_AUTO_DISMISS_MS
    const holdTimer = setTimeout(() => {
      setRecoveryPhase('leaving')
      const leaveTimer = setTimeout(() => setRecoveryPhase('done'), LEAVE_ANIMATION_MS)
      leaveTimersRef.current = leaveTimer
    }, holdMs)
    holdTimersRef.current = holdTimer
    return () => {
      if (holdTimersRef.current !== null) clearTimeout(holdTimersRef.current)
      if (leaveTimersRef.current !== null) clearTimeout(leaveTimersRef.current)
      holdTimersRef.current = null
      leaveTimersRef.current = null
    }
    // `recoveryPhase` is read only to check the terminal state; including it
    // would restart the hold timer on every phase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Tier 2 owns the message once the outage is long enough; the inline row hides
  // itself so the two never stack.
  if (unreachableStripOwns(reconnecting, now)) return null

  if (reconnecting) {
    if (unreachableWaiting) {
      return (
        <div className="quickforge-reconnect" aria-live="polite" role="status" data-state="unreachable">
          <div className="quickforge-reconnect-main">
            <span className="quickforge-reconnect-icon" aria-hidden="true"><WarnIcon /></span>
            <span className="quickforge-reconnect-title">{t('sseUnreachableTitle')}</span>
            <button className="quickforge-reconnect-retry" type="button" onClick={() => requestSseReconnectNow()}>
              {t('sseReconnectRetryNow')}
            </button>
          </div>
          <div className="quickforge-reconnect-sub">
            {t('sseUnreachableDetail', { seconds: secondsUntil(reconnecting.nextRetryAt, now) })}
          </div>
        </div>
      )
    }
    const seconds = secondsUntil(reconnecting.nextRetryAt, now)
    return (
      <div className="quickforge-reconnect" aria-live="polite" role="status" data-state="reconnecting">
        <span className="quickforge-reconnect-icon" aria-hidden="true"><SpinnerIcon /></span>
        <span className="quickforge-reconnect-text">
          {`${t('sseReconnectingLabel')} `}
          <span className="quickforge-reconnect-count">{`${reconnecting.attempt}/${reconnecting.maxAttempts}`}</span>
        </span>
        <span className="quickforge-reconnect-countdown" aria-hidden="true">
          {seconds > 0 ? t('sseReconnectNextRetry', { seconds }) : ''}
        </span>
      </div>
    )
  }

  if (status?.status === 'failed') {
    return (
      <div className="quickforge-reconnect" aria-live="polite" role="alert" data-state="failed">
        <span className="quickforge-reconnect-icon" aria-hidden="true"><WarnIcon /></span>
        <span className="quickforge-reconnect-text">
          {t('sseReconnectFailedLabel', { maxAttempts: status.maxAttempts })}
        </span>
        <button className="quickforge-reconnect-retry" type="button" onClick={() => requestSseReconnectNow()}>
          {t('sseReconnectRetryNow')}
        </button>
      </div>
    )
  }

  if (status?.status === 'connected' && (recoveryPhase === 'visible' || recoveryPhase === 'leaving')) {
    return (
      <div
        className={recoveryPhase === 'leaving' ? 'quickforge-reconnect quickforge-reconnect-leaving' : 'quickforge-reconnect'}
        aria-live="polite"
        role="status"
        data-state="reconnected"
      >
        <span className="quickforge-reconnect-icon" aria-hidden="true"><CheckIcon /></span>
        <span className="quickforge-reconnect-text">
          {status.restarted ? t('sseReconnectedRestarted') : t('sseReconnectedLabel')}
        </span>
      </div>
    )
  }

  return null
}

export type ModelRetryInfo = { attempt: number; maxAttempts: number }

/**
 * Model upstream stream retry row (companion to `ReconnectNotice`).
 *
 * The host owns the visibility: `model_stream_retry` shows/updates it and the
 * first delta of the recovered stream, the turn end or an error hides it. Only
 * the 340ms leave animation is local.
 */
export function ModelRetryNotice({ info }: { info: ModelRetryInfo | null }) {
  // Keep the last info while the row animates out, so the text does not blank
  // mid-fade (the decoration removed the node 340ms later for the same reason).
  const [lastInfo, setLastInfo] = useState<ModelRetryInfo | null>(info)
  const [leaving, setLeaving] = useState(false)
  // Remember the info the rendered row belongs to; a changed value re-seeds the
  // "last info" during render so the leave animation starts from the fresh text.
  const [infoRef, setInfoRef] = useState(info)
  if (infoRef !== info) {
    setInfoRef(info)
    if (info) {
      setLastInfo(info)
      setLeaving(false)
    } else if (lastInfo) {
      setLeaving(true)
    }
  }

  // The leave animation only ends via the timer callback (never synchronously
  // inside the effect).
  useEffect(() => {
    if (!leaving) return undefined
    const timer = setTimeout(() => {
      setLastInfo(null)
      setLeaving(false)
    }, MODEL_RETRY_LEAVE_ANIMATION_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  if (!info && !lastInfo) return null
  const display = info ?? lastInfo!
  return (
    <div
      className={leaving ? 'quickforge-model-retry quickforge-model-retry-leaving' : 'quickforge-model-retry'}
      role="status"
      aria-live="polite"
    >
      <span className="quickforge-reconnect-icon" aria-hidden="true"><SpinnerIcon /></span>
      <span className="quickforge-reconnect-text">
        {`${t('modelStreamRetryingLabel')} `}
        <span className="quickforge-reconnect-count">{`${display.attempt}/${display.maxAttempts}`}</span>
      </span>
    </div>
  )
}

type HelpRowKey = 'cli' | 'desktop' | 'remote'

const HELP_TEXT_KEY: Record<HelpRowKey | 'logs', Parameters<typeof t>[0]> = {
  cli: 'sseUnreachableHelpCli',
  desktop: 'sseUnreachableHelpDesktop',
  remote: 'sseUnreachableHelpRemote',
  logs: 'sseUnreachableHelpLogs',
}

function isDesktopApp(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false
  const desktopWindow = window as Window & { __quickforgeDesktopApp?: boolean }
  return document.body.classList.contains('quickforge-desktop-app') || desktopWindow.__quickforgeDesktopApp === true
}

function isMobileEntry(): boolean {
  try {
    return isMobileShell() || isRemoteQuickForgeClient()
  } catch {
    // mobile-server 依赖不可用时退回移动 UA 判断（与原装饰实现一致）。
    return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  }
}

/** Recovery guide rows: one action for the detected runtime plus the log line. */
export function unreachableHelpRows(): Array<HelpRowKey | 'logs'> {
  const environment: HelpRowKey = isDesktopApp() ? 'desktop' : isMobileEntry() ? 'remote' : 'cli'
  return [environment, 'logs']
}

/** `45s` under a minute, `1m 05s` above it — the decoration's format. */
export function formatUnreachableDuration(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * Tier-2 persistent amber strip pinned above the composer while the backend
 * health probe keeps failing. Visible at any scroll position, which is why it
 * lives outside the scroll container.
 */
export function UnreachableStrip({ status }: { status: SseConnectionStatus | null }) {
  const reconnecting = status?.status === 'reconnecting' ? status : null
  const active = Boolean(reconnecting?.unreachable && reconnecting.unreachableSince !== undefined)
  const now = useSecondTick(active)
  const [helpOpen, setHelpOpen] = useState(false)

  const helpRows = useMemo(() => unreachableHelpRows(), [])

  if (!reconnecting || !reconnecting.unreachable || reconnecting.unreachableSince === undefined) return null
  if (!unreachableStripOwns(reconnecting, now)) return null

  return (
    <div className="quickforge-unreachable-strip" role="alert">
      <div className="quickforge-unreachable-strip-row">
        <span className="quickforge-reconnect-icon" aria-hidden="true"><WarnIcon /></span>
        <span className="quickforge-unreachable-strip-title">
          {t('sseUnreachableStripTitle', { duration: formatUnreachableDuration(now - reconnecting.unreachableSince) })}
        </span>
        <span className="quickforge-unreachable-strip-sub">
          {t('sseUnreachableDetail', { seconds: secondsUntil(reconnecting.nextRetryAt, now) })}
        </span>
        <span className="quickforge-unreachable-strip-spacer" />
        <button className="quickforge-reconnect-retry" type="button" onClick={() => requestSseReconnectNow()}>
          {t('sseReconnectRetryNow')}
        </button>
        <button
          className="quickforge-unreachable-help-toggle"
          type="button"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((value) => !value)}
        >
          {`${t('sseUnreachableHelpToggle')} ${helpOpen ? '⌃' : '⌄'}`}
        </button>
      </div>
      <div className="quickforge-unreachable-strip-help" data-open={String(helpOpen)}>
        {helpRows.map((key) => (
          <span key={key} className="quickforge-unreachable-strip-help-row">{`· ${t(HELP_TEXT_KEY[key])}`}</span>
        ))}
      </div>
    </div>
  )
}

/**
 * 「另一个窗口正在写这个会话」提示条。
 *
 * 会话写入租约（`server/session-lease.mjs`）只允许一个客户端写：本页不是持有者
 * 时，composer 转只读并显示这条提示。它同时提供「在此窗口接管」，因为租约是
 * 用户可见的偏好而不是硬锁 —— 用户想换窗口写时不该去关掉另一个标签页。
 */
/**
 * 「无法确认写入权限」提示条。
 *
 * 会话写入租约（`server/session-lease.mjs`）只允许一个客户端写。这里覆盖两种
 * 情况，措辞必须区分开，否则用户无从判断该做什么：
 *
 * - 本页不是持有者 → 给出「在此窗口接管」，因为租约是用户可见的偏好而不是硬锁。
 * - 请求失败（网络 / 未授权 / 服务端报错）→ 给出「重试」。这类失败往往是瞬时的
 *   或与访问授权有关，把用户锁在只读里却不给出口，是这条提示最糟的形态。
 */
export function SessionLeaseStrip({
  holder,
  degraded,
  failure,
  failureStatus,
  onTakeOver,
  takingOver = false,
  onRetry,
  retrying = false,
}: {
  /** 当前持有者的 clientId；`null` 表示无人持有（仅 degraded 时会出现）。 */
  holder: string | null
  degraded: boolean
  /** 失败原因；仅 degraded 时有意义。 */
  failure?: 'network' | 'server' | 'auth' | 'unsupported'
  /** 失败时服务端返回的状态码，用于把「HTTP 500」这类事实直接告诉用户。 */
  failureStatus?: number
  onTakeOver?: () => void
  takingOver?: boolean
  onRetry?: () => void
  retrying?: boolean
}) {
  const detail = !degraded
    ? t('sessionLeaseObserverDetail')
    : failure === 'auth'
      ? t('sessionLeaseUnavailableAuthDetail')
      : failure === 'server' && failureStatus
        ? t('sessionLeaseUnavailableServerDetail', { status: String(failureStatus) })
        : t('sessionLeaseUnavailableDetail')
  return (
    <div className="quickforge-lease-strip" role="status">
      <div className="quickforge-lease-strip-row">
        <span className="quickforge-lease-dot" aria-hidden="true" />
        <span className="quickforge-lease-strip-title">
          {degraded ? t('sessionLeaseUnavailable') : t('sessionLeaseObserverTitle')}
        </span>
        <span className="quickforge-lease-strip-sub">{detail}</span>
        <span className="quickforge-lease-strip-spacer" />
        {degraded ? (
          <button
            className="quickforge-lease-takeover"
            type="button"
            disabled={retrying}
            onClick={() => onRetry?.()}
          >
            {t('sessionLeaseRetry')}
          </button>
        ) : (
          <button
            className="quickforge-lease-takeover"
            type="button"
            disabled={takingOver}
            onClick={() => onTakeOver?.()}
          >
            {t('sessionLeaseTakeOver')}
          </button>
        )}
      </div>
      {holder ? <span className="quickforge-lease-holder">{t('sessionLeaseHolderLabel', { holder })}</span> : null}
    </div>
  )
}
