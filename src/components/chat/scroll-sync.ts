/**
 * Scroll synchronization for the ChatPanel.
 *
 * Manages auto-scroll behavior: scrolls to bottom on new content unless the
 * user has explicitly scrolled up.  Re-enables auto-scroll when the user
 * scrolls back to the bottom.
 */

import type { AgentInterfaceElement } from './chat-utils'

type ScrollSyncOptions = {
  panel: HTMLElement
}

export function createScrollSync({ panel }: ScrollSyncOptions) {
  let autoScrollEnabled = true
  let autoScrollFrame: number | undefined
  let lastScrollTop = 0
  let lastTouchY: number | undefined
  let lastUserScrollUpAt = Number.NEGATIVE_INFINITY
  let lastPossibleUserScrollAt = Number.NEGATIVE_INFINITY
  let scrollResizeObserver: ResizeObserver | undefined

  const userScrollIntentMs = 500

  const findScrollContainer = () =>
    panel.querySelector<HTMLElement>('agent-interface .overflow-y-auto')

  const isNearBottom = (element: HTMLElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight <= 80

  const setPanelAutoScroll = (enabled: boolean) => {
    const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
    agentInterface?.setAutoScroll?.(enabled)
  }

  const recentlyUserScrolled = () => {
    const lastUserScrollAt = Math.max(lastUserScrollUpAt, lastPossibleUserScrollAt)
    return window.performance.now() - lastUserScrollAt <= userScrollIntentMs
  }

  const disableAutoScroll = () => {
    if (autoScrollFrame !== undefined) {
      window.cancelAnimationFrame(autoScrollFrame)
      autoScrollFrame = undefined
    }
    autoScrollEnabled = false
    setPanelAutoScroll(false)
  }

  const markUserScrollUp = () => {
    lastUserScrollUpAt = window.performance.now()
    disableAutoScroll()
  }

  const markPossibleUserScroll = () => {
    lastPossibleUserScrollAt = window.performance.now()
  }

  const scrollToBottom = () => {
    const scrollContainer = findScrollContainer()
    if (!scrollContainer || !autoScrollEnabled) return
    scrollContainer.scrollTop = scrollContainer.scrollHeight
    lastScrollTop = scrollContainer.scrollTop
  }

  const scheduleScrollToBottom = () => {
    if (autoScrollFrame !== undefined) return
    autoScrollFrame = window.requestAnimationFrame(() => {
      autoScrollFrame = undefined
      scrollToBottom()
      window.requestAnimationFrame(scrollToBottom)
    })
  }

  const enableAutoScroll = () => {
    autoScrollEnabled = true
    setPanelAutoScroll(true)
    scheduleScrollToBottom()
  }

  // --- Event handlers ---

  const handleScroll = () => {
    const scrollContainer = findScrollContainer()
    if (!scrollContainer) return
    const currentScrollTop = scrollContainer.scrollTop
    const scrollingUp = currentScrollTop < lastScrollTop - 1
    const userInitiatedScrollUp = scrollingUp && recentlyUserScrolled()
    if (scrollingUp && autoScrollEnabled && !userInitiatedScrollUp && !isNearBottom(scrollContainer)) {
      lastScrollTop = currentScrollTop
      scheduleScrollToBottom()
      return
    }
    if (userInitiatedScrollUp) {
      disableAutoScroll()
    } else if (isNearBottom(scrollContainer)) {
      autoScrollEnabled = true
      setPanelAutoScroll(true)
    }
    lastScrollTop = currentScrollTop
  }

  const handleWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) markUserScrollUp()
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (event.target === event.currentTarget) markPossibleUserScroll()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') markUserScrollUp()
  }

  const handleTouchStart = (event: TouchEvent) => {
    lastTouchY = event.touches[0]?.clientY
  }

  const handleTouchMove = (event: TouchEvent) => {
    const currentTouchY = event.touches[0]?.clientY
    if (currentTouchY === undefined || lastTouchY === undefined) return
    if (currentTouchY > lastTouchY + 1) markUserScrollUp()
    lastTouchY = currentTouchY
  }

  // --- Public API ---

  const setup = () => {
    const scrollContainer = findScrollContainer()
    if (!scrollContainer || scrollResizeObserver) return
    lastScrollTop = scrollContainer.scrollTop
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    scrollContainer.addEventListener('wheel', handleWheel, { passive: true })
    scrollContainer.addEventListener('pointerdown', handlePointerDown, { passive: true })
    scrollContainer.addEventListener('keydown', handleKeyDown)
    scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true })
    scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: true })
    scrollResizeObserver = new ResizeObserver(() => {
      if (autoScrollEnabled) scheduleScrollToBottom()
    })
    scrollResizeObserver.observe(scrollContainer)
    const contentContainer = scrollContainer.querySelector<HTMLElement>('.max-w-3xl')
    if (contentContainer) scrollResizeObserver.observe(contentContainer)
    const composerDock = panel.querySelector<HTMLElement>('.quickforge-composer-dock')
    if (composerDock) scrollResizeObserver.observe(composerDock)
    enableAutoScroll()
  }

  const cleanup = () => {
    const scrollContainer = findScrollContainer()
    scrollContainer?.removeEventListener('scroll', handleScroll)
    scrollContainer?.removeEventListener('wheel', handleWheel)
    scrollContainer?.removeEventListener('pointerdown', handlePointerDown)
    scrollContainer?.removeEventListener('keydown', handleKeyDown)
    scrollContainer?.removeEventListener('touchstart', handleTouchStart)
    scrollContainer?.removeEventListener('touchmove', handleTouchMove)
    scrollResizeObserver?.disconnect()
    scrollResizeObserver = undefined
    if (autoScrollFrame !== undefined) {
      window.cancelAnimationFrame(autoScrollFrame)
      autoScrollFrame = undefined
    }
  }

  return {
    get isEnabled() { return autoScrollEnabled },
    enable: enableAutoScroll,
    disable: disableAutoScroll,
    scheduleScrollToBottom,
    setup,
    cleanup,
  }
}
