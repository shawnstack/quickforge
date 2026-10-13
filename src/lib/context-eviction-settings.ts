import type { AppStorage } from '@/storage'

export const CONTEXT_EVICTION_SETTINGS_KEY = 'context-eviction-settings'

type ContextEvictionSettings = {
  enabled: boolean
}

export const DEFAULT_CONTEXT_EVICTION_SETTINGS: ContextEvictionSettings = {
  enabled: false,
}

export function normalizeContextEvictionSettings(value: unknown): ContextEvictionSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CONTEXT_EVICTION_SETTINGS }
  const settings = value as Partial<ContextEvictionSettings>
  return {
    enabled: settings.enabled === true,
  }
}

export async function loadContextEvictionSettings(storage: AppStorage): Promise<ContextEvictionSettings> {
  return normalizeContextEvictionSettings(await storage.settings.get<unknown>(CONTEXT_EVICTION_SETTINGS_KEY))
}

export async function saveContextEvictionSettings(storage: AppStorage, settings: ContextEvictionSettings): Promise<void> {
  await storage.settings.set(CONTEXT_EVICTION_SETTINGS_KEY, normalizeContextEvictionSettings(settings))
}
