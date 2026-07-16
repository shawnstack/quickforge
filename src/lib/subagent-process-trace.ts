function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function subagentProcessTraceMessages(messages: unknown[]) {
  const toolCallIds = new Set<string>()
  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    message.content.forEach((chunk) => {
      if (isRecord(chunk) && chunk.type === 'toolCall' && typeof chunk.id === 'string') toolCallIds.add(chunk.id)
    })
  }

  return messages.filter((message) => (
    isRecord(message)
    && (
      message.role === 'assistant'
      || (
        message.role === 'toolResult'
        && typeof message.toolCallId === 'string'
        && toolCallIds.has(message.toolCallId)
      )
    )
  ))
}
