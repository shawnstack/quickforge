import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import {
  getPinnedSummaryOutsideAction,
  hasPinnedSummaryDragThreshold,
  resolvePinnedSummaryInitialPosition,
  resolvePinnedSummaryLayout,
  type PinnedSummaryLayoutMode,
  type PinnedSummaryPosition,
} from '@/lib/pinned-summary-drag'

export const PINNED_SUMMARY_PANEL_ID = 'quickforge-pinned-summary-panel'
const PINNED_SUMMARY_DESKTOP_QUERY = '(min-width: 768px)'
// 分支菜单旁挂弹层的几何契约：宽度与 GitBranchMenu w-[340px] 一致，左右留 4px 间距，
// 距 viewport 边缘至少 12px；垂直方向 22rem 上限并在下方不足时收缩（内部列表自身滚动）。
const PINNED_BRANCH_MENU_WIDTH = 340
const PINNED_BRANCH_MENU_GAP = 4
const PINNED_BRANCH_MENU_VIEWPORT_INSET = 12
const PINNED_BRANCH_MENU_MAX_HEIGHT = 352
const PINNED_BRANCH_MENU_MIN_HEIGHT = 160

type DragSource = 'capsule' | 'header'
type DesktopMode = 'panel' | 'capsule' | 'closed'

type PinnedSummaryWidgetStyle = CSSProperties & {
  '--quickforge-pinned-summary-width'?: string
  '--quickforge-pinned-summary-height'?: string
  '--quickforge-pinned-summary-panel-max-height'?: string
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

export type PinnedBranchMenuPlacement = {
  side: 'left' | 'right'
  top: number
  maxHeight: number
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

export type UsePinnedSummaryLayoutOptions = {
  expanded: boolean
  suspended: boolean
  mobileShell: boolean
  onExpandedChange: (expanded: boolean) => void
  initialAnchorRef: RefObject<HTMLElement | null>
  /** Clears the content-owned collapse state (task expansion, finished runs). */
  onResetDetails: () => void
  /** Content-owned booleans that must re-trigger the measurement effects. */
  finishedSubagentRunsCollapsed: boolean
  showAllTasks: boolean
}

/**
 * Owns the pinned summary's desktop/mobile shape, position, drag/resize state
 * machine and branch-menu placement. The returned refs are attached by the
 * presentational toolbar/widget; every timer, rAF, listener and cleanup keeps
 * the original ordering and timing.
 */
export function usePinnedSummaryLayout({
  expanded,
  suspended,
  mobileShell,
  onExpandedChange,
  initialAnchorRef,
  onResetDetails,
  finishedSubagentRunsCollapsed,
  showAllTasks,
}: UsePinnedSummaryLayoutOptions) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const topTriggerRef = useRef<HTMLButtonElement | null>(null)
  const branchRowRef = useRef<HTMLButtonElement | null>(null)
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
  const [branchMenuPlacement, setBranchMenuPlacement] = useState<PinnedBranchMenuPlacement>()
  const desktopDraggable = desktopViewport && !mobileShell
  const desktopMode: DesktopMode = expanded ? 'panel' : capsuleVisible ? 'capsule' : 'closed'
  const floatingSummaryVisible = desktopDraggable ? desktopMode !== 'closed' : expanded

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
    onResetDetails()
  }, [onResetDetails])

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

  const toggleBranchMenu = useCallback(() => {
    if (branchMenuOpen) {
      setBranchMenuOpen(false)
      return
    }
    const row = branchRowRef.current
    const widget = desktopWidgetRef.current
    if (desktopDraggable && row && widget) {
      const rowRect = row.getBoundingClientRect()
      const widgetRect = widget.getBoundingClientRect()
      setBranchMenuPlacement({
        side: widgetRect.left - PINNED_BRANCH_MENU_VIEWPORT_INSET >= PINNED_BRANCH_MENU_WIDTH + PINNED_BRANCH_MENU_GAP ? 'left' : 'right',
        top: Math.round(rowRect.top - widgetRect.top),
        maxHeight: Math.max(
          PINNED_BRANCH_MENU_MIN_HEIGHT,
          Math.min(PINNED_BRANCH_MENU_MAX_HEIGHT, window.innerHeight - rowRect.top - PINNED_BRANCH_MENU_VIEWPORT_INSET),
        ),
      })
    } else {
      setBranchMenuPlacement(undefined)
    }
    setBranchMenuOpen(true)
  }, [branchMenuOpen, desktopDraggable])

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

  // 桌面/移动形态切换时旁挂菜单的定位口径失效，直接收起。
  useEffect(() => {
    queueMicrotask(() => setBranchMenuOpen(false))
  }, [desktopDraggable])

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

  return {
    rootRef,
    topTriggerRef,
    branchRowRef,
    desktopWidgetRef,
    desktopPanelRef,
    desktopPanelHeaderRef,
    desktopPanelContentRef,
    desktopPanelMinimizeRef,
    capsuleRef,
    capsuleMainRef,
    suppressClickRef,
    desktopDraggable,
    desktopMode,
    floatingSummaryVisible,
    desktopWidgetMounted,
    desktopWidgetClosing,
    desktopWidgetStyle,
    dragging,
    branchMenuOpen,
    branchMenuPlacement,
    setBranchMenuOpen,
    openDesktopPanel,
    minimizeDesktopPanel,
    closeSummary,
    toggleSummaryFromToolbar,
    toggleBranchMenu,
    beginDrag,
  }
}

export type PinnedSummaryLayout = ReturnType<typeof usePinnedSummaryLayout>
