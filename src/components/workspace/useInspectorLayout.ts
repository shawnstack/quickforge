// Phase hooks preserve the original Inspector effect ordering and stable-ref dependencies.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspacePanelTab } from './workspace-inspector-tabs'

function getDesktopTitlebarHeight() {
  if (typeof window === 'undefined') return 0
  const raw = window.getComputedStyle(document.body).getPropertyValue('--quickforge-desktop-titlebar-height').trim()
  if (!raw) return 0
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : 0
}

export const WORKSPACE_INSPECTOR_MIN_WIDTH = 340
const WORKSPACE_INSPECTOR_DEFAULT_WIDTH = 380
const WORKSPACE_INSPECTOR_MAX_WIDTH = 1200
const WORKSPACE_INSPECTOR_MAX_VIEWPORT_RATIO = 0.75

const WORKSPACE_INSPECTOR_AUTO_EXPAND_WIDTH = 640
const WORKSPACE_INSPECTOR_WIDTH_STORAGE_KEY = 'quickforge_workspaceInspectorWidth_v2'
export const NAV_PANEL_MIN_WIDTH = 140
const NAV_PANEL_DEFAULT_WIDTH = 200
export const NAV_PANEL_MAX_WIDTH = 400

export function getInspectorMaxWidth(leftSidebarWidth = 0, conversationMinWidth = 0) {
  if (typeof window === 'undefined') return WORKSPACE_INSPECTOR_MAX_WIDTH
  const availableWidth = window.innerWidth - leftSidebarWidth - conversationMinWidth - 1
  return Math.max(WORKSPACE_INSPECTOR_MIN_WIDTH, Math.min(
    WORKSPACE_INSPECTOR_MAX_WIDTH,
    window.innerWidth * WORKSPACE_INSPECTOR_MAX_VIEWPORT_RATIO,
    availableWidth,
  ))
}

function clampInspectorWidth(width: number, leftSidebarWidth = 0, conversationMinWidth = 0) {
  return Math.min(getInspectorMaxWidth(leftSidebarWidth, conversationMinWidth), Math.max(WORKSPACE_INSPECTOR_MIN_WIDTH, width))
}

function readPersistedInspectorWidth(leftSidebarWidth = 0, conversationMinWidth = 0): number {
  if (typeof window === 'undefined') return WORKSPACE_INSPECTOR_DEFAULT_WIDTH
  try {
    const raw = window.localStorage.getItem(WORKSPACE_INSPECTOR_WIDTH_STORAGE_KEY)
    if (!raw) return WORKSPACE_INSPECTOR_DEFAULT_WIDTH
    const value = Number(raw)
    if (!Number.isFinite(value)) return WORKSPACE_INSPECTOR_DEFAULT_WIDTH
    return clampInspectorWidth(value, leftSidebarWidth, conversationMinWidth)
  } catch {
    return WORKSPACE_INSPECTOR_DEFAULT_WIDTH
  }
}

export function useInspectorLayoutState({ open, leftSidebarWidth, conversationMinWidth }: { open: boolean; leftSidebarWidth: number; conversationMinWidth: number }) {
  const [leftWidth, setLeftWidth] = useState(NAV_PANEL_DEFAULT_WIDTH)
  const [isNavResizing, setIsNavResizing] = useState(false)
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const [narrowViewport, setNarrowViewport] = useState(false)
  const mobileOverlay = narrowViewport && mounted
  const [width, setWidth] = useState(() => readPersistedInspectorWidth(leftSidebarWidth, conversationMinWidth))
  const [isResizing, setIsResizing] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenAnimating, setFullscreenAnimating] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const navResizeDragRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)
  const navResizeFrameRef = useRef<number | null>(null)
  const resizeDragRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const fullscreenAnimationRef = useRef<Animation | null>(null)
  const fullscreenExitActionRef = useRef<(() => void) | null>(null)
  const previousBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null)
  return { leftWidth, setLeftWidth, isNavResizing, setIsNavResizing, mounted, setMounted, visible, setVisible, narrowViewport, setNarrowViewport, mobileOverlay, width, setWidth, isResizing, setIsResizing, fullscreen, setFullscreen, fullscreenAnimating, setFullscreenAnimating, asideRef, navResizeDragRef, navResizeFrameRef, resizeDragRef, resizeFrameRef, fullscreenAnimationRef, fullscreenExitActionRef, previousBodyStyleRef }
}

type LayoutOptions = ReturnType<typeof useInspectorLayoutState> & { open: boolean; onFullscreenChange?: (fullscreen: boolean) => void; leftSidebarWidth: number; conversationMinWidth: number; activePanelTab?: WorkspacePanelTab; activeReaderTabId?: string }

export function useInspectorViewport({ setNarrowViewport }: LayoutOptions) {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setNarrowViewport(!query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [setNarrowViewport])
}

export function useInspectorVisibility({ setMounted, setVisible, fullscreen, setFullscreen, setFullscreenAnimating, asideRef, fullscreenAnimationRef, fullscreenExitActionRef, open, onFullscreenChange }: LayoutOptions) {
  useEffect(() => {
    if (open) {
      let disposed = false
      queueMicrotask(() => {
        if (disposed) return
        setMounted(true)
        window.requestAnimationFrame(() => {
          if (!disposed) setVisible(true)
        })
      })
      return () => { disposed = true }
    }

    let disposed = false
    queueMicrotask(() => {
      if (!disposed) setVisible(false)
    })
    const timer = window.setTimeout(() => setMounted(false), 180)
    if (fullscreen) {
      fullscreenAnimationRef.current?.cancel()
      fullscreenExitActionRef.current = null
      setFullscreen(false)
      setFullscreenAnimating(false)
      onFullscreenChange?.(false)
      asideRef.current?.removeAttribute('style')
    }
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [asideRef, fullscreen, fullscreenAnimationRef, fullscreenExitActionRef, onFullscreenChange, open, setFullscreen, setFullscreenAnimating, setMounted, setVisible])
}

export function useInspectorWidth({ visible, mobileOverlay, width, setWidth, fullscreen, leftSidebarWidth, conversationMinWidth, activePanelTab, activeReaderTabId }: LayoutOptions) {
  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_INSPECTOR_WIDTH_STORAGE_KEY, String(width))
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [width])

  useEffect(() => {
    const syncWidthToViewport = () => {
      if (fullscreen || mobileOverlay) return
      setWidth((current) => clampInspectorWidth(current, leftSidebarWidth, conversationMinWidth))
    }
    window.addEventListener('resize', syncWidthToViewport)
    syncWidthToViewport()
    return () => window.removeEventListener('resize', syncWidthToViewport)
  }, [conversationMinWidth, fullscreen, leftSidebarWidth, mobileOverlay, setWidth])

  const expandInspectorToMax = useCallback(() => {
    setWidth((current) => (current < WORKSPACE_INSPECTOR_AUTO_EXPAND_WIDTH
      ? clampInspectorWidth(WORKSPACE_INSPECTOR_AUTO_EXPAND_WIDTH, leftSidebarWidth, conversationMinWidth)
      : current))
  }, [conversationMinWidth, leftSidebarWidth, setWidth])

  useEffect(() => {
    if (!visible || fullscreen) return
    const viewingContent = activePanelTab?.kind === 'browser' || activePanelTab?.kind === 'document' || activePanelTab?.kind === 'terminal' || activePanelTab?.kind === 'subagent' || Boolean(activeReaderTabId)
    if (!viewingContent) return
    expandInspectorToMax()
  }, [activePanelTab?.kind, activeReaderTabId, visible, fullscreen, expandInspectorToMax])
  return { expandInspectorToMax }
}

export function useInspectorLayoutActions({ leftWidth, setLeftWidth, setIsNavResizing, width, setWidth, setIsResizing, fullscreen, setFullscreen, setFullscreenAnimating, asideRef, navResizeDragRef, navResizeFrameRef, resizeDragRef, resizeFrameRef, fullscreenAnimationRef, fullscreenExitActionRef, previousBodyStyleRef, onFullscreenChange, leftSidebarWidth, conversationMinWidth }: LayoutOptions) {
  function startResizing(event: React.PointerEvent<HTMLDivElement>) {
    resizeDragRef.current = { startX: event.clientX, startWidth: width, currentWidth: width }
    previousBodyStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setIsResizing(true)
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  function resize(event: React.PointerEvent<HTMLDivElement>) {
    const start = resizeDragRef.current
    const aside = asideRef.current
    if (!start || !aside) return
    start.currentWidth = clampInspectorWidth(start.startWidth + start.startX - event.clientX, leftSidebarWidth, conversationMinWidth)
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
    resizeDragRef.current = null
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
    if (typeof finalWidth === 'number') {
      if (asideRef.current) asideRef.current.style.width = `${finalWidth}px`
      setWidth(finalWidth)
    }
    const previousBodyStyle = previousBodyStyleRef.current
    if (previousBodyStyle) {
      document.body.style.cursor = previousBodyStyle.cursor
      document.body.style.userSelect = previousBodyStyle.userSelect
      previousBodyStyleRef.current = null
    }
    setIsResizing(false)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  function startNavResizing(event: React.PointerEvent<HTMLDivElement>) {
    navResizeDragRef.current = { startX: event.clientX, startWidth: leftWidth, currentWidth: leftWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setIsNavResizing(true)
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  function navResize(event: React.PointerEvent<HTMLDivElement>) {
    const start = navResizeDragRef.current
    if (!start) return
    start.currentWidth = Math.min(
      NAV_PANEL_MAX_WIDTH,
      Math.max(NAV_PANEL_MIN_WIDTH, start.startWidth + start.startX - event.clientX),
    )
    if (navResizeFrameRef.current !== null) return
    navResizeFrameRef.current = window.requestAnimationFrame(() => {
      navResizeFrameRef.current = null
      const current = navResizeDragRef.current
      if (current) setLeftWidth(current.currentWidth)
    })
  }

  function stopNavResizing(event: React.PointerEvent<HTMLDivElement>) {
    const finalWidth = navResizeDragRef.current?.currentWidth
    navResizeDragRef.current = null
    if (navResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(navResizeFrameRef.current)
      navResizeFrameRef.current = null
    }
    if (typeof finalWidth === 'number') setLeftWidth(finalWidth)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setIsNavResizing(false)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  const toggleFullscreen = useCallback((afterExit?: () => void) => {
    const aside = asideRef.current
    if (!aside) {
      const nextFullscreen = !fullscreen
      setFullscreen(nextFullscreen)
      onFullscreenChange?.(nextFullscreen)
      if (!nextFullscreen) afterExit?.()
      return
    }

    if (fullscreen && afterExit) fullscreenExitActionRef.current = afterExit
    fullscreenAnimationRef.current?.cancel()
    const rect = aside.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const titlebarHeight = getDesktopTitlebarHeight()
    const viewportHeight = window.innerHeight - titlebarHeight
    const fullscreenTop = `${titlebarHeight}px`
    const fullscreenHeight = `${viewportHeight}px`
    const easing = 'cubic-bezier(0.22, 1, 0.36, 1)'
    setFullscreenAnimating(true)

    if (!fullscreen) {
      window.requestAnimationFrame(() => {
        const currentAside = asideRef.current
        if (!currentAside) return
        Object.assign(currentAside.style, {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          right: 'auto',
          bottom: 'auto',
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          minWidth: '0px',
          maxWidth: 'none',
          zIndex: '40',
        })
        const animation = currentAside.animate(
          [
            { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` },
            { left: '0px', top: fullscreenTop, width: `${viewportWidth}px`, height: fullscreenHeight },
          ],
          { duration: 240, easing, fill: 'forwards' },
        )
        fullscreenAnimationRef.current = animation
        animation.onfinish = () => {
          fullscreenAnimationRef.current = null
          setFullscreen(true)
          onFullscreenChange?.(true)
          window.requestAnimationFrame(() => {
            animation.cancel()
            currentAside.removeAttribute('style')
            window.requestAnimationFrame(() => setFullscreenAnimating(false))
          })
        }
        animation.oncancel = () => {
          fullscreenAnimationRef.current = null
          fullscreenExitActionRef.current = null
          setFullscreenAnimating(false)
        }
      })
      return
    }

    window.requestAnimationFrame(() => {
      const currentAside = asideRef.current
      if (!currentAside) return
      Object.assign(currentAside.style, {
        position: 'fixed',
        left: '0px',
        top: fullscreenTop,
        right: 'auto',
        bottom: 'auto',
        width: `${rect.width}px`,
        height: fullscreenHeight,
        zIndex: '40',
      })
      const targetLeft = viewportWidth - width
      const animation = currentAside.animate(
        [
          { left: '0px', top: fullscreenTop, width: `${rect.width}px`, height: fullscreenHeight },
          { left: `${targetLeft}px`, top: fullscreenTop, width: `${width}px`, height: fullscreenHeight },
        ],
        { duration: 240, easing, fill: 'forwards' },
      )
      fullscreenAnimationRef.current = animation
      animation.onfinish = () => {
        fullscreenAnimationRef.current = null
        setFullscreen(false)
        onFullscreenChange?.(false)
        const exitAction = fullscreenExitActionRef.current
        fullscreenExitActionRef.current = null
        window.requestAnimationFrame(() => {
          animation.cancel()
          currentAside.style.position = ''
          currentAside.style.left = ''
          currentAside.style.top = ''
          currentAside.style.right = ''
          currentAside.style.bottom = ''
          currentAside.style.height = ''
          currentAside.style.zIndex = ''
          currentAside.style.width = `${width}px`
          currentAside.style.minWidth = `${WORKSPACE_INSPECTOR_MIN_WIDTH}px`
          currentAside.style.maxWidth = `${getInspectorMaxWidth(leftSidebarWidth, conversationMinWidth)}px`
          window.requestAnimationFrame(() => {
            setFullscreenAnimating(false)
            exitAction?.()
          })
        })
      }
      animation.oncancel = () => {
        fullscreenAnimationRef.current = null
        fullscreenExitActionRef.current = null
        setFullscreenAnimating(false)
      }
    })
  }, [asideRef, conversationMinWidth, fullscreen, fullscreenAnimationRef, fullscreenExitActionRef, leftSidebarWidth, onFullscreenChange, setFullscreen, setFullscreenAnimating, width])

  useEffect(() => {
    if (!fullscreen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleFullscreen()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [fullscreen, toggleFullscreen])

  useEffect(() => () => {
    onFullscreenChange?.(false)
  }, [onFullscreenChange])

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
    if (navResizeFrameRef.current !== null) window.cancelAnimationFrame(navResizeFrameRef.current)
    fullscreenAnimationRef.current?.cancel()
    if (asideRef.current) asideRef.current.removeAttribute('style')
    const previousBodyStyle = previousBodyStyleRef.current
    if (previousBodyStyle) {
      document.body.style.cursor = previousBodyStyle.cursor
      document.body.style.userSelect = previousBodyStyle.userSelect
    }
  }, [asideRef, fullscreenAnimationRef, navResizeFrameRef, previousBodyStyleRef, resizeFrameRef])
  return { startResizing, resize, stopResizing, startNavResizing, navResize, stopNavResizing, toggleFullscreen }
}

