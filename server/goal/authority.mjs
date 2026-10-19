/**
 * Execution-time authority for model-facing goal controls.
 *
 * Mirrors the DSH split: a direct human turn may create/edit/pause/resume; an
 * admitted goal round may complete/block. QuickForge additionally keeps
 * `goal_report` as the evidence-bearing completion path.
 */

function lastUserMessage(session) {
  const messages = session?.agent?.state?.messages
  if (!Array.isArray(messages)) return null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index]
  }
  return null
}

function messageGoalRunKind(message) {
  const metadata = message?.metadata
  if (metadata && typeof metadata === 'object' && typeof metadata.quickforgeGoalRun === 'string') {
    return metadata.quickforgeGoalRun
  }
  const details = message?.details
  if (details && typeof details === 'object' && typeof details.quickforgeGoalRun === 'string') {
    return details.quickforgeGoalRun
  }
  return null
}

/** The current turn contains a user-authored message, not a goal-round prompt. */
export function hasDirectHumanTurn(session) {
  const message = lastUserMessage(session)
  if (!message) return false
  if (messageGoalRunKind(message)) return false
  return true
}

/** The current turn is the admitted execution round of this goal. */
export function isGoalRoundTurn(session) {
  if (!session?.goalRun || session.goalRun.kind !== 'execution') return false
  return messageGoalRunKind(lastUserMessage(session)) === 'execution'
}
