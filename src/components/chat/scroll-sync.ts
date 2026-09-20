/**
 * Scroll synchronization for the chat surface.
 *
 * Manages auto-scroll behavior: scrolls to bottom on new content unless the
 * user has explicitly scrolled up.  Re-enables auto-scroll when the user
 * scrolls back to the bottom.
 */

import { scheduleAfterPaint } from '@/lib/schedule-after-paint'

/** Fixed gap kept between the anchored message top and the viewport top (px). */
const ANCHOR_TOP_OFFSET = 12

type ScrollSyncOptions = {
  panel: HTMLElement
  /** Forward the auto-scroll flag to the React ChatSurface handle. */
  setAutoScroll?: (enabled: boolean) => void
  onReachTop?: () => void
}

export function createScrollSync({ panel, setAutoScroll, onReachTop }: ScrollSyncOptions) {
  let autoScrollEnabled = true
  let autoScrollFrame: number | undefined
  let lastScrollTop = 0
  let lastTouchY: number | undefined
  let lastUserScrollUpAt = Number.NEGATIVE_INFINITY
  let lastPossibleUserScrollAt = Number.NEGATIVE_INFINITY
  let scrollResizeObserver: ResizeObserver | undefined
  let programmaticScrollDepth = 0

  const userScrollIntentMs = 500

  const findScrollContainer = () =>
    panel.querySelector<HTMLElement>('.qf-scroll-container')

  const isNearBottom = (element: HTMLElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight <= 80

  const setPanelAutoScroll = (enabled: boolean) => {
    setAutoScroll?.(enabled)
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
    // Skip the layout-invalidating write when already pinned to the bottom.
    // On very large chat DOMs a redundant `scrollTop =` forces a synchronous
    // reflow each frame even though the position does not change.
    const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight
    if (Math.abs(scrollContainer.scrollTop - maxScroll) <= 1) {
      lastScrollTop = scrollContainer.scrollTop
      return
    }
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

  // --- Sent-message anchor (opt-in, main chat only) ---
  //
  // The freshly sent user message is the last element of the content column,
  // so its top can never reach the viewport top: scrollTop clamps to
  // `scrollHeight - clientHeight`, which pins the message *bottom* to the
  // viewport bottom. A transparent spacer appended after the content column
  // pads the scroll height exactly enough to make the anchored target
  // reachable (`maxScrollTop === userTop - ANCHOR_TOP_OFFSET`). While the
  // assistant reply grows below the message, the spacer shrinks by the same
  // amount so the total scroll height stays constant — tail-following then
  // pins `scrollTop === anchorScrollTop`: the message stays just below the
  // viewport top (fixed `ANCHOR_TOP_OFFSET` gap) while the reply fills the
  // viewport below it. Once the spacer is exhausted it is
  // removed and plain tail-following resumes (the message is pushed up
  // naturally). The spacer carries no message content, so `data-message-index`
  // anchors and windowed rendering stay unaffected.
  let anchorSpacer: HTMLDivElement | undefined
  let anchorSpacerHeight = 0
  let anchorScrollTop = 0
  let cancelPendingAnchor: (() => void) | undefined

  const removeAnchorSpacer = () => {
    anchorSpacer?.remove()
    anchorSpacer = undefined
    anchorSpacerHeight = 0
  }

  /** Compensate content growth below the anchored message (RO-driven). */
  const updateAnchorSpacer = (scrollContainer: HTMLElement) => {
    if (!anchorSpacer || !anchorSpacer.isConnected) {
      removeAnchorSpacer()
      return
    }
    // Scroll height without the spacer = content that must fit
    // `anchorScrollTop + clientHeight` for maxScrollTop to stay at the
    // anchored message top.
    const contentHeight = scrollContainer.scrollHeight - anchorSpacerHeight
    const nextHeight = Math.max(0, anchorScrollTop + scrollContainer.clientHeight - contentHeight)
    if (nextHeight === 0) {
      // The reply filled the viewport: drop the spacer and resume plain
      // tail-following from here.
      removeAnchorSpacer()
      if (autoScrollEnabled) scheduleScrollToBottom()
      return
    }
    if (Math.abs(nextHeight - anchorSpacerHeight) >= 0.5) {
      anchorSpacerHeight = nextHeight
      anchorSpacer.style.height = `${nextHeight}px`
    }
  }

  /**
   * Send-path variant of `enable()` (opt-in): after the next paint — the
   * optimistic user-message append commits with it — anchor the last
   * `.qf-user-message` just below the top of the scroll viewport (fixed
   * `ANCHOR_TOP_OFFSET` gap), then keep following the tail (see the spacer
   * notes above). Falls back to plain bottom-following when the message or
   * the scroll container cannot be found.
   */
  const enableWithAnchor = () => {
    cancelPendingAnchor?.()
    cancelPendingAnchor = scheduleAfterPaint(() => {
      cancelPendingAnchor = undefined
      const scrollContainer = findScrollContainer()
      if (!scrollContainer) {
        enableAutoScroll()
        return
      }
      // Reset any residual spacer from a previous turn before measuring.
      removeAnchorSpacer()
      const userMessages = scrollContainer.querySelectorAll<HTMLElement>('.qf-user-message')
      const lastUserMessage = userMessages[userMessages.length - 1]
      if (!lastUserMessage) {
        enableAutoScroll()
        return
      }
      const containerTop = scrollContainer.getBoundingClientRect().top
      const messageTop = lastUserMessage.getBoundingClientRect().top
      // Anchor the message slightly below the viewport top. The initial spacer
      // height below and the shrink formula both key off this same target, so
      // the bottom-pinning invariant holds and the spacer padding
      // self-adjusts for the offset.
      anchorScrollTop = Math.max(
        0,
        scrollContainer.scrollTop + messageTop - containerTop - ANCHOR_TOP_OFFSET,
      )
      // Pad the scroll height so the anchor target becomes exactly reachable.
      // A message taller than the viewport clamps to its topmost reachable
      // position (spacer stays 0).
      const spacerHeight = Math.max(
        0,
        anchorScrollTop + scrollContainer.clientHeight - scrollContainer.scrollHeight,
      )
      if (spacerHeight > 0) {
        const spacer = document.createElement('div')
        spacer.style.height = `${spacerHeight}px`
        spacer.setAttribute('data-quickforge-anchor-spacer', '')
        spacer.setAttribute('aria-hidden', 'true')
        const contentColumn = scrollContainer.querySelector<HTMLElement>('.max-w-3xl')
        ;(contentColumn ?? scrollContainer).appendChild(spacer)
        anchorSpacer = spacer
        anchorSpacerHeight = spacerHeight
      }
      // The browser clamps scrollTop to maxScrollTop, which the spacer made
      // equal to the anchor target (or the topmost reachable position).
      scrollContainer.scrollTop = anchorScrollTop
      lastScrollTop = scrollContainer.scrollTop
      enableAutoScroll()
    })
  }

  // --- Event handlers ---

  const handleScroll = () => {
    const scrollContainer = findScrollContainer()
    if (!scrollContainer) return
    const currentScrollTop = scrollContainer.scrollTop
    const scrollingUp = currentScrollTop < lastScrollTop - 1
    if (programmaticScrollDepth > 0) {
      lastScrollTop = currentScrollTop
      return
    }
    const userInitiatedScrollUp = scrollingUp && recentlyUserScrolled()
    if (scrollingUp && autoScrollEnabled && !userInitiatedScrollUp && !isNearBottom(scrollContainer)) {
      lastScrollTop = currentScrollTop
      scheduleScrollToBottom()
      return
    }
    if (userInitiatedScrollUp) {
      disableAutoScroll()
      if (currentScrollTop <= 0 && lastScrollTop > 0) onReachTop?.()
    } else if (currentScrollTop > lastScrollTop + 1 && recentlyUserScrolled() && isNearBottom(scrollContainer)) {
      autoScrollEnabled = true
      setPanelAutoScroll(true)
    }
    lastScrollTop = currentScrollTop
  }

  const handleWheel = (event: WheelEvent) => {
    markPossibleUserScroll()
    if (event.deltaY < 0) {
      markUserScrollUp()
      // Short pages may already be at the top and cannot emit a scroll event.
      if ((findScrollContainer()?.scrollTop ?? 1) <= 0 && programmaticScrollDepth === 0) onReachTop?.()
    }
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (event.target === event.currentTarget) markPossibleUserScroll()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    markPossibleUserScroll()
    if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') markUserScrollUp()
  }

  const handleTouchStart = (event: TouchEvent) => {
    lastTouchY = event.touches[0]?.clientY
  }

  const handleTouchMove = (event: TouchEvent) => {
    const currentTouchY = event.touches[0]?.clientY
    if (currentTouchY === undefined || lastTouchY === undefined) return
    markPossibleUserScroll()
    if (currentTouchY > lastTouchY + 1) markUserScrollUp()
    lastTouchY = currentTouchY
  }

  // --- Public API ---

  const beginProgrammaticScroll = () => {
    programmaticScrollDepth += 1
    disableAutoScroll()
    return () => {
      programmaticScrollDepth = Math.max(0, programmaticScrollDepth - 1)
      const scrollContainer = findScrollContainer()
      if (scrollContainer) lastScrollTop = scrollContainer.scrollTop
    }
  }

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
      // Content growth below the anchored message shrinks the spacer first,
      // so the bottom-pinning write below lands on the compensated
      // maxScrollTop (the anchored message top) instead of pushing past it.
      if (anchorSpacer) {
        const observed = findScrollContainer()
        if (observed) updateAnchorSpacer(observed)
      }
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
    cancelPendingAnchor?.()
    cancelPendingAnchor = undefined
    removeAnchorSpacer()
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
    beginProgrammaticScroll,
    enable: enableAutoScroll,
    enableWithAnchor,
    disable: disableAutoScroll,
    scheduleScrollToBottom,
    setup,
    cleanup,
  }
}
