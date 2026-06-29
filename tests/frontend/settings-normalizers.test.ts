import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_COMPACT_SETTINGS,
  loadAutoCompactSettings,
  normalizeAutoCompactSettings,
  saveAutoCompactSettings,
} from '../../src/lib/auto-compact-settings'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  getCurrentTheme,
  loadAppearanceSettings,
  normalizeAppearanceSettings,
  saveAppearanceSettings,
} from '../../src/lib/appearance-settings'
import {
  DEFAULT_FONT_SIZE_SETTINGS,
  loadFontSizeSettings,
  normalizeFontSizeSettings,
  saveFontSizeSettings,
} from '../../src/lib/font-size-settings'
import {
  DEFAULT_UPDATE_CHECK_SETTINGS,
  loadUpdateCheckSettings,
  normalizeUpdateCheckSettings,
  saveUpdateCheckSettings,
  shouldCheckAtStartup,
} from '../../src/lib/update-check-settings'

type FakeStorage = {
  settings: {
    get: <T>(key: string) => Promise<T | undefined>
    set: (key: string, value: unknown) => Promise<void>
  }
}

function createStorage(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  const storage: FakeStorage = {
    settings: {
      get: async <T,>(key: string) => values.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        values.set(key, value)
      },
    },
  }
  return { storage, values }
}

describe('settings normalizers', () => {
  it('normalizes auto compact settings with defaults, clamps, and booleans', () => {
    expect(normalizeAutoCompactSettings(null)).toEqual(DEFAULT_AUTO_COMPACT_SETTINGS)
    expect(normalizeAutoCompactSettings({
      enabled: true,
      thresholdPercent: 99.7,
      keepRecentTurns: 0,
      minSourceChars: Number.POSITIVE_INFINITY,
      requireConfirmation: false,
    })).toEqual({
      enabled: true,
      thresholdPercent: 95,
      keepRecentTurns: 1,
      minSourceChars: DEFAULT_AUTO_COMPACT_SETTINGS.minSourceChars,
      requireConfirmation: false,
    })
    expect(normalizeAutoCompactSettings({ thresholdPercent: 49.2, keepRecentTurns: 20.4, minSourceChars: -1 })).toMatchObject({
      thresholdPercent: 50,
      keepRecentTurns: 20,
      minSourceChars: 0,
    })
  })

  it('loads and saves normalized auto compact settings', async () => {
    const { storage, values } = createStorage({
      'auto-compact-settings': { enabled: true, thresholdPercent: 120, keepRecentTurns: 3, minSourceChars: 100, requireConfirmation: false },
    })

    await expect(loadAutoCompactSettings(storage)).resolves.toMatchObject({ thresholdPercent: 95 })
    await saveAutoCompactSettings(storage, { enabled: true, thresholdPercent: 60.8, keepRecentTurns: 4.2, minSourceChars: 12.3, requireConfirmation: true })
    expect(values.get('auto-compact-settings')).toEqual({
      enabled: true,
      thresholdPercent: 61,
      keepRecentTurns: 4,
      minSourceChars: 12,
      requireConfirmation: true,
    })
  })

  it('normalizes appearance settings and is a no-op in node without document', async () => {
    expect(normalizeAppearanceSettings(undefined)).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(normalizeAppearanceSettings({ theme: 'dark' })).toEqual({ theme: 'dark' })
    expect(normalizeAppearanceSettings({ theme: 'system' })).toEqual({ theme: 'light' })
    expect(getCurrentTheme()).toBe('light')

    const { storage, values } = createStorage({ 'appearance-settings': { theme: 'dark' } })
    await expect(loadAppearanceSettings(storage)).resolves.toEqual({ theme: 'dark' })
    await saveAppearanceSettings(storage, { theme: 'dark' })
    expect(values.get('appearance-settings')).toEqual({ theme: 'dark' })
  })

  it('normalizes font size settings with rounding and clamps', async () => {
    expect(normalizeFontSizeSettings(null)).toEqual(DEFAULT_FONT_SIZE_SETTINGS)
    expect(normalizeFontSizeSettings({ baseFontSizePx: 11, bodyFontSizePx: 20, messageFontSizePx: 16.6 })).toEqual({
      baseFontSizePx: 12,
      bodyFontSizePx: 16,
      messageFontSizePx: 17,
    })
    expect(normalizeFontSizeSettings({ baseFontSizePx: 'bad', bodyFontSizePx: 13.4, messageFontSizePx: Number.NaN })).toEqual({
      baseFontSizePx: DEFAULT_FONT_SIZE_SETTINGS.baseFontSizePx,
      bodyFontSizePx: 13,
      messageFontSizePx: DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx,
    })

    const { storage, values } = createStorage({ 'font-size-settings': { baseFontSizePx: 20 } })
    await expect(loadFontSizeSettings(storage)).resolves.toMatchObject({ baseFontSizePx: 18 })
    await saveFontSizeSettings(storage, { baseFontSizePx: 13.7, bodyFontSizePx: 11.2, messageFontSizePx: 21 })
    expect(values.get('font-size-settings')).toEqual({ baseFontSizePx: 14, bodyFontSizePx: 11, messageFontSizePx: 20 })
  })

  it('normalizes update check settings and decides startup checks', async () => {
    const now = Date.parse('2026-01-08T00:00:00.000Z')
    expect(normalizeUpdateCheckSettings(undefined)).toEqual(DEFAULT_UPDATE_CHECK_SETTINGS)
    expect(normalizeUpdateCheckSettings({ frequency: 'daily', lastCheckAt: 'x', ignoredVersion: 123 })).toEqual({
      frequency: 'daily',
      lastCheckAt: 'x',
      ignoredVersion: null,
    })
    expect(normalizeUpdateCheckSettings({ frequency: 'never' })).toEqual(DEFAULT_UPDATE_CHECK_SETTINGS)

    expect(shouldCheckAtStartup({ frequency: 'off', lastCheckAt: null, ignoredVersion: null }, now)).toBe(false)
    expect(shouldCheckAtStartup({ frequency: 'startup', lastCheckAt: null, ignoredVersion: null }, now)).toBe(true)
    expect(shouldCheckAtStartup({ frequency: 'daily', lastCheckAt: null, ignoredVersion: null }, now)).toBe(true)
    expect(shouldCheckAtStartup({ frequency: 'daily', lastCheckAt: 'invalid', ignoredVersion: null }, now)).toBe(true)
    expect(shouldCheckAtStartup({ frequency: 'daily', lastCheckAt: '2026-01-07T12:00:00.000Z', ignoredVersion: null }, now)).toBe(false)
    expect(shouldCheckAtStartup({ frequency: 'daily', lastCheckAt: '2026-01-06T23:59:59.000Z', ignoredVersion: null }, now)).toBe(true)
    expect(shouldCheckAtStartup({ frequency: 'weekly', lastCheckAt: '2026-01-02T00:00:00.000Z', ignoredVersion: null }, now)).toBe(false)
    expect(shouldCheckAtStartup({ frequency: 'weekly', lastCheckAt: '2026-01-01T00:00:00.000Z', ignoredVersion: null }, now)).toBe(true)

    const { storage, values } = createStorage({ 'update-check-settings': { frequency: 'weekly', ignoredVersion: '1.2.3' } })
    await expect(loadUpdateCheckSettings(storage)).resolves.toEqual({ frequency: 'weekly', lastCheckAt: null, ignoredVersion: '1.2.3' })
    await saveUpdateCheckSettings(storage, { frequency: 'off', lastCheckAt: '2026-01-01T00:00:00.000Z', ignoredVersion: null })
    expect(values.get('update-check-settings')).toEqual({ frequency: 'off', lastCheckAt: '2026-01-01T00:00:00.000Z', ignoredVersion: null })
  })
})
