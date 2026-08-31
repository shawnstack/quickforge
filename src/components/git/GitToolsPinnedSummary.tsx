import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  FileDiff,
  GitBranch,
  GripHorizontal,
  List,
  ListTodo,
  Loader2,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  X,
  XCircle,
} from 'lucide-react'
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import type { TodoWriteItem, TodoWriteStatus } from '@/components/chat/panel-decoration'
import type { SubagentRunPayload } from '@/lib/subagent-run-detail'
import { todoWriteCounts } from '@/components/chat/panel-decoration'
import {
  getPinnedSummaryOutsideAction,
  hasPinnedSummaryDragThreshold,
  resolvePinnedSummaryInitialPosition,
  resolvePinnedSummaryLayout,
  type PinnedSummaryLayoutMode,
  type PinnedSummaryPosition,
} from '@/lib/pinned-summary-drag'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'

type GitToolsPinnedSummaryProps = {
  projectId?: string
  status?: GitStatusResponse
  todos: TodoWriteItem[]
  runningSubagentRuns: SubagentRunPayload[]
  finishedSubagentRuns: SubagentRunPayload[]
  expanded: boolean
  suspended?: boolean
  onExpandedChange: (expanded: boolean) => void
  onOpenSubagentRun: (payload: SubagentRunPayload) => void
  onOpenChanges: () => void
  onOpenCommitPush: () => void
  onCheckout: (branch: string) => Promise<void>
  onCreated: (status: GitStatusResponse) => void
  onOpenGraph: () => void
  mobileShell?: boolean
  initialAnchorRef: RefObject<HTMLElement | null>
}

type DragSource = 'capsule' | 'header'
type DesktopMode = 'panel' | 'capsule' | 'closed'

type PinnedSummaryWidgetStyle = CSSProperties & {
  '--quickforge-pinned-summary-width'?: string
  '--quickforge-pinned-summary-height'?: string
  '--quickforge-pinned-summary-panel-max-height'?: string
}

type CapsuleSegment = {
  key: 'tasks' | 'git' | 'agents' | 'fallback'
  aria: string
  content: ReactNode
}

type DragState = {
  pointerId: number
  start: PinnedSummaryPosition
  origin: PinnedSummaryPosition
  current: PinnedSummaryPosition
  moved: boolean
  source: DragSource
  pointerTarget: HTMLElement
  captureTarget?: HTMLElement
}

type DragPointerEvent = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>

const PINNED_SUMMARY_PANEL_ID = 'quickforge-pinned-summary-panel'
const PINNED_SUMMARY_DESKTOP_QUERY = '(min-width: 768px)'

function gitTotals(status?: GitStatusResponse) {
  return (status?.files ?? []).reduce((totals, file) => {
    totals.additions += file.additions ?? 0
    totals.deletions += file.deletions ?? 0
    return totals
  }, { additions: 0, deletions: 0 })
}

function todoStatusLabel(status: TodoWriteStatus) {
  if (status === 'completed') return t('todoWriteStatusCompleted')
  if (status === 'in_progress') return t('todoWriteStatusInProgress')
  return t('todoWriteStatusPending')
}

function TodoStatusIcon({ status }: { status: TodoWriteStatus }) {
  if (status === 'completed') return <CheckCircle2 className="size-4 text-emerald-600" />
  if (status === 'in_progress') return <Clock3 className="size-4 text-amber-600" />
  return <Circle className="size-4 text-muted-foreground/65" />
}

function formatDuration(payload: SubagentRunPayload) {
  const durationMs = payload.timing?.durationMs
    ?? (payload.timing?.startedAt !== undefined && payload.timing.finishedAt !== undefined
      ? Math.max(0, payload.timing.finishedAt - payload.timing.startedAt)
      : undefined)
  if (durationMs === undefined) return ''
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
}

function getPinnedSummaryLayoutSize(element: HTMLElement) {
  const width = element.offsetWidth
  const height = element.offsetHeight
  if (width > 0 && height > 0) return { width, height }
  const rect = element.getBoundingClientRect()
  return {
    width: width || rect.width,
    height: height || rect.height,
  }
}

export function GitToolsPinnedSummary({
  projectId,
  status,
  todos,
  runningSubagentRuns,
  finishedSubagentRuns,
  expanded,
  suspended = false,
  onExpandedChange,
  onOpenSubagentRun,
  onOpenChanges,
  onOpenCommitPush,
  onCheckout,
  onCreated,
  onOpenGraph,
  mobileShell = false,
  initialAnchorRef,
}: GitToolsPinnedSummaryProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const topTriggerRef = useRef<HTMLButtonElement | null>(null)
  const desktopWidgetRef = useRef<HTMLDivElement | null>(null)
  const desktopPanelRef = useRef<HTMLDivElement | null>(null)
  const desktopPanelHeaderRef = useRef<HTMLDivElement | null>(null)
  const desktopPanelContentRef = useRef<HTMLDivElement | null>(null)
  const desktopPanelMinimizeRef = useRef<HTMLButtonElement | null>(null)
  const capsuleRef = useRef<HTMLDivElement | null>(null)
  const capsuleMainRef = useRef<HTMLButtonElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const dragFrameRef = useRef<number | null>(null)
  const responsiveCleanupFrameRef = useRef<number | null>(null)
  const positionRef = useRef<PinnedSummaryPosition | undefined>(undefined)
  const previousBodyUserSelectRef = useRef<string | null>(null)
  const dragTrackingCleanupRef = useRef<(() => void) | null>(null)
  const [desktopViewport, setDesktopViewport] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(PINNED_SUMMARY_DESKTOP_QUERY).matches
  ))
  const previousExpandedRef = useRef(expanded)
  const wasSuspendedRef = useRef(suspended)
  const [position, setPosition] = useState<PinnedSummaryPosition>()
  const [panelMaxHeight, setPanelMaxHeight] = useState<number>()
  const [capsuleVisible, setCapsuleVisible] = useState(false)
  const [desktopWidgetMounted, setDesktopWidgetMounted] = useState(false)
  const [desktopWidgetClosing, setDesktopWidgetClosing] = useState(false)
  const closeAnimationTimerRef = useRef<number | null>(null)
  const focusFrameRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [expandedTasksSignature, setExpandedTasksSignature] = useState<string>()
  // 已结束小节默认折叠；仅在摘要弹层展开期间记忆，重开弹层恢复折叠，不持久化。
  const [finishedSubagentRunsCollapsed, setFinishedSubagentRunsCollapsed] = useState(true)
  const totals = useMemo(() => gitTotals(status), [status])
  const todoCounts = useMemo(() => todoWriteCounts(todos), [todos])
  const dirtyCount = status ? (status.counts?.total ?? status.files.length) : 0
  const hasGitSection = Boolean(status?.isGitRepository && projectId)
  const todoSignature = todos.map((todo) => `${todo.status}:${todo.content}`).join('\n')
  const showAllTasks = expanded && expandedTasksSignature === todoSignature
  const visibleTodos = showAllTasks ? todos : todos.slice(0, 3)
  const visibleSubagentRuns = finishedSubagentRuns.slice(0, 3)
  const desktopDraggable = desktopViewport && !mobileShell
  const desktopMode: DesktopMode = expanded ? 'panel' : capsuleVisible ? 'capsule' : 'closed'
  const floatingSummaryVisible = desktopDraggable ? desktopMode !== 'closed' : expanded
  const hasGitTotals = hasGitSection && (totals.additions > 0 || totals.deletions > 0)
  const agentRunningCount = runningSubagentRuns.length
  const agentFinishedCount = finishedSubagentRuns.length
  const capsuleSegments = useMemo<CapsuleSegment[]>(() => {
    const segments: CapsuleSegment[] = []
    if (todos.length > 0) {
      segments.push({
        key: 'tasks',
        aria: t('pinnedSummaryCapsuleTasksAria', { completed: todoCounts.completed, total: todoCounts.total }),
        content: (
          <>
            <ListTodo className="size-3.5" aria-hidden="true" />
            <span>{todoCounts.completed}/{todoCounts.total}</span>
          </>
        ),
      })
    }
    if (hasGitTotals) {
      segments.push({
        key: 'git',
        aria: t('pinnedSummaryCapsuleGitAria', { additions: totals.additions, deletions: totals.deletions }),
        content: (
          <>
            <FileDiff className="size-3.5" aria-hidden="true" />
            <span className="text-emerald-600">+{totals.additions}</span>
            <span className="text-red-600">−{totals.deletions}</span>
          </>
        ),
      })
    }
    if (agentRunningCount > 0 || agentFinishedCount > 0) {
      segments.push({
        key: 'agents',
        aria: t('pinnedSummaryCapsuleAgentsAria', { running: agentRunningCount, finished: agentFinishedCount }),
        content: (
          <>
            <Bot className="size-3.5" aria-hidden="true" />
            <span>{agentRunningCount}/{agentFinishedCount}</span>
          </>
        ),
      })
    }
    if (segments.length === 0 && hasGitSection) {
      segments.push({
        key: 'fallback',
        aria: t('pinnedSummaryCapsuleFallbackAria'),
        content: <List className="size-[18px]" aria-hidden="true" />,
      })
    }
    return segments
  }, [agentFinishedCount, agentRunningCount, hasGitSection, hasGitTotals, todoCounts.completed, todoCounts.total, todos.length, totals.additions, totals.deletions])
  const capsuleAriaParts = capsuleSegments.map((segment) => segment.aria)
  const capsuleAria = capsuleAriaParts.length > 0
    ? t('pinnedSummaryCapsuleAria', { summary: capsuleAriaParts.join(t('pinnedSummaryCapsuleSeparator')) })
    : t('pinnedSummaryExpand')

  const updatePosition = useCallback((next: PinnedSummaryPosition) => {
    positionRef.current = next
    setPosition(next)
  }, [])

  const applyWidgetPosition = useCallback((next: PinnedSummaryPosition) => {
    const widget = desktopWidgetRef.current
    if (!widget) return
    widget.style.left = `${Math.round(next.x)}px`
    widget.style.top = `${Math.round(next.y)}px`
  }, [])

  const applyResolvedLayout = useCallback((
    current: PinnedSummaryPosition,
    targetSize: ReturnType<typeof getPinnedSummaryLayoutSize>,
    mode: PinnedSummaryLayoutMode,
  ) => {
    const layout = resolvePinnedSummaryLayout(
      current,
      targetSize,
      { width: window.innerWidth, height: window.innerHeight },
      mode,
    )
    applyWidgetPosition(layout.position)
    updatePosition(layout.position)
    if (mode === 'panel') setPanelMaxHeight(layout.panelMaxHeight)
    return layout.position
  }, [applyWidgetPosition, updatePosition])

  const getPanelNaturalHeight = useCallback((panel: HTMLElement) => {
    if (desktopMode !== 'panel') return getPinnedSummaryLayoutSize(panel).height
    const borderBoxDelta = Math.max(0, panel.offsetHeight - panel.clientHeight)
    const headerHeight = desktopPanelHeaderRef.current?.offsetHeight ?? 0
    const content = desktopPanelContentRef.current
    if (!content) return panel.scrollHeight + borderBoxDelta
    return headerHeight + content.scrollHeight + borderBoxDelta
  }, [desktopMode])

  const restoreDragBodyStyle = useCallback(() => {
    if (previousBodyUserSelectRef.current === null) return
    document.body.style.userSelect = previousBodyUserSelectRef.current
    previousBodyUserSelectRef.current = null
  }, [])

  const finishDrag = useCallback((pointerId?: number) => {
    const drag = dragRef.current
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return
    dragTrackingCleanupRef.current?.()
    dragTrackingCleanupRef.current = null
    dragRef.current = null
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
    }
    if (drag.moved) {
      applyResolvedLayout(
        drag.current,
        getPinnedSummaryLayoutSize(desktopMode === 'panel'
          ? (desktopPanelRef.current ?? desktopWidgetRef.current!)
          : (capsuleRef.current ?? desktopWidgetRef.current!)),
        desktopMode === 'panel' ? 'panel' : 'capsule',
      )
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
    if (drag.captureTarget) {
      try { drag.captureTarget.releasePointerCapture(drag.pointerId) } catch { /* ignore */ }
    }
    restoreDragBodyStyle()
    setDragging(false)
  }, [applyResolvedLayout, desktopMode, restoreDragBodyStyle])

  const resetSummaryDetails = useCallback(() => {
    setBranchMenuOpen(false)
    setExpandedTasksSignature(undefined)
    setFinishedSubagentRunsCollapsed(true)
  }, [])

  const clearCloseAnimationTimer = useCallback(() => {
    if (closeAnimationTimerRef.current === null) return
    window.clearTimeout(closeAnimationTimerRef.current)
    closeAnimationTimerRef.current = null
  }, [])

  const clearFocusFrame = useCallback(() => {
    if (focusFrameRef.current === null) return
    window.cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = null
  }, [])

  const scheduleSummaryFocus = useCallback((target: () => HTMLElement | null) => {
    clearFocusFrame()
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (suspended) return
      target()?.focus()
    })
  }, [clearFocusFrame, suspended])

  const openDesktopPanel = useCallback(() => {
    clearCloseAnimationTimer()
    clearFocusFrame()
    setDesktopWidgetClosing(false)
    setDesktopWidgetMounted(true)
    setCapsuleVisible(false)
    onExpandedChange(true)
    scheduleSummaryFocus(() => desktopPanelMinimizeRef.current)
  }, [clearCloseAnimationTimer, clearFocusFrame, onExpandedChange, scheduleSummaryFocus])

  const minimizeDesktopPanel = useCallback((options?: { focusCapsule?: boolean }) => {
    clearCloseAnimationTimer()
    resetSummaryDetails()
    setDesktopWidgetClosing(false)
    setDesktopWidgetMounted(true)
    setCapsuleVisible(true)
    onExpandedChange(false)
    if (options?.focusCapsule !== false) {
      scheduleSummaryFocus(() => capsuleMainRef.current)
    }
  }, [clearCloseAnimationTimer, onExpandedChange, resetSummaryDetails, scheduleSummaryFocus])

  const closeSummary = useCallback((options?: { focusTrigger?: boolean }) => {
    clearCloseAnimationTimer()
    resetSummaryDetails()
    setCapsuleVisible(false)
    onExpandedChange(false)
    if (desktopDraggable && desktopWidgetMounted) {
      setDesktopWidgetClosing(true)
      closeAnimationTimerRef.current = window.setTimeout(() => {
        closeAnimationTimerRef.current = null
        setDesktopWidgetMounted(false)
        setDesktopWidgetClosing(false)
      }, 160)
    }
    if (options?.focusTrigger) {
      scheduleSummaryFocus(() => topTriggerRef.current)
    }
  }, [clearCloseAnimationTimer, desktopDraggable, desktopWidgetMounted, onExpandedChange, resetSummaryDetails, scheduleSummaryFocus])

  const toggleSummaryFromToolbar = useCallback(() => {
    if (suspended) return
    if (floatingSummaryVisible) closeSummary()
    else if (desktopDraggable) openDesktopPanel()
    else onExpandedChange(true)
  }, [closeSummary, desktopDraggable, floatingSummaryVisible, onExpandedChange, openDesktopPanel, suspended])

  const clampCurrentPosition = useCallback(() => {
    if (!desktopDraggable || suspended) return
    const widget = desktopWidgetRef.current
    if (!widget) return
    const target = desktopMode === 'panel' ? desktopPanelRef.current : capsuleRef.current
    const targetSize = getPinnedSummaryLayoutSize(target ?? widget)
    const current = positionRef.current ?? { x: widget.getBoundingClientRect().left, y: widget.getBoundingClientRect().top }
    applyResolvedLayout(current, targetSize, desktopMode === 'panel' ? 'panel' : 'capsule')
  }, [applyResolvedLayout, desktopDraggable, desktopMode, suspended])

  const moveDrag = useCallback((event: DragPointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const currentPointer = { x: event.clientX, y: event.clientY }
    if (!drag.moved && hasPinnedSummaryDragThreshold(drag.start, currentPointer)) {
      drag.moved = true
      drag.captureTarget = drag.pointerTarget
      try { drag.pointerTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
      suppressClickRef.current = true
      setBranchMenuOpen(false)
      previousBodyUserSelectRef.current = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      setDragging(true)
    }
    if (!drag.moved) return
    const layout = resolvePinnedSummaryLayout(
      {
        x: drag.origin.x + currentPointer.x - drag.start.x,
        y: drag.origin.y + currentPointer.y - drag.start.y,
      },
      getPinnedSummaryLayoutSize(desktopMode === 'panel'
        ? (desktopPanelRef.current ?? desktopWidgetRef.current!)
        : (capsuleRef.current ?? desktopWidgetRef.current!)),
      { width: window.innerWidth, height: window.innerHeight },
      desktopMode === 'panel' ? 'panel' : 'capsule',
    )
    drag.current = layout.position
    if (desktopMode === 'panel') setPanelMaxHeight(layout.panelMaxHeight)
    if (dragFrameRef.current !== null) return
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null
      const currentDrag = dragRef.current
      if (!currentDrag?.moved) return
      applyWidgetPosition(currentDrag.current)
    })
  }, [applyWidgetPosition, desktopMode])

  const beginDrag = useCallback((event: React.PointerEvent<HTMLElement>, source: DragSource) => {
    if (!desktopDraggable || suspended || event.button !== 0) return
    if (source === 'header' && (event.target as HTMLElement).closest('button')) return
    const widget = desktopWidgetRef.current
    if (!widget) return
    finishDrag()
    const rect = widget.getBoundingClientRect()
    const origin = positionRef.current ?? { x: rect.left, y: rect.top }
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin,
      current: origin,
      moved: false,
      source,
      pointerTarget: event.currentTarget,
    }
    const handlePointerMove = (pointerEvent: PointerEvent) => moveDrag(pointerEvent)
    const handlePointerEnd = (pointerEvent: PointerEvent) => finishDrag(pointerEvent.pointerId)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    dragTrackingCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }
  }, [desktopDraggable, finishDrag, moveDrag, suspended])

  useEffect(() => {
    if (!suspended) return
    clearFocusFrame()
    finishDrag()
    if (responsiveCleanupFrameRef.current !== null) {
      window.cancelAnimationFrame(responsiveCleanupFrameRef.current)
      responsiveCleanupFrameRef.current = null
    }
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
    }
    queueMicrotask(() => setBranchMenuOpen(false))
  }, [clearFocusFrame, finishDrag, suspended])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(PINNED_SUMMARY_DESKTOP_QUERY)
    const update = () => setDesktopViewport(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const previousExpanded = previousExpandedRef.current
    previousExpandedRef.current = expanded
    if (!desktopDraggable) {
      clearCloseAnimationTimer()
      finishDrag()
      positionRef.current = undefined
      responsiveCleanupFrameRef.current = window.requestAnimationFrame(() => {
        responsiveCleanupFrameRef.current = null
        setPosition(undefined)
        setPanelMaxHeight(undefined)
        setCapsuleVisible(false)
        setDesktopWidgetMounted(false)
        setDesktopWidgetClosing(false)
      })
      return
    }
    if (expanded) {
      clearCloseAnimationTimer()
      if (responsiveCleanupFrameRef.current !== null) {
        window.cancelAnimationFrame(responsiveCleanupFrameRef.current)
        responsiveCleanupFrameRef.current = null
      }
      const frame = window.requestAnimationFrame(() => {
        setDesktopWidgetClosing(false)
        setDesktopWidgetMounted(true)
        setCapsuleVisible(false)
      })
      return () => window.cancelAnimationFrame(frame)
    }
    if (previousExpanded && !capsuleVisible && desktopWidgetMounted && !desktopWidgetClosing) {
      if (responsiveCleanupFrameRef.current !== null) {
        window.cancelAnimationFrame(responsiveCleanupFrameRef.current)
        responsiveCleanupFrameRef.current = null
      }
      resetSummaryDetails()
      setDesktopWidgetClosing(true)
      closeAnimationTimerRef.current = window.setTimeout(() => {
        closeAnimationTimerRef.current = null
        setDesktopWidgetMounted(false)
        setDesktopWidgetClosing(false)
      }, 160)
    }
  }, [capsuleVisible, clearCloseAnimationTimer, desktopDraggable, desktopWidgetClosing, desktopWidgetMounted, expanded, finishDrag, resetSummaryDetails])

  useLayoutEffect(() => {
    if (!desktopDraggable || !desktopWidgetMounted || suspended) return undefined
    const widget = desktopWidgetRef.current
    const capsule = capsuleRef.current
    const panel = desktopPanelRef.current
    if (!widget || !capsule || !panel) return undefined

    const measure = () => {
      const capsuleSize = getPinnedSummaryLayoutSize(capsule)
      const panelSize = getPinnedSummaryLayoutSize(panel)
      widget.style.setProperty('--quickforge-pinned-summary-capsule-width', `${Math.ceil(capsuleSize.width)}px`)
      widget.style.setProperty('--quickforge-pinned-summary-capsule-height', `${Math.ceil(capsuleSize.height)}px`)
      widget.style.setProperty('--quickforge-pinned-summary-panel-width', `${Math.ceil(panelSize.width)}px`)
      const panelNaturalHeight = getPanelNaturalHeight(panel)
      widget.style.setProperty('--quickforge-pinned-summary-panel-height', `${Math.ceil(panelNaturalHeight || panelSize.height)}px`)
      if (positionRef.current) {
        const mode = desktopMode === 'panel' ? 'panel' : 'capsule'
        const layoutPosition = dragRef.current?.current ?? positionRef.current
        const layout = resolvePinnedSummaryLayout(
          layoutPosition,
          mode === 'panel' ? panelSize : capsuleSize,
          { width: window.innerWidth, height: window.innerHeight },
          mode,
        )
        if (mode === 'panel') setPanelMaxHeight(layout.panelMaxHeight)
      }
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(capsule)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [desktopDraggable, desktopMode, desktopWidgetMounted, finishedSubagentRunsCollapsed, getPanelNaturalHeight, showAllTasks, suspended])

  useEffect(() => {
    if (!desktopDraggable || !desktopWidgetMounted || suspended) return
    const frame = window.requestAnimationFrame(() => {
      const widget = desktopWidgetRef.current
      if (!widget) return
      const target = desktopMode === 'panel' ? desktopPanelRef.current : capsuleRef.current
      const targetSize = getPinnedSummaryLayoutSize(target ?? widget)
      const widgetRect = widget.getBoundingClientRect()
      if (!positionRef.current) {
        const fallbackRect = rootRef.current?.getBoundingClientRect() ?? widgetRect
        const initialPosition = resolvePinnedSummaryInitialPosition({
          anchorRect: initialAnchorRef.current?.getBoundingClientRect(),
          fallbackRect,
          targetSize,
        })
        applyResolvedLayout(initialPosition, targetSize, desktopMode === 'panel' ? 'panel' : 'capsule')
        return
      }
      clampCurrentPosition()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [applyResolvedLayout, clampCurrentPosition, desktopDraggable, desktopMode, desktopWidgetMounted, finishedSubagentRunsCollapsed, initialAnchorRef, showAllTasks, suspended])

  useLayoutEffect(() => {
    const wasSuspended = wasSuspendedRef.current
    wasSuspendedRef.current = suspended
    if (!wasSuspended || suspended || !desktopDraggable || !desktopWidgetMounted) return
    const widget = desktopWidgetRef.current
    if (!widget) return
    const target = desktopMode === 'panel' ? desktopPanelRef.current : capsuleRef.current
    const targetSize = getPinnedSummaryLayoutSize(target ?? widget)
    const current = positionRef.current ?? { x: widget.getBoundingClientRect().left, y: widget.getBoundingClientRect().top }
    applyResolvedLayout(current, targetSize, desktopMode === 'panel' ? 'panel' : 'capsule')
  }, [applyResolvedLayout, desktopDraggable, desktopMode, desktopWidgetMounted, suspended])

  useEffect(() => {
    if (!desktopDraggable || suspended) return
    window.addEventListener('resize', clampCurrentPosition)
    return () => window.removeEventListener('resize', clampCurrentPosition)
  }, [clampCurrentPosition, desktopDraggable, suspended])

  useEffect(() => {
    if (desktopDraggable || !floatingSummaryVisible || suspended) return

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      if (getPinnedSummaryOutsideAction(false) === 'close') closeSummary()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeSummary({ focusTrigger: true })
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeSummary, desktopDraggable, floatingSummaryVisible, suspended])

  useEffect(() => () => {
    clearCloseAnimationTimer()
    clearFocusFrame()
    finishDrag()
    if (responsiveCleanupFrameRef.current !== null) window.cancelAnimationFrame(responsiveCleanupFrameRef.current)
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current)
    restoreDragBodyStyle()
  }, [clearCloseAnimationTimer, clearFocusFrame, finishDrag, restoreDragBodyStyle])

  if (todos.length === 0 && runningSubagentRuns.length === 0 && finishedSubagentRuns.length === 0 && !hasGitSection) return null

  const toggleBranchMenu = () => {
    setBranchMenuOpen((value) => !value)
  }

  const summarySections = (
    <>
      {hasGitSection && status && projectId ? (
        <section aria-labelledby="pinned-environment-title">
          <div id="pinned-environment-title" className="mb-2 pr-8 text-xs font-medium text-muted-foreground">{t('gitToolsTitle')}</div>
          <div className="space-y-1 text-sm">
            <button type="button" className={cn('hidden h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-foreground/88 transition-colors hover:bg-muted/45 hover:text-foreground md:flex', mobileShell && 'md:hidden')} onClick={onOpenChanges}>
              <FileDiff className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-medium">{t('gitToolsChanges')}</span>
              <span className="font-medium text-emerald-600">+{totals.additions}</span>
              <span className="font-medium text-red-600">-{totals.deletions}</span>
            </button>

            <div className="relative">
              <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-foreground/88 transition-colors hover:bg-muted/45 hover:text-foreground" onClick={toggleBranchMenu} aria-expanded={branchMenuOpen}>
                <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{status.branch || t('unknown')}</span>
                <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', branchMenuOpen && 'rotate-180')} />
              </button>
              {branchMenuOpen ? (
                <GitBranchMenu
                  projectId={projectId}
                  currentBranch={status.branch}
                  dirtyCount={dirtyCount}
                  className={cn(
                    'fixed inset-x-2 top-[9.25rem] max-h-[calc(100dvh-9.75rem)] w-auto overflow-y-auto md:absolute md:inset-x-auto md:top-full md:mt-1 md:max-h-[min(22rem,calc(100dvh-8rem))] md:w-full md:overflow-y-auto',
                    mobileShell && 'md:fixed md:inset-x-2 md:right-auto md:top-[9.25rem] md:mt-0 md:max-h-[calc(100dvh-9.75rem)] md:w-auto md:overflow-y-auto lg:inset-x-2 lg:right-auto lg:top-[9.25rem] lg:mr-0',
                  )}
                  openChangesClassName={cn('hidden md:flex', mobileShell && 'md:hidden')}
                  onCheckout={async (branch) => {
                    await onCheckout(branch)
                    setBranchMenuOpen(false)
                  }}
                  onCreated={(nextStatus) => {
                    onCreated(nextStatus)
                    setBranchMenuOpen(false)
                  }}
                  onOpenGraph={() => {
                    setBranchMenuOpen(false)
                    onOpenGraph()
                  }}
                  onOpenChanges={() => {
                    setBranchMenuOpen(false)
                    onOpenChanges()
                  }}
                />
              ) : null}
            </div>

            <button type="button" className="flex h-11 w-full items-center gap-3 rounded-2xl px-2.5 text-left text-foreground/88 transition-colors hover:bg-muted/45 hover:text-foreground" onClick={onOpenCommitPush}>
              <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">{t('gitToolsCommitOrPush')}</span>
            </button>
          </div>
        </section>
      ) : null}

      {todos.length > 0 ? (
        <section className={cn(hasGitSection && 'mt-3 border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_28%,transparent)] pt-3')} aria-labelledby="pinned-tasks-title">
          <div id="pinned-tasks-title" className="mb-2 flex items-center justify-between gap-3 pr-8 text-xs font-medium text-muted-foreground">
            <span>{t('pinnedTasksTitle')}</span>
            <span>{todoCounts.completed}/{todoCounts.total}</span>
          </div>
          <div className="space-y-1">
            {visibleTodos.map((todo, index) => (
              <div key={`${todo.content}:${index}`} className="flex min-h-9 items-center gap-2.5 px-1.5 text-sm text-foreground/88">
                <span className="shrink-0" aria-hidden="true"><TodoStatusIcon status={todo.status} /></span>
                <span className={cn('min-w-0 flex-1 truncate', todo.status === 'completed' && 'text-muted-foreground line-through')}>{todo.content}</span>
                <span className="sr-only">{todoStatusLabel(todo.status)}</span>
              </div>
            ))}
          </div>
          {todos.length > 3 ? (
            <button type="button" className="mt-1 rounded-lg px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground" onClick={() => setExpandedTasksSignature(showAllTasks ? undefined : todoSignature)} aria-expanded={showAllTasks}>
              {showAllTasks ? t('pinnedCollapseTasks') : t('pinnedViewAllTasks', { count: todos.length })}
            </button>
          ) : null}
        </section>
      ) : null}

      {runningSubagentRuns.length > 0 || finishedSubagentRuns.length > 0 ? (
        <section className={cn((hasGitSection || todos.length > 0) && 'mt-3 border-t-[0.5px] border-[color-mix(in_oklab,var(--border)_28%,transparent)] pt-3')} aria-labelledby="pinned-subagents-title">
          <div id="pinned-subagents-title" className="mb-2 flex items-center justify-between gap-3 pr-8 text-xs font-medium text-muted-foreground">
            <span>{t('pinnedSubagentsTitle')}</span>
          </div>
          {runningSubagentRuns.length > 0 ? (
            <div className="mb-2">
              <div className="mb-1 px-1.5 text-[11px] text-muted-foreground/85">{t('pinnedSubagentsRunningSection')}</div>
              <div className="space-y-1">
                {runningSubagentRuns.map((payload) => {
                  const label = payload.label || payload.name || t('subagentGeneral')
                  return (
                    <button
                      key={payload.canonicalToolCallId || payload.runId}
                      type="button"
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-1.5 text-left transition-colors hover:bg-muted/45"
                      onClick={() => onOpenSubagentRun(payload)}
                      aria-label={t('pinnedSubagentOpenAria', { name: label, task: payload.task })}
                    >
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground/65" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground/88">{label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{payload.task}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          {finishedSubagentRuns.length > 0 ? (
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-lg px-1.5 py-1 text-[11px] text-muted-foreground/85 transition-colors hover:bg-muted/45 hover:text-foreground"
                onClick={() => setFinishedSubagentRunsCollapsed((value) => !value)}
                aria-expanded={!finishedSubagentRunsCollapsed}
              >
                <span>{t('pinnedSubagentsFinishedSection')} · {finishedSubagentRuns.length}</span>
                {finishedSubagentRunsCollapsed
                  ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/85" aria-hidden="true" />
                  : <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/85" aria-hidden="true" />}
              </button>
              {!finishedSubagentRunsCollapsed ? (
                <div className="mt-1 space-y-1">
                  {visibleSubagentRuns.map((payload) => {
                    const duration = formatDuration(payload)
                    const label = payload.label || payload.name || t('subagentGeneral')
                    return (
                      <button
                        key={payload.canonicalToolCallId || payload.runId}
                        type="button"
                        className="flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-1.5 text-left transition-colors hover:bg-muted/45"
                        onClick={() => onOpenSubagentRun(payload)}
                        aria-label={t('pinnedSubagentOpenAria', { name: label, task: payload.task })}
                      >
                        {payload.status === 'error'
                          ? <XCircle className="size-4 shrink-0 text-destructive" />
                          : <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground/88">{label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{payload.task}</span>
                        </span>
                        {duration ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{duration}</span> : <Bot className="size-3.5 shrink-0 text-muted-foreground/65" />}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  )

  const desktopWidgetStyle: PinnedSummaryWidgetStyle | undefined = position
    ? {
        left: position.x,
        top: position.y,
        '--quickforge-pinned-summary-width': desktopMode === 'panel'
          ? 'var(--quickforge-pinned-summary-panel-width, min(20.5rem, calc(100vw - 1rem)))'
          : 'var(--quickforge-pinned-summary-capsule-width, max-content)',
        '--quickforge-pinned-summary-height': desktopMode === 'panel'
          ? 'min(var(--quickforge-pinned-summary-panel-height, 20rem), var(--quickforge-pinned-summary-panel-max-height, calc(100dvh - 1.5rem)))'
          : 'var(--quickforge-pinned-summary-capsule-height, 2.75rem)',
        '--quickforge-pinned-summary-panel-max-height': desktopMode !== 'panel' || panelMaxHeight === undefined
          ? undefined
          : `${Math.max(0, Math.floor(panelMaxHeight))}px`,
      }
    : undefined

  const desktopFloatingWidget = desktopDraggable && desktopWidgetMounted ? (
    <div
      ref={desktopWidgetRef}
      data-mode={desktopMode === 'closed' ? 'capsule' : desktopMode}
      data-closing={desktopWidgetClosing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      className={cn('quickforge-pinned-summary-widget fixed z-40', suspended && 'hidden')}
      style={desktopWidgetStyle}
      hidden={suspended}
      aria-hidden={suspended || undefined}
      inert={suspended ? true : undefined}
    >
      <div
        ref={capsuleRef}
        className={cn(
          'quickforge-pinned-summary-capsule flex min-h-11 max-w-[calc(100vw-1.5rem)] cursor-grab items-center rounded-full border border-[color-mix(in_oklab,var(--border)_55%,transparent)] bg-background text-foreground shadow-quickforge',
          dragging && 'cursor-grabbing',
        )}
        onPointerDown={(event) => beginDrag(event, 'capsule')}
        aria-hidden={desktopMode !== 'capsule'}
        inert={desktopMode !== 'capsule' ? true : undefined}
      >
        <button
          ref={capsuleMainRef}
          type="button"
          className="quickforge-pinned-summary-capsule-main group flex min-w-0 flex-1 items-center gap-2 rounded-l-full py-1 pl-2.5 text-left transition-colors hover:bg-muted/30"
          onClick={() => {
            if (suppressClickRef.current) return
            openDesktopPanel()
          }}
          aria-label={capsuleAria}
          title={t('pinnedSummaryExpand')}
          aria-expanded={false}
          aria-controls={PINNED_SUMMARY_PANEL_ID}
          tabIndex={desktopMode === 'capsule' ? 0 : -1}
        >
          {capsuleSegments.map((segment, index) => (
            <span key={segment.key} className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground">
              {index > 0 ? <span className="h-3.5 w-px shrink-0 bg-foreground/15" aria-hidden="true" /> : null}
              {segment.content}
            </span>
          ))}
          <span className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/55 transition-colors group-hover:bg-muted/40 group-hover:text-muted-foreground group-focus-visible:bg-muted/40 group-focus-visible:text-muted-foreground" aria-hidden="true">
            <Maximize2 className="size-3.5" />
          </span>
        </button>
        <button
          type="button"
          className="quickforge-pinned-summary-capsule-close mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation()
            closeSummary({ focusTrigger: true })
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={t('pinnedSummaryClose')}
          title={t('pinnedSummaryClose')}
          tabIndex={desktopMode === 'capsule' ? 0 : -1}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div
        ref={desktopPanelRef}
        id={PINNED_SUMMARY_PANEL_ID}
        className="quickforge-pinned-summary-panel flex w-[min(20.5rem,calc(100vw-1rem))] flex-col overflow-visible rounded-3xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-background text-foreground shadow-quickforge"
        aria-hidden={desktopMode !== 'panel'}
        inert={desktopMode !== 'panel' ? true : undefined}
      >
        <div
          ref={desktopPanelHeaderRef}
          className={cn(
            'flex min-h-10 shrink-0 cursor-grab items-center gap-2 rounded-t-3xl px-3 text-xs font-medium text-muted-foreground',
            dragging && 'cursor-grabbing',
          )}
          onPointerDown={(event) => beginDrag(event, 'header')}
        >
          <GripHorizontal className="size-4" aria-hidden="true" />
          <span className="flex-1">{t('pinnedSummaryDrag')}</span>
          <button ref={desktopPanelMinimizeRef} type="button" className="inline-flex size-8 items-center justify-center rounded-full text-foreground/85 transition-colors hover:bg-muted" onClick={() => minimizeDesktopPanel()} aria-label={t('pinnedSummaryMinimize')} title={t('pinnedSummaryMinimize')} tabIndex={desktopMode === 'panel' ? 0 : -1}>
            <Minimize2 className="size-4" aria-hidden="true" />
          </button>
          <button type="button" className="inline-flex size-8 items-center justify-center rounded-full text-foreground/85 transition-colors hover:bg-muted" onClick={() => closeSummary({ focusTrigger: true })} aria-label={t('pinnedSummaryClose')} title={t('pinnedSummaryClose')} tabIndex={desktopMode === 'panel' ? 0 : -1}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div ref={desktopPanelContentRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {summarySections}
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <div
        ref={rootRef}
        className={cn('relative', suspended && 'hidden')}
        hidden={suspended}
        aria-hidden={suspended || undefined}
        inert={suspended ? true : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={topTriggerRef}
          type="button"
          className={cn(
            'inline-flex size-9 items-center justify-center rounded-2xl bg-transparent text-muted-foreground/85 transition-colors hover:bg-muted/45 hover:text-foreground/90',
            floatingSummaryVisible && 'bg-muted/45 text-foreground/90',
          )}
          onClick={toggleSummaryFromToolbar}
          aria-label={t('togglePinnedSummary')}
          title={t('togglePinnedSummary')}
          aria-pressed={floatingSummaryVisible}
          aria-expanded={floatingSummaryVisible}
          aria-controls={PINNED_SUMMARY_PANEL_ID}
        >
          <List className="size-[18px]" />
        </button>

        {!desktopDraggable && expanded ? (
          <div
            id={PINNED_SUMMARY_PANEL_ID}
            className={cn(
              'fixed inset-x-2 top-14 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-3xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-background p-4 text-foreground shadow-quickforge',
              mobileShell && 'md:fixed md:inset-x-2 md:right-auto md:top-14 md:max-h-[calc(100dvh-4rem)] md:w-auto md:overflow-y-auto lg:inset-x-2 lg:right-auto lg:top-14',
            )}
          >
            <button type="button" className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-full text-foreground/85 transition-colors hover:bg-muted" onClick={() => closeSummary()} aria-label={t('pinnedSummaryClose')} title={t('pinnedSummaryClose')}>
              <X className="size-4" />
            </button>
            {summarySections}
          </div>
        ) : null}
      </div>
      {desktopFloatingWidget}
    </>
  )
}
