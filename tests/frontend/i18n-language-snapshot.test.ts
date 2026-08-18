import { afterEach, describe, expect, it, vi } from 'vitest'

// i18n.ts 运行时只从 pi-web-ui 引入 translations；用最小桩替代完整 UI bundle。
vi.mock('@earendil-works/pi-web-ui', () => ({
  translations: { en: {}, zh: {} },
}))

import { applyAppLanguageFromSnapshot, getAppLanguage } from '../../src/lib/i18n'

describe('applyAppLanguageFromSnapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
