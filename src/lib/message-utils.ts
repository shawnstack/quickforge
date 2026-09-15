import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { t } from '@/lib/i18n'

function textFromContentBlocks(content: unknown, separator = ' ') {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } => {
      return (
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string'
      )
    })
    .map((block) => block.text)
    .join(separator)
}

export function assistantText(message: AgentMessage) {
  if (message.role !== 'assistant') return ''
  return textFromContentBlocks(message.content, '\n\n').trim()
}

export function rollbackStartIndexFromMessage(messages: AgentMessage[], messageIndex: number) {
  let rollbackIndex = messageIndex

  if (messages[messageIndex]?.role === 'assistant') {
    for (let index = messageIndex - 1; index >= 0; index--) {
      if (messages[index].role === 'user' || messages[index].role === 'user-with-attachments') {
        rollbackIndex = index
        break
      }
    }
  }

  const message = messages[rollbackIndex]
  if (!message || (message.role !== 'user' && message.role !== 'user-with-attachments')) return -1
  return rollbackIndex
}

export function draftTextFromUserMessage(message: AgentMessage) {
  if (message.role !== 'user' && message.role !== 'user-with-attachments') return ''
  return typeof message.content === 'string'
    ? message.content
    : textFromContentBlocks(message.content, '\n\n')
}

/**
 * Whether the turn started by the user message at `messageIndex` ended with an error.
 *
 * A failed turn may already have run tools: retrying it by trimming the history would
 * drop those tool calls from the model transcript, so the model would redo side
 * effects (file edits, commands) it already performed. Retrying a failed turn
 * therefore keeps the whole history and appends a continuation message, while
 * successfully completed turns are trimmed and regenerated.
 */
export function turnEndedWithError(messages: AgentMessage[], messageIndex: number) {
  for (let index = messageIndex + 1; index < messages.length; index++) {
    const message = messages[index]
    if (message.role === 'user' || message.role === 'user-with-attachments') break
    if (message.role !== 'assistant') continue
    const { stopReason, errorMessage } = message as { stopReason?: unknown; errorMessage?: unknown }
    if (stopReason === 'error' && typeof errorMessage === 'string' && errorMessage.length > 0) {
      return true
    }
  }
  return false
}

export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export function generateTitle(messages: AgentMessage[]) {
  const firstUser = messages.find(
    (message) => message.role === 'user' || message.role === 'user-with-attachments',
  )

  if (!firstUser || (firstUser.role !== 'user' && firstUser.role !== 'user-with-attachments')) {
    return 'New chat'
  }

  const content = firstUser.content
  const text = typeof content === 'string' ? content : textFromContentBlocks(content)

  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'New chat'
  return normalized.length > 46 ? `${normalized.slice(0, 43)}...` : normalized
}

export function titleNeedsGeneration(title: string) {
  return title === 'New chat' || title === t('newChat')
}

export function hasUserMessage(messages: AgentMessage[]) {
  return messages.some((message) => message.role === 'user' || message.role === 'user-with-attachments')
}

export function shouldSaveSession(messages: AgentMessage[]) {
  return hasUserMessage(messages) && messages.some((message) => message.role === 'assistant')
}


