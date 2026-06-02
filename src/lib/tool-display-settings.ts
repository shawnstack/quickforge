import type { AppStorage } from '@earendil-works/pi-web-ui'

const TOOL_DISPLAY_SETTINGS_KEY = 'tool-display-settings'

export type ToolDisplaySettings = {
  showToolDetails: boolean
  expandToolsByDefault: boolean
}

export const DEFAULT_TOOL_DISPLAY_SETTINGS: ToolDisplaySettings = {
  showToolDetails: false,
  expandToolsByDefault: false,
}

let cachedToolDisplaySettings: ToolDisplaySettings = { ...DEFAULT_TOOL_DISPLAY_SETTINGS }

function normalizeToolDisplaySettings(value: unknown): ToolDisplaySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_TOOL_DISPLAY_SETTINGS }
  const settings = value as Partial<ToolDisplaySettings>
  return {
    showToolDetails: settings.showToolDetails === true,
    expandToolsByDefault: settings.expandToolsByDefault === true,
  }
}

export function getCachedToolDisplaySettings(): ToolDisplaySettings {
  return cachedToolDisplaySettings
}

export async function loadToolDisplaySettings(storage: AppStorage): Promise<ToolDisplaySettings> {
  const settings = normalizeToolDisplaySettings(await storage.settings.get<unknown>(TOOL_DISPLAY_SETTINGS_KEY))
  cachedToolDisplaySettings = settings
  return settings
}

export async function saveToolDisplaySettings(storage: AppStorage, settings: ToolDisplaySettings): Promise<void> {
  const normalized = normalizeToolDisplaySettings(settings)
  await storage.settings.set(TOOL_DISPLAY_SETTINGS_KEY, normalized)
  cachedToolDisplaySettings = normalized
}
