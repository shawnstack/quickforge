import { t } from '@/lib/i18n'

/**
 * Model stream retry notice (companion to reconnect-notice).
 *
 * 服务端检测到模型上游流静默超时并内部重建流时，经 `model_stream_retry`
 * SSE 事件上报进度；本 controller 在消息流末尾显示居中轻量行
 * 「模型连接重试中… n/10」，新流的增量（message_update）或回合终止事件
 * 到达即移除。有已产出内容时重试会从零重放，本提示向用户解释文字
 * 被重写的原因。
 */

const MODEL_RETRY_NOTICE_SELECTOR = '.quickforge-model-retry'
const LEAVE_ANIMATION_MS = 340

const SPINNER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/></svg>'

export type ModelRetryNoticeController = {
  /** 显示/更新重试进度（attempt 从 1 开始）。 */
  show: (attempt: number, maxAttempts: number) => void
  /** 移除提示（流恢复出字、回合结束或失败）。 */
  hide: () => void
  /** Re-assert placement; call from the decorate pass. */
  sync: () => void
  destroy: () => void
}

export function createModelRetryNoticeController(deps: { panel: HTMLElement }): ModelRetryNoticeController {
  const { panel } = deps
  let leaveTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let lastInfo: { attempt: number; maxAttempts: number } | null = null

  function findNotice(): HTMLElement | null {
    return panel.querySelector<HTMLElement>(MODEL_RETRY_NOTICE_SELECTOR)
  }

  function ensureNotice(): HTMLElement | null {
    const messageList = panel.querySelector<HTMLElement>('message-list')
    if (!messageList) return null

    let notice = findNotice()
    if (!notice) {
      notice = document.createElement('div')
      notice.className = 'quickforge-model-retry'
      notice.setAttribute('role', 'status')
      notice.setAttribute('aria-live', 'polite')
    }
    if (notice.parentElement !== messageList) messageList.append(notice)
    return notice
  }

  function clearLeaveTimer() {
    if (leaveTimer !== null) {
      clearTimeout(leaveTimer)
      leaveTimer = null
    }
  }

  function render(notice: HTMLElement, attempt: number, maxAttempts: number) {
    notice.classList.remove('quickforge-model-retry-leaving')
    const icon = document.createElement('span')
    icon.className = 'quickforge-reconnect-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = SPINNER_SVG

    const text = document.createElement('span')
    text.className = 'quickforge-reconnect-text'
    text.textContent = `${t('modelStreamRetryingLabel')} `
    const count = document.createElement('span')
    count.className = 'quickforge-reconnect-count'
    count.textContent = `${attempt}/${maxAttempts}`
    text.append(count)

    notice.replaceChildren(icon, text)
  }

  return {
    show: (attempt, maxAttempts) => {
      if (disposed || !Number.isFinite(attempt) || !Number.isFinite(maxAttempts)) return
      clearLeaveTimer()
      lastInfo = { attempt, maxAttempts }
      const notice = ensureNotice()
      if (notice) render(notice, attempt, maxAttempts)
    },
    hide: () => {
      if (disposed) return
      lastInfo = null
      const notice = findNotice()
      if (!notice) return
      notice.classList.add('quickforge-model-retry-leaving')
      leaveTimer = setTimeout(() => {
        leaveTimer = null
        findNotice()?.remove()
      }, LEAVE_ANIMATION_MS)
    },
    sync: () => {
      if (disposed || !lastInfo) return
      const notice = findNotice()
      if (!notice) {
        const next = ensureNotice()
        if (next) render(next, lastInfo.attempt, lastInfo.maxAttempts)
        return
      }
      const messageList = panel.querySelector<HTMLElement>('message-list')
      if (messageList && notice.parentElement !== messageList) messageList.append(notice)
    },
    destroy: () => {
      if (disposed) return
      disposed = true
      clearLeaveTimer()
      findNotice()?.remove()
    },
  }
}
