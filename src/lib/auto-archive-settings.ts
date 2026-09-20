import type { AppStorage } from '@/storage'

export const AUTO_ARCHIVE_SETTINGS_KEY = 'auto-archive-settings'

type AutoArchiveSettings = {
  enabled: boolean
}

export const DEFAULT_AUTO_ARCHIVE_SETTINGS: AutoArchiveSettings = {
  enabled: false,
}

export function normalizeAutoArchiveSettings(value: unknown): AutoArchiveSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AUTO_ARCHIVE_SETTINGS }
  return { enabled: (value as Partial<AutoArchiveSettings>).enabled === true }
}

export async function loadAutoArchiveSettings(storage: AppStorage): Promise<AutoArchiveSettings> {
  return normalizeAutoArchiveSettings(await storage.settings.get<unknown>(AUTO_ARCHIVE_SETTINGS_KEY))
}

export async function saveAutoArchiveSettings(storage: AppStorage, settings: AutoArchiveSettings): Promise<void> {
  await storage.settings.set(AUTO_ARCHIVE_SETTINGS_KEY, normalizeAutoArchiveSettings(settings))
}
