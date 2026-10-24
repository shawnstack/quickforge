import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Ellipsis,
  Folder,
  FolderOpen,
  Loader2,
  MessageSquarePlus,
  Plus,
  SlidersHorizontal,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  MeasuringStrategy,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Button } from '@/components/ui/button'
import { clampProjectDragTransform, visibleProjectDragBoundary } from '@/lib/project-drag-boundary'
import { SIDEBAR_SESSION_DISPLAY_STEP } from '@/lib/sidebar-session-display'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { sessionTitle } from '@/lib/types'
import type { SidebarSectionId, SidebarSectionOrder } from '@/lib/sidebar-section-order'
import type {
  ProjectInfo,
  QuickForgeSessionMetadata,
  BackgroundTaskStatus,
  SidebarSessionSortMode,
  SidebarSessionViewMode,
} from '@/lib/types'
import {
  activeProjectTitleClass,
  chevronClass,
  collapseInnerClass,
  collapsePanelClass,
  collapsePanelClosedClass,
  collapsePanelOpenClass,
  draggableSectionTitleClass,
  iconSlotClass,
  inactiveRowClass,
  overlayIconButtonClass,
  projectActionOverlayClass,
  projectActiveRowClass,
  sectionActionButtonClass,
  sectionHeaderClass,
  sectionToggleClass,
  sidebarRowClass,
  sidebarSessionTitleClass,
} from './chat-sidebar/sidebar-classes'
import {
  formatSessionTime,
  getSidebarMaxWidth,
  isValidPinnedAt,
  projectMenuHeight,
  projectMenuWidth,
  sidebarMaxViewportRatio,
  sidebarMaxWidth,
  sidebarMinWidth,
  sidebarSectionDndId,
  sidebarSectionIdFromDndId,
  viewSortMenuHeight,
  viewSortMenuWidth,
} from './chat-sidebar/sidebar-utils'
import { LoadMoreSentinel, SessionDisplayControls } from './chat-sidebar/SessionDisplayControls'
import { SortableProjectItem, SortableSidebarSection } from './chat-sidebar/SortableSidebarItems'
import { SidebarSessionRow } from './chat-sidebar/SidebarSessionRow'
import { SessionHoverTip } from './chat-sidebar/SessionHoverTip'
import { ViewSortMenu } from './chat-sidebar/ViewSortMenu'
import { ProjectMenu } from './chat-sidebar/ProjectMenu'
import { SidebarSearchDialog } from './chat-sidebar/SidebarSearchDialog'
import { SidebarHeaderNav } from './chat-sidebar/SidebarHeaderNav'
import { SidebarFooter } from './chat-sidebar/SidebarFooter'
import { useSidebarResize } from './chat-sidebar/useSidebarResize'
import { useSidebarSessionDisplay } from './chat-sidebar/useSidebarSessionDisplay'

type ChatSidebarProps = {
  sidebarOpen: boolean
  variant?: 'desktop' | 'mobile'
  projectsCollapsed: boolean
  pinnedCollapsed: boolean
  conversationsCollapsed: boolean
  sectionOrder: SidebarSectionOrder
  projects: ProjectInfo[]
  expandedProjectIds: Set<string>
  activeProject?: ProjectInfo
  currentSessionId?: string
  loadingSessionId?: string
  sessionViewMode: SidebarSessionViewMode
  sessionSortMode: SidebarSessionSortMode
  globalSessions: QuickForgeSessionMetadata[]
  pinnedSessions: QuickForgeSessionMetadata[]
  pinnedHasMore: boolean
  pinnedLoading: boolean
  sessionsForProject: (projectId: string) => QuickForgeSessionMetadata[]
  projectTimelineSessions: QuickForgeSessionMetadata[]
  projectTimelineHasMore: boolean
  projectTimelineLoading: boolean
  /** True only while a user-triggered "show more" append is in flight; silent refocus
      refreshes keep loading props true but appending false so the button stays static. */
  projectTimelineAppending: boolean
  globalHasMore: boolean
  globalAppending: boolean
  onLoadMoreGlobal: () => Promise<boolean>
  onLoadMorePinned: () => void
  projectHasMore: (projectId: string) => boolean
  projectLoading: (projectId: string) => boolean
  projectAppending: (projectId: string) => boolean
  projectLoaded: (projectId: string) => boolean
  onLoadMoreProject: (projectId: string) => Promise<boolean>
  onLoadMoreProjectTimeline: () => Promise<boolean>
  sessionTaskStatus: (session: QuickForgeSessionMetadata) => BackgroundTaskStatus
  completedSessionIds: Set<string>
  selectingProject: boolean
  onTogglePinnedCollapsed: () => void
  onToggleProjectsCollapsed: () => void
  onToggleConversationsCollapsed: () => void
  onReorderSections: (activeId: SidebarSectionId, overId: SidebarSectionId) => void
  onToggleProjectExpanded: (projectId: string) => void
  onToggleAllProjectsExpanded: () => void
  onReorderProjects: (orderedIds: string[]) => void
  onSelectProjectDirectory?: () => void
  onStartNewProjectChat: (project: ProjectInfo) => void
  onOpenGlobalSkills: () => void
  onOpenMcp: () => void
  onOpenAgents: () => void
  onOpenScheduledTasks: () => void
  onOpenProjectSkills: (project: ProjectInfo) => void
  onOpenProjectInExplorer?: (project: ProjectInfo) => void
  onDeleteProject: (projectId: string) => void | Promise<void>
  onLoadSession: (sessionId: string) => void
  onSessionViewModeChange: (mode: SidebarSessionViewMode) => void
  onSessionSortModeChange: (mode: SidebarSessionSortMode) => void
  onTogglePinSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void | Promise<void>
  onStartNewDefaultChat: () => void
  onStartNewGlobalChat: () => void
  onOpenSettings: () => void
  currentServerUrl?: string
  currentServerAlias?: string
  onOpenServer?: () => void
  onOpenUpdate?: () => void
  onDismissUpdate?: () => void
  updateAvailable?: boolean
  latestVersion?: string
  currentVersion?: string
  onToggleSidebar: () => void
  onWidthChange?: (width: number) => void
  currentSessionHoverInfo?: {
    sessionId?: string
    gitBranch?: string
    context?: {
      color: string
      label: string
      title: string
    }
  }
}

// Session delete exit duration; matches the --quickforge-dur-exit motion token.
const deleteSessionFadeMs = 140
const sessionHoverTipDelayMs = 400

export const ChatSidebar = memo(function ChatSidebar({
  sidebarOpen,
  variant = 'desktop',
  projectsCollapsed,
  pinnedCollapsed,
  conversationsCollapsed,
  sectionOrder,
  projects,
  expandedProjectIds,
  activeProject,
  currentSessionId,
  loadingSessionId,
  sessionViewMode,
  sessionSortMode,
  globalSessions,
  pinnedSessions,
  pinnedHasMore,
  pinnedLoading,
  sessionsForProject,
  projectTimelineSessions,
  projectTimelineHasMore,
  projectTimelineLoading,
  projectTimelineAppending,
  globalHasMore,
  globalAppending,
  onLoadMoreGlobal,
  onLoadMorePinned,
  projectHasMore,
  projectLoading,
  projectAppending,
  projectLoaded,
  onLoadMoreProject,
  onLoadMoreProjectTimeline,
  sessionTaskStatus,
  completedSessionIds,
  selectingProject,
  onTogglePinnedCollapsed,
  onToggleProjectsCollapsed,
  onToggleConversationsCollapsed,
  onReorderSections,
  onToggleProjectExpanded,
  onToggleAllProjectsExpanded,
  onReorderProjects,
  onSelectProjectDirectory,
  onStartNewProjectChat,
  onOpenGlobalSkills,
  onOpenMcp,
  onOpenAgents,
  onOpenScheduledTasks,
  onOpenProjectSkills,
  onOpenProjectInExplorer,
  onDeleteProject,
  onLoadSession,
  onSessionViewModeChange,
  onSessionSortModeChange,
  onTogglePinSession,
  onDeleteSession,
  onStartNewDefaultChat,
  onStartNewGlobalChat,
  onOpenSettings,
  currentServerUrl,
  currentServerAlias,
  onOpenServer,
  onOpenUpdate,
  onDismissUpdate,
  updateAvailable,
  latestVersion,
  currentVersion,
  onToggleSidebar,
  onWidthChange,
  currentSessionHoverInfo,
}: ChatSidebarProps) {
  const isMobile = variant === 'mobile'

  const { asideRef, sidebarWidth, isResizing, startResizing, resizeSidebar, stopResizing, resetSidebarWidth } =
    useSidebarResize({ isMobile, sidebarOpen })

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null)
  const [projectMenuPosition, setProjectMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [viewSortMenuOpen, setViewSortMenuOpen] = useState(false)
  const [viewSortMenuPosition, setViewSortMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [confirmingDeleteProjectId, setConfirmingDeleteProjectId] = useState<string | null>(null)
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [suppressedSessionActionsId, setSuppressedSessionActionsId] = useState<string | null>(null)
  const [confirmingDeleteSessionId, setConfirmingDeleteSessionId] = useState<string | null>(null)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [hoveredSessionTip, setHoveredSessionTip] = useState<{ sessionId: string; x: number; y: number } | null>(null)
  const [isProjectDragging, setIsProjectDragging] = useState(false)
  const [draggingSectionId, setDraggingSectionId] = useState<SidebarSectionId>()
  const deleteAnimationTimeoutRef = useRef<number | null>(null)
  const projectDeleteAnimationTimeoutRef = useRef<number | null>(null)
  const hoverTipTimerRef = useRef<number | null>(null)
  const sidebarScrollViewportRef = useRef<HTMLDivElement | null>(null)
  const projectsDragBoundaryRef = useRef<HTMLDivElement | null>(null)
  const projectDragStartScrollTopRef = useRef(0)
  const suppressProjectRowClickRef = useRef(false)
  const suppressSectionHeaderClickRef = useRef(false)
  const sectionsDragBoundaryRef = useRef<HTMLDivElement | null>(null)
  const sectionDragStartScrollTopRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isMobile || !onWidthChange || typeof ResizeObserver === 'undefined') return undefined
    const aside = asideRef.current
    if (!aside) return undefined
    const reportWidth = () => onWidthChange(aside.getBoundingClientRect().width)
    reportWidth()
    const observer = new ResizeObserver(reportWidth)
    observer.observe(aside)
    return () => observer.disconnect()
  }, [isMobile, onWidthChange, asideRef])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const sectionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const finishSectionDrag = useCallback(() => {
    suppressSectionHeaderClickRef.current = true
    setDraggingSectionId(undefined)
  }, [])

  const handleSectionDragStart = useCallback((event: { active: { id: string | number } }) => {
    suppressSectionHeaderClickRef.current = true
    sectionDragStartScrollTopRef.current = sidebarScrollViewportRef.current?.scrollTop ?? 0
    const activeSectionId = sidebarSectionIdFromDndId(event.active.id)
    if (activeSectionId) setDraggingSectionId(activeSectionId)
  }, [])

  const handleSectionDragEnd = useCallback((event: DragEndEvent) => {
    finishSectionDrag()
    const activeId = sidebarSectionIdFromDndId(event.active.id)
    const overId = event.over ? sidebarSectionIdFromDndId(event.over.id) : undefined
    if (activeId && overId) onReorderSections(activeId, overId)
  }, [finishSectionDrag, onReorderSections])

  const isSectionDragging = draggingSectionId !== undefined
  const projectsVisuallyCollapsed = projectsCollapsed || isSectionDragging
  const conversationsVisuallyCollapsed = conversationsCollapsed || isSectionDragging

  const restrictProjectDragToViewport = useCallback<Modifier>(({ transform, draggingNodeRect }) => {
    const boundaryRect = projectsDragBoundaryRef.current?.getBoundingClientRect()
    const scrollViewportRect = sidebarScrollViewportRef.current?.getBoundingClientRect()
    const visibleBoundary = visibleProjectDragBoundary(boundaryRect, scrollViewportRect)
    const scrollViewport = sidebarScrollViewportRef.current
    return clampProjectDragTransform(
      transform,
      draggingNodeRect,
      visibleBoundary,
      (scrollViewport?.scrollTop ?? 0) - projectDragStartScrollTopRef.current,
    )
  }, [])

  const canAutoScrollProjectsViewport = useCallback((element: Element) => (
    element === sidebarScrollViewportRef.current
  ), [])

  const restrictSectionDragToViewport = useCallback<Modifier>(({ transform, draggingNodeRect }) => {
    const boundaryRect = sectionsDragBoundaryRef.current?.getBoundingClientRect()
    const scrollViewportRect = sidebarScrollViewportRef.current?.getBoundingClientRect()
    const visibleBoundary = visibleProjectDragBoundary(boundaryRect, scrollViewportRect)
    const scrollViewport = sidebarScrollViewportRef.current
    return clampProjectDragTransform(
      transform,
      draggingNodeRect,
      visibleBoundary,
      (scrollViewport?.scrollTop ?? 0) - sectionDragStartScrollTopRef.current,
    )
  }, [])

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects])
  const openProjectMenuProject = useMemo(() => projects.find((project) => project.id === projectMenuId), [projectMenuId, projects])
  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const timelineSessions = useMemo(() => {
    const seen = new Set<string>()
    return projectTimelineSessions
      .filter((session) => {
        if (seen.has(session.id)) return false
        seen.add(session.id)
        return true
      })
      .map((session) => ({
        session,
        projectName: session.projectId ? projectNameById.get(session.projectId) ?? t('unknownProject') : t('unknownProject'),
      }))
  }, [projectNameById, projectTimelineSessions])
  const pinnedSessionItems = useMemo(() => pinnedSessions.filter((session) => isValidPinnedAt(session.pinnedAt)).map((session) => ({
    session,
    sourceName: session.scope === 'project'
      ? session.projectId ? projectNameById.get(session.projectId) ?? t('unknownProject') : t('unknownProject')
      : t('normalChat'),
  })), [pinnedSessions, projectNameById])

  const {
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
  } = useSidebarSessionDisplay({
    sessionViewMode,
    projectsCollapsed,
    conversationsCollapsed,
    expandedProjectIds,
    projectCount: projects.length,
    timelineLoadedCount: timelineSessions.length,
    timelineHasMore: projectTimelineHasMore,
    onLoadMoreTimeline: onLoadMoreProjectTimeline,
    globalLoadedCount: globalSessions.length,
    globalHasMore,
    onLoadMoreGlobal,
    projectHasMore,
    onLoadMoreProject,
    onToggleProjectExpanded,
    onToggleAllProjectsExpanded,
    onToggleProjectsCollapsed,
    onToggleConversationsCollapsed,
  })

  const visibleTimelineSessions = timelineSessions.slice(0, timelineVisibleCount)
  const visibleGlobalSessions = globalSessions.slice(0, globalVisibleCount)

  const handleDragStart = useCallback(() => {
    suppressProjectRowClickRef.current = true
    projectDragStartScrollTopRef.current = sidebarScrollViewportRef.current?.scrollTop ?? 0
    setIsProjectDragging(true)
    setProjectMenuId(null)
    setProjectMenuPosition(null)
    if (hoverTipTimerRef.current !== null) {
      window.clearTimeout(hoverTipTimerRef.current)
      hoverTipTimerRef.current = null
    }
    setHoveredSessionTip(null)
  }, [])

  const finishProjectDrag = useCallback(() => {
    suppressProjectRowClickRef.current = true
    setIsProjectDragging(false)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    finishProjectDrag()
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = projectIds.indexOf(active.id as string)
    const newIndex = projectIds.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = [...projectIds]
    reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, active.id as string)
    onReorderProjects(reordered)
  }, [finishProjectDrag, projectIds, onReorderProjects])

  const searchableSessions = useMemo(() => {
    const pinned = pinnedSessionItems.map(({ session, sourceName }) => ({ session, projectName: sourceName }))
    const projectSessions = projects.flatMap((project) => sessionsForProject(project.id).map((session) => ({ session, projectName: project.name })))
    const timeline = projectTimelineSessions.map((session) => ({
      session,
      projectName: session.projectId ? projectNameById.get(session.projectId) ?? t('unknownProject') : t('unknownProject'),
    }))
    const global = globalSessions.map((session) => ({ session, projectName: '' }))
    const seen = new Set<string>()
    return [...pinned, ...projectSessions, ...timeline, ...global].filter(({ session }) => {
      if (seen.has(session.id)) return false
      seen.add(session.id)
      return true
    })
  }, [globalSessions, pinnedSessionItems, projectNameById, projectTimelineSessions, projects, sessionsForProject])
  const searchResults = searchQuery.trim()
    ? searchableSessions.filter(({ session, projectName }) => `${sessionTitle(session.title)} ${projectName}`.toLowerCase().includes(searchQuery.trim().toLowerCase())).slice(0, 8)
    : []
  const openSearch = () => {
    setSearchOpen(true)
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }
  const selectSearchResult = (sessionId: string) => {
    onLoadSession(sessionId)
    setSearchOpen(false)
    setSearchQuery('')
  }
  const clearHoverTipTimer = () => {
    if (hoverTipTimerRef.current !== null) {
      window.clearTimeout(hoverTipTimerRef.current)
      hoverTipTimerRef.current = null
    }
  }
  const showSessionHoverTip = (event: React.MouseEvent<HTMLElement>, sessionId: string) => {
    if (isMobile) return
    // 同步读取位置：React 合成事件进入异步回调后 currentTarget 会被回收为 null
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(8, Math.min(rect.right + 8, window.innerWidth - 392))
    const y = rect.top + rect.height / 2
    clearHoverTipTimer()
    hoverTipTimerRef.current = window.setTimeout(() => {
      hoverTipTimerRef.current = null
      setHoveredSessionTip({ sessionId, x, y })
    }, sessionHoverTipDelayMs)
  }
  const hideSessionHoverTip = (sessionId: string) => {
    clearHoverTipTimer()
    setHoveredSessionTip((current) => current?.sessionId === sessionId ? null : current)
  }
  const handleSessionRowMouseLeave = (sessionId: string, deleting: boolean) => {
    setSuppressedSessionActionsId((current) => current === sessionId ? null : current)
    if (!deleting) {
      setConfirmingDeleteSessionId((current) => current === sessionId ? null : current)
    }
    hideSessionHoverTip(sessionId)
  }
  const openProjectMenu = (event: React.MouseEvent<HTMLButtonElement>, projectId: string) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setConfirmingDeleteProjectId(null)
    setProjectMenuId((current) => {
      if (current === projectId) {
        setProjectMenuPosition(null)
        return null
      }
      setProjectMenuPosition({
        x: Math.max(8, Math.min(rect.right - projectMenuWidth, window.innerWidth - projectMenuWidth - 8)),
        y: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - projectMenuHeight - 8)),
      })
      return projectId
    })
  }
  const openViewSortMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setProjectMenuId(null)
    setProjectMenuPosition(null)
    setViewSortMenuOpen((open) => {
      if (open) {
        setViewSortMenuPosition(null)
        return false
      }
      setViewSortMenuPosition({
        x: Math.max(8, Math.min(rect.right - viewSortMenuWidth, window.innerWidth - viewSortMenuWidth - 8)),
        y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - viewSortMenuHeight - 8)),
      })
      return true
    })
  }
  const closeViewSortMenu = useCallback(() => {
    setViewSortMenuOpen(false)
    setViewSortMenuPosition(null)
  }, [])
  const selectViewMode = (mode: SidebarSessionViewMode) => {
    if (mode !== sessionViewMode) collapseTimelineSessions()
    onSessionViewModeChange(mode)
    closeViewSortMenu()
  }
  const selectSortMode = (mode: SidebarSessionSortMode) => {
    onSessionSortModeChange(mode)
    closeViewSortMenu()
  }
  const closeProjectMenu = useCallback(() => {
    setProjectMenuId(null)
    setProjectMenuPosition(null)
    setConfirmingDeleteProjectId(null)
  }, [])
  const requestDeleteProject = (event: React.MouseEvent<HTMLButtonElement>, projectId: string) => {
    event.stopPropagation()
    setConfirmingDeleteProjectId(projectId)
  }
  const confirmDeleteProject = (event: React.MouseEvent<HTMLButtonElement>, projectId: string) => {
    event.stopPropagation()
    setProjectMenuId(null)
    setProjectMenuPosition(null)
    setDeletingProjectId(projectId)
    if (projectDeleteAnimationTimeoutRef.current !== null) {
      window.clearTimeout(projectDeleteAnimationTimeoutRef.current)
    }
    projectDeleteAnimationTimeoutRef.current = window.setTimeout(() => {
      projectDeleteAnimationTimeoutRef.current = null
      setConfirmingDeleteProjectId((current) => current === projectId ? null : current)
      void Promise.resolve(onDeleteProject(projectId)).catch(() => {
        setDeletingProjectId((current) => current === projectId ? null : current)
      })
    }, deleteSessionFadeMs)
  }
  const toggleSessionPinFromActions = (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => {
    event.stopPropagation()
    event.currentTarget.blur()
    setSuppressedSessionActionsId(sessionId)
    onTogglePinSession(sessionId)
  }
  const requestDeleteSession = (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => {
    event.stopPropagation()
    event.currentTarget.blur()
    setConfirmingDeleteSessionId(sessionId)
  }
  const confirmDeleteSession = (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => {
    event.stopPropagation()
    setDeletingSessionId(sessionId)
    hideSessionHoverTip(sessionId)
    if (deleteAnimationTimeoutRef.current !== null) {
      window.clearTimeout(deleteAnimationTimeoutRef.current)
    }
    deleteAnimationTimeoutRef.current = window.setTimeout(() => {
      deleteAnimationTimeoutRef.current = null
      setConfirmingDeleteSessionId((current) => current === sessionId ? null : current)
      void Promise.resolve(onDeleteSession(sessionId)).catch(() => {
        setDeletingSessionId((current) => current === sessionId ? null : current)
      })
    }, deleteSessionFadeMs)
  }

  useEffect(() => () => {
    if (deleteAnimationTimeoutRef.current !== null) {
      window.clearTimeout(deleteAnimationTimeoutRef.current)
    }
    if (projectDeleteAnimationTimeoutRef.current !== null) {
      window.clearTimeout(projectDeleteAnimationTimeoutRef.current)
    }
    if (hoverTipTimerRef.current !== null) {
      window.clearTimeout(hoverTipTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!projectMenuId) return
    window.addEventListener('click', closeProjectMenu)
    window.addEventListener('blur', closeProjectMenu)
    window.addEventListener('resize', closeProjectMenu)
    return () => {
      window.removeEventListener('click', closeProjectMenu)
      window.removeEventListener('blur', closeProjectMenu)
      window.removeEventListener('resize', closeProjectMenu)
    }
  }, [projectMenuId, closeProjectMenu])

  useEffect(() => {
    if (!viewSortMenuOpen) return
    window.addEventListener('click', closeViewSortMenu)
    window.addEventListener('blur', closeViewSortMenu)
    window.addEventListener('resize', closeViewSortMenu)
    return () => {
      window.removeEventListener('click', closeViewSortMenu)
      window.removeEventListener('blur', closeViewSortMenu)
      window.removeEventListener('resize', closeViewSortMenu)
    }
  }, [viewSortMenuOpen, closeViewSortMenu])

  const sessionRowProps = (session: QuickForgeSessionMetadata, timeText: string) => ({
    session,
    selected: currentSessionId === session.id,
    loading: loadingSessionId === session.id,
    deleting: deletingSessionId === session.id,
    actionsSuppressed: suppressedSessionActionsId === session.id,
    confirmingDelete: confirmingDeleteSessionId === session.id,
    sidebarOpen,
    timeText,
    sessionTaskStatus,
    completedSessionIds,
    onLoadSession,
    onTogglePin: toggleSessionPinFromActions,
    onRequestDelete: requestDeleteSession,
    onConfirmDelete: confirmDeleteSession,
    onHoverTipEnter: showSessionHoverTip,
    onHoverTipHide: hideSessionHoverTip,
    onRowMouseLeave: handleSessionRowMouseLeave,
  })

  return (
    <aside
      ref={asideRef}
      className={cn(
        'relative z-10 min-h-0 shrink-0 overflow-hidden bg-[var(--quickforge-sidebar-bg)] transition-[width] duration-200 ease-out motion-reduce:transition-none',
        isMobile ? 'flex h-full w-full flex-col' : 'hidden md:flex md:flex-col',
        !isMobile && !sidebarOpen ? 'w-14' : undefined,
        isResizing && 'transition-none',
      )}
      style={!isMobile && sidebarOpen ? {
        width: sidebarWidth,
        minWidth: sidebarMinWidth,
        maxWidth: `min(${sidebarMaxWidth}px, ${sidebarMaxViewportRatio * 100}vw)`,
      } : undefined}
    >
      {!isMobile && sidebarOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={sidebarMinWidth}
          aria-valuemax={getSidebarMaxWidth()}
          aria-valuenow={Math.round(sidebarWidth)}
          className={cn(
            'group absolute inset-y-0 right-0 z-30 w-2 cursor-col-resize touch-none bg-transparent transition-colors',
            isResizing && '',
          )}
          onDoubleClick={resetSidebarWidth}
          onPointerDown={startResizing}
          onPointerMove={resizeSidebar}
          onPointerUp={stopResizing}
          onPointerCancel={stopResizing}
        >
          <span className={cn(
            'absolute inset-y-0 right-0 w-px opacity-0 transition-opacity',
            isResizing ? 'opacity-100' : 'group-hover:opacity-100',
          )} />
        </div>
      ) : null}
      <SidebarHeaderNav
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        onStartNewDefaultChat={onStartNewDefaultChat}
        onOpenSearch={openSearch}
        onOpenScheduledTasks={onOpenScheduledTasks}
        onOpenGlobalSkills={onOpenGlobalSkills}
        onOpenMcp={onOpenMcp}
        onOpenAgents={onOpenAgents}
      />

      {sidebarOpen ? (
        <div ref={sidebarScrollViewportRef} className="min-h-0 flex-1 overflow-y-auto">
          {/* Content-driven mount: loading alone must not mount this section — refocus
              refreshes (visibilitychange → loadPinnedSessions sets loading:true while items
              stay empty) would flash an empty Pinned block and shove the sections below. */}
          {pinnedSessionItems.length > 0 ? (
            <div className="px-3 pb-1">
              <div
                className={sectionHeaderClass}
                onPointerDown={() => {
                  suppressSectionHeaderClickRef.current = false
                }}
                onClick={() => {
                  if (suppressSectionHeaderClickRef.current) {
                    suppressSectionHeaderClickRef.current = false
                    return
                  }
                  onTogglePinnedCollapsed()
                }}
              >
                <button type="button" className={sectionToggleClass} aria-expanded={!pinnedCollapsed}>
                  <span className="truncate">{t('pinnedConversations')}</span>
                  <ChevronRight className={cn(chevronClass, !pinnedCollapsed && 'rotate-90')} />
                </button>
              </div>
              <div className={cn(collapsePanelClass, pinnedCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass)}>
                <div className={collapseInnerClass}>
                  <div className="space-y-0.5">
                    {pinnedSessionItems.map(({ session }) => (
                      <SidebarSessionRow
                        key={session.id}
                        variant="pinned"
                        {...sessionRowProps(session, formatSessionTime(session.pinnedAt))}
                      />
                    ))}
                    <LoadMoreSentinel onLoadMore={onLoadMorePinned} enabled={!pinnedCollapsed && pinnedHasMore && !pinnedLoading} />
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <DndContext
            sensors={sectionSensors}
            collisionDetection={closestCenter}
            onDragStart={handleSectionDragStart}
            onDragEnd={handleSectionDragEnd}
            onDragCancel={finishSectionDrag}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            modifiers={[restrictSectionDragToViewport]}
            autoScroll={false}
          >
            <SortableContext items={sectionOrder.map(sidebarSectionDndId)} strategy={verticalListSortingStrategy}>
              <div
                ref={sectionsDragBoundaryRef}
                className="flex flex-col"
                data-dragging-section={draggingSectionId}
              >
                {sectionOrder.map((sectionId) => (
                  <SortableSidebarSection
                    key={sectionId}
                    id={sectionId}
                  >
                    {({ listeners, attributes, setActivatorNodeRef, isDragging }) => sectionId === 'projects' ? (
                      <>
                        <div className="px-3">
                          <div className="mb-0.5">
                            <div
                              className={sectionHeaderClass}
                              onPointerDown={() => {
                                suppressSectionHeaderClickRef.current = false
                              }}
                              onClick={() => {
                                if (suppressSectionHeaderClickRef.current) {
                                  suppressSectionHeaderClickRef.current = false
                                  return
                                }
                                toggleProjectsCollapsed()
                              }}
                            >
                              <button
                                ref={setActivatorNodeRef}
                                type="button"
                                className={cn(draggableSectionTitleClass, isDragging && 'cursor-grabbing')}
                                aria-expanded={!projectsVisuallyCollapsed}
                                {...attributes}
                                {...listeners}
                              >
                                <span className="truncate">{t('projects')}</span>
                                <ChevronRight className={cn(chevronClass, !projectsVisuallyCollapsed && 'rotate-90')} />
                              </button>
                              {projects.length > 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={sectionActionButtonClass}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openViewSortMenu(event)
                                  }}
                                  aria-label={t('filterSort')}
                                  title={t('filterSort')}
                                  aria-haspopup="menu"
                                  aria-expanded={viewSortMenuOpen}
                                >
                                  <SlidersHorizontal className="size-4" />
                                </Button>
                              )}
                              {projects.length > 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={sectionActionButtonClass}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    toggleAllProjectsExpanded()
                                  }}
                                  aria-label={expandedProjectIds.size === projects.length ? t('collapseAllProjects') : t('expandAllProjects')}
                                >
                                  {expandedProjectIds.size === projects.length ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
                                </Button>
                              )}
                              {onSelectProjectDirectory ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={sectionActionButtonClass}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onSelectProjectDirectory()
                                  }}
                                  disabled={selectingProject}
                                  aria-label={t('addProject')}
                                >
                                  <Plus className="size-4" />
                                </Button>
                              ) : null}
                            </div>

                            <div className={cn(collapsePanelClass, isSectionDragging && 'transition-none', projectsVisuallyCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass)}>
                              <div className={collapseInnerClass}>
                                <div ref={projectsDragBoundaryRef}>
                                  <div className="space-y-0.5">
                                    {projects.length === 0 ? (
                                      <div className="px-3 py-3 text-xs">{t('noProjects')}</div>
                                    ) : sessionViewMode === 'timeline' ? (
                                      timelineSessions.length === 0 ? (
                                        projectTimelineLoading ? (
                                          <div className="flex items-center px-3 py-3 text-xs">
                                            <Loader2 className="mr-1.5 size-3 animate-spin" />
                                            {t('loadingChatWorkspace')}
                                          </div>
                                        ) : (
                                          <div className="px-3 py-3 text-xs">{t('noConversations')}</div>
                                        )
                                      ) : (
                                        <>
                                          {visibleTimelineSessions.map(({ session }) => (
                                            <SidebarSessionRow
                                              key={session.id}
                                              variant="timeline"
                                              {...sessionRowProps(session, formatSessionTime(sessionSortMode === 'createdAt' ? session.createdAt : session.lastModified))}
                                            />
                                          ))}
                                          <SessionDisplayControls
                                            visibleCount={timelineVisibleCount}
                                            loadedCount={timelineSessions.length}
                                            hasMore={projectTimelineHasMore}
                                            loading={projectTimelineAppending}
                                            onShowMore={showMoreTimelineSessions}
                                          />
                                        </>
                                      )
                                    ) : (
                                      <DndContext
                                        sensors={sensors}
                                        collisionDetection={closestCenter}
                                        onDragStart={handleDragStart}
                                        onDragEnd={handleDragEnd}
                                        onDragCancel={finishProjectDrag}
                                        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                                        modifiers={[restrictProjectDragToViewport]}
                                        autoScroll={{ canScroll: canAutoScrollProjectsViewport }}
                                      >
                                        <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
                                          {projects.map((item) => {
                                            const projectSessions = sessionsForProject(item.id)
                                            const expanded = !isProjectDragging && expandedProjectIds.has(item.id)
                                            const active = activeProject?.id === item.id
                                            const loaded = projectLoaded(item.id)
                                            const menuOpen = projectMenuId === item.id
                                            const deleting = deletingProjectId === item.id

                                            return (
                                              <SortableProjectItem key={item.id} id={item.id}>
                                                {({ listeners, attributes }) => (
                                                  <div
                                                    className={cn(
                                                      'grid transition-[grid-template-rows,opacity,transform] duration-(--quickforge-dur-exit) ease-(--quickforge-ease-out) motion-reduce:transition-none',
                                                      deleting ? 'grid-rows-[0fr] -translate-x-1 opacity-0' : 'grid-rows-[1fr] translate-x-0 opacity-100',
                                                    )}
                                                  >
                                                    <div className="min-h-0 overflow-hidden">
                                                      <div
                                                        className={cn(
                                                          sidebarRowClass(sidebarOpen),
                                                          active ? projectActiveRowClass : inactiveRowClass,
                                                          menuOpen && 'z-20 overflow-visible',
                                                          deleting && 'pointer-events-none scale-[0.98] opacity-0 duration-(--quickforge-dur-exit) ease-(--quickforge-ease-out) motion-reduce:transition-none',
                                                        )}
                                                        style={{ touchAction: 'none' }}
                                                        {...listeners}
                                                        {...attributes}
                                                        onPointerDown={(event) => {
                                                          suppressProjectRowClickRef.current = false
                                                          listeners?.onPointerDown?.(event)
                                                        }}
                                                        onClick={() => {
                                                          if (suppressProjectRowClickRef.current) {
                                                            suppressProjectRowClickRef.current = false
                                                            return
                                                          }
                                                          toggleProjectExpanded(item.id)
                                                        }}
                                                      >
                                                        <button
                                                          type="button"
                                                          className={iconSlotClass}
                                                          aria-label={expanded ? t('collapseProject') : t('expandProject')}
                                                        >
                                                          {expanded ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
                                                        </button>
                                                        <button
                                                          className="flex min-w-0 flex-1 items-center text-left"
                                                          type="button"
                                                          title={item.path}
                                                        >
                                                          <span className={cn(sidebarSessionTitleClass, active && activeProjectTitleClass)}>{item.name}</span>
                                                        </button>
                                                        <div className={projectActionOverlayClass}>
                                                          <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className={overlayIconButtonClass}
                                                            onClick={(event) => {
                                                              event.stopPropagation()
                                                              openProjectMenu(event, item.id)
                                                            }}
                                                            aria-label={t('moreOptions')}
                                                            aria-expanded={menuOpen}
                                                          >
                                                            <Ellipsis className="size-4" />
                                                          </Button>
                                                          <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className={overlayIconButtonClass}
                                                            onClick={(event) => {
                                                              event.stopPropagation()
                                                              onStartNewProjectChat(item)
                                                            }}
                                                            aria-label={t('newProjectChat')}
                                                          >
                                                            <MessageSquarePlus className="size-4" />
                                                          </Button>
                                                        </div>
                                                      </div>

                                                      <div className={cn(collapsePanelClass, isProjectDragging && 'transition-none', expanded ? collapsePanelOpenClass : collapsePanelClosedClass)}>
                                                        <div className={collapseInnerClass}>
                                                          <div className="mt-0.5 space-y-0.5">
                                                            {projectSessions.length === 0 && !loaded ? (
                                                              // Hidden while collapsed: the collapsed panel only hides
                                                              // visually (grid-rows 0fr), and this placeholder would
                                                              // otherwise stay exposed to screen readers for every
                                                              // not-yet-loaded project.
                                                              expanded ? (
                                                                <div className={cn('flex items-center px-2 py-1.5 text-xs', sidebarOpen && 'pl-8')}>
                                                                  <Loader2 className="mr-1.5 size-3 animate-spin" />
                                                                  {t('loadingChatWorkspace')}
                                                                </div>
                                                              ) : null
                                                            ) : projectSessions.length === 0 && projectLoading(item.id) ? (
                                                              <div className={cn('flex items-center px-2 py-1.5 text-xs', sidebarOpen && 'pl-8')}>
                                                                <Loader2 className="mr-1.5 size-3 animate-spin" />
                                                                {t('loadingChatWorkspace')}
                                                              </div>
                                                            ) : projectSessions.length === 0 && !projectHasMore(item.id) ? (
                                                              <div className={cn('px-2 py-1.5 text-xs', sidebarOpen && 'pl-8')}>{t('noConversations')}</div>
                                                            ) : (
                                                              <>
                                                                {projectSessions.slice(0, projectVisibleCounts[item.id] ?? SIDEBAR_SESSION_DISPLAY_STEP).map((session) => (
                                                                  <SidebarSessionRow
                                                                    key={session.id}
                                                                    variant="project"
                                                                    {...sessionRowProps(session, formatSessionTime(sessionSortMode === 'createdAt' ? session.createdAt : session.lastModified))}
                                                                  />
                                                                ))}
                                                                <SessionDisplayControls
                                                                  visibleCount={projectVisibleCounts[item.id] ?? SIDEBAR_SESSION_DISPLAY_STEP}
                                                                  loadedCount={projectSessions.length}
                                                                  hasMore={projectHasMore(item.id)}
                                                                  loading={projectAppending(item.id)}
                                                                  onShowMore={() => showMoreProjectSessions(item.id, projectSessions.length)}
                                                                />
                                                              </>
                                                            )}
                                                          </div>
                                                        </div>
                                                      </div>
                                                    </div>
                                                  </div>
                                                )}
                                              </SortableProjectItem>
                                            )
                                          })}
                                        </SortableContext>
                                      </DndContext>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="px-3 pb-3">
                          <div
                            className={sectionHeaderClass}
                            onPointerDown={() => {
                              suppressSectionHeaderClickRef.current = false
                            }}
                            onClick={() => {
                              if (suppressSectionHeaderClickRef.current) {
                                suppressSectionHeaderClickRef.current = false
                                return
                              }
                              toggleConversationsCollapsed()
                            }}
                          >
                            <button
                              ref={setActivatorNodeRef}
                              type="button"
                              className={cn(draggableSectionTitleClass, isDragging && 'cursor-grabbing')}
                              aria-expanded={!conversationsVisuallyCollapsed}
                              {...attributes}
                              {...listeners}
                            >
                              <span className="truncate">{t('conversations')}</span>
                              <ChevronRight className={cn(chevronClass, !conversationsVisuallyCollapsed && 'rotate-90')} />
                            </button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={sectionActionButtonClass}
                              onClick={(event) => {
                                event.stopPropagation()
                                onStartNewGlobalChat()
                              }}
                              aria-label={t('newChat')}
                            >
                              <MessageSquarePlus className="size-4" />
                            </Button>
                          </div>

                          <div className={cn(collapsePanelClass, conversationsVisuallyCollapsed && 'transition-none', conversationsVisuallyCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass)}>
                            <div className={collapseInnerClass}>
                              <div className="pb-2">
                                {globalSessions.length === 0 && !globalHasMore ? (
                                  <div className="px-3 py-3 text-xs">{t('noSavedConversations')}</div>
                                ) : (
                                  <div className="space-y-0.5">
                                    {visibleGlobalSessions.map((session) => (
                                      <SidebarSessionRow
                                        key={session.id}
                                        variant="global"
                                        {...sessionRowProps(session, formatSessionTime(sessionSortMode === 'createdAt' ? session.createdAt : session.lastModified))}
                                      />
                                    ))}
                                    <SessionDisplayControls
                                      visibleCount={globalVisibleCount}
                                      loadedCount={globalSessions.length}
                                      hasMore={globalHasMore}
                                      loading={globalAppending}
                                      onShowMore={showMoreGlobalSessions}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </SortableSidebarSection>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : null}

      <SidebarFooter
        sidebarOpen={sidebarOpen}
        updateAvailable={updateAvailable}
        latestVersion={latestVersion}
        currentVersion={currentVersion}
        onOpenUpdate={onOpenUpdate}
        onDismissUpdate={onDismissUpdate}
        currentServerUrl={currentServerUrl}
        currentServerAlias={currentServerAlias}
        onOpenServer={onOpenServer}
        onOpenSettings={onOpenSettings}
      />

      {hoveredSessionTip ? (() => {
        const session = searchableSessions.find((item) => item.session.id === hoveredSessionTip.sessionId)?.session
        if (!session) return null
        return (
          <SessionHoverTip
            position={{ x: hoveredSessionTip.x, y: hoveredSessionTip.y }}
            session={session}
            hoverInfo={currentSessionHoverInfo}
          />
        )
      })() : null}

      {viewSortMenuOpen && viewSortMenuPosition ? (
        <ViewSortMenu
          position={viewSortMenuPosition}
          sessionViewMode={sessionViewMode}
          sessionSortMode={sessionSortMode}
          onSelectViewMode={selectViewMode}
          onSelectSortMode={selectSortMode}
        />
      ) : null}

      {openProjectMenuProject && projectMenuPosition ? (
        <ProjectMenu
          position={projectMenuPosition}
          project={openProjectMenuProject}
          confirmingDelete={confirmingDeleteProjectId === openProjectMenuProject.id}
          canOpenInExplorer={Boolean(onOpenProjectInExplorer)}
          onOpenInExplorer={(project) => {
            closeProjectMenu()
            onOpenProjectInExplorer?.(project)
          }}
          onOpenProjectSkills={(project) => {
            closeProjectMenu()
            onOpenProjectSkills(project)
          }}
          onRequestDelete={requestDeleteProject}
          onConfirmDelete={confirmDeleteProject}
        />
      ) : null}

      {searchOpen ? (
        <SidebarSearchDialog
          query={searchQuery}
          results={searchResults}
          loadingSessionId={loadingSessionId}
          inputRef={searchInputRef}
          onQueryChange={setSearchQuery}
          onClose={() => setSearchOpen(false)}
          onSelectResult={selectSearchResult}
        />
      ) : null}
    </aside>
  )
})
