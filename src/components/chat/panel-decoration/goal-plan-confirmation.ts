import type { GoalState } from '@/lib/goal'

export type GoalPlanCandidate = { toolCallId: string; revision: number; key: string }

/** Compatibility API: historical reports never authorize a current Goal action. */
export function currentGoalPlan(_messages: readonly unknown[], _goal: GoalState | null, _sessionId: string): GoalPlanCandidate | null {
  void [_messages, _goal, _sessionId]
  return null
}

type Deps = {
  panel: HTMLElement
  enabled: () => boolean
  getSessionId: () => string
  getGoal: () => GoalState | null
  getMessages: () => readonly unknown[]
  isStreaming: () => boolean
  onConfirm: () => Promise<unknown>
}

/** Plans start at the server's durable normal-run barrier, never from a history button. */
export function createGoalPlanConfirmationController(_deps: Deps) {
  void _deps
  return { update() {}, cleanup() {} }
}
