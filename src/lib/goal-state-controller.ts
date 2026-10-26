import { normalizeGoalState, type GoalState } from './goal'

export type GoalAdoptionResult = { applied: boolean; changed: boolean }

export type GoalStateControllerOptions = {
  getGoal: () => GoalState | null | undefined
  setGoal: (goal: GoalState | null) => void
  notifyChanged: () => void
}

/**
 * Owns the goal-snapshot ordering rules: same-id revision monotonicity and the
 * cross-id/null watermark used by async responses. `ServerAgent` keeps the HTTP
 * actions and message/streaming guards; this collaborator decides only whether
 * an incoming goal snapshot may replace the current one.
 */
export class GoalStateController {
  private seq = 0
  private readonly options: GoalStateControllerOptions

  constructor(options: GoalStateControllerOptions) {
    this.options = options
  }

  /** Capture the current watermark before an async request. */
  capture(): { seq: number } {
    return { seq: this.seq }
  }

  /**
   * Adopt a normalized goal snapshot. A same-id older revision is rejected; a
   * cross-id/null replacement is rejected when another goal change landed after
   * the caller's capture. Only a real change advances the watermark.
   */
  adopt(next: GoalState | null, capture?: { seq: number }): GoalAdoptionResult {
    if (capture && capture.seq !== this.seq) return { applied: false, changed: false }
    const current = this.options.getGoal() ?? null
    if (next !== null && current && current.id === next.id && next.revision < current.revision) {
      return { applied: false, changed: false }
    }
    const unchanged = next === null
      ? current === null
      : Boolean(current && current.id === next.id && current.revision === next.revision)
    this.options.setGoal(next)
    if (!unchanged) this.seq++
    return { applied: true, changed: !unchanged }
  }

  /**
   * Message-version guards may reject a `/state` snapshot as too old for the
   * message list, but the goal has an independent watermark: a strictly newer
   * revision of the same goal is still authoritative. Cross-id replacements,
   * explicit nulls and equal/lower revisions stay blocked.
   */
  adoptNewerRevision(goal: GoalState | null | undefined, capture: { seq: number }): void {
    if (!goal) return
    const next = normalizeGoalState(goal)
    const current = this.options.getGoal() ?? null
    if (!next || !current || current.id !== next.id || next.revision <= current.revision) return
    const result = this.adopt(next, capture)
    if (result.changed) this.options.notifyChanged()
  }
}
