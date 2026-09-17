import type { AppStorage } from '@earendil-works/pi-web-ui'

export const GOAL_SETTINGS_KEY = 'goal-settings'

type GoalSettings = {
  maxIterations: number
}

export const DEFAULT_GOAL_SETTINGS: GoalSettings = {
  maxIterations: 20,
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function normalizeGoalSettings(value: unknown): GoalSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_GOAL_SETTINGS }
  const settings = value as Partial<GoalSettings>
  return {
    maxIterations: clampNumber(settings.maxIterations, DEFAULT_GOAL_SETTINGS.maxIterations, 1, 100),
  }
}

export async function loadGoalSettings(storage: AppStorage): Promise<GoalSettings> {
  return normalizeGoalSettings(await storage.settings.get<unknown>(GOAL_SETTINGS_KEY))
}

export async function saveGoalSettings(storage: AppStorage, settings: GoalSettings): Promise<void> {
  await storage.settings.set(GOAL_SETTINGS_KEY, normalizeGoalSettings(settings))
}
