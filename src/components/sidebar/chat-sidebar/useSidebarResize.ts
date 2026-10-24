import { useCallback, useEffect, useRef, useState } from 'react'
import { clampSidebarWidth, sidebarDefaultWidth } from './sidebar-utils'

/** 桌面侧栏宽度拖拽：pointer 拖动 + rAF 节流写宽度、双击复位、视口收缩联动、
 *  拖拽期间锁 body 光标/选区；移动端或侧栏收起时自动结束并清内联宽度。 */
export function useSidebarResize({ isMobile, sidebarOpen }: { isMobile: boolean; sidebarOpen: boolean }) {
  const [sidebarWidth, setSidebarWidth] = useState(sidebarDefaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const resizeDragRef = useRef<{ startX: number; startWidth: number; currentWidth: number } | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const previousBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null)

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
    } else {
      asideRef.current?.style.removeProperty('width')
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
    if (isMobile || !sidebarOpen) return
    const syncWidthToViewport = () => {
      const nextWidth = clampSidebarWidth(resizeDragRef.current?.currentWidth ?? sidebarWidth)
      finishResizing(nextWidth)
    }
    window.addEventListener('resize', syncWidthToViewport)
    return () => window.removeEventListener('resize', syncWidthToViewport)
  }, [finishResizing, isMobile, sidebarWidth, sidebarOpen])

  return {
    asideRef,
    sidebarWidth,
    isResizing,
    startResizing,
    resizeSidebar,
    stopResizing,
    resetSidebarWidth,
  }
}
