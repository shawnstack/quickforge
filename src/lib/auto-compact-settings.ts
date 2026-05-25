import type { AppStorage } from '@mariozechner/pi-web-ui'

export const AUTO_COMPACT_SETTINGS_KEY = 'auto-compact-settings'

export type AutoCompactSettings = {
  enabled: boolean
  thresholdPercent: number
  keepRecentTurns: number
  minSourceChars: number
  requireConfirmation: boolean
}

export const DEFAULT_AUTO_COMPACT_SETTINGS: AutoCompactSettings = {
  enabled: false,
  thresholdPercent: 80,
  keepRecentTurns: 2,
  minSourceChars: 1600,
  requireConfirmation: true,
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function normalizeAutoCompactSettings(value: unknown): AutoCompactSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AUTO_COMPACT_SETTINGS }
  const settings = value as Partial<AutoCompactSettings>
  return {
    enabled: settings.enabled === true,
    thresholdPercent: clampNumber(
      settings.thresholdPercent,
      DEFAULT_AUTO_COMPACT_SETTINGS.thresholdPercent,
      50,
      95,
    ),
    keepRecentTurns: clampNumber(
      settings.keepRecentTurns,
      DEFAULT_AUTO_COMPACT_SETTINGS.keepRecentTurns,
      1,
      20,
    ),
    minSourceChars: clampNumber(
      settings.minSourceChars,
      DEFAULT_AUTO_COMPACT_SETTINGS.minSourceChars,
      0,
      200000,
    ),
    requireConfirmation: settings.requireConfirmation !== false,
  }
}

export async function loadAutoCompactSettings(storage: AppStorage): Promise<AutoCompactSettings> {
  return normalizeAutoCompactSettings(await storage.settings.get<unknown>(AUTO_COMPACT_SETTINGS_KEY))
}

export async function saveAutoCompactSettings(storage: AppStorage, settings: AutoCompactSettings): Promise<void> {
  await storage.settings.set(AUTO_COMPACT_SETTINGS_KEY, normalizeAutoCompactSettings(settings))
}
