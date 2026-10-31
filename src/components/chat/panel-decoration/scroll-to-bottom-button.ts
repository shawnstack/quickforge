import { t } from '@/lib/i18n'

/**
 * "Back to bottom" floating button for the chat panel.
 *
 * Sits centered above the composer while the user has scrolled well away from
 * the tail of the conversation.  Visibility uses a hysteresis band (show far,
 * hide near) so the button never flickers around a single threshold, mirroring
 * how scroll-sync treats "near bottom".  Assistant messages that arrive while
 * the button is visible accumulate into an unread badge that clears on return.
 */

type ScrollToBottomButtonOptions = {
  panel: HTMLElement
  /**
   * Fired when a jump finishes without user interruption so the host can
   * re-enable tail-following (auto-scroll).
   */
  onJumpSettled: () => void
}

const SHOW_DISTANCE_PX = 280
const HIDE_DISTANCE_PX = 120
const JUMP_SETTLE_MS = 900

const BOTTOM_ARROW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>'

export function createScrollToBottomButton({ panel, onJumpSettled }: ScrollToBottomButtonOptions) {
  let button: HTMLButtonElement | null = null
  let badge: HTMLElement | null = null
  let scrollContainer: HTMLElement | null = null
  let resizeObserver: ResizeObserver | null = null
  let observedContainer: HTMLElement | null = null
  let observedContent: HTMLElement | null = null
  let measuredDistance: number | null = null
  let visible = false
  let unread = 0

  const findScrollContainer = () =>
    panel.querySelector<HTMLElement>('.qf-chat-panel .qf-scroll-container')

  const stopObserving = () => {
    resizeObserver?.disconnect()
    resizeObserver = null
    observedContainer = null
    observedContent = null
  }

  const readDistance = () => {
    if (!scrollContainer) {
      measuredDistance = null
      return
    }
    measuredDistance = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
  }

  const applyVisibility = () => {
    if (measuredDistance === null) return
    setVisible(visible ? measuredDistance > HIDE_DISTANCE_PX : measuredDistance > SHOW_DISTANCE_PX)
  }

  const handleScroll = () => {
    readDistance()
    applyVisibility()
  }

  const renderBadge = () => {
    if (!button || !badge) return
    badge.textContent = String(unread)
    badge.classList.toggle('quickforge-scroll-bottom-badge-empty', unread === 0)
    const label = unread > 0
      ? t('scrollToBottomUnreadLabel', { count: unread })
      : t('scrollToBottomLabel')
    button.setAttribute('aria-label', label)
    button.title = label
  }

  const setVisible = (next: boolean) => {
    if (visible === next) return
    visible = next
    button?.classList.toggle('is-visible', next)
    if (!next && unread > 0) {
      unread = 0
      renderBadge()
    }
  }

  const jumpToBottom = () => {
    const container = scrollContainer
    if (!container) return
    unread = 0
    renderBadge()
    setVisible(false)
    const target = container.scrollHeight - container.clientHeight
    const reducedMotion =
      typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (Math.abs(container.scrollTop - target) <= 1 || reducedMotion) {
      container.scrollTop = target
      onJumpSettled()
      return
    }
    // Native smooth scroll, with a wheel-up listener so an interrupting user
    // cancels the resume of tail-following instead of being dragged back down.
    let settled = false
    let interrupted = false
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) interrupted = true
    }
    const settle = () => {
      if (settled) return
      settled = true
      container.removeEventListener('scrollend', settle)
      container.removeEventListener('wheel', onWheel)
      window.clearTimeout(timeoutId)
      if (!interrupted) onJumpSettled()
    }
    container.addEventListener('wheel', onWheel, { passive: true })
    container.addEventListener('scrollend', settle, { once: true })
    const timeoutId = window.setTimeout(settle, JUMP_SETTLE_MS)
    container.scrollTo({ top: target, behavior: 'smooth' })
  }

  const createButton = () => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'quickforge-scroll-bottom-button'
    element.innerHTML = BOTTOM_ARROW_SVG
    badge = document.createElement('span')
    badge.className = 'quickforge-scroll-bottom-badge quickforge-scroll-bottom-badge-empty'
    badge.setAttribute('aria-hidden', 'true')
    element.append(badge)
    element.addEventListener('click', jumpToBottom)
    button = element
    renderBadge()
    return element
  }

  /**
   * Content and viewport growth are the only reasons visibility changes without
   * a scroll event. Watching them through ResizeObserver keeps the per-pass
   * `setup()` free of `scrollHeight` reads: by the time a decoration pass runs,
   * layout has already been invalidated by the DOM writes above it, so measuring
   * there would force a synchronous layout on every streaming frame.
   */
  const observeGeometry = () => {
    if (!scrollContainer) return
    // Test doubles do not implement the full Element surface.
    const content = typeof scrollContainer.querySelector === 'function'
      ? scrollContainer.querySelector<HTMLElement>('.max-w-3xl')
      : null
    if (
      resizeObserver
      && observedContainer === scrollContainer
      && observedContent === content
      && content?.isConnected !== false
    ) {
      return
    }
    stopObserving()
    if (
      typeof ResizeObserver !== 'function'
      || typeof scrollContainer.getBoundingClientRect !== 'function'
    ) {
      return
    }
    const observer = new ResizeObserver(handleScroll)
    try {
      observer.observe(scrollContainer)
      if (content) observer.observe(content)
    } catch {
      observer.disconnect()
      return
    }
    resizeObserver = observer
    observedContainer = scrollContainer
    observedContent = content
  }

  /**
   * Idempotent and self-healing: safe to call on every decoration pass.  Binds
   * the (persistent) scroll container once, and re-anchors the button when the
   * composer dock is rebuilt or removed (read-only sessions drop the dock).
   */
  const setup = () => {
    const container = findScrollContainer()
    if (container !== scrollContainer) {
      scrollContainer?.removeEventListener('scroll', handleScroll)
      scrollContainer = container
      scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })
      measuredDistance = null
    }
    const shell = panel.querySelector<HTMLElement>('.quickforge-composer-shell')
    if (!shell) {
      button?.remove()
      button = null
      badge = null
      stopObserving()
      return
    }
    if (!button) {
      button = createButton()
      // A read-only session drops the dock (and the button) without resetting
      // `visible`; replay the state onto the fresh node on rebuild.
      button.classList.toggle('is-visible', visible)
    }
    if (button.parentElement !== shell) shell.append(button)
    const previousObserver = resizeObserver
    observeGeometry()
    // First bind / geometry re-bind need one fresh measurement; steady-state
    // passes reuse the last scroll or ResizeObserver reading.
    if (!resizeObserver || resizeObserver !== previousObserver || measuredDistance === null) handleScroll()
    else applyVisibility()
  }

  const notifyNewAssistantMessage = () => {
    if (!visible) return
    unread += 1
    renderBadge()
  }

  const cleanup = () => {
    stopObserving()
    scrollContainer?.removeEventListener('scroll', handleScroll)
    scrollContainer = null
    measuredDistance = null
    button?.remove()
    button = null
    badge = null
    visible = false
    unread = 0
  }

  return {
    setup,
    cleanup,
    notifyNewAssistantMessage,
  }
}
