import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildComposerDraftKey,
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
} from '../../src/lib/composer-drafts'

function createLocalStorageMock(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, String(value))
    },
  }
}

const draftsKey = 'quickforge:composer-drafts:v1'

function readStoredDrafts() {
  const raw = globalThis.localStorage.getItem(draftsKey)
  return raw ? JSON.parse(raw) as Record<string, Record<string, unknown>> : {}
}

describe('composer drafts', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock())
  })

  it('builds stable draft keys for sessions and new chats', () => {
    expect(buildComposerDraftKey({ scope: 'global', sessionId: 'session-1' })).toBe('session:session-1')
    expect(buildComposerDraftKey({ scope: 'global', sessionId: 'pending-1' })).toBe('new:global')
    expect(buildComposerDraftKey({ scope: 'project', projectId: 'project-1' })).toBe('new:project:project-1')
    expect(buildComposerDraftKey({ scope: 'project' })).toBe('new:global')
  })

  it('loads valid drafts and ignores empty or invalid drafts', async () => {
    globalThis.localStorage.setItem(draftsKey, JSON.stringify({
      valid: { text: 'hello', updatedAt: '2026-01-01T00:00:00.000Z' },
      empty: { text: '', updatedAt: '2026-01-01T00:00:00.000Z' },
      invalid: { text: 123 },
    }))

    await expect(loadComposerDraft('valid')).resolves.toEqual({ text: 'hello', attachments: [] })
    await expect(loadComposerDraft('empty')).resolves.toBeUndefined()
    await expect(loadComposerDraft('invalid')).resolves.toBeUndefined()
    await expect(loadComposerDraft('missing')).resolves.toBeUndefined()
  })

  it('saves a non-empty project draft with context metadata', async () => {
    await saveComposerDraft(
      'new:project:project-1',
      { text: 'draft text', attachments: [] },
      { scope: 'project', projectId: 'project-1', sessionId: 'pending-1' },
    )

    const drafts = readStoredDrafts()
    expect(drafts['new:project:project-1']).toMatchObject({
      text: 'draft text',
      scope: 'project',
      projectId: 'project-1',
    })
    expect(typeof drafts['new:project:project-1'].updatedAt).toBe('string')
  })

  it('saves a real session draft with session id', async () => {
    await saveComposerDraft(
      'session:session-1',
      { text: 'resume later', attachments: [] },
      { scope: 'global', sessionId: 'session-1' },
    )

    const drafts = readStoredDrafts()
    expect(drafts['session:session-1']).toMatchObject({
      text: 'resume later',
      scope: 'global',
      sessionId: 'session-1',
    })
  })

  it('ignores invalid localStorage JSON without breaking future saves', async () => {
    globalThis.localStorage.setItem(draftsKey, '{broken')

    await expect(loadComposerDraft('missing')).resolves.toBeUndefined()
    await saveComposerDraft('new:global', { text: 'fresh draft', attachments: [] }, { scope: 'global' })

    expect(readStoredDrafts()['new:global']).toMatchObject({ text: 'fresh draft', scope: 'global' })
  })

  it('clears drafts when saving empty text and skips writes for missing keys', async () => {
    globalThis.localStorage.setItem(draftsKey, JSON.stringify({
      keep: { text: 'keep', updatedAt: '2026-01-01T00:00:00.000Z' },
      clear: { text: 'clear', updatedAt: '2026-01-01T00:00:00.000Z' },
    }))

    await saveComposerDraft('clear', { text: '', attachments: [] }, { scope: 'global' })
    expect(readStoredDrafts()).toEqual({
      keep: { text: 'keep', updatedAt: '2026-01-01T00:00:00.000Z' },
    })

    const before = globalThis.localStorage.getItem(draftsKey)
    await clearComposerDraft('missing')
    expect(globalThis.localStorage.getItem(draftsKey)).toBe(before)
  })
})
