import type { AgentMessage } from '@earendil-works/pi-agent-core'

export const TURN_NAVIGATION_MIN_TURNS = 5

export function shouldShowTurnNavigation(turnCount: number) {
  return turnCount >= TURN_NAVIGATION_MIN_TURNS
}

export type ConversationTurn = {
  messageIndex: number
  userText: string
  finalAnswerText: string
  isGenerating: boolean
}

export function isTurnUserMessage(message: AgentMessage) {
  return message.role === 'user' || message.role === 'user-with-attachments'
}

function textFromBlocks(content: unknown) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } => (
      typeof block === 'object'
      && block !== null
      && 'type' in block
      && block.type === 'text'
      && 'text' in block
      && typeof block.text === 'string'
    ))
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

function userText(message: AgentMessage) {
  if (!isTurnUserMessage(message)) return ''
  const content = message.content
  return (typeof content === 'string' ? content : textFromBlocks(content)).trim()
}

function answerText(message: AgentMessage) {
  return message.role === 'assistant' ? textFromBlocks(message.content) : ''
}

export function buildConversationTurns(messages: AgentMessage[], isStreaming: boolean): ConversationTurn[] {
  const turns: ConversationTurn[] = []

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]
    if (!isTurnUserMessage(message)) continue

    let finalAnswerText = ''
    for (let index = messageIndex + 1; index < messages.length; index++) {
      const candidate = messages[index]
      if (isTurnUserMessage(candidate)) break
      if (candidate.role === 'assistant') finalAnswerText = answerText(candidate)
    }

    turns.push({
      messageIndex,
      userText: userText(message),
      finalAnswerText,
      isGenerating: false,
    })
  }

  if (isStreaming && turns.length > 0) turns[turns.length - 1].isGenerating = true
  return turns
}

export type ConversationTurnResolver = (messages: AgentMessage[], isStreaming: boolean) => ConversationTurn[]

/**
 * One-entry cache for the turn projection.
 *
 * `turnNavigation.update()` runs on every decoration pass, but this projection
 * walks the whole conversation and extracts every user/assistant text block.
 * Its inputs only change when the message array (replaced on every write, see
 * the immutable-message contract) or the streaming flag changes, so idle and
 * streaming passes reuse the previous model instead of re-reading all text.
 *
 * Callers must treat the returned array as read-only: it is shared with the
 * cached entry.
 */
export function createConversationTurnResolver(): ConversationTurnResolver {
  let cachedMessages: AgentMessage[] | null = null
  let cachedStreaming = false
  let cachedTurns: ConversationTurn[] = []
  return (messages, isStreaming) => {
    if (cachedMessages === messages && cachedStreaming === isStreaming) return cachedTurns
    cachedMessages = messages
    cachedStreaming = isStreaming
    cachedTurns = buildConversationTurns(messages, isStreaming)
    return cachedTurns
  }
}
