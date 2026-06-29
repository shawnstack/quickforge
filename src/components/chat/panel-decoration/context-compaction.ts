import type { MessageWithUsage } from '../chat-utils'
import { replaceSvg } from '../chat-utils'
import { assistantText, copyTextToClipboard, draftTextFromUserMessage } from '@/lib/message-utils'
import { t } from '@/lib/i18n'
import { escapeHtml } from './html'
import { copiedIcon, copyIcon } from './icons'

type ContextCompactionNoticeDeps = {
  panel: HTMLElement
  getMessages: () => MessageWithUsage[]
  getContextCompaction: () => { summaryMessage?: unknown; compactedUpToIndex?: number } | null | undefined
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

function getPrimaryMessageElements(panel: HTMLElement) {
  const messageList = panel.querySelector<HTMLElement>('message-list')
  if (!messageList) return []

  return Array.from(messageList.querySelectorAll<HTMLElement>('user-message, assistant-message'))
    .filter((element) => element.closest('message-list') === messageList)
}

function insertBeforeMessageElement(panel: HTMLElement, messages: MessageWithUsage[], messageIndex: number, notice: HTMLElement) {
  const messageElements = getPrimaryMessageElements(panel)
  let displayIndex = 0
  for (let index = 0; index < messages.length; index++) {
    if (!isDisplayMessage(messages[index])) continue
    if (index === messageIndex) {
      const target = messageElements[displayIndex]
      if (target) {
        if (notice.nextElementSibling !== target) target.before(notice)
        return
      }
      break
    }
    displayIndex += 1
  }

  const messageList = panel.querySelector('message-list')
  if (messageList && messageList.firstElementChild !== notice) messageList.prepend(notice)
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
  const { panel, getMessages, getContextCompaction } = deps
  const compaction = getContextCompaction()
  const messages = getMessages()
  const existing = panel.querySelector<HTMLElement>('.quickforge-context-compaction-notice')

  if (!compaction || messages.length === 0) {
    existing?.remove()
    return
  }

  const tailStart = Math.min(messages.length, Math.max(0, Number(compaction.compactedUpToIndex) || 0))
  if (tailStart <= 0) {
    existing?.remove()
    return
  }

  const summaryText = compaction.summaryMessage ? compactSummaryText(compaction.summaryMessage) : ''
  const initialOpen = existing?.querySelector<HTMLDetailsElement>('.quickforge-context-compaction-details')?.open ?? false
  const notice = existing ?? document.createElement('div')
  const previousSummaryText = notice.dataset.summaryText ?? ''
  const previousHasSummary = notice.dataset.hasSummary === 'true'
  const shouldRender = !existing || previousSummaryText !== summaryText || previousHasSummary !== Boolean(summaryText)
  notice.className = 'quickforge-context-compaction-notice'
  notice.dataset.tailStart = String(tailStart)
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

  insertBeforeMessageElement(panel, messages, tailStart, notice)
}
