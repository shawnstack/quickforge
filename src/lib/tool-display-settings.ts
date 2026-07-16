import type { AppStorage } from '@earendil-works/pi-web-ui'

const TOOL_DISPLAY_SETTINGS_KEY = 'tool-display-settings'

export type ToolDisplayMode = 'compact' | 'detailed'

export type ToolDisplaySettings = {
  toolDisplayMode: ToolDisplayMode
  showContextUsage: boolean
}

export const DEFAULT_TOOL_DISPLAY_SETTINGS: ToolDisplaySettings = {
  toolDisplayMode: 'compact',
  showContextUsage: false,
}

let cachedToolDisplaySettings: ToolDisplaySettings = { ...DEFAULT_TOOL_DISPLAY_SETTINGS }

function normalizeToolDisplaySettings(value: unknown): ToolDisplaySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_TOOL_DISPLAY_SETTINGS }
  const settings = value as Partial<ToolDisplaySettings>
  return {
    toolDisplayMode: settings.toolDisplayMode === 'detailed' ? 'detailed' : 'compact',
    showContextUsage: settings.showContextUsage === true,
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
