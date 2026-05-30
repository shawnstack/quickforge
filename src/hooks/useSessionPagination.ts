import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import type { QuickForgeSessionMetadata } from '@/lib/types'

const PAGE_SIZE = 20

function sessionSortTime(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sortSessions(items: QuickForgeSessionMetadata[]) {
  return [...items].sort((a, b) => {
    const pinnedDiff = sessionSortTime(b.pinnedAt) - sessionSortTime(a.pinnedAt)
    if (pinnedDiff !== 0) return pinnedDiff
    if (a.pinnedAt && !b.pinnedAt) return -1
    if (!a.pinnedAt && b.pinnedAt) return 1
    return sessionSortTime(b.lastModified) - sessionSortTime(a.lastModified)
  })
}

type SessionPage = {
  items: QuickForgeSessionMetadata[]
  total: number
  loading: boolean
}

type UseSessionPaginationOptions = {
  backendRef: React.MutableRefObject<HttpStorageBackend | null>
  expandedProjectIds: Set<string>
  onBroadcastSessionsChanged?: () => void
}

export function useSessionPagination({
  backendRef,
  expandedProjectIds,
  onBroadcastSessionsChanged,
}: UseSessionPaginationOptions) {
  const [globalPage, setGlobalPage] = useState<SessionPage>({ items: [], total: 0, loading: false })
  const [projectPages, setProjectPages] = useState<Record<string, SessionPage>>({})
  const projectPagesRef = useRef(projectPages)
  const expandedProjectIdsRef = useRef(expandedProjectIds)

  useEffect(() => {
    projectPagesRef.current = projectPages
  }, [projectPages])

  useEffect(() => {
    expandedProjectIdsRef.current = expandedProjectIds
  }, [expandedProjectIds])

  const allLoadedSessions: QuickForgeSessionMetadata[] = useMemo(
    () => [
      ...globalPage.items,
      ...Object.values(projectPages).flatMap((p) => p.items),
    ],
    [globalPage.items, projectPages],
  )

  const loadGlobalSessions = useCallback(async (offset: number) => {
    const backend = backendRef.current
    if (!backend) return
    setGlobalPage((prev) => ({ ...prev, loading: true }))
    try {
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', 'lastModified',
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'global' },
      )
      setGlobalPage((prev) => ({
        items: sortSessions(offset === 0 ? result.values : [...prev.items, ...result.values]),
        total: result.total,
        loading: false,
      }))
    } catch {
      setGlobalPage((prev) => ({ ...prev, loading: false }))
    }
  }, [backendRef])

  const loadProjectSessions = useCallback(async (projectId: string, offset: number) => {
    const backend = backendRef.current
    if (!backend) return
    setProjectPages((prev) => {
      const page = prev[projectId]
      return { ...prev, [projectId]: { ...(page ?? { items: [], total: 0 }), loading: true } }
    })
    try {
      const result = await backend.fetchPaginatedFromIndex<QuickForgeSessionMetadata>(
        'sessions-metadata', 'lastModified',
        { direction: 'desc', limit: PAGE_SIZE, offset, scope: 'project', projectId },
      )
      setProjectPages((prev) => {
        const page = prev[projectId]
        const prevItems = page?.items ?? []
        return {
          ...prev,
          [projectId]: {
            items: sortSessions(offset === 0 ? result.values : [...prevItems, ...result.values]),
            total: result.total,
            loading: false,
          },
        }
      })
    } catch {
      setProjectPages((prev) => {
        const page = prev[projectId]
        return { ...prev, [projectId]: { ...(page ?? { items: [], total: 0 }), loading: false } }
      })
    }
  }, [backendRef])

  const refreshSessions = useCallback(async (opts?: { broadcast?: boolean }) => {
    // Reset and reload the visible initial pages.
    await loadGlobalSessions(0)

    const loadedProjectIds = new Set([
      ...Object.keys(projectPagesRef.current),
      ...expandedProjectIdsRef.current,
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
      await Promise.all([...loadedProjectIds].map((projectId) => loadProjectSessions(projectId, 0)))
    }

    if (opts?.broadcast) onBroadcastSessionsChanged?.()
  }, [loadGlobalSessions, loadProjectSessions, onBroadcastSessionsChanged])

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

  const loadMoreGlobal = useCallback(() => {
    void loadGlobalSessions(globalPage.items.length)
  }, [globalPage.items.length, loadGlobalSessions])

  const loadMoreProject = useCallback((projectId: string) => {
    const page = projectPages[projectId]
    void loadProjectSessions(projectId, page?.items.length ?? 0)
  }, [loadProjectSessions, projectPages])

  return {
    allLoadedSessions,
    globalSessions: globalPage.items,
    sessionsForProject,
    globalHasMore: globalPage.items.length < globalPage.total,
    projectHasMore,
    globalLoading: globalPage.loading,
    projectLoading,
    projectLoaded,
    loadGlobalSessions,
    loadProjectSessions,
    refreshSessions,
    loadMoreGlobal,
    loadMoreProject,
  }
}
