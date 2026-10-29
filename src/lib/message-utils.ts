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

/**
 * 回滚起点：删除该索引处的消息及其之后的所有消息。
 *
 * 回滚永远可用，不做「找不到锚点就拒绝」的限制：
 * - 点击 user 消息 → 以它自身为锚点；
 * - 点击其他角色（assistant / toolResult / 孤立轮）→ 回退到本轮开头的 user，
 *   找不到（例如报错产生的孤立轮）就以该消息自身为截断点。
 * 索引会 clamp 到有效范围（UI 窗口数组与权威消息数组可能瞬时错位），
 * 仅当会话没有任何消息或输入不是有限数时返回 -1（无操作）。
 */
export function rollbackStartIndexFromMessage(messages: AgentMessage[], messageIndex: number) {
  if (!Array.isArray(messages) || messages.length === 0) return -1

  const requested = Number(messageIndex)
  if (!Number.isFinite(requested)) return -1

  const rollbackIndex = Math.max(0, Math.min(Math.trunc(requested), messages.length - 1))
  const message = messages[rollbackIndex]
  if (!message) return -1

  if (message.role === 'user' || message.role === 'user-with-attachments') {
    return rollbackIndex
  }

  for (let index = rollbackIndex - 1; index >= 0; index--) {
    const candidate = messages[index]
    if (candidate.role === 'user' || candidate.role === 'user-with-attachments') {
      return index
    }
  }
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

/**
 * Marker prepended to the title of a forked session so the conversation list
 * makes the origin obvious. Kept language-neutral on purpose: the same prefix
 * in every UI language keeps forked sessions easy to spot and to search.
 */
export const FORK_TITLE_PREFIX = '[fork] '

export function generateTitle(messages: AgentMessage[], prefix = '') {
  const firstUser = messages.find(
    (message) => message.role === 'user' || message.role === 'user-with-attachments',
  )

  if (!firstUser || (firstUser.role !== 'user' && firstUser.role !== 'user-with-attachments')) {
    return `${prefix}New chat`
  }

  const content = firstUser.content
  const text = typeof content === 'string' ? content : textFromContentBlocks(content)

  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return `${prefix}New chat`
  // The prefix is a marker, not content: the 46-char budget still applies to the
  // message text on its own so a fork never shows less of the real question.
  return `${prefix}${normalized.length > 46 ? `${normalized.slice(0, 43)}...` : normalized}`
}

export function generateForkTitle(messages: AgentMessage[]) {
  return generateTitle(messages, FORK_TITLE_PREFIX)
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


