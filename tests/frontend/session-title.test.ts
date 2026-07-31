import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/i18n', () => ({
  t: (key: string) => key,
}))

import { sessionTitle } from '../../src/lib/types'

describe('session title display', () => {
  it('prefixes channel conversations without changing the stored title', () => {
    expect(sessionTitle('配置项目', '微信')).toBe('微信 · 配置项目')
  })

  it('keeps ordinary conversations unchanged', () => {
    expect(sessionTitle('配置项目')).toBe('配置项目')
    expect(sessionTitle('配置项目', '   ')).toBe('配置项目')
  })
})
