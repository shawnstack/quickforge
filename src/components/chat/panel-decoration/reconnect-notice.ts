import { t } from '@/lib/i18n'
import {
  getSseConnectionState,
  requestSseReconnectNow,
  subscribeSseConnectionState,
  type SseConnectionStatus,
} from '@/lib/server-agent'

/**
 * Weak-network reconnect notice for the global agent SSE stream.
 *
 * Appends a lightweight centered row at the end of the message list
 * (design-mockups/reconnect-indicator.html · 方案 A) while the stream retries:
 * 「重新连接中… 8/10 · 4s 后重试」 → 「已重新连接」 (auto-dismissed) →
 * 「连接失败，已重试 10 次」+ manual retry. Idempotent across decorate
 * passes; re-appends itself when the message list is rebuilt.
 */

const RECONNECT_NOTICE_SELECTOR = '.quickforge-reconnect'
const RECONNECTED_AUTO_DISMISS_MS = 2200
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

  function ensureNotice(state: 'reconnecting' | 'reconnected' | 'failed'): HTMLElement | null {
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

  function renderReconnecting(notice: HTMLElement, status: Extract<SseConnectionStatus, { status: 'reconnecting' }>) {
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

  function renderReconnected(notice: HTMLElement) {
    notice.classList.remove('quickforge-reconnect-leaving')
    const text = document.createElement('span')
    text.className = 'quickforge-reconnect-text'
    text.textContent = t('sseReconnectedLabel')
    notice.replaceChildren(iconSpan(CHECK_SVG), text)
    dismissTimer = setTimeout(() => {
      dismissTimer = null
      dismissWithAnimation()
    }, RECONNECTED_AUTO_DISMISS_MS)
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
    const notice = ensureNotice(status.status)
    if (!notice) return
    if (status.status === 'reconnecting') renderReconnecting(notice, status)
    else renderFailed(notice, status)
  }

  function onStatusChange(status: SseConnectionStatus) {
    if (disposed) return
    if (status.status === 'connected') {
      clearTimers()
      const notice = ensureNotice('reconnected')
      if (notice) renderReconnected(notice)
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
      if (!notice || notice.dataset.state !== current.status) {
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
