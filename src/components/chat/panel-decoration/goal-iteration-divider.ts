import { t } from '@/lib/i18n'

/**
 * Goal-iteration divider: the "Planning · Ready" / "Iteration 2 · Completed" rule
 * rendered at the bottom of an assistant message that belongs to a goal round.
 *
 * ## What belongs here and what does not
 *
 * Only the pure projection (marker → label + warning mark) and the icon geometry
 * live here. Rendering is React's job (`AssistantMessage` renders the divider),
 * which is why this module no longer creates or moves DOM nodes: a command-mutating
 * version had to re-assert `element.lastElementChild === divider` on every pass
 * because other decorators append to the same message root after it.
 *
 * The icon paths are returned as data rather than markup so both call sites
 * (JSX render and the equivalence tests) read the same source of truth.
 */

export type GoalIterationMarker = {
  goalId: string
  iteration: number
  kind?: 'planning' | 'execution'
  outcome?: string
  blocker?: string
}

export type GoalIterationDividerModel = {
  text: string
  /** Failed/halted rounds must not wear the successful round's checkmark. */
  warning: boolean
}

/**
 * Read the iteration marker off a message's `details`.
 *
 * Returns `null` for anything that must not render a divider — that covers the
 * "field absent", "wrong shape", "unknown kind" and "iteration out of range"
 * cases that the previous implementation guarded inline.
 */
export function readGoalIterationMarker(details: unknown): GoalIterationMarker | null {
  const record = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).quickforgeGoalIteration
    : null
  const marker = record && typeof record === 'object' && !Array.isArray(record)
    ? record as Record<string, unknown>
    : null
  if (!marker) return null
  const planning = marker.kind === 'planning'
  if (typeof marker.goalId !== 'string' || !marker.goalId.trim()) return null
  // Only `planning` / `execution` (or an omitted kind, which means execution).
  if (marker.kind !== undefined && marker.kind !== 'execution' && !planning) return null
  // Planning rounds are numbered from 0; execution rounds from 1.
  if (!Number.isSafeInteger(marker.iteration) || Number(marker.iteration) < (planning ? 0 : 1)) return null
  return {
    goalId: marker.goalId,
    iteration: Number(marker.iteration),
    kind: planning ? 'planning' : 'execution',
    outcome: typeof marker.outcome === 'string' ? marker.outcome : undefined,
    blocker: typeof marker.blocker === 'string' ? marker.blocker : undefined,
  }
}

/** Label + warning mark for a marker that already passed validation. */
export function buildGoalIterationDivider(marker: GoalIterationMarker): GoalIterationDividerModel {
  const planning = marker.kind === 'planning'
  const outcome = marker.outcome
  const label = planning
    ? outcome === 'running' ? t('goalPlanningReady')
      : outcome === 'error' ? t('goalPlanningError')
        : outcome === 'paused' ? t('goalIterationPaused')
          : outcome === 'blocked' ? t('goalIterationBlocked')
            : outcome === 'cancelled' ? t('goalIterationCancelled') : t('goalPlanningNeeded')
    : marker.blocker === 'iteration_budget' || marker.blocker === 'duration_budget'
    ? t('goalIterationBudget')
    : outcome === 'completed' ? t('goalIterationCompleted')
      : outcome === 'running' || outcome === 'verifying' ? t('goalIterationContinue')
        : outcome === 'blocked' ? t('goalIterationBlocked')
          : outcome === 'cancelled' ? t('goalIterationCancelled')
            : outcome === 'needs_review' ? t('goalIterationReview')
              : outcome === 'error' ? t('goalIterationError') : t('goalIterationPaused')
  const text = `${planning ? t('goalPlanningLabel') : t('goalIterationNumber', { count: String(marker.iteration) })} · ${label}`
  // Planning warns until it settles; execution error/blocked/cancelled read as
  // warnings. Budget pauses stay recoverable, so they keep the checkmark.
  const warning = planning
    ? outcome !== 'running'
    : outcome === 'error' || outcome === 'blocked' || outcome === 'cancelled'
  return { text, warning }
}

/** The two icon marks, as SVG path data (viewBox `0 0 24 24`). */
export function goalIterationIcon(dividing: boolean) {
  return {
    circle: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    mark: dividing
      ? '<path d="M12 7v6m0 3v1" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      : '<path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  }
}

/**
 * Render the divider into a message root.
 *
 * **This stays imperative on purpose.** The divider's host is whichever message
 * element ends the round, and that is decided *after* rendering: normally the
 * assistant row, but when a run produced no assistant message the host is the
 * round's user row (`quickforge-goal-internal-user-message`). Two different React
 * components would have to own the same node, and the ordering rule — the divider
 * must be the root's **last element child** — has to be re-asserted every pass
 * because other decorators append to the same root afterwards. Expressing that
 * from React would mean promoting the message list's sibling order into shared
 * state, which is a rewrite of the folding/decoration model, not a rendering
 * change.
 *
 * What did move out is the decision logic (`readGoalIterationMarker` +
 * `buildGoalIterationDivider`), so the label/mark rules have exactly one
 * definition and can be tested without a DOM.
 */
export function syncGoalIterationDivider(element: HTMLElement, details: unknown) {
  const marker = readGoalIterationMarker(details)
  const existing = element.querySelector<HTMLElement>(':scope > .quickforge-goal-iteration-divider')
  if (!marker) {
    existing?.remove()
    return
  }

  const { text, warning } = buildGoalIterationDivider(marker)
  const icon = goalIterationIcon(warning)
  const iconMarkup = icon.circle + icon.mark
  let divider = existing
  if (!divider) {
    divider = document.createElement('div')
    divider.className = 'quickforge-goal-iteration-divider'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    divider.append(svg, document.createElement('span'))
  }
  const svg = divider.querySelector('svg')!
  if (svg.innerHTML !== iconMarkup) svg.innerHTML = iconMarkup
  const span = divider.querySelector('span')!
  if (span.textContent !== text) span.textContent = text
  if (element.lastElementChild !== divider) element.append(divider)
}
