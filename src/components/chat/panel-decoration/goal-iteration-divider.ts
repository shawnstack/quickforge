import { t } from '@/lib/i18n'

export function syncGoalIterationDivider(element: HTMLElement, details: unknown) {
  const record = details && typeof details === 'object'
    ? (details as Record<string, unknown>).quickforgeGoalIteration : null
  const marker = record && typeof record === 'object' ? record as Record<string, unknown> : null
  let divider = element.querySelector<HTMLElement>(':scope > .quickforge-goal-iteration-divider')
  if (!marker || typeof marker.goalId !== 'string' || !Number.isSafeInteger(marker.iteration) || Number(marker.iteration) < 1) {
    divider?.remove()
    return
  }
  const outcome = marker.outcome
  const label = marker.blocker === 'iteration_budget' || marker.blocker === 'duration_budget'
    ? t('goalIterationBudget')
    : outcome === 'completed' ? t('goalIterationCompleted')
      : outcome === 'running' || outcome === 'verifying' ? t('goalIterationContinue')
        : outcome === 'blocked' ? t('goalIterationBlocked')
          : outcome === 'cancelled' ? t('goalIterationCancelled')
            : outcome === 'needs_review' ? t('goalIterationReview')
              : outcome === 'error' ? t('goalIterationError') : t('goalIterationPaused')
  const text = `${t('goalIterationNumber', { count: String(marker.iteration) })} · ${label}`
  if (!divider) {
    divider = document.createElement('div')
    divider.className = 'quickforge-goal-iteration-divider'
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.setAttribute('viewBox', '0 0 24 24')
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    divider.append(icon, document.createElement('span'))
  }
  const span = divider.querySelector('span')!
  if (span.textContent !== text) span.textContent = text
  if (element.lastElementChild !== divider) element.append(divider)
}
