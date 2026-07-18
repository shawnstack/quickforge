import { describe, expect, it } from 'vitest'
import { canApplyGeneratedTitle } from '../../server/agent-manager.mjs'

describe('session title generation guards', () => {
  it('accepts only the current fallback title generation', () => {
    const session = {
      title: 'Fallback title',
      titleSource: 'fallback',
      titleGenerationId: 2,
    }

    expect(canApplyGeneratedTitle(session, 2, 'Fallback title')).toBe(true)
    expect(canApplyGeneratedTitle(session, 1, 'Fallback title')).toBe(false)
    expect(canApplyGeneratedTitle({ ...session, title: 'Manual title', titleSource: 'manual' }, 2, 'Fallback title')).toBe(false)
    expect(canApplyGeneratedTitle({ ...session, title: 'Another fallback' }, 2, 'Fallback title')).toBe(false)
  })
})
