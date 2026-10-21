import type { MessageWithUsage } from '../chat-utils'
import { replaceSvg } from '../chat-utils'
import { assistantText, copyTextToClipboard, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import { escapeHtml } from './html'
import { copiedIcon, copyIcon } from './icons'
import { readMessageRows } from './message-rows'

type ContextCompactionNoticeDeps = {
  panel: HTMLElement
  getMessages: () => MessageWithUsage[]
  getContextCompaction: () => { summaryMessage?: unknown; compactedUpToIndex?: number } | null | undefined
  messageIndexOffset?: number
  /** 同一装饰 pass 内已枚举好的消息行（省去重复全表扫描）。 */
  messageRows?: HTMLElement[]
}

function showCopiedFeedback(button: HTMLButtonElement, defaultTitle: string, defaultIcon: string) {
  const copiedTitle = t('copied')
  const previousTimer = Number(button.dataset.quickforgeCopyFeedbackTimer)
  if (previousTimer) window.clearTimeout(previousTimer)

  replaceSvg(button, copiedIcon)
  button.title = copiedTitle
  button.setAttribute('aria-label', copiedTitle)
  button.style.color = 'rgb(5 150 105)'

  const timer = window.setTimeout(() => {
    replaceSvg(button, defaultIcon)
    button.title = defaultTitle
    button.setAttribute('aria-label', defaultTitle)
    button.style.color = ''
    delete button.dataset.quickforgeCopyFeedbackTimer
  }, 1200)
  button.dataset.quickforgeCopyFeedbackTimer = String(timer)
}

function isDisplayMessage(message: MessageWithUsage) {
  return message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant'
}

function insertNoticeAtBoundary(
  panel: HTMLElement,
  messages: MessageWithUsage[],
  boundaryIndex: number,
  notice: HTMLElement,
  rows?: HTMLElement[],
) {
  const messageList = panel.querySelector('.qf-message-list')
  // `rows` lets one decoration pass share a single enumeration across every
  // decorator instead of each re-scanning the whole list.
  const messageElements = rows ?? readMessageRows(panel)

  // 边界之前的可见消息数量就是横线要插入的行位置：边界落在 toolResult 等不单独
  // 渲染的消息上时，自然插到它之后的下一条可见消息之前。
  let displayIndex = 0
  for (let index = 0; index < messages.length && index < boundaryIndex; index++) {
    if (isDisplayMessage(messages[index])) displayIndex += 1
  }

  const target = messageElements[displayIndex]
  if (target) {
    if (notice.nextElementSibling !== target) target.before(notice)
    return
  }

  // 边界在已渲染的末尾之后（整段历史都被压缩、压缩覆盖到最新一轮）：横线跟在最后
  // 一条消息之后，而不是被挂到列表最顶部。
  const lastElement = messageElements[messageElements.length - 1]
  if (lastElement) {
    if (lastElement.nextElementSibling !== notice) lastElement.after(notice)
    return
  }
  if (messageList && messageList.lastElementChild !== notice) messageList.append(notice)
}

function compactSummaryText(summaryMessage: unknown) {
  const message = summaryMessage as MessageWithUsage | undefined
  const rawText = message?.role === 'assistant'
    ? assistantText(message as Parameters<typeof assistantText>[0])
    : draftTextFromUserMessage(message as Parameters<typeof draftTextFromUserMessage>[0])
  const match = rawText.match(/<compact_summary>\s*([\s\S]*?)\s*<\/compact_summary>/i)
  return (match?.[1] ?? rawText).trim()
}

function syncCompactionSummaryHandlers(notice: HTMLElement, summaryText: string, initialOpen = false) {
  const details = notice.querySelector<HTMLDetailsElement>('.quickforge-context-compaction-details')
  const summary = notice.querySelector<HTMLElement>('.quickforge-context-compaction-summary')
  const toggleLabel = notice.querySelector<HTMLElement>('.quickforge-context-compaction-toggle-label')
  const copyButton = notice.querySelector<HTMLButtonElement>('[data-quickforge-action="copy-compact-summary"]')
  if (details) details.open = initialOpen
  const syncToggleLabel = () => {
    if (toggleLabel && details) toggleLabel.textContent = details.open ? t('contextCompactedHideSummary') : t('contextCompactedViewSummary')
  }
  if (summary && !summary.dataset.quickforgeCompactionBound) {
    summary.dataset.quickforgeCompactionBound = 'true'
    summary.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!details) return
      details.open = !details.open
      syncToggleLabel()
    })
  }
  if (details && !details.dataset.quickforgeCompactionBound) {
    details.dataset.quickforgeCompactionBound = 'true'
    details.addEventListener('toggle', syncToggleLabel)
  }
  syncToggleLabel()
  if (copyButton) {
    copyButton.onclick = async (event) => {
      event.preventDefault()
      event.stopPropagation()
      await copyTextToClipboard(summaryText)
      showCopiedFeedback(copyButton, t('contextCompactedCopySummary'), copyIcon)
    }
  }
}

export function syncContextCompactionNotice(deps: ContextCompactionNoticeDeps) {
  const { panel, getMessages, getContextCompaction, messageIndexOffset = 0, messageRows } = deps
  const compaction = getContextCompaction()
  const messages = getMessages()
  const existing = panel.querySelector<HTMLElement>('.quickforge-context-compaction-notice')

  if (!compaction || messages.length === 0) {
    existing?.remove()
    return
  }

  const compactedUpToIndex = Math.max(0, Number(compaction.compactedUpToIndex) || 0)
  const windowEnd = messageIndexOffset + messages.length
  // 横线标在「被压缩历史的末尾」：位置由服务端 compactedUpToIndex 直接决定，不再回溯到
  // 用户回合，否则压缩覆盖到最新一轮时横线会跑到最后一轮提问上方（用户看到的不是压缩
  // 结束处）。边界恰好等于窗口末尾（压缩覆盖到最新一轮）时照常渲染，横线跟在最后一条
  // 已渲染消息之后——压缩完成（auto_compact_completed / messages_replaced 后 decorate）
  // 即可看到。严格越过窗口末尾只可能来自陈旧状态（回滚后消息变短），保持隐藏。
  if (compactedUpToIndex <= 0 || compactedUpToIndex > windowEnd) {
    existing?.remove()
    return
  }
  const boundaryIndex = Math.max(0, compactedUpToIndex - messageIndexOffset)

  const summaryText = compaction.summaryMessage ? compactSummaryText(compaction.summaryMessage) : ''
  const initialOpen = existing?.querySelector<HTMLDetailsElement>('.quickforge-context-compaction-details')?.open ?? false
  const notice = existing ?? document.createElement('div')
  const previousSummaryText = notice.dataset.summaryText ?? ''
  const previousHasSummary = notice.dataset.hasSummary === 'true'
  const shouldRender = !existing || previousSummaryText !== summaryText || previousHasSummary !== Boolean(summaryText)
  notice.className = 'quickforge-context-compaction-notice'
  notice.dataset.boundaryIndex = String(boundaryIndex)
  notice.dataset.summaryText = summaryText
  notice.dataset.hasSummary = String(Boolean(summaryText))
  notice.title = t('contextCompactedTooltip')
  notice.setAttribute('aria-label', t('contextCompactedTooltip'))
  if (shouldRender) {
    notice.innerHTML = summaryText ? `
      <details class="quickforge-context-compaction-details">
        <summary class="quickforge-context-compaction-summary">
          <div class="quickforge-context-compaction-line"></div>
          <div class="quickforge-context-compaction-pill">
            <span class="quickforge-context-compaction-dot" aria-hidden="true"></span>
            <span><strong>${escapeHtml(t('contextCompactedLabel'))}</strong> · ${escapeHtml(t('contextCompactedTimelineLabel'))} · <span class="quickforge-context-compaction-toggle-label"></span></span>
          </div>
          <div class="quickforge-context-compaction-line"></div>
        </summary>
        <div class="quickforge-context-compaction-card">
          <div class="quickforge-context-compaction-card-header">
            <span>${escapeHtml(t('contextCompactedSummaryTitle'))}</span>
            <button type="button" class="quickforge-context-compaction-copy" data-quickforge-action="copy-compact-summary">${copyIcon}<span>${escapeHtml(t('contextCompactedCopySummary'))}</span></button>
          </div>
          <pre class="quickforge-context-compaction-text">${escapeHtml(summaryText)}</pre>
        </div>
      </details>
    ` : `
      <div class="quickforge-context-compaction-summary" role="separator">
        <div class="quickforge-context-compaction-line"></div>
        <div class="quickforge-context-compaction-pill">
          <span class="quickforge-context-compaction-dot" aria-hidden="true"></span>
          <span><strong>${escapeHtml(t('contextCompactedLabel'))}</strong> · ${escapeHtml(t('contextCompactedTimelineLabel'))}</span>
        </div>
        <div class="quickforge-context-compaction-line"></div>
      </div>
    `
  }
  if (summaryText) syncCompactionSummaryHandlers(notice, summaryText, initialOpen)

  insertNoticeAtBoundary(panel, messages, boundaryIndex, notice, messageRows)
}
