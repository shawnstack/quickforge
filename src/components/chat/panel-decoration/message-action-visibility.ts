import type { MessageWithUsage } from '../chat-utils'

export function assistantActionDisplayIndexes(
  messages: Array<Pick<MessageWithUsage, 'role'>>,
  isStreaming: boolean,
) {
  const indexes = new Set<number>()
  let lastAssistantIndex: number | undefined

  messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      lastAssistantIndex = index
      return
    }

    if (lastAssistantIndex !== undefined) indexes.add(lastAssistantIndex)
    lastAssistantIndex = undefined
  })

  const hasActiveAssistantTurn = isStreaming && messages[messages.length - 1]?.role === 'assistant'
  if (lastAssistantIndex !== undefined && !hasActiveAssistantTurn) indexes.add(lastAssistantIndex)

  return indexes
}
