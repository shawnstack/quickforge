import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/i18n', () => ({
  t: (key: string) => key,
}))

import { sessionTitle } from '../../src/lib/types'

describe('session title display', () => {
  it('localizes the stored default title', () => {
    expect(sessionTitle('New chat')).toBe('newChat')
  })

  it('keeps ordinary conversations unchanged', () => {
    expect(sessionTitle('配置项目')).toBe('配置项目')
  })
})
