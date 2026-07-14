import type { AppStorage } from '@earendil-works/pi-web-ui'

export const MEMORY_SETTINGS_KEY = 'memory-settings'

export type MemorySettings = {
  enabled: boolean
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
}

export function normalizeMemorySettings(value: unknown): MemorySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_MEMORY_SETTINGS }
  const settings = value as Partial<MemorySettings>
  return { enabled: settings.enabled !== false }
}

export async function loadMemorySettings(storage: AppStorage): Promise<MemorySettings> {
  return normalizeMemorySettings(await storage.settings.get<unknown>(MEMORY_SETTINGS_KEY))
}

export async function saveMemorySettings(storage: AppStorage, settings: MemorySettings): Promise<void> {
  await storage.settings.set(MEMORY_SETTINGS_KEY, normalizeMemorySettings(settings))
}
