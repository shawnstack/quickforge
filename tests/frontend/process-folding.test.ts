import { describe, expect, it, vi } from 'vitest'
import { processFinishedAtFromMessages } from '../../src/components/chat/panel-decoration/process-folding'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })

describe('process folding timing', () => {
  it('restores a persisted thinking-only completion time after the panel is rebuilt', () => {
    expect(processFinishedAtFromMessages([
      { role: 'assistant', timestamp: 1_000, details: { quickforgeProcessFinishedAt: 6_000 } },
    ])).toBe(6_000)
  })

  it('accepts persisted ISO timestamps and uses the latest assistant completion', () => {
    expect(processFinishedAtFromMessages([
      { role: 'assistant', details: { quickforgeProcessFinishedAt: '2026-01-01T00:00:05.000Z' } },
      { role: 'assistant', details: { quickforgeProcessFinishedAt: '1767225610000' } },
    ])).toBe(1_767_225_610_000)
  })
})
