import type { AppStorage } from '@earendil-works/pi-web-ui'

const FONT_SIZE_SETTINGS_KEY = 'font-size-settings'
const FONT_SIZE_FORCE_13PX_MIGRATION_KEY = 'font-size-settings-force-13px-v1'

export const FONT_SIZE_RANGE = {
  min: 12,
  max: 18,
} as const

export type FontSizeSettings = {
  interfaceFontSizePx: number
  messageFontSizePx: number
}

export const DEFAULT_FONT_SIZE_SETTINGS: FontSizeSettings = {
  interfaceFontSizePx: 13,
  messageFontSizePx: 13,
}

export const FONT_SIZE_SETTINGS_CHANGED_EVENT = 'quickforge:font-size-settings-changed'

export type FixedFontMetrics = {
  fontSize: number
  lineHeight: number
}

function interfaceFontSizeFromDocument() {
  if (typeof document === 'undefined') return DEFAULT_FONT_SIZE_SETTINGS.interfaceFontSizePx
  const parsed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(parsed) ? parsed : DEFAULT_FONT_SIZE_SETTINGS.interfaceFontSizePx
}

export function getCodeFontMetrics(interfaceFontSizePx = interfaceFontSizeFromDocument()): FixedFontMetrics {
  const fontSize = clampNumber(interfaceFontSizePx - 1, 13, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)
  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.54),
  }
}

export function getTerminalFontMetrics(interfaceFontSizePx = interfaceFontSizeFromDocument()): FixedFontMetrics {
  return {
    fontSize: clampNumber(interfaceFontSizePx - 2, 12, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
    lineHeight: 1.2,
  }
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
  // The interface font size drives the root font-size, so every rem-based token
  // (including `--text-sm: 1rem`) scales automatically — no per-token overrides needed.
  root.style.fontSize = `${normalized.interfaceFontSizePx}px`
  root.style.setProperty('--quickforge-message-font-size', `${normalized.messageFontSizePx}px`)
  root.style.setProperty('--quickforge-message-line-height', '1.625')
  window.dispatchEvent(new CustomEvent(FONT_SIZE_SETTINGS_CHANGED_EVENT, { detail: normalized }))
}

export async function loadFontSizeSettings(storage: AppStorage): Promise<FontSizeSettings> {
  const hasForced13PxMigration = await storage.settings.get<boolean>(FONT_SIZE_FORCE_13PX_MIGRATION_KEY)
  if (!hasForced13PxMigration) {
    const settings = { ...DEFAULT_FONT_SIZE_SETTINGS }
    await storage.settings.set(FONT_SIZE_SETTINGS_KEY, settings)
    await storage.settings.set(FONT_SIZE_FORCE_13PX_MIGRATION_KEY, true)
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
