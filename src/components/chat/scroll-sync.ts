/**
 * Scroll synchronization for the chat surface.
 *
 * Manages auto-scroll behavior: scrolls to bottom on new content unless the
 * user has explicitly scrolled up.  Re-enables auto-scroll when the user
 * scrolls back to the bottom.
 */

/** Fixed gap kept between the anchored message top and the viewport top (px). */
const ANCHOR_TOP_OFFSET = 12

/** Upper bound for the per-frame wait of the freshly sent user message. */
const ANCHOR_WAIT_TIMEOUT_MS = 1000

/**
 * DOM event a fold disclosure (process group / stage / thinking block) emits
 * when the user toggles it. Expanding grows the content below the viewport, so
 * both the content ResizeObserver and the per-event `scheduleScrollToBottom`
 * would otherwise pin the tail again on the next frame — yanking the viewport
 * past what the user just opened ("expand → jump to bottom" flash). The panel
 * treats the event as a reading intent: tail-following detaches immediately and
 * re-arms the usual way (scrolling back within `repinFollowDistancePx`).
 */
export const READING_INTENT_EVENT = 'quickforge:reading-intent'

/**
 * Emit {@link READING_INTENT_EVENT} from a disclosure control so the panel
 * detaches tail-following. Bubbles: scroll-sync listens on the chat panel, so
 * any descendant (decoration-owned or React-rendered) may call this with the
 * toggled control element. Defensive against non-DOM test fakes.
 */
export function emitReadingIntent(target?: { dispatchEvent?: (event: Event) => boolean }): void {
  const dispatchEvent = target?.dispatchEvent
  if (typeof dispatchEvent !== 'function') return
  dispatchEvent(new CustomEvent(READING_INTENT_EVENT, { bubbles: true }))
}

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
  // Hysteresis parity with the removed pi-web-ui `AgentInterface`
  // (`_handleScroll`): a user scroll-up detaches tail-following only once the
  // tail is more than 50px away; a viewport back within 10px of the tail
  // re-arms the follow immediately, whatever moved it there.
  const releaseFollowDistancePx = 50
  const repinFollowDistancePx = 10

  const findScrollContainer = () =>
    panel.querySelector<HTMLElement>('.qf-scroll-container')

  const distanceFromBottom = (element: HTMLElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight

  const isNearBottom = (element: HTMLElement) => distanceFromBottom(element) <= 80

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
    // Distance-gated like pi-web-ui's `_handleScroll`: an upward tick that
    // stays inside the hysteresis band keeps following the tail. Exception:
    // while the sent-message anchor is active the viewport sits on the
    // spacer-padded maxScrollTop (distance-to-bottom stays ~0), so the band
    // would swallow every upward tick and keep re-anchoring against the
    // user - detach immediately instead.
    const scrollContainer = findScrollContainer()
    if (
      !scrollContainer ||
      anchorMessage !== undefined ||
      distanceFromBottom(scrollContainer) > releaseFollowDistancePx
    ) {
      disableAutoScroll()
    }
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
  // reachable (`maxScrollTop === userTop - ANCHOR_TOP_OFFSET`).
  //
  // Two send-time races used to strand the message off-screen; both are
  // handled here:
  // - The optimistic append may commit later than any fixed double-rAF wait
  //   (busy main thread), which used to make the anchor grab the *previous*
  //   turn's message. `enableWithAnchor` instead records the pre-send last
  //   user message and polls per animation frame until a different element
  //   holds the last `.qf-user-message` slot (or the first one appears in a
  //   fresh chat), falling back to plain bottom-following on timeout.
  // - The anchor never pins a scroll position captured at send time: every
  //   update re-derives the target from the message's *live* geometry, so
  //   layout shifts around the send (process-fold release → re-fold,
  //   decoration injections, content changes above the message) are absorbed
  //   on the next update instead of leaving the viewport pinned to a stale
  //   document offset. The invariant is always "content bottom pinned to the
  //   viewport bottom with the message top ANCHOR_TOP_OFFSET below the
  //   viewport top": spacer = max(0, target + clientHeight − contentHeight)
  //   and scrollTop = target. When the spacer reaches 0, the content below
  //   the message already fills the viewport: the spacer is removed and
  //   plain tail-following resumes (the message is pushed up naturally).
  //
  // The spacer carries no message content, so `data-message-index` anchors
  // and windowed rendering stay unaffected. `src/index.css` additionally
  // disables the browser's native overflow-anchor on the scroll container so
  // it cannot counter-shift these scrollTop writes.
  let anchorSpacer: HTMLDivElement | undefined
  let anchorSpacerHeight = 0
  let anchorMessage: HTMLElement | undefined
  let cancelPendingAnchor: (() => void) | undefined

  const removeAnchorSpacer = () => {
    anchorSpacer?.remove()
    anchorSpacer = undefined
    anchorSpacerHeight = 0
  }

  /** Leave the anchor-active state; optionally resume plain tail-following. */
  const exitAnchor = (followTail: boolean) => {
    removeAnchorSpacer()
    anchorMessage = undefined
    if (followTail && autoScrollEnabled) scheduleScrollToBottom()
  }

  /**
   * Re-anchor against the live geometry of the anchored message. Runs on
   * ResizeObserver updates while the anchor is active (spacer lifetime);
   * rect reads happen only here, never outside it.
   */
  const refreshAnchor = (scrollContainer: HTMLElement) => {
    if (!anchorMessage) return
    if (!anchorMessage.isConnected) {
      // The node was replaced or the session rebuilt: drop the anchor
      // quietly and let plain tail-following take over.
      exitAnchor(true)
      return
    }
    const containerTop = scrollContainer.getBoundingClientRect().top
    const messageTop = anchorMessage.getBoundingClientRect().top
    // Document-space top of the message: invariant under scrolling, shifts
    // when layout above the message changes. Re-derived on every update.
    const messageTopDoc = messageTop - containerTop + scrollContainer.scrollTop
    const anchorTarget = Math.max(0, messageTopDoc - ANCHOR_TOP_OFFSET)
    // Scroll height without the spacer = content that must fit
    // `anchorTarget + clientHeight` for the message to stay pinned.
    const contentHeight = scrollContainer.scrollHeight - anchorSpacerHeight
    const nextSpacerHeight = Math.max(0, anchorTarget + scrollContainer.clientHeight - contentHeight)
    if (nextSpacerHeight === 0) {
      exitAnchor(true)
      return
    }
    if (!anchorSpacer || !anchorSpacer.isConnected) {
      if (anchorSpacer) removeAnchorSpacer()
      const spacer = document.createElement('div')
      spacer.style.height = `${nextSpacerHeight}px`
      spacer.setAttribute('data-quickforge-anchor-spacer', '')
      spacer.setAttribute('aria-hidden', 'true')
      const contentColumn = scrollContainer.querySelector<HTMLElement>('.max-w-3xl')
      ;(contentColumn ?? scrollContainer).appendChild(spacer)
      anchorSpacer = spacer
      anchorSpacerHeight = nextSpacerHeight
    } else if (Math.abs(nextSpacerHeight - anchorSpacerHeight) >= 0.5) {
      anchorSpacerHeight = nextSpacerHeight
      anchorSpacer.style.height = `${nextSpacerHeight}px`
    }
    // Bottom-pinning write: with the spacer in place maxScrollTop ===
    // anchorTarget, so this is exactly the tail-following position. Skipped
    // while the user scrolled away (the spacer still compensates).
    if (autoScrollEnabled && Math.abs(scrollContainer.scrollTop - anchorTarget) > 0.5) {
      scrollContainer.scrollTop = anchorTarget
      lastScrollTop = scrollContainer.scrollTop
    }
  }

  /**
   * Send-path variant of `enable()` (opt-in): wait for the optimistic user
   * message to appear in the DOM (per-frame poll, bounded by a timeout),
   * then anchor it just below the top of the scroll viewport (fixed
   * `ANCHOR_TOP_OFFSET` gap) and keep following the tail (see the spacer
   * notes above). Falls back to plain bottom-following when the message
   * never shows up or the scroll container cannot be found.
   */
  const enableWithAnchor = () => {
    cancelPendingAnchor?.()
    cancelPendingAnchor = undefined
    // Reset any residual anchor state from a previous turn before waiting.
    exitAnchor(false)
    const scrollContainer = findScrollContainer()
    if (!scrollContainer) {
      enableAutoScroll()
      return
    }
    // The message appended by this send must differ from the last user
    // message that already existed when the send started.
    const previousMessages = scrollContainer.querySelectorAll<HTMLElement>('.qf-user-message')
    const previousLast = previousMessages[previousMessages.length - 1]
    const startedAt = window.performance.now()
    let frame: number | undefined
    const stopWaiting = () => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame)
        frame = undefined
      }
      if (cancelPendingAnchor === stopWaiting) cancelPendingAnchor = undefined
    }
    cancelPendingAnchor = stopWaiting
    const poll = () => {
      frame = undefined
      // A newer wait (or cleanup) replaced this one: stand down. The token
      // check also covers hosts where cancelAnimationFrame cannot retract an
      // already-queued callback.
      if (cancelPendingAnchor !== stopWaiting) return
      if (window.performance.now() - startedAt >= ANCHOR_WAIT_TIMEOUT_MS) {
        stopWaiting()
        enableAutoScroll()
        return
      }
      const container = findScrollContainer()
      if (!container) {
        stopWaiting()
        enableAutoScroll()
        return
      }
      const messages = container.querySelectorAll<HTMLElement>('.qf-user-message')
      const last = messages[messages.length - 1]
      if (last && last !== previousLast) {
        stopWaiting()
        anchorMessage = last
        refreshAnchor(container)
        enableAutoScroll()
        return
      }
      frame = window.requestAnimationFrame(poll)
    }
    frame = window.requestAnimationFrame(poll)
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
    const distance = distanceFromBottom(scrollContainer)
    const userInitiatedScrollUp = scrollingUp && recentlyUserScrolled()
    if (scrollingUp && autoScrollEnabled && !userInitiatedScrollUp && !isNearBottom(scrollContainer)) {
      lastScrollTop = currentScrollTop
      scheduleScrollToBottom()
      return
    }
    if (distance < repinFollowDistancePx) {
      // pi-web-ui parity: touching the tail re-arms the follow immediately,
      // even when the scroll carried no recent user-scroll intent.
      if (!autoScrollEnabled) {
        autoScrollEnabled = true
        setPanelAutoScroll(true)
      }
    } else if (
      userInitiatedScrollUp &&
      (anchorMessage !== undefined || distance > releaseFollowDistancePx)
    ) {
      // pi-web-ui parity: a user scroll-up inside the hysteresis band keeps
      // following; only a scroll-up past 50px from the tail detaches
      // (anchor-active scroll-ups detach immediately - see markUserScrollUp).
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

  const handleReadingIntent = () => {
    // A fold disclosure was toggled: the user is reading there, so detach
    // tail-following (see READING_INTENT_EVENT) instead of letting the next
    // resize/event frame scroll past the freshly opened content.
    disableAutoScroll()
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
    // Reading intent bubbles from any fold disclosure inside the panel.
    panel.addEventListener(READING_INTENT_EVENT, handleReadingIntent)
    scrollResizeObserver = new ResizeObserver(() => {
      // While the anchor is active, re-derive the target from the message's
      // live position first: layout shifts above the message (fold release /
      // re-fold, decorations) and content growth below it are both absorbed
      // here, and the bottom-pinning write below lands on the compensated
      // maxScrollTop (the anchored message top) instead of pushing past it.
      if (anchorMessage) {
        const observed = findScrollContainer()
        if (observed) refreshAnchor(observed)
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
    anchorMessage = undefined
    const scrollContainer = findScrollContainer()
    scrollContainer?.removeEventListener('scroll', handleScroll)
    scrollContainer?.removeEventListener('wheel', handleWheel)
    scrollContainer?.removeEventListener('pointerdown', handlePointerDown)
    scrollContainer?.removeEventListener('keydown', handleKeyDown)
    scrollContainer?.removeEventListener('touchstart', handleTouchStart)
    scrollContainer?.removeEventListener('touchmove', handleTouchMove)
    panel.removeEventListener(READING_INTENT_EVENT, handleReadingIntent)
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
