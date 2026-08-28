import { t } from '@/lib/i18n'
import {
  getSseConnectionState,
  requestSseReconnectNow,
  subscribeSseConnectionState,
  type SseConnectionStatus,
} from '@/lib/server-agent'
import { UNREACHABLE_STRIP_AFTER_MS } from './unreachable-strip'

/**
 * Tier-1 inline reconnect notice for the global agent SSE stream.
 *
 * Appends a lightweight centered row at the end of the message list
 * (design-mockups/reconnect-indicator.html · 方案 A) while the stream retries:
 * 「重新连接中… 8/10 · 4s 后重试」 → 「已重新连接」 (auto-dismissed) →
 * 「连接失败，已重试 10 次」+ manual retry. Health-probe variants
 * (design-mockups/unreachable-notice.html · 方案 A): while the backend is
 * unreachable the row escalates to an amber two-line notice with its own
 * 「立即重试」 button (data-state="unreachable"); after
 * UNREACHABLE_STRIP_AFTER_MS it hides itself and hands over to the
 * persistent composer strip (unreachable-strip.ts). A changed server bootId
 * on recovery upgrades the notice to 「已重新连接 · 服务已重启」 shown for a
 * longer 4s window. Idempotent across decorate passes; re-appends itself
 * when the message list is rebuilt.
 */

const RECONNECT_NOTICE_SELECTOR = '.quickforge-reconnect'
const RECONNECTED_AUTO_DISMISS_MS = 2200
const RECONNECTED_RESTARTED_DISMISS_MS = 4000
const LEAVE_ANIMATION_MS = 340

const SPINNER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/></svg>'
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>'
const WARN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 21 19H3z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/></svg>'

export type ReconnectNoticeController = {
  /** Re-assert placement/state; call from the decorate pass. */
  sync: () => void
  /** Unsubscribe, clear timers and remove the notice from the DOM. */
  destroy: () => void
}

function iconSpan(svg: string): HTMLElement {
  const icon = document.createElement('span')
  icon.className = 'quickforge-reconnect-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = svg
  return icon
}

export function createReconnectNoticeController(deps: { panel: HTMLElement }): ReconnectNoticeController {
  const { panel } = deps
  let countdownTimer: ReturnType<typeof setInterval> | null = null
  let dismissTimer: ReturnType<typeof setTimeout> | null = null
  let leaveTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function clearTimers() {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer)
      dismissTimer = null
    }
    if (leaveTimer !== null) {
      clearTimeout(leaveTimer)
      leaveTimer = null
    }
  }

  function findNotice(): HTMLElement | null {
    return panel.querySelector<HTMLElement>(RECONNECT_NOTICE_SELECTOR)
  }

  function ensureNotice(state: 'reconnecting' | 'reconnected' | 'failed' | 'unreachable'): HTMLElement | null {
    const messageList = panel.querySelector<HTMLElement>('message-list')
    if (!messageList) return null

    let notice = findNotice()
    if (!notice) {
      notice = document.createElement('div')
      notice.className = 'quickforge-reconnect'
      notice.setAttribute('aria-live', 'polite')
    }
    notice.dataset.state = state
    notice.setAttribute('role', state === 'failed' ? 'alert' : 'status')
    if (notice.parentElement !== messageList) messageList.append(notice)
    return notice
  }

  function removeNotice() {
    clearTimers()
    findNotice()?.remove()
  }

  function dismissWithAnimation() {
    const notice = findNotice()
    if (!notice) return
    notice.classList.add('quickforge-reconnect-leaving')
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      removeNotice()
    }, LEAVE_ANIMATION_MS)
  }

  /** 不可达态（Tier1）：琥珀双行 + 「立即重试」；持续 ≥30s 后隐藏并交给 Tier2 常驻条。 */
  function tier2OwnsUnreachable(status: Extract<SseConnectionStatus, { status: 'reconnecting' }>): boolean {
    return status.unreachableSince !== undefined && Date.now() - status.unreachableSince >= UNREACHABLE_STRIP_AFTER_MS
  }

  function renderUnreachable(notice: HTMLElement, status: Extract<SseConnectionStatus, { status: 'reconnecting' }>) {
    notice.classList.remove('quickforge-reconnect-leaving')
    const main = document.createElement('div')
    main.className = 'quickforge-reconnect-main'

    const text = document.createElement('span')
    text.className = 'quickforge-reconnect-title'
    text.textContent = t('sseUnreachableTitle')

    const retry = document.createElement('button')
    retry.className = 'quickforge-reconnect-retry'
    retry.setAttribute('type', 'button')
    retry.textContent = t('sseReconnectRetryNow')
    retry.addEventListener('click', () => {
      requestSseReconnectNow()
    })

    main.append(iconSpan(WARN_SVG), text, retry)

    const sub = document.createElement('div')
    sub.className = 'quickforge-reconnect-sub'

    notice.replaceChildren(main, sub)

    const tick = () => {
      if (tier2OwnsUnreachable(status)) {
        // 到点自动隐藏：Tier2 常驻条接管（无新广播也要在 tick 内复查）。
        removeNotice()
        return
      }
      const seconds = Math.max(0, Math.ceil((status.nextRetryAt - Date.now()) / 1000))
      sub.textContent = t('sseUnreachableDetail', { seconds })
    }
    tick()
    countdownTimer = setInterval(tick, 1000)
  }

  function renderReconnecting(notice: HTMLElement, status: Extract<SseConnectionStatus, { status: 'reconnecting' }>) {
    if (status.unreachable) {
      renderUnreachable(notice, status)
      return
    }
    notice.classList.remove('quickforge-reconnect-leaving')
    const text = document.createElement('span')
    text.className = 'quickforge-reconnect-text'
    text.textContent = `${t('sseReconnectingLabel')} `
    const count = document.createElement('span')
    count.className = 'quickforge-reconnect-count'
    count.textContent = `${status.attempt}/${status.maxAttempts}`
    text.append(count)

    const countdown = document.createElement('span')
    countdown.className = 'quickforge-reconnect-countdown'
    countdown.setAttribute('aria-hidden', 'true')
    notice.replaceChildren(iconSpan(SPINNER_SVG), text, countdown)

    const tick = () => {
      const seconds = Math.max(0, Math.ceil((status.nextRetryAt - Date.now()) / 1000))
      countdown.textContent = seconds > 0 ? t('sseReconnectNextRetry', { seconds }) : ''
    }
    tick()
    countdownTimer = setInterval(tick, 1000)
  }

  function renderReconnected(notice: HTMLElement, restarted = false) {
    notice.classList.remove('quickforge-reconnect-leaving')
    const text = document.createElement('span')
    text.className = 'quickforge-reconnect-text'
    text.textContent = restarted ? t('sseReconnectedRestarted') : t('sseReconnectedLabel')
    notice.replaceChildren(iconSpan(CHECK_SVG), text)
    // restarted（断连期间服务重启）提示多停留一会儿让用户看清原因。
    dismissTimer = setTimeout(() => {
      dismissTimer = null
      dismissWithAnimation()
    }, restarted ? RECONNECTED_RESTARTED_DISMISS_MS : RECONNECTED_AUTO_DISMISS_MS)
  }

  function renderFailed(notice: HTMLElement, status: Extract<SseConnectionStatus, { status: 'failed' }>) {
    notice.classList.remove('quickforge-reconnect-leaving')
    const text = document.createElement('span')
    text.className = 'quickforge-reconnect-text'
    text.textContent = t('sseReconnectFailedLabel', { maxAttempts: status.maxAttempts })

    const retry = document.createElement('button')
    retry.className = 'quickforge-reconnect-retry'
    retry.setAttribute('type', 'button')
    retry.textContent = t('sseReconnectRetryNow')
    retry.addEventListener('click', () => {
      requestSseReconnectNow()
    })
    notice.replaceChildren(iconSpan(WARN_SVG), text, retry)
  }

  function apply(status: SseConnectionStatus | null) {
    if (disposed || !status || status.status === 'connected') return
    clearTimers()
    if (status.status === 'reconnecting' && status.unreachable && tier2OwnsUnreachable(status)) {
      // Tier2 常驻条已接管（持续不可达 ≥30s）：行内提示让位。
      removeNotice()
      return
    }
    const notice = ensureNotice(status.status === 'reconnecting' && status.unreachable ? 'unreachable' : status.status)
    if (!notice) return
    if (status.status === 'reconnecting') renderReconnecting(notice, status)
    else renderFailed(notice, status)
  }

  function onStatusChange(status: SseConnectionStatus) {
    if (disposed) return
    if (status.status === 'connected') {
      // restarted 是恢复提示显示期间的一次补播：升级文案并重置淡出计时器；
      // 若提示已被 dismiss 移除则忽略（可接受边界：重启提示只在恢复提示仍可见时升级）。
      if (status.restarted && !findNotice()) return
      clearTimers()
      const notice = ensureNotice('reconnected')
      if (notice) renderReconnected(notice, status.restarted === true)
      return
    }
    apply(status)
  }

  const unsubscribe = subscribeSseConnectionState(onStatusChange)
  // 初始快照忽略 connected：那是一次已结束的瞬时成功态，挂载时不应闪现。
  const initial = getSseConnectionState()
  if (initial && initial.status !== 'connected') apply(initial)

  return {
    sync: () => {
      if (disposed) return
      // 成功态提示由 dismiss 计时器自行移除；同步只处理仍在进行的
      // reconnecting/failed：消息列表被 Lit 重建后把提示重新挂回末尾。
      const current = getSseConnectionState()
      if (!current || current.status === 'connected') return
      const notice = findNotice()
      const expectedState = current.status === 'reconnecting' && current.unreachable ? 'unreachable' : current.status
      if (!notice || notice.dataset.state !== expectedState) {
        apply(current)
        return
      }
      const messageList = panel.querySelector<HTMLElement>('message-list')
      if (messageList && notice.parentElement !== messageList) messageList.append(notice)
    },
    destroy: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      removeNotice()
    },
  }
}
