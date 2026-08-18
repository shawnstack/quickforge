import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpStorageBackend } from '../../src/lib/http-storage-backend'

const reactHarness = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
}))

vi.mock('react', () => ({
  useCallback<T>(callback: T) {
    return callback
  },
  useEffect(effect: () => void | (() => void)) {
    effect()
  },
  useMemo<T>(factory: () => T) {
    return factory()
  },
  useRef<T>(initialValue: T) {
    return { current: initialValue }
  },
  useState<T>(initialValue: T | (() => T)) {
    const index = reactHarness.cursor
    reactHarness.cursor += 1
    reactHarness.states[index] = typeof initialValue === 'function'
      ? (initialValue as () => T)()
      : initialValue
    const setState = (update: T | ((previous: T) => T)) => {
      const previous = reactHarness.states[index] as T
      reactHarness.states[index] = typeof update === 'function'
        ? (update as (value: T) => T)(previous)
        : update
    }
    return [reactHarness.states[index] as T, setState] as const
  },
}))

vi.mock('@/lib/session-list-updates', () => ({
  patchSessionTitleInPage: (page: unknown) => page,
  sortSessions: <T>(sessions: T[]) => sessions,
  uniqueSessions: <T extends { id: string }>(sessions: T[]) => [...new Map(sessions.map((session) => [session.id, session])).values()],
  upsertSessionPage: (page: unknown) => page,
}))

import { useSessionPagination } from '../../src/hooks/useSessionPagination'

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('session pagination bootstrap', () => {
  beforeEach(() => {
    reactHarness.cursor = 0
    reactHarness.states = []
  })

  it('does not leave restored projects in a fake loading state before the backend is ready', async () => {
    useSessionPagination({
      backendRef: { current: null },
      expandedProjectIds: new Set(['project-1']),
      viewMode: 'project',
      sortMode: 'updatedAt',
    })

    await flushMicrotasks()

    expect(reactHarness.states[2]).toEqual({})
  })

  it('starts pinned and global initial-page requests in parallel', async () => {
    const pinned = deferred<{ values: never[]; total: number }>()
    const global = deferred<{ values: never[]; total: number }>()
    const fetchPaginatedFromIndex = vi.fn((
      _storeName: string,
      _indexName: string,
      options: { pinned?: string },
    ) => options.pinned === 'only' ? pinned.promise : global.promise)
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend

    useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(),
      viewMode: 'project',
      sortMode: 'updatedAt',
    })

    await Promise.resolve()
    expect(fetchPaginatedFromIndex).toHaveBeenCalledTimes(2)

    pinned.resolve({ values: [], total: 0 })
    global.resolve({ values: [], total: 0 })
    await flushMicrotasks()
  })

  it('loads restored project sessions once the backend is ready', async () => {
    const projectSession = {
      id: 'session-1',
      title: 'Project session',
      scope: 'project' as const,
      projectId: 'project-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-02T00:00:00.000Z',
      messageCount: 1,
    }
    const fetchPaginatedFromIndex = vi.fn(async (
      _storeName: string,
      _indexName: string,
      options: { scope?: string },
    ) => ({
      values: options.scope === 'project' ? [projectSession] : [],
      total: options.scope === 'project' ? 1 : 0,
    }))
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend

    useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(['project-1']),
      viewMode: 'project',
      sortMode: 'updatedAt',
    })

    await flushMicrotasks()

    expect(fetchPaginatedFromIndex).toHaveBeenCalledWith(
      'sessions-metadata',
      'lastModified',
      expect.objectContaining({ scope: 'project', projectId: 'project-1' }),
    )
    expect(reactHarness.states[2]).toEqual({
      'project-1': {
        items: [projectSession],
        total: 1,
        loading: false,
      },
    })
  })

  it('converges the global total to merged items when an offset page makes no progress', async () => {
    const globalSessionA = {
      id: 'session-a',
      title: 'Global session A',
      scope: 'global' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-02T00:00:00.000Z',
      messageCount: 1,
    }
    const globalSessionB = {
      id: 'session-b',
      title: 'Global session B',
      scope: 'global' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-03T00:00:00.000Z',
      messageCount: 1,
    }
    const fetchPaginatedFromIndex = vi.fn(async (
      _storeName: string,
      _indexName: string,
      options: { pinned?: string; scope?: string },
    ) => {
      if (options.pinned === 'only') return { values: [], total: 0 }
      if (options.scope === 'global') return { values: [globalSessionA, globalSessionB], total: 5 }
      return { values: [], total: 0 }
    })
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend

    const pagination = useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(),
      viewMode: 'project',
      sortMode: 'updatedAt',
    })

    await flushMicrotasks()

    await pagination.loadGlobalSessions(2)
    await flushMicrotasks()

    expect(reactHarness.states[0]).toEqual({
      items: [globalSessionA, globalSessionB],
      total: 2,
      loading: false,
    })
  })

  it('converges the project total to merged items when an offset page makes no progress', async () => {
    const projectSessionA = {
      id: 'project-session-a',
      title: 'Project session A',
      scope: 'project' as const,
      projectId: 'project-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-02T00:00:00.000Z',
      messageCount: 1,
    }
    const projectSessionB = {
      id: 'project-session-b',
      title: 'Project session B',
      scope: 'project' as const,
      projectId: 'project-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-03T00:00:00.000Z',
      messageCount: 1,
    }
    const fetchPaginatedFromIndex = vi.fn(async (
      _storeName: string,
      _indexName: string,
      options: { pinned?: string; scope?: string; projectId?: string },
    ) => {
      if (options.pinned === 'only') return { values: [], total: 0 }
      if (options.scope === 'global') return { values: [], total: 0 }
      if (options.scope === 'project' && options.projectId === 'project-1') {
        return { values: [projectSessionA, projectSessionB], total: 5 }
      }
      return { values: [], total: 0 }
    })
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend

    const pagination = useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(['project-1']),
      viewMode: 'project',
      sortMode: 'updatedAt',
    })

    await flushMicrotasks()

    await pagination.loadProjectSessions('project-1', 2)
    await flushMicrotasks()

    expect(reactHarness.states[2]).toEqual({
      'project-1': {
        items: [projectSessionA, projectSessionB],
        total: 2,
        loading: false,
      },
    })
  })
})
