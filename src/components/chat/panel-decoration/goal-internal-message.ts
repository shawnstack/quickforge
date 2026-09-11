/** Presentation only: keep internal turns in history, model context and DOM ordering. */
export function isGoalInternalUserMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false
  const record = message as Record<string, unknown>
  if (record.role !== 'user') return false
  const metadata = record.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const kind = (metadata as Record<string, unknown>).quickforgeGoalRun
  return kind === 'execution' || kind === 'planning'
}

export function syncGoalInternalMessage(element: HTMLElement, message: unknown): boolean {
  const internal = isGoalInternalUserMessage(message)
  element.classList.toggle('quickforge-goal-internal-user-message', internal)
  return internal
}
