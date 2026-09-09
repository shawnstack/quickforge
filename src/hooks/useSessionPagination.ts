import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HttpStorageBackend } from '@/lib/http-storage-backend'
import type { QuickForgeSessionMetadata, SidebarSessionSortMode, SidebarSessionViewMode } from '@/lib/types'
import {
  patchSessionTitleInPage,
  removeSessionFromPage,
  sortSessions,
  uniqueSessions,
  upsertSessionPage,
  type SessionPage,
} from '@/lib/session-list-updates'

const PAGE_SIZE = 20

// refreshSessions 合并窗口：同一 hook 实例内的并发刷新在该窗口内复用同一轮请求，
// 避免 agent_end 等多个事件源在同一时刻重复拉取会话列表。
export const REFRESH_SESSIONS_MERGE_MS = 250

function isValidPinnedAt(value?: string) {
  if (!value) return false
  const normalized = value.trim()
  if (!normalized || normalized === 'undefined' || normalized === 'null' || normalized === 'false') return false
  return !Number.isNaN(Date.parse(normalized))
}

type UseSessionPaginationOptions = {
  backendRef: React.MutableRefObject<HttpStorageBackend | null>
  expandedProjectIds: Set<string>
  externalProjectIds?: Set<string>
  viewMode: SidebarSessionViewMode
  sortMode: SidebarSessionSortMode
  onBroadcastSessionsChanged?: () => void
}

type RefreshRound = {
  startedAt: number
  pendingBroadcast: boolean
  promise: Promise<void>
}

export function useSessionPagination({
  backendRef,
  expandedProjectIds,
  externalProjectIds,
  viewMode,
  sortMode,
  onBroadcastSessionsChanged,
}: UseSessionPaginationOptions) {
  const [globalPage, setGlobalPage] = useState<SessionPage>({ items: [], total: 0, loading: false })
  const [pinnedPage, setPinnedPage] = useState<SessionPage>({ items: [], total: 0, loading: false })
  const [projectPages, setProjectPages] = useState<Record<string, SessionPage>>({})
  const [projectTimelinePage, setProjectTimelinePage] = useState<SessionPage>({ items: [], total: 0, loading: false })
  const globalPageRef = useRef(globalPage)
  const projectPagesRef = useRef(projectPages)
  const projectTimelinePageRef = useRef(projectTimelinePage)
  const expandedProjectIdsRef = useRef(expandedProjectIds)
  const externalProjectIdsRef = useRef(externalProjectIds ?? new Set<string>())
  const requestVersionRef = useRef(0)
  const refreshRoundRef = useRef<RefreshRound | null>(null)

  useEffect(() => {
    globalPageRef.current = globalPage
  }, [globalPage])

  useEffect(() => {
    projectPagesRef.current = projectPages
  }, [projectPages])

  useEffect(() => {
    projectTimelinePageRef.current = projectTimelinePage
  }, [projectTimelinePage])

  useEffect(() => {
    expandedProjectIdsRef.current = expandedProjectIds
  }, [expandedProjectIds])

  useEffect(() => {
    externalProjectIdsRef.current = externalProjectIds ?? new Set<string>()
  }, [externalProjectIds])

  const nextRequestVersion = useCallback(() => {
    requestVersionRef.current += 1
    return requestVersionRef.current
  }, [])

  const isCurrentRequest = useCallback((version: number) => version === requestVersionRef.current, [])

  const allLoadedSessions: QuickForgeSessionMetadata[] = useMemo(
    () => uniqueSessions([
      ...pinnedPage.items,
      ...globalPage.items,
      ...Object.values(projectPages).flatMap((p) => p.items),
      ...projectTimelinePage.items,
    ]),
    [pinnedPage.items, globalPage.items, projectPages, projectTimelinePage.items],
  )

  const loadPinnedSessions = useCallback(async (offset: number, version = requestVersionRef.current) => {
    const backend = backendRef.current
    if (!backend) return
    setPinnedPage((prev) => ({ ...prev, loading: true, appending: offset > 0 }))
    try {
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', 'pinnedAt',
        { direction: 'desc', limit: PAGE_SIZE, offset, pinned: 'only' },
      )
      if (!isCurrentRequest(version)) return
      const pinnedValues = result.values.filter((session) => isValidPinnedAt(session.pinnedAt))
      setPinnedPage((prev) => {
        const merged = offset === 0 ? pinnedValues : uniqueSessions([...prev.items, ...pinnedValues])
        const stalled = offset > 0 && pinnedValues.length > 0 && merged.length === prev.items.length
        return {
          items: sortSessions(merged, sortMode),
          total: stalled ? merged.length : result.total,
          loading: false,
          appending: false,
        }
      })
    } catch {
      if (!isCurrentRequest(version)) return
      setPinnedPage((prev) => ({ ...prev, loading: false, appending: false }))
    }
  }, [backendRef, isCurrentRequest, sortMode])

  const loadGlobalSessions = useCallback(async (offset: number, version = requestVersionRef.current) => {
    const backend = backendRef.current
    if (!backend) return
    setGlobalPage((prev) => ({ ...prev, loading: true, appending: offset > 0 }))
    globalPageRef.current = { ...globalPageRef.current, loading: true, appending: offset > 0 }
    try {
      const indexName = sortMode === 'createdAt' ? 'createdAt' : 'lastModified'
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', indexName,
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'global', pinned: 'exclude' },
      )
      if (!isCurrentRequest(version)) return
      setGlobalPage((prev) => {
        const merged = offset === 0 ? result.values : uniqueSessions([...prev.items, ...result.values])
        const stalled = offset > 0 && result.values.length > 0 && merged.length === prev.items.length
        const nextPage = {
          items: sortSessions(merged, sortMode),
          total: stalled ? merged.length : result.total,
          loading: false,
          appending: false,
        }
        globalPageRef.current = nextPage
        return nextPage
      })
    } catch {
      if (!isCurrentRequest(version)) return
      setGlobalPage((prev) => {
        const nextPage = { ...prev, loading: false, appending: false }
        globalPageRef.current = nextPage
        return nextPage
      })
    }
  }, [backendRef, isCurrentRequest, sortMode])

  const loadProjectSessions = useCallback(async (projectId: string, offset: number, version = requestVersionRef.current) => {
    const backend = backendRef.current
    if (!backend) return
    setProjectPages((prev) => {
      const page = prev[projectId]
      const nextPage = { ...(page ?? { items: [], total: 0 }), loading: true, appending: offset > 0 }
      projectPagesRef.current = { ...projectPagesRef.current, [projectId]: nextPage }
      return { ...prev, [projectId]: nextPage }
    })
    try {
      const indexName = sortMode === 'createdAt' ? 'createdAt' : 'lastModified'
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', indexName,
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'project', projectId, pinned: 'exclude' },
      )
      if (!isCurrentRequest(version)) return
      setProjectPages((prev) => {
        const page = prev[projectId]
        const prevItems = page?.items ?? []
        const merged = offset === 0 ? result.values : uniqueSessions([...prevItems, ...result.values])
        const stalled = offset > 0 && result.values.length > 0 && merged.length === prevItems.length
        const nextPages = {
          ...prev,
          [projectId]: {
            items: sortSessions(merged, sortMode),
            total: stalled ? merged.length : result.total,
            loading: false,
            appending: false,
          },
        }
        projectPagesRef.current = nextPages
        return nextPages
      })
    } catch {
      if (!isCurrentRequest(version)) return
      setProjectPages((prev) => {
        const page = prev[projectId]
        const nextPages = { ...prev, [projectId]: { ...(page ?? { items: [], total: 0 }), loading: false, appending: false } }
        projectPagesRef.current = nextPages
        return nextPages
      })
    }
  }, [backendRef, isCurrentRequest, sortMode])

  const loadProjectTimelineSessions = useCallback(async (offset: number, version = requestVersionRef.current) => {
    const backend = backendRef.current
    if (!backend) return
    setProjectTimelinePage((prev) => ({ ...prev, loading: true, appending: offset > 0 }))
    projectTimelinePageRef.current = { ...projectTimelinePageRef.current, loading: true, appending: offset > 0 }
    try {
      const indexName = sortMode === 'createdAt' ? 'createdAt' : 'lastModified'
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', indexName,
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'projects', pinned: 'exclude' },
      )
      if (!isCurrentRequest(version)) return
      setProjectTimelinePage((prev) => {
        const merged = offset === 0 ? result.values : uniqueSessions([...prev.items, ...result.values])
        const stalled = offset > 0 && result.values.length > 0 && merged.length === prev.items.length
        const nextPage = {
          items: sortSessions(merged, sortMode),
          total: stalled ? merged.length : result.total,
          loading: false,
          appending: false,
        }
        projectTimelinePageRef.current = nextPage
        return nextPage
      })
    } catch {
      if (!isCurrentRequest(version)) return
      setProjectTimelinePage((prev) => {
        const nextPage = { ...prev, loading: false, appending: false }
        projectTimelinePageRef.current = nextPage
        return nextPage
      })
    }
  }, [backendRef, isCurrentRequest, sortMode])

  const refreshSessions = useCallback((opts?: { broadcast?: boolean }): Promise<void> => {
    if (!backendRef.current) return Promise.resolve()

    // 合并窗口内复用正在跑的那一轮：多个事件源（如 agent_end）可能在同一时刻触发刷新，
    // 重复请求只会放大 sessions-metadata 各索引的读取压力。
    const existing = refreshRoundRef.current
    if (existing && Date.now() - existing.startedAt < REFRESH_SESSIONS_MERGE_MS) {
      // 被合并的调用若要求广播，记在正在跑的那一轮上，结尾只广播一次。
      if (opts?.broadcast) existing.pendingBroadcast = true
      return existing.promise
    }

    const round: RefreshRound = {
      startedAt: Date.now(),
      pendingBroadcast: Boolean(opts?.broadcast),
      promise: Promise.resolve(),
    }
    refreshRoundRef.current = round

    round.promise = (async () => {
      try {
        const version = nextRequestVersion()
        // Reset and reload the visible initial pages.
        await Promise.all([
          loadPinnedSessions(0, version),
          loadGlobalSessions(0, version),
        ])
        if (!isCurrentRequest(version)) return

        if (viewMode === 'timeline') {
          setProjectPages((prev) => {
            const next: Record<string, SessionPage> = {}
            for (const [projectId, page] of Object.entries(prev)) {
              next[projectId] = { ...page, loading: false, appending: false }
            }
            return next
          })
          await loadProjectTimelineSessions(0, version)
          if (round.pendingBroadcast && isCurrentRequest(version)) onBroadcastSessionsChanged?.()
          return
        }

        setProjectTimelinePage((prev) => ({ ...prev, loading: false, appending: false }))
        const loadedProjectIds = new Set([
          ...Object.keys(projectPagesRef.current),
          ...expandedProjectIdsRef.current,
          ...externalProjectIdsRef.current,
        ])
        if (loadedProjectIds.size === 0) {
          setProjectPages({})
        } else {
          await Promise.all([...loadedProjectIds].map((projectId) => loadProjectSessions(projectId, 0, version)))
        }

        if (round.pendingBroadcast && isCurrentRequest(version)) onBroadcastSessionsChanged?.()
      } finally {
        if (refreshRoundRef.current === round) refreshRoundRef.current = null
      }
    })()

    return round.promise
  }, [backendRef, isCurrentRequest, loadGlobalSessions, loadPinnedSessions, loadProjectSessions, loadProjectTimelineSessions, nextRequestVersion, onBroadcastSessionsChanged, viewMode])

  const upsertSessionMetadata = useCallback((session: QuickForgeSessionMetadata) => {
    // 置顶会话只进置顶分区：其余列表以 pinned=exclude 拉取，不持有置顶会话；
    // 取消置顶后由 refreshSessions 收敛各列表。
    if (isValidPinnedAt(session.pinnedAt)) {
      setPinnedPage((page) => upsertSessionPage(page, session, sortMode))
      return
    }
    if (session.scope === 'project' && session.projectId) {
      setProjectPages((pages) => {
        const page = pages[session.projectId!]
        if (!page) return pages
        return { ...pages, [session.projectId!]: upsertSessionPage(page, session, sortMode) }
      })
      if (viewMode === 'timeline') {
        setProjectTimelinePage((page) => upsertSessionPage(page, session, sortMode))
      }
      return
    }
    setGlobalPage((page) => upsertSessionPage(page, session, sortMode))
  }, [sortMode, viewMode])

  const updateSessionTitle = useCallback((sessionId: string, title: string) => {
    setPinnedPage((page) => patchSessionTitleInPage(page, sessionId, title))
    setGlobalPage((page) => patchSessionTitleInPage(page, sessionId, title))
    setProjectTimelinePage((page) => patchSessionTitleInPage(page, sessionId, title))
    setProjectPages((pages) => {
      let changed = false
      const next = Object.fromEntries(Object.entries(pages).map(([projectId, page]) => {
        const patched = patchSessionTitleInPage(page, sessionId, title)
        if (patched !== page) changed = true
        return [projectId, patched]
      }))
      return changed ? next : pages
    })
  }, [])

  const removeSession = useCallback((sessionId: string) => {
    setPinnedPage((page) => removeSessionFromPage(page, sessionId))
    setGlobalPage((page) => removeSessionFromPage(page, sessionId))
    setProjectTimelinePage((page) => removeSessionFromPage(page, sessionId))
    setProjectPages((pages) => {
      let changed = false
      const next = Object.fromEntries(Object.entries(pages).map(([projectId, page]) => {
        const removed = removeSessionFromPage(page, sessionId)
        if (removed !== page) changed = true
        return [projectId, removed]
      }))
      return changed ? next : pages
    })
  }, [])

  const sessionsForProject = useCallback((projectId: string) => {
    return projectPages[projectId]?.items ?? []
  }, [projectPages])

  const projectHasMore = useCallback((projectId: string) => {
    const page = projectPages[projectId]
    if (!page) return true // not yet loaded
    return page.items.length < page.total
  }, [projectPages])

  const projectLoading = useCallback((projectId: string) => projectPages[projectId]?.loading ?? false, [projectPages])
  const projectLoaded = useCallback((projectId: string) => projectId in projectPages, [projectPages])

  const loadMorePinned = useCallback(() => {
    if (pinnedPage.loading) return
    if (pinnedPage.items.length >= pinnedPage.total) return
    void loadPinnedSessions(pinnedPage.items.length)
  }, [loadPinnedSessions, pinnedPage.items.length, pinnedPage.loading, pinnedPage.total])

  const loadMoreGlobal = useCallback(async () => {
    const page = globalPageRef.current
    if (page.loading || page.items.length >= page.total) return false
    const previousCount = page.items.length
    await loadGlobalSessions(previousCount)
    const nextPage = globalPageRef.current
    return nextPage.items.length > previousCount
  }, [loadGlobalSessions])

  const loadMoreProject = useCallback(async (projectId: string) => {
    const page = projectPagesRef.current[projectId]
    if (page?.loading || (page && page.items.length >= page.total)) return false
    const previousCount = page?.items.length ?? 0
    await loadProjectSessions(projectId, previousCount)
    return (projectPagesRef.current[projectId]?.items.length ?? 0) > previousCount
  }, [loadProjectSessions])

  const loadMoreProjectTimeline = useCallback(async () => {
    const page = projectTimelinePageRef.current
    if (page.loading || page.items.length >= page.total) return false
    const previousCount = page.items.length
    await loadProjectTimelineSessions(previousCount)
    return projectTimelinePageRef.current.items.length > previousCount
  }, [loadProjectTimelineSessions])

  useEffect(() => {
    void Promise.resolve().then(() => refreshSessions())
  }, [refreshSessions])

  return {
    allLoadedSessions,
    pinnedSessions: pinnedPage.items,
    pinnedHasMore: pinnedPage.items.length < pinnedPage.total,
    pinnedLoading: pinnedPage.loading,
    globalSessions: globalPage.items,
    sessionsForProject,
    projectTimelineSessions: projectTimelinePage.items,
    projectTimelineHasMore: projectTimelinePage.items.length < projectTimelinePage.total,
    projectTimelineLoading: projectTimelinePage.loading,
    projectTimelineAppending: projectTimelinePage.appending ?? false,
    globalHasMore: globalPage.items.length < globalPage.total,
    projectHasMore,
    globalLoading: globalPage.loading,
    globalAppending: globalPage.appending ?? false,
    projectLoading,
    projectAppending: useCallback((projectId: string) => projectPages[projectId]?.appending ?? false, [projectPages]),
    projectLoaded,
    loadGlobalSessions,
    loadProjectSessions,
    refreshSessions,
    upsertSessionMetadata,
    updateSessionTitle,
    removeSession,
    loadMorePinned,
    loadMoreGlobal,
    loadMoreProject,
    loadMoreProjectTimeline,
  }
}
