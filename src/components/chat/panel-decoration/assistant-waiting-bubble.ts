import type { MessageWithUsage } from '../chat-utils'
import { assistantText } from '@/lib/message-utils'
import { t } from '@/lib/i18n'

type AssistantWaitingBubbleDeps = {
  panel: HTMLElement
  getMessages: () => MessageWithUsage[]
  isStreaming: () => boolean
  isActive: boolean
}

function isDisplayMessage(message: MessageWithUsage) {
  return message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant'
}

function isUserMessage(message: MessageWithUsage) {
  return message.role === 'user' || message.role === 'user-with-attachments'
}

function hasAssistantContent(message: MessageWithUsage) {
  if (message.role !== 'assistant') return false
  return assistantText(message as Parameters<typeof assistantText>[0]).trim().length > 0
}

function getPrimaryMessageList(panel: HTMLElement) {
  return panel.querySelector<HTMLElement>('message-list')
}

function getPrimaryMessageElements(panel: HTMLElement) {
  const messageList = getPrimaryMessageList(panel)
  if (!messageList) return []

  return Array.from(messageList.querySelectorAll<HTMLElement>('user-message, assistant-message'))
    .filter((element) => element.closest('message-list') === messageList)
}

const ASSISTANT_WAITING_SELECTOR = '.quickforge-assistant-waiting'

function removeAssistantWaitingBubble(panel: HTMLElement) {
  panel.querySelectorAll(ASSISTANT_WAITING_SELECTOR).forEach((element) => element.remove())
}

function assistantElementHasVisibleContent(element: HTMLElement) {
  // Check for thinking-block or tool-message that is NOT already inside a process-body
  const processElements = element.querySelectorAll('thinking-block, tool-message')
  for (const el of processElements) {
    if (!el.closest('.quickforge-process-body')) return true
  }
  // Check for markdown-block or code-block that is NOT inside a process-body
  const mdBlocks = element.querySelectorAll<HTMLElement>('markdown-block, code-block')
  for (const block of mdBlocks) {
    if (block.closest('.quickforge-process-body')) continue
    if ((block.textContent ?? '').trim().length > 0) return true
  }

  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.quickforge-message-actions').forEach((node) => node.remove())
  clone.querySelectorAll('.quickforge-process-body').forEach((node) => node.remove())
  return (clone.textContent ?? '').trim().length > 0
}

export function syncAssistantWaitingBubble(deps: AssistantWaitingBubbleDeps) {
  const { panel, getMessages, isStreaming, isActive } = deps
  const existing = panel.querySelector<HTMLElement>(ASSISTANT_WAITING_SELECTOR)

  if (!isStreaming() || !isActive) {
    removeAssistantWaitingBubble(panel)
    return false
  }

  const messageList = getPrimaryMessageList(panel)
  const messages = getMessages()
  const displayEntries = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isDisplayMessage(message))
  const lastUserDisplayIndex = (() => {
    for (let i = displayEntries.length - 1; i >= 0; i--) {
      if (isUserMessage(displayEntries[i].message)) return i
    }
    return -1
  })()

  if (!messageList || lastUserDisplayIndex < 0) {
    existing?.remove()
    return false
  }

  const lastUserEntry = displayEntries[lastUserDisplayIndex]
  const hasAssistantAfterLastUser = messages.slice(lastUserEntry.index + 1).some(hasAssistantContent)
  const messageElements = getPrimaryMessageElements(panel)
  const lastUserElement = messageElements[lastUserDisplayIndex]
  const hasVisibleAssistantAfterLastUser = messageElements
    .slice(lastUserDisplayIndex + 1)
    .some((element) => element.matches('assistant-message') && assistantElementHasVisibleContent(element))

  if (!lastUserElement || hasAssistantAfterLastUser || hasVisibleAssistantAfterLastUser) {
    existing?.remove()
    return false
  }

  const bubble = existing ?? document.createElement('div')
  bubble.className = 'quickforge-assistant-waiting'
  bubble.setAttribute('role', 'status')
  bubble.setAttribute('aria-live', 'polite')
  bubble.setAttribute('aria-label', t('assistantWaitingAriaLabel'))
  if (!existing) {
    bubble.innerHTML = `
      <div class="quickforge-assistant-waiting-dots" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `
  }

  if (bubble.previousElementSibling !== lastUserElement) lastUserElement.after(bubble)
  return true
}
