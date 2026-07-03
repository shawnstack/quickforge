import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import type { QuickForgeSessionMetadata, SidebarSessionSortMode, SidebarSessionViewMode } from '@/lib/types'

const PAGE_SIZE = 20

function sessionSortTime(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sortSessions(items: QuickForgeSessionMetadata[], sortMode: SidebarSessionSortMode) {
  const timeKey = sortMode === 'createdAt' ? 'createdAt' : 'lastModified'
  return [...items].sort((a, b) => {
    const pinnedDiff = sessionSortTime(b.pinnedAt) - sessionSortTime(a.pinnedAt)
    if (pinnedDiff !== 0) return pinnedDiff
    if (a.pinnedAt && !b.pinnedAt) return -1
    if (!a.pinnedAt && b.pinnedAt) return 1
    return sessionSortTime(b[timeKey]) - sessionSortTime(a[timeKey])
  })
}

function uniqueSessions(items: QuickForgeSessionMetadata[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function isValidPinnedAt(value?: string) {
  if (!value) return false
  const normalized = value.trim()
  if (!normalized || normalized === 'undefined' || normalized === 'null' || normalized === 'false') return false
  return !Number.isNaN(Date.parse(normalized))
}

type SessionPage = {
  items: QuickForgeSessionMetadata[]
  total: number
  loading: boolean
}

type UseSessionPaginationOptions = {
  backendRef: React.MutableRefObject<HttpStorageBackend | null>
  expandedProjectIds: Set<string>
  externalProjectIds?: Set<string>
  viewMode: SidebarSessionViewMode
  sortMode: SidebarSessionSortMode
  onBroadcastSessionsChanged?: () => void
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
  const projectPagesRef = useRef(projectPages)
  const expandedProjectIdsRef = useRef(expandedProjectIds)
  const externalProjectIdsRef = useRef(externalProjectIds ?? new Set<string>())
  const requestVersionRef = useRef(0)

  useEffect(() => {
    projectPagesRef.current = projectPages
  }, [projectPages])

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
    setPinnedPage((prev) => ({ ...prev, loading: true }))
    try {
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', 'pinnedAt',
        { direction: 'desc', limit: PAGE_SIZE, offset, pinned: 'only' },
      )
      if (!isCurrentRequest(version)) return
      const pinnedValues = result.values.filter((session) => isValidPinnedAt(session.pinnedAt))
      setPinnedPage((prev) => ({
        items: sortSessions(offset === 0 ? pinnedValues : uniqueSessions([...prev.items, ...pinnedValues]), sortMode),
        total: result.total,
        loading: false,
      }))
    } catch {
      if (!isCurrentRequest(version)) return
      setPinnedPage((prev) => ({ ...prev, loading: false }))
    }
  }, [backendRef, isCurrentRequest, sortMode])

  const loadGlobalSessions = useCallback(async (offset: number, version = requestVersionRef.current) => {
    const backend = backendRef.current
    if (!backend) return
    setGlobalPage((prev) => ({ ...prev, loading: true }))
    try {
      const indexName = sortMode === 'createdAt' ? 'createdAt' : 'lastModified'
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', indexName,
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'global' },
      )
      if (!isCurrentRequest(version)) return
      setGlobalPage((prev) => ({
        items: sortSessions(offset === 0 ? result.values : uniqueSessions([...prev.items, ...result.values]), sortMode),
        total: result.total,
        loading: false,
      }))
    } catch {
      if (!isCurrentRequest(version)) return
      setGlobalPage((prev) => ({ ...prev, loading: false }))
    }
  }, [backendRef, isCurrentRequest, sortMode])

  const loadProjectSessions = useCallback(async (projectId: string, offset: number, version = requestVersionRef.current) => {
    const backend = backendRef.current
    if (!backend) return
    setProjectPages((prev) => {
      const page = prev[projectId]
      return { ...prev, [projectId]: { ...(page ?? { items: [], total: 0 }), loading: true } }
    })
    try {
      const indexName = sortMode === 'createdAt' ? 'createdAt' : 'lastModified'
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', indexName,
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'project', projectId },
      )
      if (!isCurrentRequest(version)) return
      setProjectPages((prev) => {
        const page = prev[projectId]
        const prevItems = page?.items ?? []
        return {
          ...prev,
          [projectId]: {
            items: sortSessions(offset === 0 ? result.values : uniqueSessions([...prevItems, ...result.values]), sortMode),
            total: result.total,
            loading: false,
          },
        }
      })
    } catch {
      if (!isCurrentRequest(version)) return
      setProjectPages((prev) => {
        const page = prev[projectId]
        return { ...prev, [projectId]: { ...(page ?? { items: [], total: 0 }), loading: false } }
      })
    }
  }, [backendRef, isCurrentRequest, sortMode])

  const loadProjectTimelineSessions = useCallback(async (offset: number, version = requestVersionRef.current) => {
    const backend = backendRef.current
    if (!backend) return
    setProjectTimelinePage((prev) => ({ ...prev, loading: true }))
    try {
      const indexName = sortMode === 'createdAt' ? 'createdAt' : 'lastModified'
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', indexName,
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'projects' },
      )
      if (!isCurrentRequest(version)) return
      setProjectTimelinePage((prev) => ({
        items: sortSessions(offset === 0 ? result.values : uniqueSessions([...prev.items, ...result.values]), sortMode),
        total: result.total,
        loading: false,
      }))
    } catch {
      if (!isCurrentRequest(version)) return
      setProjectTimelinePage((prev) => ({ ...prev, loading: false }))
    }
  }, [backendRef, isCurrentRequest, sortMode])

  const refreshSessions = useCallback(async (opts?: { broadcast?: boolean }) => {
    const version = nextRequestVersion()
    // Reset and reload the visible initial pages.
    await loadPinnedSessions(0, version)
    if (!isCurrentRequest(version)) return
    await loadGlobalSessions(0, version)
    if (!isCurrentRequest(version)) return

    if (viewMode === 'timeline') {
      setProjectPages((prev) => {
        const next: Record<string, SessionPage> = {}
        for (const [projectId, page] of Object.entries(prev)) {
          next[projectId] = { ...page, loading: false }
        }
        return next
      })
      await loadProjectTimelineSessions(0, version)
      if (opts?.broadcast && isCurrentRequest(version)) onBroadcastSessionsChanged?.()
      return
    }

    setProjectTimelinePage((prev) => ({ ...prev, loading: false }))
    const loadedProjectIds = new Set([
      ...Object.keys(projectPagesRef.current),
      ...expandedProjectIdsRef.current,
      ...externalProjectIdsRef.current,
    ])
    if (loadedProjectIds.size === 0) {
      setProjectPages({})
    } else {
      setProjectPages((prev) => {
        const next: Record<string, SessionPage> = {}
        for (const projectId of loadedProjectIds) {
          next[projectId] = { ...(prev[projectId] ?? { items: [], total: 0 }), loading: true }
        }
        return next
      })
      await Promise.all([...loadedProjectIds].map((projectId) => loadProjectSessions(projectId, 0, version)))
    }

    if (opts?.broadcast && isCurrentRequest(version)) onBroadcastSessionsChanged?.()
  }, [isCurrentRequest, loadGlobalSessions, loadPinnedSessions, loadProjectSessions, loadProjectTimelineSessions, nextRequestVersion, onBroadcastSessionsChanged, viewMode])

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

  const loadMoreGlobal = useCallback(() => {
    void loadGlobalSessions(globalPage.items.length)
  }, [globalPage.items.length, loadGlobalSessions])

  const loadMoreProject = useCallback((projectId: string) => {
    const page = projectPages[projectId]
    void loadProjectSessions(projectId, page?.items.length ?? 0)
  }, [loadProjectSessions, projectPages])

  const loadMoreProjectTimeline = useCallback(() => {
    if (projectTimelinePage.loading) return
    if (projectTimelinePage.items.length >= projectTimelinePage.total) return
    void loadProjectTimelineSessions(projectTimelinePage.items.length)
  }, [
    loadProjectTimelineSessions,
    projectTimelinePage.items.length,
    projectTimelinePage.loading,
    projectTimelinePage.total,
  ])

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
    globalHasMore: globalPage.items.length < globalPage.total,
    projectHasMore,
    globalLoading: globalPage.loading,
    projectLoading,
    projectLoaded,
    loadGlobalSessions,
    loadProjectSessions,
    refreshSessions,
    loadMorePinned,
    loadMoreGlobal,
    loadMoreProject,
    loadMoreProjectTimeline,
  }
}
