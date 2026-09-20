import { afterEach, describe, expect, it, vi } from 'vitest'


import { applyAppLanguage, applyAppLanguageFromSnapshot, getAppLanguage, getDateLocale, initializeAppLanguage, t } from '../../src/lib/i18n'
import type { AppStorage } from '../../src/storage'

function storageWithLanguage(language: unknown) {
  const values = new Map<string, unknown>([['language', language]])
  const settings = {
    get: vi.fn(async (key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => { values.set(key, value) }),
  }
  return { storage: { settings } as unknown as AppStorage, settings, values }
}

describe('local language lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    applyAppLanguageFromSnapshot('en')
  })

  it('applies a valid snapshot language locally without a reload', () => {
    applyAppLanguageFromSnapshot('en')
    expect(getAppLanguage()).toBe('en')

    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })

    applyAppLanguageFromSnapshot('zh')
    expect(getAppLanguage()).toBe('zh')
    // 快照预应用只本地生效：不整页 reload（写库由 initializeAppLanguage 的
    // 校准路径负责，本函数不接触 storage）。
    expect(reload).not.toHaveBeenCalled()
  })

  it('updates document language, direction, translation and date locale from a snapshot', () => {
    const documentElement = { lang: '', dir: 'rtl' }
    vi.stubGlobal('document', { documentElement })
    applyAppLanguageFromSnapshot('zh')
    expect(documentElement).toEqual({ lang: 'zh-CN', dir: 'ltr' })
    expect(getDateLocale()).toBe('zh-CN')
    expect(t('cancel')).toBe('取消')
    applyAppLanguageFromSnapshot('en')
    expect(documentElement).toEqual({ lang: 'en', dir: 'ltr' })
    expect(getDateLocale()).toBe('en-US')
    expect(t('cancel')).toBe('Cancel')
  })

  it('calibrates a snapshot from persisted language without rewriting valid settings', async () => {
    const { storage, settings } = storageWithLanguage('en')
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    applyAppLanguageFromSnapshot('zh')
    expect(await initializeAppLanguage(storage)).toBe('en')
    expect(settings.get).toHaveBeenCalledWith('language')
    expect(settings.set).not.toHaveBeenCalled()
    expect(getAppLanguage()).toBe('en')
    expect(reload).not.toHaveBeenCalled()
  })

  it.each([['zh-TW', 'zh'], ['de-DE', 'en']])('persists browser fallback for invalid settings (%s)', async (browserLanguage, expected) => {
    const { storage, values } = storageWithLanguage('fr')
    vi.stubGlobal('navigator', { language: browserLanguage })
    expect(await initializeAppLanguage(storage)).toBe(expected)
    expect(values.get('language')).toBe(expected)
  })

  it('persists a changed language before applying it and reloading exactly once', async () => {
    const { storage, settings, values } = storageWithLanguage('en')
    applyAppLanguageFromSnapshot('en')
    const reload = vi.fn(() => {
      expect(values.get('language')).toBe('zh')
      expect(getAppLanguage()).toBe('zh')
    })
    vi.stubGlobal('window', { location: { reload } })
    expect(await applyAppLanguage(storage, 'zh')).toBe(true)
    expect(await applyAppLanguage(storage, 'zh')).toBe(false)
    expect(settings.set).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not apply or reload when persistence fails', async () => {
    const { storage, settings } = storageWithLanguage('en')
    const reload = vi.fn()
    vi.stubGlobal('window', { location: { reload } })
    applyAppLanguageFromSnapshot('en')
    settings.set.mockRejectedValueOnce(new Error('offline'))
    await expect(applyAppLanguage(storage, 'zh')).rejects.toThrow('offline')
    expect(getAppLanguage()).toBe('en')
    expect(reload).not.toHaveBeenCalled()
  })

  it('is a no-op for invalid snapshot values', () => {
    applyAppLanguageFromSnapshot('zh')
    expect(getAppLanguage()).toBe('zh')

    applyAppLanguageFromSnapshot('fr')
    expect(getAppLanguage()).toBe('zh')
    applyAppLanguageFromSnapshot(null)
    expect(getAppLanguage()).toBe('zh')
    applyAppLanguageFromSnapshot({ language: 'en' })
    expect(getAppLanguage()).toBe('zh')
  })
})
