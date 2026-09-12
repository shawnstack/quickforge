import { readStore } from './storage.mjs'
import { GOAL_BUDGET_DEFAULTS } from './agent-goal-state.mjs'

export const GOAL_SETTINGS_KEY = 'goal-settings'

// The state-model default stays the single source: the settings fallback and
// `GOAL_BUDGET_DEFAULTS` must never drift apart.
export const DEFAULT_GOAL_SETTINGS = Object.freeze({
  maxIterations: GOAL_BUDGET_DEFAULTS.maxIterations,
})

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function normalizeGoalSettings(value) {
  if (!value || typeof value !== 'object') return { ...DEFAULT_GOAL_SETTINGS }
  return {
    maxIterations: clampNumber(value.maxIterations, DEFAULT_GOAL_SETTINGS.maxIterations, 1, 100),
  }
}

/**
 * Read before every goal creation/extension. A failing settings read must never
 * block the goal flow, so it fails open to the defaults instead of throwing.
 */
export async function readGoalSettings() {
  try {
    const settings = await readStore('settings')
    return normalizeGoalSettings(settings?.[GOAL_SETTINGS_KEY])
  } catch {
    return { ...DEFAULT_GOAL_SETTINGS }
  }
}

export async function resolveGoalMaxIterations() {
  return (await readGoalSettings()).maxIterations
}
