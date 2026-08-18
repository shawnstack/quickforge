import { describe, expect, it } from 'vitest'
import type { QuickForgeSessionMetadata } from '../../src/lib/types'
import { patchSessionTitleInPage, removeSessionFromPage, upsertSessionPage } from '../../src/lib/session-list-updates'

const baseSession: QuickForgeSessionMetadata = {
  id: 'session-1',
  title: 'Fallback title',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-02T00:00:00.000Z',
  messageCount: 1,
}

describe('session pagination local updates', () => {
  it('inserts a new session once and keeps the configured order', () => {
    const page = {
      items: [{ ...baseSession, id: 'older', lastModified: '2026-01-01T00:00:00.000Z' }],
      total: 1,
      loading: false,
    }

    const inserted = upsertSessionPage(page, baseSession, 'updatedAt')
    const repeated = upsertSessionPage(inserted, { ...baseSession, title: 'Updated fallback' }, 'updatedAt')

    expect(inserted.items.map((session) => session.id)).toEqual(['session-1', 'older'])
    expect(repeated.total).toBe(2)
    expect(repeated.items.filter((session) => session.id === 'session-1')).toHaveLength(1)
    expect(repeated.items[0].title).toBe('Updated fallback')
  })

  it('patches only the title without changing order or timestamps', () => {
    const page = {
      items: [baseSession, { ...baseSession, id: 'session-2', title: 'Second' }],
      total: 2,
      loading: false,
    }

    const patched = patchSessionTitleInPage(page, 'session-1', 'AI title')

    expect(patched.items.map((session) => session.id)).toEqual(['session-1', 'session-2'])
    expect(patched.items[0]).toEqual({ ...baseSession, title: 'AI title' })
    expect(patched.items[1]).toBe(page.items[1])
  })

  it('removes an existing session and decrements the total', () => {
    const page = {
      items: [baseSession, { ...baseSession, id: 'session-2', title: 'Second' }],
      total: 2,
      loading: false,
    }

    const removed = removeSessionFromPage(page, 'session-1')

    expect(removed.items.map((session) => session.id)).toEqual(['session-2'])
    expect(removed.total).toBe(1)
    expect(removed.items[0]).toBe(page.items[1])
  })

  it('returns the same page reference when removing a missing session', () => {
    const page = {
      items: [baseSession],
      total: 1,
      loading: false,
    }

    expect(removeSessionFromPage(page, 'missing-session')).toBe(page)
  })
})
