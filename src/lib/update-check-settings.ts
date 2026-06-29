import type { AppStorage } from '@earendil-works/pi-web-ui'

const UPDATE_CHECK_SETTINGS_KEY = 'update-check-settings'

export type UpdateCheckFrequency = 'startup' | 'daily' | 'weekly' | 'off'

export type UpdateCheckSettings = {
  frequency: UpdateCheckFrequency
  /** ISO timestamp of the last successful background check. */
  lastCheckAt: string | null
  /** A version the user explicitly dismissed via "Later"; re-alert only for a newer one. */
  ignoredVersion: string | null
}

export const DEFAULT_UPDATE_CHECK_SETTINGS: UpdateCheckSettings = {
  frequency: 'startup',
  lastCheckAt: null,
  ignoredVersion: null,
}

export function normalizeUpdateCheckSettings(value: unknown): UpdateCheckSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_UPDATE_CHECK_SETTINGS }
  const settings = value as Partial<UpdateCheckSettings>
  const validFrequencies: UpdateCheckFrequency[] = ['startup', 'daily', 'weekly', 'off']
  const frequency = validFrequencies.includes(settings.frequency as UpdateCheckFrequency)
    ? (settings.frequency as UpdateCheckFrequency)
    : DEFAULT_UPDATE_CHECK_SETTINGS.frequency
  return {
    frequency,
    lastCheckAt: typeof settings.lastCheckAt === 'string' ? settings.lastCheckAt : null,
    ignoredVersion: typeof settings.ignoredVersion === 'string' ? settings.ignoredVersion : null,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Decide whether a background update check should run at startup, based on the
 * configured frequency and the timestamp of the last successful check.
 */
export function shouldCheckAtStartup(settings: UpdateCheckSettings, now = Date.now()): boolean {
  switch (settings.frequency) {
    case 'off':
      return false
    case 'startup':
      return true
    case 'daily':
    case 'weekly': {
      if (!settings.lastCheckAt) return true
      const last = Date.parse(settings.lastCheckAt)
      if (Number.isNaN(last)) return true
      const interval = settings.frequency === 'daily' ? DAY_MS : 7 * DAY_MS
      return now - last >= interval
    }
    default:
      return false
  }
}

export async function loadUpdateCheckSettings(storage: AppStorage): Promise<UpdateCheckSettings> {
  return normalizeUpdateCheckSettings(await storage.settings.get<unknown>(UPDATE_CHECK_SETTINGS_KEY))
}

export async function saveUpdateCheckSettings(storage: AppStorage, settings: UpdateCheckSettings): Promise<void> {
  await storage.settings.set(UPDATE_CHECK_SETTINGS_KEY, normalizeUpdateCheckSettings(settings))
}
