import { useCallback, useEffect, useRef, useState } from 'react'
import type { SidebarSessionViewMode } from '@/lib/types'
import {
  createSidebarSessionShowMoreState,
  invalidateSidebarSessionShowMore,
  invalidateSidebarSessionShowMoreByPrefix,
  runSidebarSessionShowMore,
  SIDEBAR_SESSION_DISPLAY_STEP,
} from '@/lib/sidebar-session-display'

/** 会话列表「渐进展示」状态机：每个区块（时间线 / 全局 / 单个项目）记住已展开条数，
 *  显示更多走 lib/sidebar-session-display 的去抖队列；视图切换、区块收起、项目折叠
 *  都要使对应队列失效并回退到初始步长，避免「展开着的列表突然又变长」。
 *  返回的 toggle* 回调在转发父级开关的同时负责失效副作用。 */
export function useSidebarSessionDisplay({
  sessionViewMode,
  projectsCollapsed,
  conversationsCollapsed,
  expandedProjectIds,
  projectCount,
  timelineLoadedCount,
  timelineHasMore,
  onLoadMoreTimeline,
  globalLoadedCount,
  globalHasMore,
  onLoadMoreGlobal,
  projectHasMore,
  onLoadMoreProject,
  onToggleProjectExpanded,
  onToggleAllProjectsExpanded,
  onToggleProjectsCollapsed,
  onToggleConversationsCollapsed,
}: {
  sessionViewMode: SidebarSessionViewMode
  projectsCollapsed: boolean
  conversationsCollapsed: boolean
  expandedProjectIds: Set<string>
  projectCount: number
  timelineLoadedCount: number
  timelineHasMore: boolean
  onLoadMoreTimeline: () => Promise<boolean>
  globalLoadedCount: number
  globalHasMore: boolean
  onLoadMoreGlobal: () => Promise<boolean>
  projectHasMore: (projectId: string) => boolean
  onLoadMoreProject: (projectId: string) => Promise<boolean>
  onToggleProjectExpanded: (projectId: string) => void
  onToggleAllProjectsExpanded: () => void
  onToggleProjectsCollapsed: () => void
  onToggleConversationsCollapsed: () => void
}) {
  const [timelineVisibleCount, setTimelineVisibleCount] = useState(SIDEBAR_SESSION_DISPLAY_STEP)
  const [globalVisibleCount, setGlobalVisibleCount] = useState(SIDEBAR_SESSION_DISPLAY_STEP)
  const [projectVisibleCounts, setProjectVisibleCounts] = useState<Record<string, number>>({})
  const showMoreStateRef = useRef(createSidebarSessionShowMoreState())
  const previousProjectsCollapsedRef = useRef(projectsCollapsed)
  const previousConversationsCollapsedRef = useRef(conversationsCollapsed)
  const previousExpandedProjectIdsRef = useRef(expandedProjectIds)
  const previousSessionViewModeRef = useRef(sessionViewMode)

  useEffect(() => {
    const previousSessionViewMode = previousSessionViewModeRef.current
    previousSessionViewModeRef.current = sessionViewMode
    if (previousSessionViewMode === sessionViewMode) return
    invalidateSidebarSessionShowMore(showMoreStateRef.current, 'timeline')
    setTimelineVisibleCount(SIDEBAR_SESSION_DISPLAY_STEP)
  }, [sessionViewMode])

  useEffect(() => {
    const resetForSharedCollapse = projectsCollapsed && !previousProjectsCollapsedRef.current
    previousProjectsCollapsedRef.current = projectsCollapsed
    if (!resetForSharedCollapse) return
    invalidateSidebarSessionShowMore(showMoreStateRef.current, 'timeline')
    invalidateSidebarSessionShowMoreByPrefix(showMoreStateRef.current, 'project:')
    window.requestAnimationFrame(() => {
      setTimelineVisibleCount(SIDEBAR_SESSION_DISPLAY_STEP)
      setProjectVisibleCounts({})
    })
  }, [projectsCollapsed])

  useEffect(() => {
    const resetForSharedCollapse = conversationsCollapsed && !previousConversationsCollapsedRef.current
    previousConversationsCollapsedRef.current = conversationsCollapsed
    if (!resetForSharedCollapse) return
    invalidateSidebarSessionShowMore(showMoreStateRef.current, 'global')
    window.requestAnimationFrame(() => setGlobalVisibleCount(SIDEBAR_SESSION_DISPLAY_STEP))
  }, [conversationsCollapsed])

  useEffect(() => {
    const previousExpandedProjectIds = previousExpandedProjectIdsRef.current
    previousExpandedProjectIdsRef.current = expandedProjectIds
    const collapsedProjectIds = [...previousExpandedProjectIds].filter((projectId) => !expandedProjectIds.has(projectId))
    if (collapsedProjectIds.length === 0) return
    for (const projectId of collapsedProjectIds) {
      invalidateSidebarSessionShowMore(showMoreStateRef.current, `project:${projectId}`)
    }
    window.requestAnimationFrame(() => {
      setProjectVisibleCounts((counts) => {
        const next = Object.fromEntries(Object.entries(counts).filter(([projectId]) => expandedProjectIds.has(projectId)))
        return Object.keys(next).length === Object.keys(counts).length ? counts : next
      })
    })
  }, [expandedProjectIds])

  const showMoreSessions = useCallback(async ({
    key,
    visibleCount,
    loadedCount,
    hasMore,
    loadMore,
    commitVisibleCount,
  }: {
    key: string
    visibleCount: number
    loadedCount: number
    hasMore: boolean
    loadMore: () => Promise<boolean>
    commitVisibleCount: (count: number) => void
  }) => {
    const nextVisibleCount = await runSidebarSessionShowMore({
      key,
      state: showMoreStateRef.current,
      input: { visibleCount, loadedCount, hasMore },
      loadMore,
    })
    if (nextVisibleCount !== undefined) commitVisibleCount(nextVisibleCount)
  }, [])

  const showMoreTimelineSessions = useCallback(() => {
    void showMoreSessions({
      key: 'timeline',
      visibleCount: timelineVisibleCount,
      loadedCount: timelineLoadedCount,
      hasMore: timelineHasMore,
      loadMore: onLoadMoreTimeline,
      commitVisibleCount: setTimelineVisibleCount,
    })
  }, [onLoadMoreTimeline, showMoreSessions, timelineHasMore, timelineLoadedCount, timelineVisibleCount])

  const showMoreGlobalSessions = useCallback(() => {
    void showMoreSessions({
      key: 'global',
      visibleCount: globalVisibleCount,
      loadedCount: globalLoadedCount,
      hasMore: globalHasMore,
      loadMore: onLoadMoreGlobal,
      commitVisibleCount: setGlobalVisibleCount,
    })
  }, [globalHasMore, globalLoadedCount, globalVisibleCount, onLoadMoreGlobal, showMoreSessions])

  const showMoreProjectSessions = useCallback((projectId: string, loadedCount: number) => {
    const visibleCount = projectVisibleCounts[projectId] ?? SIDEBAR_SESSION_DISPLAY_STEP
    void showMoreSessions({
      key: `project:${projectId}`,
      visibleCount,
      loadedCount,
      hasMore: projectHasMore(projectId),
      loadMore: () => onLoadMoreProject(projectId),
      commitVisibleCount: (count) => setProjectVisibleCounts((counts) => ({
        ...counts,
        [projectId]: count,
      })),
    })
  }, [onLoadMoreProject, projectHasMore, projectVisibleCounts, showMoreSessions])

  const collapseTimelineSessions = useCallback(() => {
    invalidateSidebarSessionShowMore(showMoreStateRef.current, 'timeline')
    setTimelineVisibleCount(SIDEBAR_SESSION_DISPLAY_STEP)
  }, [])

  const collapseProjectSessions = useCallback((projectId: string) => {
    invalidateSidebarSessionShowMore(showMoreStateRef.current, `project:${projectId}`)
    setProjectVisibleCounts((counts) => ({ ...counts, [projectId]: SIDEBAR_SESSION_DISPLAY_STEP }))
  }, [])

  const toggleProjectExpanded = useCallback((projectId: string) => {
    if (expandedProjectIds.has(projectId)) collapseProjectSessions(projectId)
    onToggleProjectExpanded(projectId)
  }, [collapseProjectSessions, expandedProjectIds, onToggleProjectExpanded])

  const toggleAllProjectsExpanded = useCallback(() => {
    if (expandedProjectIds.size === projectCount && projectCount > 0) {
      for (const projectId of expandedProjectIds) {
        invalidateSidebarSessionShowMore(showMoreStateRef.current, `project:${projectId}`)
      }
      setProjectVisibleCounts({})
    }
    onToggleAllProjectsExpanded()
  }, [expandedProjectIds, onToggleAllProjectsExpanded, projectCount])

  const toggleProjectsCollapsed = useCallback(() => {
    if (!projectsCollapsed) {
      invalidateSidebarSessionShowMore(showMoreStateRef.current, 'timeline')
      invalidateSidebarSessionShowMoreByPrefix(showMoreStateRef.current, 'project:')
    }
    onToggleProjectsCollapsed()
  }, [onToggleProjectsCollapsed, projectsCollapsed])

  const toggleConversationsCollapsed = useCallback(() => {
    if (!conversationsCollapsed) invalidateSidebarSessionShowMore(showMoreStateRef.current, 'global')
    onToggleConversationsCollapsed()
  }, [conversationsCollapsed, onToggleConversationsCollapsed])

  return {
    timelineVisibleCount,
    globalVisibleCount,
    projectVisibleCounts,
    showMoreTimelineSessions,
    showMoreGlobalSessions,
    showMoreProjectSessions,
    collapseTimelineSessions,
    toggleProjectExpanded,
    toggleAllProjectsExpanded,
    toggleProjectsCollapsed,
    toggleConversationsCollapsed,
  }
}
