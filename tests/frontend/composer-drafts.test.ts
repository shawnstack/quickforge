import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildComposerDraftKey,
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
  createComposerDraftRestoreGuard,
  MAX_CONSUMED_RESTORED_DRAFT_IDS,
  rememberConsumedRestoredDraftId,
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

  it('saves and restores a references-only project draft without persisting attachments', async () => {
    const reference = { type: 'file' as const, projectId: 'project-1', path: 'src/main.ts' }
    await saveComposerDraft(
      'new:project:project-1',
      { text: '', attachments: [{ name: 'not-persisted' }], contextReferences: [reference] },
      { scope: 'project', projectId: 'project-1' },
    )

    expect(readStoredDrafts()['new:project:project-1']).toMatchObject({ text: '', contextReferences: [reference] })
    await expect(loadComposerDraft('new:project:project-1')).resolves.toEqual({ text: '', attachments: [], contextReferences: [reference] })
  })

  it('round-trips selected capabilities through localStorage without persisting attachments', async () => {
    const capability = {
      type: 'plugin' as const,
      pluginName: 'documents',
      name: 'documents',
      label: 'Documents',
      description: 'Create and edit documents',
    }
    await saveComposerDraft(
      'new:global',
      { text: 'continue', attachments: [{ name: 'not-persisted' }], selectedCapabilities: [capability] },
      { scope: 'global' },
    )

    expect(readStoredDrafts()['new:global']).toMatchObject({
      text: 'continue',
      selectedCapabilities: [capability],
    })
    expect(readStoredDrafts()['new:global']).not.toHaveProperty('attachments')
    await expect(loadComposerDraft('new:global')).resolves.toEqual({
      text: 'continue',
      attachments: [],
      selectedCapabilities: [capability],
    })
  })

  it('filters invalid and duplicate persisted capabilities and limits restoration to four', async () => {
    const valid = (name: string) => ({
      type: 'plugin',
      pluginName: name,
      name,
      label: name.toUpperCase(),
      description: `${name} description`,
      mention: `@${name}`,
      ignored: true,
    })
    globalThis.localStorage.setItem(draftsKey, JSON.stringify({
      capabilities: {
        text: '',
        updatedAt: '2026-01-01T00:00:00.000Z',
        selectedCapabilities: [
          valid('one'),
          { ...valid('one'), label: 'duplicate' },
          { ...valid('two'), type: 'invalid' },
          { ...valid('three'), pluginName: 123 },
          { ...valid('four'), description: 123 },
          { ...valid('five'), mention: 123 },
          valid('two'),
          { ...valid('three'), type: 'skill' },
          { ...valid('four'), type: 'tool' },
          { ...valid('five'), type: 'command' },
        ],
      },
    }))

    await expect(loadComposerDraft('capabilities')).resolves.toEqual({
      text: '',
      attachments: [],
      selectedCapabilities: [
        { type: 'plugin', pluginName: 'one', name: 'one', label: 'ONE', description: 'one description', mention: '@one' },
        { type: 'plugin', pluginName: 'two', name: 'two', label: 'TWO', description: 'two description', mention: '@two' },
        { type: 'skill', pluginName: 'three', name: 'three', label: 'THREE', description: 'three description', mention: '@three' },
        { type: 'tool', pluginName: 'four', name: 'four', label: 'FOUR', description: 'four description', mention: '@four' },
      ],
    })
  })

  it('keeps a capabilities-only draft and removes it once saved empty', async () => {
    const capability = { type: 'plugin' as const, pluginName: 'documents', name: 'documents', label: 'Documents' }
    await saveComposerDraft(
      'new:global',
      { text: '', attachments: [], selectedCapabilities: [capability] },
      { scope: 'global' },
    )

    expect(readStoredDrafts()['new:global']).toMatchObject({ text: '', selectedCapabilities: [capability] })
    await expect(loadComposerDraft('new:global')).resolves.toEqual({
      text: '',
      attachments: [],
      selectedCapabilities: [capability],
    })

    await saveComposerDraft('new:global', { text: '', attachments: [] }, { scope: 'global' })
    expect(globalThis.localStorage.getItem(draftsKey)).toBeNull()
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

  it('bounds consumed restored draft ids while keeping the newest ids', () => {
    const consumedIds = new Set<number>()
    for (let id = 1; id <= MAX_CONSUMED_RESTORED_DRAFT_IDS + 2; id += 1) {
      rememberConsumedRestoredDraftId(consumedIds, id)
    }

    expect(consumedIds.size).toBe(MAX_CONSUMED_RESTORED_DRAFT_IDS)
    expect(consumedIds.has(1)).toBe(false)
    expect(consumedIds.has(2)).toBe(false)
    expect(consumedIds.has(MAX_CONSUMED_RESTORED_DRAFT_IDS + 2)).toBe(true)

    rememberConsumedRestoredDraftId(consumedIds, 3)
    expect(consumedIds.size).toBe(MAX_CONSUMED_RESTORED_DRAFT_IDS)
    expect([...consumedIds].at(-1)).toBe(3)
  })

  it('invalidates stale async draft restores after a send clears the composer', () => {
    const guard = createComposerDraftRestoreGuard()
    const restoreVersion = guard.version()

    guard.invalidate()

    expect(guard.isCurrent(restoreVersion)).toBe(false)
    expect(guard.isCurrent(guard.version())).toBe(true)
  })
})
