import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  BookOpen,
  Bot,
  CalendarClock,
  CalendarPlus,
  Check,
  Clock,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Ellipsis,
  Folder,
  FolderOpen,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  PanelLeftOpen,
  Pin,
  Plus,
  Puzzle,
  SlidersHorizontal,
  Search,
  Settings,
  DownloadCloud,
  Trash2,
  GitBranch,
  Gauge,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  MeasuringStrategy,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Transform } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { sessionTitle } from '@/lib/types'
import { useSentinel } from '@/hooks/useSentinel'
import type {
  ProjectInfo,
  QuickForgeSessionMetadata,
  BackgroundTaskStatus,
  SidebarSessionSortMode,
  SidebarSessionViewMode,
} from '@/lib/types'

type ChatSidebarProps = {
  sidebarOpen: boolean
  variant?: 'desktop' | 'mobile'
  projectsCollapsed: boolean
  pinnedCollapsed: boolean
  conversationsCollapsed: boolean
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
  globalHasMore: boolean
  globalLoading: boolean
  onLoadMoreGlobal: () => void
  onLoadMorePinned: () => void
  projectHasMore: (projectId: string) => boolean
  projectLoading: (projectId: string) => boolean
  projectLoaded: (projectId: string) => boolean
  onLoadMoreProject: (projectId: string) => void
  onLoadMoreProjectTimeline: () => void
  sessionTaskStatus: (session: QuickForgeSessionMetadata) => BackgroundTaskStatus
  selectingProject: boolean
  onTogglePinnedCollapsed: () => void
  onToggleProjectsCollapsed: () => void
  onToggleConversationsCollapsed: () => void
  onToggleProjectExpanded: (projectId: string) => void
  onToggleAllProjectsExpanded: () => void
  onReorderProjects: (orderedIds: string[]) => void
  onSelectProjectDirectory?: () => void
  onStartNewProjectChat: (project: ProjectInfo) => void
  onOpenGlobalSkills: () => void
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
  onStartNewGlobalChat: () => void
  onOpenArchivedConversations: () => void
  onOpenSettings: () => void
  onOpenUpdate?: () => void
  onDismissUpdate?: () => void
  updateAvailable?: boolean
  latestVersion?: string
  currentVersion?: string
  onToggleSidebar: () => void
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

const minuteMs = 60 * 1000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs
const weekMs = 7 * dayMs
const yearMs = 365 * dayMs
const deleteSessionFadeMs = 360
const sessionHoverTipDelayMs = 300
const projectMenuWidth = 192
const projectMenuHeight = 120
const viewSortMenuWidth = 224
const viewSortMenuHeight = 244
const sidebarDefaultWidth = 320
const sidebarMinWidth = 320
const sidebarMaxWidth = 520
const sidebarMaxViewportRatio = 0.5

function getSidebarMaxWidth() {
  if (typeof window === 'undefined') return sidebarMaxWidth
  return Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, window.innerWidth * sidebarMaxViewportRatio))
}

function clampSidebarWidth(width: number) {
  return Math.min(getSidebarMaxWidth(), Math.max(sidebarMinWidth, width))
}

function formatSessionTime(value?: string) {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ''

  const elapsedMs = Math.max(0, Date.now() - timestamp)
  if (elapsedMs < hourMs) return t('relativeMinuteShort', { count: Math.max(1, Math.floor(elapsedMs / minuteMs)) })
  if (elapsedMs < dayMs) return t('relativeHourShort', { count: Math.floor(elapsedMs / hourMs) })
  if (elapsedMs < weekMs) return t('relativeDayShort', { count: Math.floor(elapsedMs / dayMs) })
  if (elapsedMs < yearMs) return t('relativeWeekShort', { count: Math.floor(elapsedMs / weekMs) })
  return t('relativeYearShort', { count: Math.floor(elapsedMs / yearMs) })
}

function isValidPinnedAt(value?: string) {
  if (!value) return false
  const normalized = value.trim()
  if (!normalized || normalized === 'undefined' || normalized === 'null' || normalized === 'false') return false
  return !Number.isNaN(Date.parse(normalized))
}

function LoadMoreSentinel({ onLoadMore, enabled }: { onLoadMore: () => void; enabled: boolean }) {
  const ref = useSentinel(onLoadMore, enabled)
  if (!enabled) return null
  return (
    <div ref={ref} className="flex items-center justify-center py-1">
      <Loader2 className="size-3 animate-spin text-muted-foreground/45" />
    </div>
  )
}

function SortableProjectItem({ id, children }: { id: string; children: (props: { listeners: ReturnType<typeof useSortable>['listeners']; attributes: ReturnType<typeof useSortable>['attributes'] }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-50 opacity-40')}>
      {children({ listeners, attributes })}
    </div>
  )
}

export const ChatSidebar = memo(function ChatSidebar({
  sidebarOpen,
  variant = 'desktop',
  projectsCollapsed,
  pinnedCollapsed,
  conversationsCollapsed,
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
  globalHasMore,
  globalLoading,
  onLoadMoreGlobal,
  onLoadMorePinned,
  projectHasMore,
  projectLoading,
  projectLoaded,
  onLoadMoreProject,
  onLoadMoreProjectTimeline,
  sessionTaskStatus,
  selectingProject,
  onTogglePinnedCollapsed,
  onToggleProjectsCollapsed,
  onToggleConversationsCollapsed,
  onToggleProjectExpanded,
  onToggleAllProjectsExpanded,
  onReorderProjects,
  onSelectProjectDirectory,
  onStartNewProjectChat,
  onOpenGlobalSkills,
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
  onStartNewGlobalChat,
  onOpenArchivedConversations,
  onOpenSettings,
  onOpenUpdate,
  onDismissUpdate,
  updateAvailable,
  latestVersion,
  currentVersion,
  onToggleSidebar,
  currentSessionHoverInfo,
}: ChatSidebarProps) {
  const sidebarHoverBgClass = 'hover:bg-[var(--quickforge-sidebar-hover-bg)]'
  const sidebarActiveBgClass = 'bg-[var(--quickforge-sidebar-hover-bg)]'
  const sectionHeaderClass = `quickforge-sidebar-section-header group mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1 text-sm font-[350] leading-5 text-muted-foreground/50 transition-colors ${sidebarHoverBgClass}`
  const sectionToggleClass = 'quickforge-sidebar-section-toggle flex min-w-0 flex-1 items-center gap-1 text-left transition-colors'
  const chevronClass = 'quickforge-sidebar-section-icon size-4 shrink-0 text-current opacity-0 transition-[transform,opacity] duration-200 ease-out group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none'
  const collapsePanelClass = 'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none'
  const collapsePanelOpenClass = 'grid-rows-[1fr] opacity-100'
  const collapsePanelClosedClass = 'pointer-events-none grid-rows-[0fr] opacity-0'
  const collapseInnerClass = 'min-h-0 overflow-hidden'
  const rowHoverShadowClass = ''
  const iconHoverShadowClass = ''
  const rowClass = `group relative flex items-center gap-2 overflow-hidden rounded-lg py-1.5 text-left transition-[background-color,color,box-shadow] duration-160 ease-out ${sidebarOpen ? 'px-2' : 'justify-center px-0'} ${rowHoverShadowClass}`
  const footerRowClass = `group relative flex items-center gap-2 overflow-hidden py-1.5 text-left transition-[background-color,color,box-shadow] duration-160 ease-out ${sidebarOpen ? 'px-2' : 'justify-center px-0'}`
  const activeRowClass = `${sidebarActiveBgClass} text-foreground/84 shadow-[0_8px_22px_-20px_rgb(15_23_42_/_0.32)]`
  const projectActiveRowClass = `text-foreground/80 ${sidebarHoverBgClass}`
  const inactiveRowClass = `text-muted-foreground/68 ${sidebarHoverBgClass} hover:text-foreground/80`
  const sessionInactiveRowClass = `text-muted-foreground/70 ${sidebarHoverBgClass} hover:text-foreground/82`
  const iconSlotClass = 'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/55 transition-colors group-hover:text-foreground/70'
  const iconButtonClass = `size-7 shrink-0 rounded-full text-muted-foreground/55 transition-[background-color,color,box-shadow,opacity] duration-160 ease-out ${sidebarHoverBgClass} hover:text-foreground/85 ${iconHoverShadowClass}`
  const sectionActionButtonClass = `quickforge-sidebar-section-icon ${iconButtonClass} pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100`
  const actionOverlayBaseClass = 'pointer-events-none absolute inset-y-0 right-1 z-20 flex items-center gap-px rounded-r-lg bg-gradient-to-l from-[var(--quickforge-sidebar-hover-bg)] via-[var(--quickforge-sidebar-hover-bg)]/95 to-transparent pl-4 opacity-0 transition-opacity duration-160'
  const actionOverlayClass = `${actionOverlayBaseClass} group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100`
  const projectActionOverlayClass = `${actionOverlayBaseClass} group-hover:pointer-events-auto group-hover:opacity-100`
  const overlayIconButtonClass = `size-6 shrink-0 rounded-full text-muted-foreground/55 transition-[background-color,color,box-shadow] duration-160 ease-out ${sidebarHoverBgClass} hover:text-foreground/85 ${iconHoverShadowClass}`
  const sessionTitleClass = 'truncate text-sm font-[350] leading-5'
  const sessionButtonClass = 'flex min-w-0 flex-1 items-center gap-2 text-left'
  const sessionTitleRowClass = 'flex min-w-0 flex-1 items-center gap-1 truncate'
  const sessionLoadingIndicator = (sessionId: string) => loadingSessionId === sessionId
    ? <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground/55" aria-hidden="true" />
    : null
  const pinnedSessionButtonClass = `relative z-10 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/55 transition-opacity duration-160 transition-colors ${sidebarHoverBgClass} hover:text-foreground/85`
  const sessionMetaHoverHiddenClass = 'group-hover:pointer-events-none group-hover:opacity-0 group-focus-within:pointer-events-none group-focus-within:opacity-0'
  const activeSessionTitleClass = 'font-[350] text-foreground/84'
  const activeProjectTitleClass = 'font-[350] text-foreground/80'
  const timeClass = 'quickforge-sidebar-session-time shrink-0 text-[11px] leading-4 transition-opacity duration-160'
  const searchDialogClass = 'fixed inset-0 z-50 flex items-start justify-center bg-background/50 px-4 pt-[12vh] backdrop-blur-sm'
  const projectMenuClass = 'fixed z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-background p-1 shadow-quickforge'
  const viewSortMenuClass = 'fixed z-50 overflow-hidden rounded-2xl border border-border bg-background p-1.5 shadow-quickforge'
  const viewSortMenuSectionLabelClass = 'px-3 pb-1 pt-2 text-xs font-[350] leading-4 text-muted-foreground/50'
  const viewSortMenuItemClass = 'flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm text-foreground/86 transition-colors hover:bg-muted/45'
  const sessionHoverTipClass = 'pointer-events-none fixed z-50 w-[min(24rem,calc(100vw-1rem))] max-w-sm rounded-2xl border border-border bg-popover px-4 py-3 text-left shadow-quickforge'
  const sessionHoverTipMetaClass = 'mt-2 flex items-center gap-2 text-sm leading-5 text-muted-foreground/72'
  const isMobile = variant === 'mobile'
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
  const [sidebarWidth, setSidebarWidth] = useState(sidebarDefaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const resizeDragRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const previousBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null)
  const deleteAnimationTimeoutRef = useRef<number | null>(null)
  const projectDeleteAnimationTimeoutRef = useRef<number | null>(null)
  const hoverTipTimerRef = useRef<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const restrictToVertical = useCallback((args: { transform: Transform }) => ({
    ...args.transform,
    x: 0,
  }), [])

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

  const handleDragStart = useCallback(() => {
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

  const searchInputRef = useRef<HTMLInputElement>(null)
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
    ? searchableSessions.filter(({ session, projectName }) => `${sessionTitle(session.title, session.channelName)} ${projectName}`.toLowerCase().includes(searchQuery.trim().toLowerCase())).slice(0, 8)
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

  const restoreResizeBodyStyle = useCallback(() => {
    const previousBodyStyle = previousBodyStyleRef.current
    if (!previousBodyStyle) return
    document.body.style.cursor = previousBodyStyle.cursor
    document.body.style.userSelect = previousBodyStyle.userSelect
    previousBodyStyleRef.current = null
  }, [])

  const finishResizing = useCallback((finalWidth?: number) => {
    resizeDragRef.current = null
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
    if (typeof finalWidth === 'number') {
      const nextWidth = clampSidebarWidth(finalWidth)
      if (asideRef.current) asideRef.current.style.width = `${nextWidth}px`
      setSidebarWidth(nextWidth)
    }
    restoreResizeBodyStyle()
    setIsResizing(false)
  }, [restoreResizeBodyStyle])

  function startResizing(event: React.PointerEvent<HTMLDivElement>) {
    const currentWidth = asideRef.current?.getBoundingClientRect().width ?? sidebarWidth
    resizeDragRef.current = { startX: event.clientX, startWidth: currentWidth, currentWidth }
    previousBodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setIsResizing(true)
    event.preventDefault()
    event.stopPropagation()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  function resizeSidebar(event: React.PointerEvent<HTMLDivElement>) {
    const start = resizeDragRef.current
    if (!start || !asideRef.current) return
    start.currentWidth = clampSidebarWidth(start.startWidth + event.clientX - start.startX)
    if (resizeFrameRef.current !== null) return
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      const current = resizeDragRef.current
      if (!current || !asideRef.current) return
      asideRef.current.style.width = `${current.currentWidth}px`
    })
  }

  function stopResizing(event: React.PointerEvent<HTMLDivElement>) {
    const finalWidth = resizeDragRef.current?.currentWidth
    finishResizing(finalWidth)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  function resetSidebarWidth() {
    finishResizing(sidebarDefaultWidth)
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
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
    }
    resizeDragRef.current = null
    restoreResizeBodyStyle()
  }, [restoreResizeBodyStyle])

  useEffect(() => {
    if (!isMobile && sidebarOpen) return
    const frame = window.requestAnimationFrame(() => finishResizing())
    return () => window.cancelAnimationFrame(frame)
  }, [finishResizing, isMobile, sidebarOpen])

  useEffect(() => {
    if (isMobile) return
    const syncWidthToViewport = () => {
      const nextWidth = clampSidebarWidth(resizeDragRef.current?.currentWidth ?? sidebarWidth)
      finishResizing(nextWidth)
    }
    window.addEventListener('resize', syncWidthToViewport)
    return () => window.removeEventListener('resize', syncWidthToViewport)
  }, [finishResizing, isMobile, sidebarWidth])

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

  const renderPinnedSessionItem = ({ session }: { session: QuickForgeSessionMetadata }) => {
    const selected = currentSessionId === session.id
    const actionsSuppressed = suppressedSessionActionsId === session.id
    const deleting = deletingSessionId === session.id
    return (
      <div
        key={session.id}
        className={cn(
          'grid transition-[grid-template-rows,opacity,transform] duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
          deleting ? 'grid-rows-[0fr] -translate-x-1 opacity-0' : 'grid-rows-[1fr] translate-x-0 opacity-100',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              rowClass,
              selected ? activeRowClass : sessionInactiveRowClass,
              deleting && 'pointer-events-none scale-[0.98] opacity-0 duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
            )}
            onMouseEnter={(event) => showSessionHoverTip(event, session.id)}
            onMouseLeave={() => {
              setSuppressedSessionActionsId((current) => current === session.id ? null : current)
              if (!deleting) {
                setConfirmingDeleteSessionId((current) => current === session.id ? null : current)
              }
              hideSessionHoverTip(session.id)
            }}
          >
            <div
              role="button"
              tabIndex={0}
              aria-busy={loadingSessionId === session.id}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => onLoadSession(session.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onLoadSession(session.id)
              }}
            >
              <div className="min-w-0 flex-1">
                <div className={sessionTitleRowClass}>
                  {sessionLoadingIndicator(session.id)}
                  {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                  <span className={cn(sessionTitleClass, selected && activeSessionTitleClass)}>{sessionTitle(session.title, session.channelName)}</span>
                </div>
              </div>
              <button
                type="button"
                className={cn(pinnedSessionButtonClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}
                onClick={(event) => {
                  event.stopPropagation()
                  onTogglePinSession(session.id)
                }}
                aria-label={t('unpinSession')}
                title={t('unpinSession')}
              >
                <Pin className="size-3" />
              </button>
              <span className={cn(timeClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}>{formatSessionTime(session.pinnedAt)}</span>
            </div>
            <div className={cn(actionOverlayClass, actionsSuppressed && 'hidden')}>
              {confirmingDeleteSessionId === session.id ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-6 rounded-full px-2 text-xs"
                  onClick={(event) => confirmDeleteSession(event, session.id)}
                  aria-label={t('confirmArchive')}
                  title={t('confirmArchive')}
                >
                  {t('confirm')}
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={overlayIconButtonClass}
                    onClick={(event) => toggleSessionPinFromActions(event, session.id)}
                    aria-label={t('unpinSession')}
                  >
                    <Pin className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={overlayIconButtonClass}
                    onClick={(event) => requestDeleteSession(event, session.id)}
                    aria-label={t('archiveSession')}
                  >
                    <Archive className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <aside
      ref={asideRef}
      className={cn(
        'relative z-10 min-h-0 shrink-0 overflow-hidden border-r-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-[var(--quickforge-sidebar-bg)] transition-[width] duration-200 ease-out motion-reduce:transition-none',
        isMobile ? 'flex h-full w-80 max-w-[85vw] flex-col' : 'hidden md:flex md:flex-col',
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
            'group absolute inset-y-0 right-0 z-30 w-2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-border/20',
            isResizing && 'bg-border/25',
          )}
          onDoubleClick={resetSidebarWidth}
          onPointerDown={startResizing}
          onPointerMove={resizeSidebar}
          onPointerUp={stopResizing}
          onPointerCancel={stopResizing}
        >
          <span className={cn(
            'absolute inset-y-0 right-0 w-px bg-border/70 opacity-0 transition-opacity',
            isResizing ? 'opacity-100' : 'group-hover:opacity-100',
          )} />
        </div>
      ) : null}
      <div className="shrink-0 px-3 pt-3 pb-1">
        <div className={cn(rowClass, 'w-full')}>
          {sidebarOpen ? (
            <>
              <span className={iconSlotClass}>
                <img src="/favicon.svg" alt="" aria-hidden="true" className="size-5" />
              </span>
              <button
                type="button"
                className={cn(iconButtonClass, 'ml-auto inline-flex items-center justify-center')}
                onClick={onToggleSidebar}
                aria-label={t('toggleSidebar')}
                title={t('toggleSidebar')}
              >
                <PanelLeft className="size-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className={cn(iconButtonClass, 'group/toggle relative inline-flex items-center justify-center')}
              onClick={onToggleSidebar}
              aria-label={t('toggleSidebar')}
              title={t('toggleSidebar')}
            >
              <img src="/favicon.svg" alt="" aria-hidden="true" className="size-5 transition-opacity duration-160 group-hover/toggle:opacity-0 group-focus-visible/toggle:opacity-0" />
              <PanelLeftOpen className="absolute size-4 opacity-0 transition-opacity duration-160 group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100" />
            </button>
          )}
        </div>
        <button
          type="button"
          className={cn(rowClass, 'mt-4 w-full', inactiveRowClass)}
          onClick={onStartNewGlobalChat}
          aria-label={t('startNewChat')}
          title={t('startNewChat')}
        >
          <span className={iconSlotClass}>
            <MessageSquarePlus className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>{t('startNewChat')}</span> : null}
        </button>
        <button
          type="button"
          className={cn(rowClass, 'w-full', inactiveRowClass)}
          onClick={openSearch}
          aria-label={t('search')}
        >
          <span className={iconSlotClass}>
            <Search className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>{t('search')}</span> : null}
        </button>
        <button
          type="button"
          className={cn(rowClass, 'w-full', inactiveRowClass)}
          onClick={onOpenScheduledTasks}
          aria-label={t('scheduledTasks')}
          title={t('scheduledTasks')}
        >
          <span className={iconSlotClass}>
            <CalendarClock className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>{t('scheduledTasks')}</span> : null}
        </button>
        <button
          type="button"
          className={cn(rowClass, 'w-full', inactiveRowClass)}
          onClick={onOpenGlobalSkills}
          aria-label={t('manageGlobalSkills')}
          title={t('manageGlobalSkills')}
        >
          <span className={iconSlotClass}>
            <BookOpen className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>{t('skills')}</span> : null}
        </button>
        <button
          type="button"
          className={cn(rowClass, 'w-full', inactiveRowClass)}
          onClick={onOpenAgents}
          aria-label={t('agentsTab')}
          title={t('agentsTab')}
        >
          <span className={iconSlotClass}>
            <Bot className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>{t('agentsTab')}</span> : null}
        </button>
      </div>

      {sidebarOpen ? (
        <>
          {(pinnedSessionItems.length > 0 || pinnedLoading) ? (
            <div className="shrink-0 px-3 pb-1 max-h-[28%] flex flex-col min-h-0 overflow-hidden">
              <div className={sectionHeaderClass}>
                <button type="button" className={sectionToggleClass} onClick={onTogglePinnedCollapsed} aria-expanded={!pinnedCollapsed}>
                  <span className="truncate">{t('pinnedConversations')}</span>
                  <ChevronRight className={cn(chevronClass, !pinnedCollapsed && 'rotate-90')} />
                </button>
              </div>
              <div className={cn(collapsePanelClass, 'flex-1 min-h-0', pinnedCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass)}>
                <div className={collapseInnerClass}>
                  <div className="h-full overflow-y-auto">
                    <div className="space-y-0.5">
                      {pinnedSessionItems.length === 0 ? (
                        <div className="flex items-center px-3 py-3 text-xs text-muted-foreground/55">
                          <Loader2 className="mr-1.5 size-3 animate-spin" />
                          {t('loadingChatWorkspace')}
                        </div>
                      ) : (
                        <>
                          {pinnedSessionItems.map(renderPinnedSessionItem)}
                          <LoadMoreSentinel onLoadMore={onLoadMorePinned} enabled={pinnedHasMore && !pinnedLoading} />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <div className="shrink-0 px-3 max-h-[55%] flex flex-col min-h-0 overflow-hidden">
            <div className="mb-0.5 flex min-h-0 flex-1 flex-col">
              <div className={sectionHeaderClass}>
                <button type="button" className={sectionToggleClass} onClick={onToggleProjectsCollapsed} aria-expanded={!projectsCollapsed}>
                  <span className="truncate">{t('projects')}</span>
                  <ChevronRight className={cn(chevronClass, !projectsCollapsed && 'rotate-90')} />
                </button>
                {projects.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={sectionActionButtonClass}
                    onClick={openViewSortMenu}
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
                    onClick={onToggleAllProjectsExpanded}
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
                    onClick={onSelectProjectDirectory}
                    disabled={selectingProject}
                    aria-label={t('addProject')}
                  >
                    <Plus className="size-4" />
                  </Button>
                ) : null}
              </div>

              <div className={cn(collapsePanelClass, 'flex-1 min-h-0', projectsCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass)}>
                <div className={collapseInnerClass}>
                  <div className="h-full overflow-y-auto">
                    <div className="space-y-0.5">
                      {projects.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-muted-foreground/55">{t('noProjects')}</div>
                      ) : sessionViewMode === 'timeline' ? (
                        timelineSessions.length === 0 ? (
                          projectTimelineLoading ? (
                            <div className="flex items-center px-3 py-3 text-xs text-muted-foreground/55">
                              <Loader2 className="mr-1.5 size-3 animate-spin" />
                              {t('loadingChatWorkspace')}
                            </div>
                          ) : (
                            <div className="px-3 py-3 text-xs text-muted-foreground/55">{t('noConversations')}</div>
                          )
                        ) : (
                          <>
                            {timelineSessions.map(({ session }) => {
                              const selected = currentSessionId === session.id
                              const actionsSuppressed = suppressedSessionActionsId === session.id
                              const deleting = deletingSessionId === session.id
                              const timeValue = sessionSortMode === 'createdAt' ? session.createdAt : session.lastModified
                              return (
                                <div
                                  key={session.id}
                                  className={cn(
                                    'grid transition-[grid-template-rows,opacity,transform] duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                                    deleting ? 'grid-rows-[0fr] -translate-x-1 opacity-0' : 'grid-rows-[1fr] translate-x-0 opacity-100',
                                  )}
                                >
                                  <div className="min-h-0 overflow-hidden">
                                    <div
                                      className={cn(
                                        rowClass,
                                        selected ? activeRowClass : sessionInactiveRowClass,
                                        deleting && 'pointer-events-none scale-[0.98] opacity-0 duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                                      )}
                                      onMouseEnter={(event) => showSessionHoverTip(event, session.id)}
                                      onMouseLeave={() => {
                                        setSuppressedSessionActionsId((current) => current === session.id ? null : current)
                                        if (!deleting) {
                                          setConfirmingDeleteSessionId((current) => current === session.id ? null : current)
                                        }
                                        hideSessionHoverTip(session.id)
                                      }}
                                    >
                                      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" type="button" aria-busy={loadingSessionId === session.id} onClick={() => onLoadSession(session.id)}>
                                        <div className="min-w-0 flex-1">
                                          <div className={sessionTitleRowClass}>
                                            {sessionLoadingIndicator(session.id)}
                                            {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                                            <span className={cn(sessionTitleClass, selected && activeSessionTitleClass)}>{sessionTitle(session.title, session.channelName)}</span>
                                          </div>
                                        </div>
                                        {session.pinnedAt ? (
                                          <button
                                            type="button"
                                            className={cn(pinnedSessionButtonClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}
                                            onClick={(event) => {
                                              event.stopPropagation()
                                              onTogglePinSession(session.id)
                                            }}
                                            aria-label={t('unpinSession')}
                                            title={t('unpinSession')}
                                          >
                                            <Pin className="size-3" />
                                          </button>
                                        ) : null}
                                        <span className={cn(timeClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}>{formatSessionTime(timeValue)}</span>
                                      </button>
                                      <div className={cn(actionOverlayClass, actionsSuppressed && 'hidden')}>
                                        {confirmingDeleteSessionId === session.id ? (
                                          <Button
                                            variant="destructive"
                                            size="sm"
                                            className="h-6 rounded-full px-2 text-xs"
                                            onClick={(event) => confirmDeleteSession(event, session.id)}
                                            aria-label={t('confirmArchive')}
                                            title={t('confirmArchive')}
                                          >
                                            {t('confirm')}
                                          </Button>
                                        ) : (
                                          <>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className={overlayIconButtonClass}
                                              onClick={(event) => toggleSessionPinFromActions(event, session.id)}
                                              aria-label={session.pinnedAt ? t('unpinSession') : t('pinSession')}
                                            >
                                              <Pin className="size-3.5" />
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className={overlayIconButtonClass}
                                              onClick={(event) => requestDeleteSession(event, session.id)}
                                              aria-label={t('archiveSession')}
                                            >
                                              <Archive className="size-3.5" />
                                            </Button>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                            <LoadMoreSentinel
                              onLoadMore={onLoadMoreProjectTimeline}
                              enabled={projectTimelineHasMore && !projectTimelineLoading}
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
                          modifiers={[restrictToVertical]}
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
                                    'grid transition-[grid-template-rows,opacity,transform] duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                                    deleting ? 'grid-rows-[0fr] -translate-x-1 opacity-0' : 'grid-rows-[1fr] translate-x-0 opacity-100',
                                  )}
                                >
                                  <div className="min-h-0 overflow-hidden">
                              <div
                                className={cn(
                                  rowClass,
                                  active ? projectActiveRowClass : inactiveRowClass,
                                  menuOpen && 'z-20 overflow-visible',
                                  deleting && 'pointer-events-none scale-[0.98] opacity-0 duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                                )}
                                style={{ touchAction: 'none' }}
                                {...listeners}
                                {...attributes}
                              >
                                <button
                                  type="button"
                                  className={iconSlotClass}
                                  onClick={() => onToggleProjectExpanded(item.id)}
                                  aria-label={expanded ? t('collapseProject') : t('expandProject')}
                                >
                                  {expanded ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
                                </button>
                                <button
                                  className="flex min-w-0 flex-1 items-center text-left"
                                  type="button"
                                  title={item.path}
                                  onClick={() => onToggleProjectExpanded(item.id)}
                                >
                                  <span className={cn(sessionTitleClass, active && activeProjectTitleClass)}>{item.name}</span>
                                </button>
                                <div className={projectActionOverlayClass}>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={overlayIconButtonClass}
                                    onClick={(event) => openProjectMenu(event, item.id)}
                                    aria-label={t('moreOptions')}
                                    aria-expanded={menuOpen}
                                  >
                                    <Ellipsis className="size-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={overlayIconButtonClass}
                                    onClick={() => onStartNewProjectChat(item)}
                                    aria-label={t('newProjectChat')}
                                  >
                                    <MessageSquarePlus className="size-4" />
                                  </Button>
                                </div>
                              </div>

                              <div className={cn(collapsePanelClass, isProjectDragging && 'transition-none', expanded ? collapsePanelOpenClass : collapsePanelClosedClass)}>
                                <div className={collapseInnerClass}>
                                  <div className="mt-0.5 space-y-0.5 pl-8 max-h-[35vh] overflow-y-auto">
                                    {projectSessions.length === 0 && !loaded ? (
                                      <div className="flex items-center px-2 py-1.5 text-xs text-muted-foreground/55">
                                        <Loader2 className="mr-1.5 size-3 animate-spin" />
                                        {t('loadingChatWorkspace')}
                                      </div>
                                    ) : projectSessions.length === 0 && projectLoading(item.id) ? (
                                      <div className="flex items-center px-2 py-1.5 text-xs text-muted-foreground/55">
                                        <Loader2 className="mr-1.5 size-3 animate-spin" />
                                        {t('loadingChatWorkspace')}
                                      </div>
                                    ) : projectSessions.length === 0 && !projectHasMore(item.id) ? (
                                      <div className="px-2 py-1.5 text-xs text-muted-foreground/55">{t('noConversations')}</div>
                                    ) : (
                                      <>
                                        {projectSessions.map((session) => {
                                          const selected = currentSessionId === session.id
                                          const actionsSuppressed = suppressedSessionActionsId === session.id
                                          const deleting = deletingSessionId === session.id
                                          return (
                                            <div
                                              key={session.id}
                                              className={cn(
                                                'grid transition-[grid-template-rows,opacity,transform] duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                                                deleting ? 'grid-rows-[0fr] -translate-x-1 opacity-0' : 'grid-rows-[1fr] translate-x-0 opacity-100',
                                              )}
                                            >
                                              <div className="min-h-0 overflow-hidden">
                                                <div
                                                  className={cn(
                                                    rowClass,
                                                    'gap-1',
                                                    selected ? activeRowClass : sessionInactiveRowClass,
                                                    deleting && 'pointer-events-none scale-[0.98] opacity-0 duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                                                  )}
                                                  onMouseEnter={(event) => showSessionHoverTip(event, session.id)}
                                                  onMouseLeave={() => {
                                                    setSuppressedSessionActionsId((current) => current === session.id ? null : current)
                                                    if (!deleting) {
                                                      setConfirmingDeleteSessionId((current) => current === session.id ? null : current)
                                                    }
                                                    hideSessionHoverTip(session.id)
                                                  }}
                                                >
                                              <button className={sessionButtonClass} type="button" aria-busy={loadingSessionId === session.id} onClick={() => onLoadSession(session.id)}>
                                                <div className={sessionTitleRowClass}>
                                                  {sessionLoadingIndicator(session.id)}
                                                  {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                                                  <span className={cn(sessionTitleClass, selected && activeSessionTitleClass)}>{sessionTitle(session.title, session.channelName)}</span>
                                                </div>
                                                {session.pinnedAt ? (
                                                  <button
                                                    type="button"
                                                    className={cn(pinnedSessionButtonClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}
                                                    onClick={(event) => {
                                                      event.stopPropagation()
                                                      onTogglePinSession(session.id)
                                                    }}
                                                    aria-label={t('unpinSession')}
                                                    title={t('unpinSession')}
                                                  >
                                                    <Pin className="size-3" />
                                                  </button>
                                                ) : null}
                                                <span className={cn(timeClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}>{formatSessionTime(sessionSortMode === 'createdAt' ? session.createdAt : session.lastModified)}</span>
                                              </button>
                                              <div className={cn(actionOverlayClass, actionsSuppressed && 'hidden')}>
                                                {confirmingDeleteSessionId === session.id ? (
                                                  <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    className="h-6 rounded-full px-2 text-xs"
                                                    onClick={(event) => confirmDeleteSession(event, session.id)}
                                                    aria-label={t('confirmArchive')}
                                                    title={t('confirmArchive')}
                                                  >
                                                    {t('confirm')}
                                                  </Button>
                                                ) : (
                                                  <>
                                                    <Button
                                                      variant="ghost"
                                                      size="icon"
                                                      className={overlayIconButtonClass}
                                                      onClick={(event) => toggleSessionPinFromActions(event, session.id)}
                                                      aria-label={session.pinnedAt ? t('unpinSession') : t('pinSession')}
                                                    >
                                                      <Pin className="size-3.5" />
                                                    </Button>
                                                    <Button
                                                      variant="ghost"
                                                      size="icon"
                                                      className={overlayIconButtonClass}
                                                      onClick={(event) => requestDeleteSession(event, session.id)}
                                                      aria-label={t('archiveSession')}
                                                    >
                                                      <Archive className="size-3.5" />
                                                    </Button>
                                                  </>
                                                )}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                          )
                                        })}
                                        <LoadMoreSentinel
                                          onLoadMore={() => onLoadMoreProject(item.id)}
                                          enabled={projectHasMore(item.id) && !projectLoading(item.id)}
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

          <div className="flex-1 min-h-0 flex flex-col px-3 pb-3">
            <div className={sectionHeaderClass}>
              <button type="button" className={sectionToggleClass} onClick={onToggleConversationsCollapsed} aria-expanded={!conversationsCollapsed}>
                <span className="truncate">{t('conversations')}</span>
                <ChevronRight className={cn(chevronClass, !conversationsCollapsed && 'rotate-90')} />
              </button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(iconButtonClass, 'quickforge-sidebar-section-icon')}
                onClick={onStartNewGlobalChat}
                aria-label={t('newChat')}
              >
                <MessageSquarePlus className="size-4" />
              </Button>
            </div>

            <div className={cn(collapsePanelClass, 'flex-1 min-h-0', conversationsCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass)}>
              <div className={collapseInnerClass}>
                <div className="h-full overflow-y-auto">
                  {globalSessions.length === 0 && !globalHasMore ? (
                    <div className="px-3 py-3 text-xs text-muted-foreground/55">{t('noSavedConversations')}</div>
                  ) : (
                    <div className="space-y-0.5">
                      {globalSessions.map((session) => {
                        const selected = currentSessionId === session.id
                        const actionsSuppressed = suppressedSessionActionsId === session.id
                        const deleting = deletingSessionId === session.id
                        return (
                          <div
                            key={session.id}
                            className={cn(
                              'grid transition-[grid-template-rows,opacity,transform] duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                              deleting ? 'grid-rows-[0fr] -translate-x-1 opacity-0' : 'grid-rows-[1fr] translate-x-0 opacity-100',
                            )}
                          >
                            <div className="min-h-0 overflow-hidden">
                              <div
                                className={cn(
                                  rowClass,
                                  selected ? activeRowClass : sessionInactiveRowClass,
                                  deleting && 'pointer-events-none scale-[0.98] opacity-0 duration-[360ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                                )}
                                onMouseEnter={(event) => showSessionHoverTip(event, session.id)}
                                onMouseLeave={() => {
                                  setSuppressedSessionActionsId((current) => current === session.id ? null : current)
                                  if (!deleting) {
                                    setConfirmingDeleteSessionId((current) => current === session.id ? null : current)
                                  }
                                  hideSessionHoverTip(session.id)
                                }}
                              >
                            <button className={sessionButtonClass} type="button" aria-busy={loadingSessionId === session.id} onClick={() => onLoadSession(session.id)}>
                              <div className={sessionTitleRowClass}>
                                {sessionLoadingIndicator(session.id)}
                                {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                                <span className={cn(sessionTitleClass, selected && activeSessionTitleClass)}>{sessionTitle(session.title, session.channelName)}</span>
                              </div>
                              {session.pinnedAt ? (
                                <button
                                  type="button"
                                  className={cn(pinnedSessionButtonClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onTogglePinSession(session.id)
                                  }}
                                  aria-label={t('unpinSession')}
                                  title={t('unpinSession')}
                                >
                                  <Pin className="size-3" />
                                </button>
                              ) : null}
                              <span className={cn(timeClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}>{formatSessionTime(sessionSortMode === 'createdAt' ? session.createdAt : session.lastModified)}</span>
                            </button>
                            <div className={cn(actionOverlayClass, actionsSuppressed && 'hidden')}>
                              {confirmingDeleteSessionId === session.id ? (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-6 rounded-full px-2 text-xs"
                                  onClick={(event) => confirmDeleteSession(event, session.id)}
                                  aria-label={t('confirmArchive')}
                                  title={t('confirmArchive')}
                                >
                                  {t('confirm')}
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={overlayIconButtonClass}
                                    onClick={(event) => toggleSessionPinFromActions(event, session.id)}
                                    aria-label={session.pinnedAt ? t('unpinSession') : t('pinSession')}
                                  >
                                    <Pin className="size-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={overlayIconButtonClass}
                                    onClick={(event) => requestDeleteSession(event, session.id)}
                                    aria-label={t('archiveSession')}
                                  >
                                    <Archive className="size-4" />
                                  </Button>
                                </>
                              )}
                              </div>
                            </div>
                          </div>
                        </div>
                        )
                      })}
                      <LoadMoreSentinel
                        onLoadMore={onLoadMoreGlobal}
                        enabled={globalHasMore && !globalLoading}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="mt-auto shrink-0 border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-3 py-3">
        {updateAvailable && latestVersion ? (
          <button
            type="button"
            className={cn(
              footerRowClass,
              'relative mb-2 w-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10',
            )}
            onClick={onOpenUpdate}
            aria-label={t('newVersionAvailable', { version: latestVersion })}
            title={t('newVersionAvailable', { version: latestVersion })}
          >
            <span className={cn(iconSlotClass, 'text-primary/80')}>
              <DownloadCloud className="size-4" />
            </span>
            {sidebarOpen ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium leading-tight">
                  {t('newVersionAvailable', { version: latestVersion })}
                </span>
                {currentVersion ? (
                  <span className="block truncate text-[11px] leading-tight text-primary/70">
                    {t('newVersionAvailableSub', { current: currentVersion })}
                  </span>
                ) : null}
              </span>
            ) : null}
            {sidebarOpen && onDismissUpdate ? (
              <span
                className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] text-primary/60 transition-colors hover:bg-primary/15 hover:text-primary"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  onDismissUpdate()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation()
                    event.preventDefault()
                    onDismissUpdate()
                  }
                }}
              >
                {t('updateLater')}
              </span>
            ) : null}
            {!sidebarOpen ? (
              <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />
            ) : null}
          </button>
        ) : null}
        <button
          type="button"
          className={cn(footerRowClass, 'min-h-9 w-full shrink-0 rounded-lg', inactiveRowClass)}
          onClick={onOpenArchivedConversations}
          aria-label={t('archivedConversations')}
          title={t('archivedConversations')}
        >
          <span className={iconSlotClass}>
            <Archive className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>{t('archivedConversations')}</span> : null}
        </button>
        <button
          type="button"
          className={cn(footerRowClass, 'min-h-9 w-full shrink-0 rounded-lg', inactiveRowClass)}
          onClick={onOpenSettings}
          aria-label={t('settings')}
          title={t('settings')}
        >
          <span className={iconSlotClass}>
            <Settings className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>{t('settings')}</span> : null}
        </button>
      </div>

      {hoveredSessionTip ? (() => {
        const session = searchableSessions.find((item) => item.session.id === hoveredSessionTip.sessionId)?.session
        if (!session) return null
        const showRuntimeInfo = currentSessionHoverInfo?.sessionId === session.id
        return (
          <div
            className={sessionHoverTipClass}
            style={{ left: hoveredSessionTip.x, top: hoveredSessionTip.y, transform: 'translateY(-50%)' }}
          >
            <div className="truncate text-sm font-medium leading-5 text-foreground/92">{sessionTitle(session.title, session.channelName)}</div>
            {showRuntimeInfo && currentSessionHoverInfo?.gitBranch ? (
              <div className={sessionHoverTipMetaClass}>
                <GitBranch className="size-4 shrink-0 text-muted-foreground/60" />
                <span className="truncate">{currentSessionHoverInfo.gitBranch}</span>
              </div>
            ) : null}
            {showRuntimeInfo && currentSessionHoverInfo?.context ? (
              <div className={sessionHoverTipMetaClass} title={currentSessionHoverInfo.context.title}>
                <Gauge className="size-4 shrink-0 text-muted-foreground/60" />
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: currentSessionHoverInfo.context.color }} />
                <span className="truncate">{currentSessionHoverInfo.context.label}</span>
              </div>
            ) : null}
          </div>
        )
      })() : null}

      {viewSortMenuOpen && viewSortMenuPosition ? createPortal(
        <div
          className={viewSortMenuClass}
          style={{ left: viewSortMenuPosition.x, top: viewSortMenuPosition.y, width: viewSortMenuWidth }}
          role="menu"
          aria-label={t('filterSort')}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={viewSortMenuSectionLabelClass}>{t('sidebarView')}</div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sessionViewMode === 'project'}
            className={viewSortMenuItemClass}
            onClick={() => selectViewMode('project')}
          >
            <Folder className="size-4 shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 flex-1 truncate">{t('sidebarViewByProject')}</span>
            {sessionViewMode === 'project' ? <Check className="size-4 shrink-0 text-muted-foreground/70" /> : <span className="size-4 shrink-0" />}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sessionViewMode === 'timeline'}
            className={viewSortMenuItemClass}
            onClick={() => selectViewMode('timeline')}
          >
            <Clock className="size-4 shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 flex-1 truncate">{t('sidebarViewTimeline')}</span>
            {sessionViewMode === 'timeline' ? <Check className="size-4 shrink-0 text-muted-foreground/70" /> : <span className="size-4 shrink-0" />}
          </button>
          <div className="my-1 border-t" style={{ borderColor: 'color-mix(in oklab, var(--muted-foreground) 50%, transparent)' }} />
          <div className={viewSortMenuSectionLabelClass}>{t('sortBy')}</div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sessionSortMode === 'updatedAt'}
            className={viewSortMenuItemClass}
            onClick={() => selectSortMode('updatedAt')}
          >
            <Clock className="size-4 shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 flex-1 truncate">{t('sortByUpdatedAt')}</span>
            {sessionSortMode === 'updatedAt' ? <Check className="size-4 shrink-0 text-muted-foreground/70" /> : <span className="size-4 shrink-0" />}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sessionSortMode === 'createdAt'}
            className={viewSortMenuItemClass}
            onClick={() => selectSortMode('createdAt')}
          >
            <CalendarPlus className="size-4 shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 flex-1 truncate">{t('sortByCreatedAt')}</span>
            {sessionSortMode === 'createdAt' ? <Check className="size-4 shrink-0 text-muted-foreground/70" /> : <span className="size-4 shrink-0" />}
          </button>
        </div>,
        document.body,
      ) : null}

      {openProjectMenuProject && projectMenuPosition ? createPortal(
        <div
          className={projectMenuClass}
          style={{ left: projectMenuPosition.x, top: projectMenuPosition.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {onOpenProjectInExplorer ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
              title={t('openInExplorer')}
              aria-label={t('openInExplorer')}
              onClick={() => {
                closeProjectMenu()
                onOpenProjectInExplorer(openProjectMenuProject)
              }}
            >
              <FolderOpen className="size-4 shrink-0 text-muted-foreground/70" />
              <span>{t('openFolder')}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-foreground/86 transition-colors hover:bg-muted"
            onClick={() => {
              closeProjectMenu()
              onOpenProjectSkills(openProjectMenuProject)
            }}
          >
            <Puzzle className="size-4 shrink-0 text-muted-foreground/70" />
            <span>{t('manageProjectSkills')}</span>
          </button>
          {confirmingDeleteProjectId === openProjectMenuProject.id ? (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-destructive px-2 py-1.5 text-left text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
              aria-label={t('confirmDelete')}
              onClick={(event) => confirmDeleteProject(event, openProjectMenuProject.id)}
            >
              <span>{t('confirm')}</span>
            </button>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
              aria-label={t('deleteProject')}
              onClick={(event) => requestDeleteProject(event, openProjectMenuProject.id)}
            >
              <Trash2 className="size-4 shrink-0" />
              <span>{t('deleteProject')}</span>
            </button>
          )}
        </div>,
        document.body,
      ) : null}

      {searchOpen ? (
        <div className={searchDialogClass} role="dialog" aria-modal="true" onMouseDown={() => setSearchOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl border border-border bg-popover p-3 shadow-quickforge" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2">
              <Search className="size-4 shrink-0 text-muted-foreground/60" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearchOpen(false)
                }}
                placeholder={t('searchDialog')}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/45"
              />
            </div>
            <div className="mt-2 max-h-[50vh] overflow-y-auto">
              {searchQuery.trim() ? (
                searchResults.length > 0 ? (
                  searchResults.map(({ session, projectName }) => (
                    <button
                      key={session.id}
                      type="button"
                      aria-busy={loadingSessionId === session.id}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/28"
                      onClick={() => selectSearchResult(session.id)}
                    >
                      {sessionLoadingIndicator(session.id)}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground/90">{sessionTitle(session.title, session.channelName)}</span>
                        <span className="block truncate text-[11px] text-muted-foreground/55">{projectName || t('normalChat')} · {formatSessionTime(session.lastModified)}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-3 text-xs text-muted-foreground/55">{t('noSearchResults')}</div>
                )
              ) : (
                <div className="px-3 py-3 text-xs text-muted-foreground/55">{t('searchHint')}</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  )
})
