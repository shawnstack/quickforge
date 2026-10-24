import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

const sessionTitleScrollDelayMs = 400
const sessionTitleScrollSpeedPxPerSecond = 35
const sessionTitleEndPauseMs = 1000

/** 悬停时若标题溢出容器，延迟后用 Web Animations API 横向滚动一遍再弹回。 */
export function SessionTitleMarquee({ title, className }: { title: string; className?: string }) {
  const staticTextRef = useRef<HTMLSpanElement | null>(null)
  const movingTextRef = useRef<HTMLSpanElement | null>(null)
  const delayTimerRef = useRef<number | null>(null)
  const animationRef = useRef<Animation | null>(null)

  const stopAnimation = useCallback(() => {
    if (delayTimerRef.current !== null) {
      window.clearTimeout(delayTimerRef.current)
      delayTimerRef.current = null
    }
    animationRef.current?.cancel()
    animationRef.current = null
    if (staticTextRef.current) staticTextRef.current.style.visibility = ''
    if (movingTextRef.current) {
      movingTextRef.current.style.display = ''
      movingTextRef.current.style.transform = 'translateX(0)'
    }
  }, [])

  const startAnimation = useCallback((event: React.MouseEvent<HTMLSpanElement>) => {
    stopAnimation()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const container = event.currentTarget
    const movingText = movingTextRef.current
    if (!movingText) return
    movingText.style.display = 'inline-block'
    const distance = movingText.scrollWidth - container.clientWidth
    movingText.style.display = ''
    if (distance <= 1) return

    delayTimerRef.current = window.setTimeout(() => {
      delayTimerRef.current = null
      const currentStaticText = staticTextRef.current
      const currentMovingText = movingTextRef.current
      if (!currentStaticText || !currentMovingText) return
      currentStaticText.style.visibility = 'hidden'
      currentMovingText.style.display = 'inline-block'
      const scrollDurationMs = distance / sessionTitleScrollSpeedPxPerSecond * 1000
      const returnDurationMs = Math.min(500, Math.max(240, scrollDurationMs * 0.25))
      const totalDurationMs = scrollDurationMs + sessionTitleEndPauseMs + returnDurationMs
      const endOffset = scrollDurationMs / totalDurationMs
      const returnOffset = (scrollDurationMs + sessionTitleEndPauseMs) / totalDurationMs
      const animation = currentMovingText.animate([
        { transform: 'translateX(0)', offset: 0, easing: 'linear' },
        { transform: `translateX(-${distance}px)`, offset: endOffset, easing: 'linear' },
        { transform: `translateX(-${distance}px)`, offset: returnOffset, easing: 'ease-out' },
        { transform: 'translateX(0)', offset: 1 },
      ], {
        duration: totalDurationMs,
        fill: 'forwards',
      })
      animationRef.current = animation
      void animation.finished.then(() => {
        if (animationRef.current !== animation) return
        animation.cancel()
        animationRef.current = null
        currentStaticText.style.visibility = ''
        currentMovingText.style.display = ''
        currentMovingText.style.transform = 'translateX(0)'
      }).catch(() => undefined)
    }, sessionTitleScrollDelayMs)
  }, [stopAnimation])

  useEffect(() => stopAnimation, [stopAnimation])

  return (
    <span
      className={cn('relative min-w-0 flex-1 overflow-hidden whitespace-nowrap', className)}
      onMouseEnter={startAnimation}
      onMouseLeave={stopAnimation}
    >
      <span ref={staticTextRef} className="block truncate">{title}</span>
      <span ref={movingTextRef} className="pointer-events-none absolute left-0 top-0 hidden whitespace-nowrap will-change-transform" aria-hidden="true">
        {title}
      </span>
    </span>
  )
}
