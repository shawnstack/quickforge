import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { t } from '@/lib/i18n'

// Main chat behavior prompt.
export const BASE_SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer clearly and pragmatically. If the user asks for code, prefer concise working examples. When YOLO mode is enabled, you may use the local workspace tools to inspect files, edit files, and run commands in the current project.'

async function fetchInstructions(projectId?: string): Promise<{ global: string | null; project: string | null }> {
  const url = projectId
    ? `/api/instructions?projectId=${encodeURIComponent(projectId)}`
    : '/api/instructions'
  try {
    const response = await fetch(url)
    if (!response.ok) return { global: null, project: null }
    return await response.json()
  } catch {
    return { global: null, project: null }
  }
}

export async function buildSystemPrompt(projectId?: string): Promise<string> {
  const instructions = await fetchInstructions(projectId)
  const parts = [BASE_SYSTEM_PROMPT]

  if (instructions.global) {
    parts.push(`\n<user_instructions>\n${instructions.global}\n</user_instructions>`)
  }

  if (instructions.project) {
    parts.push(`\n<project_instructions>\n${instructions.project}\n</project_instructions>`)
  }

  return parts.join('\n')
}

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

export function rollbackConversationFromMessage(messages: AgentMessage[], messageIndex: number) {
  const rollbackIndex = rollbackStartIndexFromMessage(messages, messageIndex)
  if (rollbackIndex < 0) return messages
  return messages.slice(0, rollbackIndex)
}

export function draftTextFromUserMessage(message: AgentMessage) {
  if (message.role !== 'user' && message.role !== 'user-with-attachments') return ''
  return typeof message.content === 'string'
    ? message.content
    : textFromContentBlocks(message.content, '\n\n')
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


