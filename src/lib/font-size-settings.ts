import type { AppStorage } from '@earendil-works/pi-web-ui'

const FONT_SIZE_SETTINGS_KEY = 'font-size-settings'
const FONT_SIZE_FORCE_14PX_MIGRATION_KEY = 'font-size-settings-force-14px-v1'

export const FONT_SIZE_RANGE = {
  min: 12,
  max: 18,
} as const

export type FontSizeSettings = {
  interfaceFontSizePx: number
  messageFontSizePx: number
}

export const DEFAULT_FONT_SIZE_SETTINGS: FontSizeSettings = {
  interfaceFontSizePx: 14,
  messageFontSizePx: 14,
}

type RawFontSizeSettings = Partial<Record<keyof FontSizeSettings, unknown>> & {
  baseFontSizePx?: unknown
  bodyFontSizePx?: unknown
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function normalizeFontSizeSettings(value: unknown): FontSizeSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_FONT_SIZE_SETTINGS }
  const settings = value as RawFontSizeSettings
  return {
    interfaceFontSizePx: clampNumber(
      settings.interfaceFontSizePx ?? settings.baseFontSizePx ?? settings.bodyFontSizePx,
      DEFAULT_FONT_SIZE_SETTINGS.interfaceFontSizePx,
      FONT_SIZE_RANGE.min,
      FONT_SIZE_RANGE.max,
    ),
    messageFontSizePx: clampNumber(
      settings.messageFontSizePx,
      DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx,
      FONT_SIZE_RANGE.min,
      FONT_SIZE_RANGE.max,
    ),
  }
}

export function applyFontSizeSettings(settings: FontSizeSettings) {
  if (typeof document === 'undefined') return
  const normalized = normalizeFontSizeSettings(settings)
  const root = document.documentElement
  root.style.fontSize = `${normalized.interfaceFontSizePx}px`
  root.style.setProperty('--text-sm', `${normalized.interfaceFontSizePx}px`)
  root.style.setProperty('--text-sm--line-height', String(20 / DEFAULT_FONT_SIZE_SETTINGS.interfaceFontSizePx))
  root.style.setProperty('--quickforge-message-font-size', `${normalized.messageFontSizePx}px`)
  root.style.setProperty('--quickforge-message-line-height', '1.625')
}

export async function loadFontSizeSettings(storage: AppStorage): Promise<FontSizeSettings> {
  const hasForced14PxMigration = await storage.settings.get<boolean>(FONT_SIZE_FORCE_14PX_MIGRATION_KEY)
  if (!hasForced14PxMigration) {
    const settings = { ...DEFAULT_FONT_SIZE_SETTINGS }
    await storage.settings.set(FONT_SIZE_SETTINGS_KEY, settings)
    await storage.settings.set(FONT_SIZE_FORCE_14PX_MIGRATION_KEY, true)
    return settings
  }

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
