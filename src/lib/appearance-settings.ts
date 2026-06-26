import type { AppStorage } from '@earendil-works/pi-web-ui'

const APPEARANCE_SETTINGS_KEY = 'appearance-settings'

export type AppTheme = 'light' | 'dark'

export type AppearanceSettings = {
  theme: AppTheme
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: 'light',
}

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_APPEARANCE_SETTINGS }
  const settings = value as Partial<AppearanceSettings>
  return {
    theme: settings.theme === 'dark' ? 'dark' : 'light',
  }
}

/**
 * Apply an appearance setting to the DOM.
 * Theme switching works by toggling the `dark` class on <html>: the light/dark
 * semantic tokens and `dark:` variants are already shipped by pi-web-ui's app.css.
 * `color-scheme` keeps native scrollbars and form controls in sync with the theme.
 */
export function applyAppearanceSettings(settings: AppearanceSettings) {
  if (typeof document === 'undefined') return
  const normalized = normalizeAppearanceSettings(settings)
  const root = document.documentElement
  root.classList.toggle('dark', normalized.theme === 'dark')
  root.style.setProperty('color-scheme', normalized.theme)
}

/** Read the currently active theme straight from the DOM (always in sync). */
export function getCurrentTheme(): AppTheme {
  if (typeof document === 'undefined') return DEFAULT_APPEARANCE_SETTINGS.theme
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export async function loadAppearanceSettings(storage: AppStorage): Promise<AppearanceSettings> {
  return normalizeAppearanceSettings(await storage.settings.get<unknown>(APPEARANCE_SETTINGS_KEY))
}

export async function loadAndApplyAppearanceSettings(storage: AppStorage): Promise<AppearanceSettings> {
  const settings = await loadAppearanceSettings(storage)
  applyAppearanceSettings(settings)
  return settings
}

export async function saveAppearanceSettings(storage: AppStorage, settings: AppearanceSettings): Promise<void> {
  const normalized = normalizeAppearanceSettings(settings)
  await storage.settings.set(APPEARANCE_SETTINGS_KEY, normalized)
  applyAppearanceSettings(normalized)
}
