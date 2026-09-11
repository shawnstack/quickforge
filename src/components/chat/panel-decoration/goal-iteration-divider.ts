import { t } from '@/lib/i18n'

export function syncGoalIterationDivider(element: HTMLElement, details: unknown) {
  const record = details && typeof details === 'object' && !Array.isArray(details)
    ? (details as Record<string, unknown>).quickforgeGoalIteration : null
  const marker = record && typeof record === 'object' && !Array.isArray(record) ? record as Record<string, unknown> : null
  const planning = marker?.kind === 'planning'
  let divider = element.querySelector<HTMLElement>(':scope > .quickforge-goal-iteration-divider')
  if (!marker || typeof marker.goalId !== 'string' || !marker.goalId.trim()
    || (marker.kind !== undefined && marker.kind !== 'execution' && !planning)
    || !Number.isSafeInteger(marker.iteration) || Number(marker.iteration) < (planning ? 0 : 1)) {
    divider?.remove()
    return
  }
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
  // A planning failure must not inherit the successful round's checkmark.
  const iconMarkup = '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + (planning && outcome !== 'running'
      ? '<path d="M12 7v6m0 3v1" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      : '<path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5"/>')
  if (!divider) {
    divider = document.createElement('div')
    divider.className = 'quickforge-goal-iteration-divider'
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('viewBox', '0 0 24 24')
    icon.setAttribute('aria-hidden', 'true')
    divider.append(icon, document.createElement('span'))
  }
  const icon = divider.querySelector('svg')!
  if (icon.innerHTML !== iconMarkup) icon.innerHTML = iconMarkup
  const span = divider.querySelector('span')!
  if (span.textContent !== text) span.textContent = text
  if (element.lastElementChild !== divider) element.append(divider)
}
