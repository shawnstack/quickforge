import type { AgentMessage } from '@earendil-works/pi-agent-core'

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
  return (typeof message.content === 'string' ? message.content : textFromBlocks(message.content)).trim()
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
