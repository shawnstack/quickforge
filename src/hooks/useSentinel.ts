import { useEffect, useRef, useCallback } from 'react'

/**
 * Returns a ref to attach to a sentinel element. When the sentinel enters
 * the viewport and `enabled` is true, `onIntersect` is called.
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

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          callbackRef.current()
        }
      },
      {
        // Observe relative to the nearest scrollable ancestor
        root: null,
        rootMargin: '100px',
        threshold: 0,
      },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled])

  return setRef
}
