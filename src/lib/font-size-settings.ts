import type { AppStorage } from '@earendil-works/pi-web-ui'

const FONT_SIZE_SETTINGS_KEY = 'font-size-settings'

export type FontSizeSettings = {
  baseFontSizePx: number
  bodyFontSizePx: number
  messageFontSizePx: number
}

export const DEFAULT_FONT_SIZE_SETTINGS: FontSizeSettings = {
  baseFontSizePx: 14,
  bodyFontSizePx: 12,
  messageFontSizePx: 16,
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function normalizeFontSizeSettings(value: unknown): FontSizeSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_FONT_SIZE_SETTINGS }
  const settings = value as Partial<FontSizeSettings>
  return {
    baseFontSizePx: clampNumber(settings.baseFontSizePx, DEFAULT_FONT_SIZE_SETTINGS.baseFontSizePx, 12, 18),
    bodyFontSizePx: clampNumber(settings.bodyFontSizePx, DEFAULT_FONT_SIZE_SETTINGS.bodyFontSizePx, 11, 16),
    messageFontSizePx: clampNumber(settings.messageFontSizePx, DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx, 13, 20),
  }
}

export function applyFontSizeSettings(settings: FontSizeSettings) {
  if (typeof document === 'undefined') return
  const normalized = normalizeFontSizeSettings(settings)
  const root = document.documentElement
  root.style.fontSize = `${normalized.baseFontSizePx}px`
  root.style.setProperty('--text-sm', `${normalized.bodyFontSizePx}px`)
  root.style.setProperty('--text-sm--line-height', String(16 / normalized.bodyFontSizePx))
  root.style.setProperty('--quickforge-message-font-size', `${normalized.messageFontSizePx}px`)
  root.style.setProperty('--quickforge-message-line-height', '1.625')
}

export async function loadFontSizeSettings(storage: AppStorage): Promise<FontSizeSettings> {
  return normalizeFontSizeSettings(await storage.settings.get<unknown>(FONT_SIZE_SETTINGS_KEY))
}

export async function loadAndApplyFontSizeSettings(storage: AppStorage): Promise<FontSizeSettings> {
  const settings = await loadFontSizeSettings(storage)
  applyFontSizeSettings(settings)
  return settings
}

export async function saveFontSizeSettings(storage: AppStorage, settings: FontSizeSettings): Promise<void> {
  const normalized = normalizeFontSizeSettings(settings)
  await storage.settings.set(FONT_SIZE_SETTINGS_KEY, normalized)
  applyFontSizeSettings(normalized)
}
