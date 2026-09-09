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
  removeSessionFromPage: (page: unknown) => page,
  sortSessions: <T>(sessions: T[]) => sessions,
  uniqueSessions: <T extends { id: string }>(sessions: T[]) => [...new Map(sessions.map((session) => [session.id, session])).values()],
  upsertSessionPage: (page: unknown) => page,
}))

import { REFRESH_SESSIONS_MERGE_MS, useSessionPagination } from '../../src/hooks/useSessionPagination'

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function session(id: string, scope: 'global' | 'project' = 'global', projectId?: string) {
  return {
    id,
    title: id,
    scope,
    projectId,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-02T00:00:00.000Z',
    messageCount: 1,
  }
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
    // 置顶列表仍以 pinned=only 拉取；全局/项目/时间线列表以 pinned=exclude 过滤置顶会话
    const requestedPinnedValues = fetchPaginatedFromIndex.mock.calls.map((call) => (call[2] as { pinned?: string }).pinned)
    expect(requestedPinnedValues.filter((pinned) => pinned === 'only')).toHaveLength(1)
    expect(requestedPinnedValues.filter((pinned) => pinned === 'exclude')).toHaveLength(1)

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
      expect.objectContaining({ scope: 'project', projectId: 'project-1', pinned: 'exclude' }),
    )
    expect(reactHarness.states[2]).toEqual({
      'project-1': {
        items: [projectSession],
        total: 1,
        loading: false,
        appending: false,
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
      appending: false,
    })
  })

  it('reports global load-more success only when new items arrive and deduplicates pending calls', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => session(`global-${index}`))
    const nextPage = [session('global-20')]
    const pending = deferred<{ values: ReturnType<typeof session>[]; total: number }>()
    const fetchPaginatedFromIndex = vi.fn((
      _storeName: string,
      _indexName: string,
      options: { pinned?: string; scope?: string; offset?: number },
    ) => {
      if (options.pinned === 'only') return Promise.resolve({ values: [], total: 0 })
      if (options.scope === 'global' && options.offset === 0) return Promise.resolve({ values: firstPage, total: 21 })
      if (options.scope === 'global' && options.offset === 20) return pending.promise
      return Promise.resolve({ values: [], total: 0 })
    })
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend
    const pagination = useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(),
      viewMode: 'project',
      sortMode: 'updatedAt',
    })
    await flushMicrotasks()

    const first = pagination.loadMoreGlobal()
    const second = pagination.loadMoreGlobal()
    await expect(second).resolves.toBe(false)
    expect(fetchPaginatedFromIndex.mock.calls.filter((call) => {
      const options = call[2] as { scope?: string; offset?: number }
      return options.scope === 'global' && options.offset === 20
    })).toHaveLength(1)

    pending.resolve({ values: nextPage, total: 21 })
    await expect(first).resolves.toBe(true)
  })

  it('reports load-more failure without advancing when a request rejects', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => session(`timeline-${index}`, 'project', 'project-1'))
    const fetchPaginatedFromIndex = vi.fn(async (
      _storeName: string,
      _indexName: string,
      options: { pinned?: string; scope?: string; offset?: number },
    ) => {
      if (options.pinned === 'only' || options.scope === 'global') return { values: [], total: 0 }
      if (options.scope === 'projects' && options.offset === 0) return { values: firstPage, total: 21 }
      if (options.scope === 'projects' && options.offset === 20) throw new Error('network failed')
      return { values: [], total: 0 }
    })
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend
    const pagination = useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(),
      viewMode: 'timeline',
      sortMode: 'updatedAt',
    })
    await flushMicrotasks()

    await expect(pagination.loadMoreProjectTimeline()).resolves.toBe(false)
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
        appending: false,
      },
    })
  })

  it('marks silent offset-0 refreshes as loading without appending', async () => {
    const globalSession = session('global-1')
    const refresh = deferred<{ values: ReturnType<typeof session>[]; total: number }>()
    let globalOffsetZeroCalls = 0
    const fetchPaginatedFromIndex = vi.fn((
      _storeName: string,
      _indexName: string,
      options: { pinned?: string; scope?: string; offset?: number },
    ) => {
      if (options.pinned === 'only') return Promise.resolve({ values: [], total: 0 })
      if (options.scope === 'global' && options.offset === 0) {
        globalOffsetZeroCalls += 1
        return globalOffsetZeroCalls === 1
          ? Promise.resolve({ values: [globalSession], total: 1 })
          : refresh.promise
      }
      return Promise.resolve({ values: [], total: 0 })
    })
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend
    const pagination = useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(),
      viewMode: 'project',
      sortMode: 'updatedAt',
    })
    await flushMicrotasks()

    void pagination.refreshSessions()
    await flushMicrotasks()

    // Refocus refresh in flight: loading true, appending false — mounted "show more"
    // buttons read appending, so they must not flip to spinner.
    expect(reactHarness.states[0]).toEqual({
      items: [globalSession],
      total: 1,
      loading: true,
      appending: false,
    })

    refresh.resolve({ values: [globalSession], total: 1 })
    await flushMicrotasks()
    expect(reactHarness.states[0]).toEqual({
      items: [globalSession],
      total: 1,
      loading: false,
      appending: false,
    })
  })

  it('marks user-triggered load-more as appending', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => session(`global-${index}`))
    const nextPage = deferred<{ values: ReturnType<typeof session>[]; total: number }>()
    const fetchPaginatedFromIndex = vi.fn((
      _storeName: string,
      _indexName: string,
      options: { pinned?: string; scope?: string; offset?: number },
    ) => {
      if (options.pinned === 'only') return Promise.resolve({ values: [], total: 0 })
      if (options.scope === 'global' && options.offset === 0) return Promise.resolve({ values: firstPage, total: 21 })
      if (options.scope === 'global' && options.offset === 20) return nextPage.promise
      return Promise.resolve({ values: [], total: 0 })
    })
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend
    const pagination = useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(),
      viewMode: 'project',
      sortMode: 'updatedAt',
    })
    await flushMicrotasks()

    void pagination.loadMoreGlobal()
    await flushMicrotasks()

    expect(reactHarness.states[0]).toEqual({
      items: firstPage,
      total: 21,
      loading: true,
      appending: true,
    })

    nextPage.resolve({ values: [session('global-20')], total: 21 })
    await flushMicrotasks()
    expect(reactHarness.states[0].loading).toBe(false)
    expect(reactHarness.states[0].appending).toBe(false)
  })

  it('coalesces refreshSessions calls within the merge window into one round of requests', async () => {
    const pending = deferred<{ values: never[]; total: number }>()
    let bootstrapDone = false
    const fetchPaginatedFromIndex = vi.fn(() => (
      bootstrapDone ? pending.promise : Promise.resolve({ values: [], total: 0 })
    ))
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend
    const pagination = useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(),
      viewMode: 'project',
      sortMode: 'updatedAt',
    })
    await flushMicrotasks()
    expect(fetchPaginatedFromIndex).toHaveBeenCalledTimes(2)
    bootstrapDone = true

    const first = pagination.refreshSessions()
    const second = pagination.refreshSessions()
    // 同一轮请求：pinned + global 各一次，第二次调用不再发请求且复用同一个 promise
    expect(second).toBe(first)
    expect(fetchPaginatedFromIndex).toHaveBeenCalledTimes(4)

    pending.resolve({ values: [], total: 0 })
    await Promise.all([first, second])
  })

  it('broadcasts once at the end of the merged round when a merged call requests it', async () => {
    const pending = deferred<{ values: never[]; total: number }>()
    let bootstrapDone = false
    const fetchPaginatedFromIndex = vi.fn(() => (
      bootstrapDone ? pending.promise : Promise.resolve({ values: [], total: 0 })
    ))
    const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend
    const onBroadcastSessionsChanged = vi.fn()
    const pagination = useSessionPagination({
      backendRef: { current: backend },
      expandedProjectIds: new Set(),
      viewMode: 'project',
      sortMode: 'updatedAt',
      onBroadcastSessionsChanged,
    })
    await flushMicrotasks()
    expect(onBroadcastSessionsChanged).not.toHaveBeenCalled()
    bootstrapDone = true

    const first = pagination.refreshSessions()
    const second = pagination.refreshSessions({ broadcast: true })
    const third = pagination.refreshSessions({ broadcast: true })
    await flushMicrotasks()
    // 仍在飞行中：广播只在整轮结束时执行
    expect(onBroadcastSessionsChanged).not.toHaveBeenCalled()

    pending.resolve({ values: [], total: 0 })
    await Promise.all([first, second, third])
    // 多次合并广播只触发一次，且不会丢失
    expect(onBroadcastSessionsChanged).toHaveBeenCalledTimes(1)
  })

  it('starts a new round of requests once the merge window has elapsed', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    let now = 1_000_000
    nowSpy.mockImplementation(() => now)
    try {
      const pending = deferred<{ values: never[]; total: number }>()
      let bootstrapDone = false
      const fetchPaginatedFromIndex = vi.fn(() => (
        bootstrapDone ? pending.promise : Promise.resolve({ values: [], total: 0 })
      ))
      const backend = { fetchPaginatedFromIndex } as unknown as HttpStorageBackend
      const pagination = useSessionPagination({
        backendRef: { current: backend },
        expandedProjectIds: new Set(),
        viewMode: 'project',
        sortMode: 'updatedAt',
      })
      await flushMicrotasks()
      expect(fetchPaginatedFromIndex).toHaveBeenCalledTimes(2)
      bootstrapDone = true

      const first = pagination.refreshSessions()
      expect(fetchPaginatedFromIndex).toHaveBeenCalledTimes(4)

      now += REFRESH_SESSIONS_MERGE_MS + 1
      const second = pagination.refreshSessions()

      expect(second).not.toBe(first)
      expect(fetchPaginatedFromIndex).toHaveBeenCalledTimes(6)

      pending.resolve({ values: [], total: 0 })
      await Promise.all([first, second])
    } finally {
      nowSpy.mockRestore()
    }
  })
})
