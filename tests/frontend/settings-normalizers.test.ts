import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_COMPACT_SETTINGS,
  loadAutoCompactSettings,
  normalizeAutoCompactSettings,
  saveAutoCompactSettings,
} from '../../src/lib/auto-compact-settings'
import {
  DEFAULT_MEMORY_SETTINGS,
  loadMemorySettings,
  normalizeMemorySettings,
  saveMemorySettings,
} from '../../src/lib/memory-settings'
import {
  DEFAULT_APPEARANCE_SETTINGS,
  getCurrentTheme,
  loadAppearanceSettings,
  normalizeAppearanceSettings,
  saveAppearanceSettings,
} from '../../src/lib/appearance-settings'
import {
  DEFAULT_FONT_SIZE_SETTINGS,
  getCodeFontMetrics,
  getTerminalFontMetrics,
  loadFontSizeSettings,
  normalizeFontSizeSettings,
  saveFontSizeSettings,
} from '../../src/lib/font-size-settings'
import {
  DEFAULT_TOOL_DISPLAY_SETTINGS,
  loadToolDisplaySettings,
  saveToolDisplaySettings,
} from '../../src/lib/tool-display-settings'
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
    expect(normalizeAutoCompactSettings({})).toMatchObject({
      enabled: true,
      requireConfirmation: true,
    })
    expect(normalizeAutoCompactSettings({ enabled: false, requireConfirmation: false })).toMatchObject({
      enabled: false,
      requireConfirmation: false,
    })
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

  it('normalizes, loads, and saves memory settings', async () => {
    expect(normalizeMemorySettings(undefined)).toEqual(DEFAULT_MEMORY_SETTINGS)
    expect(normalizeMemorySettings({})).toEqual({ enabled: true })
    expect(normalizeMemorySettings({ enabled: false })).toEqual({ enabled: false })

    const { storage, values } = createStorage({ 'memory-settings': { enabled: false } })
    await expect(loadMemorySettings(storage)).resolves.toEqual({ enabled: false })
    await saveMemorySettings(storage, { enabled: true })
    expect(values.get('memory-settings')).toEqual({ enabled: true })
  })

  it('normalizes, loads, and saves tool display settings with compact mode by default', async () => {
    const empty = createStorage()
    await expect(loadToolDisplaySettings(empty.storage)).resolves.toEqual(DEFAULT_TOOL_DISPLAY_SETTINGS)

    const legacy = createStorage({
      'tool-display-settings': { showToolDetails: true, expandToolsByDefault: true, showContextUsage: true },
    })
    await expect(loadToolDisplaySettings(legacy.storage)).resolves.toEqual({
      toolDisplayMode: 'compact',
      showContextUsage: true,
    })

    const invalid = createStorage({
      'tool-display-settings': { toolDisplayMode: 'expanded' },
    })
    await expect(loadToolDisplaySettings(invalid.storage)).resolves.toEqual(DEFAULT_TOOL_DISPLAY_SETTINGS)

    await saveToolDisplaySettings(legacy.storage, {
      toolDisplayMode: 'detailed',
      showContextUsage: true,
    })
    expect(legacy.values.get('tool-display-settings')).toEqual({
      toolDisplayMode: 'detailed',
      showContextUsage: true,
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

  it('normalizes font size settings with rounding, clamps, and legacy keys', async () => {
    expect(normalizeFontSizeSettings(null)).toEqual(DEFAULT_FONT_SIZE_SETTINGS)
    expect(normalizeFontSizeSettings({ interfaceFontSizePx: 11, messageFontSizePx: 18.6 })).toEqual({
      interfaceFontSizePx: 12,
      messageFontSizePx: 18,
    })
    expect(normalizeFontSizeSettings({ interfaceFontSizePx: 'bad', messageFontSizePx: Number.NaN })).toEqual({
      interfaceFontSizePx: DEFAULT_FONT_SIZE_SETTINGS.interfaceFontSizePx,
      messageFontSizePx: DEFAULT_FONT_SIZE_SETTINGS.messageFontSizePx,
    })
    expect(normalizeFontSizeSettings({ baseFontSizePx: 16, bodyFontSizePx: 13, messageFontSizePx: 20 })).toEqual({
      interfaceFontSizePx: 16,
      messageFontSizePx: 18,
    })
    expect(getCodeFontMetrics(14)).toEqual({ fontSize: 13, lineHeight: 20 })
    expect(getCodeFontMetrics(18)).toEqual({ fontSize: 17, lineHeight: 26 })
    expect(getTerminalFontMetrics(14)).toEqual({ fontSize: 12, lineHeight: 1.2 })
    expect(getTerminalFontMetrics(18)).toEqual({ fontSize: 16, lineHeight: 1.2 })

    const { storage, values } = createStorage({ 'font-size-settings': { baseFontSizePx: 20 } })
    await expect(loadFontSizeSettings(storage)).resolves.toEqual(DEFAULT_FONT_SIZE_SETTINGS)
    expect(values.get('font-size-settings')).toEqual(DEFAULT_FONT_SIZE_SETTINGS)
    expect(values.get('font-size-settings-force-13px-v1')).toBe(true)

    const migrated = createStorage({
      'font-size-settings-force-13px-v1': true,
      'font-size-settings': { baseFontSizePx: 20 },
    })
    await expect(loadFontSizeSettings(migrated.storage)).resolves.toMatchObject({ interfaceFontSizePx: 18 })
    await saveFontSizeSettings(migrated.storage, { interfaceFontSizePx: 13.7, messageFontSizePx: 21 })
    expect(migrated.values.get('font-size-settings')).toEqual({ interfaceFontSizePx: 14, messageFontSizePx: 18 })
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
