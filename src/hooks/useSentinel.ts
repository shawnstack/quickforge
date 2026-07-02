import { useEffect, useRef, useCallback } from 'react'

function nearestScrollableAncestor(node: HTMLElement) {
  let current = node.parentElement
  while (current) {
    const style = window.getComputedStyle(current)
    const overflowY = style.overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return current
    }
    current = current.parentElement
  }
  return null
}

/**
 * Returns a ref to attach to a sentinel element. When the sentinel enters
 * its nearest scrollable ancestor, or the viewport when no scroll parent is
 * found, `onIntersect` is called.
 * Cleans up on unmount or when enabled becomes false.
 */
export function useSentinel(onIntersect: () => void, enabled: boolean) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const callbackRef = useRef(onIntersect)
  useEffect(() => {
    callbackRef.current = onIntersect
  }, [onIntersect])

  const setRef = useCallback((node: HTMLDivElement | null) => {
    sentinelRef.current = node
  }, [])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !enabled) return

    const root = nearestScrollableAncestor(node)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          callbackRef.current()
        }
      },
      {
        root,
        rootMargin: '100px',
        threshold: 0,
      },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled])

  return setRef
}
