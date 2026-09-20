import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { t } from '../../lib/i18n'
import { buildConversationTurns, isTurnUserMessage, shouldShowTurnNavigation, type ConversationTurn } from './turn-navigation-data'

export { buildConversationTurns } from './turn-navigation-data'

const isUserMessage = isTurnUserMessage

type TurnNavigationOptions = {
  host: HTMLElement
  panel: HTMLElement
  getMessages: () => AgentMessage[]
  isStreaming: () => boolean
  beginProgrammaticScroll: () => () => void
  onWindowChanged: () => void
  showMessageIndex?: (index: number) => Promise<void>
}

/**
 * Layout-independent inputs of {@link updateActiveFromScroll}: everything the
 * O(M×T) ordinal mapping and the `.qf-user-message` querySelectorAll scan
 * depend on. Scroll events fire many times per frame; caching these until the
 * rendered window or the turn model changes keeps the per-event cost down to
 * the getBoundingClientRect loop.
 */
type ScrollMeasureCache = {
  list: HTMLElement
  messages: AgentMessage[]
  windowStart: number
  turns: ConversationTurn[]
  userElements: HTMLElement[]
  renderedTurnOrdinals: number[]
}

function textPreview(text: string, fallback: string) {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return normalized || fallback
}

export function createTurnNavigation({
  host,
  panel,
  getMessages,
  isStreaming,
  beginProgrammaticScroll,
  onWindowChanged,
  showMessageIndex,
}: TurnNavigationOptions) {
  const rail = document.createElement('nav')
  rail.className = 'quickforge-turn-navigation'
  rail.setAttribute('aria-label', t('turnNavigationLabel'))
  rail.hidden = true

  const track = document.createElement('div')
  track.className = 'quickforge-turn-navigation-track'
  rail.append(track)
  host.append(rail)

  let turns: ConversationTurn[] = []
  let nodeSignature = ''
  let activeOrdinal = -1
  let tooltip: HTMLElement | null = null
  let tooltipTrigger: HTMLButtonElement | null = null
  let showTimer: number | undefined
  let hideTimer: number | undefined
  let scrollContainer: HTMLElement | null = null
  let jumpGeneration = 0
  let endProgrammaticScroll: (() => void) | null = null
  let cancelScrollCompletion: (() => void) | null = null
  let scrollMeasureFrame: number | undefined
  let scrollMeasureCache: ScrollMeasureCache | null = null

  const clearShowTimer = () => {
    if (showTimer === undefined) return
    window.clearTimeout(showTimer)
    showTimer = undefined
  }

  const clearHideTimer = () => {
    if (hideTimer === undefined) return
    window.clearTimeout(hideTimer)
    hideTimer = undefined
  }

  const hideTooltip = () => {
    clearShowTimer()
    clearHideTimer()
    tooltip?.remove()
    tooltip = null
    tooltipTrigger?.removeAttribute('aria-describedby')
    tooltipTrigger = null
  }

  const positionTooltip = () => {
    if (!tooltip || !tooltipTrigger) return
    const triggerRect = tooltipTrigger.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const gap = 10
    const viewportPadding = 12
    let left = triggerRect.right + gap
    if (left + tooltipRect.width > window.innerWidth - viewportPadding) {
      left = triggerRect.left - tooltipRect.width - gap
    }
    const top = Math.min(
      Math.max(viewportPadding, triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2),
      Math.max(viewportPadding, window.innerHeight - tooltipRect.height - viewportPadding),
    )
    tooltip.style.left = `${Math.max(viewportPadding, left)}px`
    tooltip.style.top = `${top}px`
  }

  const showTooltip = (trigger: HTMLButtonElement, ordinal: number) => {
    clearShowTimer()
    clearHideTimer()
    hideTooltip()
    const turn = turns[ordinal]
    if (!turn) return

    const popover = document.createElement('div')
    const tooltipId = `quickforge-turn-navigation-tooltip-${ordinal}`
    popover.id = tooltipId
    popover.className = 'quickforge-turn-navigation-tooltip'
    popover.setAttribute('role', 'tooltip')

    const userText = document.createElement('div')
    userText.className = 'quickforge-turn-navigation-tooltip-text quickforge-turn-navigation-tooltip-user'
    userText.textContent = textPreview(turn.userText, t('turnNavigationAttachmentOnly'))
    popover.append(userText)

    const answer = turn.isGenerating ? t('turnNavigationGenerating') : turn.finalAnswerText.trim()
    if (answer) {
      const answerText = document.createElement('div')
      answerText.className = 'quickforge-turn-navigation-tooltip-text quickforge-turn-navigation-tooltip-answer'
      answerText.textContent = answer
      popover.append(answerText)
    }
    popover.addEventListener('pointerenter', clearHideTimer)
    popover.addEventListener('pointerleave', () => {
      hideTimer = window.setTimeout(hideTooltip, 100)
    })
    document.body.append(popover)
    tooltip = popover
    tooltipTrigger = trigger
    trigger.setAttribute('aria-describedby', tooltipId)
    positionTooltip()
  }

  const scheduleTooltip = (trigger: HTMLButtonElement, ordinal: number) => {
    clearShowTimer()
    clearHideTimer()
    showTimer = window.setTimeout(() => showTooltip(trigger, ordinal), 150)
  }

  const setActiveOrdinal = (ordinal: number) => {
    if (ordinal === activeOrdinal) return
    activeOrdinal = ordinal
    const nodes = track.querySelectorAll<HTMLButtonElement>('.quickforge-turn-navigation-node')
    nodes.forEach((node, index) => {
      const active = index === ordinal
      const distance = Math.abs(index - ordinal)
      node.classList.toggle('is-active', active)
      node.classList.toggle('is-nearby', distance === 1)
      node.classList.toggle('is-nearby-secondary', distance === 2)
      if (active) node.setAttribute('aria-current', 'true')
      else node.removeAttribute('aria-current')
    })
  }

  const updateActiveFromScroll = () => {
    const container = scrollContainer
    const list = panel.querySelector<HTMLElement>('.qf-message-list')
    if (!container || !list || turns.length === 0) return

    const messages = getMessages()
    const windowStart = Number(list.dataset.windowStart) || 0
    let cache = scrollMeasureCache
    if (!cache || cache.list !== list || cache.messages !== messages || cache.windowStart !== windowStart || cache.turns !== turns) {
      const renderedTurnOrdinals = messages
        .map((message, index) => index >= windowStart && isUserMessage(message) ? index : -1)
        .filter((messageIndex) => messageIndex >= 0)
        .map((messageIndex) => turns.findIndex((turn) => turn.messageIndex === messageIndex))
        .filter((ordinal) => ordinal >= 0)
      const userElements = Array.from(list.querySelectorAll<HTMLElement>('.qf-user-message'))
        .filter((element) => element.closest('.qf-message-list') === list)
      cache = { list, messages, windowStart, turns, userElements, renderedTurnOrdinals }
      scrollMeasureCache = cache
    }
    const { userElements, renderedTurnOrdinals } = cache
    if (userElements.length === 0 || renderedTurnOrdinals.length === 0) return

    const threshold = container.getBoundingClientRect().top + Math.min(120, container.clientHeight * 0.2)
    let visibleIndex = 0
    for (let index = 0; index < userElements.length; index++) {
      if (userElements[index].getBoundingClientRect().top <= threshold) visibleIndex = index
      else break
    }
    setActiveOrdinal(renderedTurnOrdinals[Math.min(visibleIndex, renderedTurnOrdinals.length - 1)])
  }

  // Scroll events fire several times per frame during smooth scrolling; coalesce
  // the measurement into one animation-frame pass (same pattern as scroll-sync).
  const measureActiveFromScrollEvent = () => {
    if (scrollMeasureFrame !== undefined) return
    scrollMeasureFrame = window.requestAnimationFrame(() => {
      scrollMeasureFrame = undefined
      updateActiveFromScroll()
    })
  }

  const attachScrollContainer = () => {
    const next = panel.querySelector<HTMLElement>('.qf-scroll-container')
    if (next === scrollContainer) return
    scrollContainer?.removeEventListener('scroll', measureActiveFromScrollEvent)
    scrollContainer = next
    scrollContainer?.addEventListener('scroll', measureActiveFromScrollEvent, { passive: true })
  }

  const scrollToTurn = (ordinal: number) => {
    const turn = turns[ordinal]
    const list = panel.querySelector<HTMLElement>('.qf-message-list')
    const container = panel.querySelector<HTMLElement>('.qf-scroll-container')
    if (!turn || !list || !container) return

    hideTooltip()
    const generation = ++jumpGeneration
    cancelScrollCompletion?.()
    cancelScrollCompletion = null
    endProgrammaticScroll?.()
    endProgrammaticScroll = beginProgrammaticScroll()
    const finishProgrammaticScroll = () => {
      if (generation !== jumpGeneration) return
      cancelScrollCompletion?.()
      cancelScrollCompletion = null
      const end = endProgrammaticScroll
      endProgrammaticScroll = null
      window.requestAnimationFrame(() => end?.())
    }
    const waitForScrollCompletion = () => {
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        container.removeEventListener('scrollend', settle)
        window.clearTimeout(timeoutId)
        finishProgrammaticScroll()
      }
      container.addEventListener('scrollend', settle, { once: true })
      const timeoutId = window.setTimeout(settle, 900)
      cancelScrollCompletion = () => {
        settled = true
        container.removeEventListener('scrollend', settle)
        window.clearTimeout(timeoutId)
      }
    }
    // Wait for React's layout commit before measuring the newly selected window.
    const finish = () => {
      window.requestAnimationFrame(() => {
        if (generation !== jumpGeneration) return
        const messages = getMessages()
        const targetIndex = turn.messageIndex
        if (!messages[targetIndex]) {
          finishProgrammaticScroll()
          return
        }
        const userBeforeTarget = messages
          .slice(Number(list.dataset.windowStart) || 0, targetIndex + 1)
          .filter(isUserMessage).length - 1
        const target = Array.from(list.querySelectorAll<HTMLElement>('.qf-user-message'))
          .filter((element) => element.closest('.qf-message-list') === list)[userBeforeTarget]
        if (!target) {
          finishProgrammaticScroll()
          return
        }
        const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 24
        const destination = Math.max(0, top)
        if (Math.abs(container.scrollTop - destination) <= 1) {
          container.scrollTop = destination
          finishProgrammaticScroll()
        } else {
          waitForScrollCompletion()
          container.scrollTo({ top: destination, behavior: 'smooth' })
        }
        setActiveOrdinal(ordinal)
        onWindowChanged()
      })
    }
    if (showMessageIndex) void showMessageIndex(turn.messageIndex).then(finish, finishProgrammaticScroll)
    else finish()
  }

  const renderNodes = () => {
    track.replaceChildren()
    if (!shouldShowTurnNavigation(turns.length)) {
      rail.hidden = true
      return
    }
    rail.hidden = false

    turns.forEach((turn, ordinal) => {
      const node = document.createElement('button')
      node.type = 'button'
      node.className = 'quickforge-turn-navigation-node'
      node.setAttribute('aria-label', t('turnNavigationJumpLabel', {
        index: ordinal + 1,
        preview: textPreview(turn.userText, t('turnNavigationAttachmentOnly')),
      }))
      node.addEventListener('pointerenter', () => scheduleTooltip(node, ordinal))
      node.addEventListener('pointerleave', () => {
        clearShowTimer()
        hideTimer = window.setTimeout(hideTooltip, 100)
      })
      node.addEventListener('focus', () => scheduleTooltip(node, ordinal))
      node.addEventListener('blur', () => {
        hideTimer = window.setTimeout(hideTooltip, 100)
      })
      node.addEventListener('click', () => scrollToTurn(ordinal))
      track.append(node)
    })
    activeOrdinal = -1
  }

  const update = () => {
    // The decorate cycle that calls update() may have rebuilt message rows in
    // between (decorate / process re-fold); drop the scroll-measure cache so
    // the next measurement rescans the (possibly changed) DOM.
    scrollMeasureCache = null
    turns = buildConversationTurns(getMessages(), isStreaming())
    const signature = turns.map((turn) => `${turn.messageIndex}:${turn.userText}`).join('|')
    if (signature !== nodeSignature) {
      nodeSignature = signature
      renderNodes()
    }
    attachScrollContainer()
    updateActiveFromScroll()
  }

  const handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') hideTooltip()
  }
  const handleViewportChange = () => hideTooltip()
  document.addEventListener('keydown', handleDocumentKeyDown)
  window.addEventListener('resize', handleViewportChange)

  return {
    update,
    cleanup() {
      jumpGeneration += 1
      cancelScrollCompletion?.()
      cancelScrollCompletion = null
      endProgrammaticScroll?.()
      endProgrammaticScroll = null
      hideTooltip()
      if (scrollMeasureFrame !== undefined) {
        window.cancelAnimationFrame(scrollMeasureFrame)
        scrollMeasureFrame = undefined
      }
      scrollMeasureCache = null
      scrollContainer?.removeEventListener('scroll', measureActiveFromScrollEvent)
      document.removeEventListener('keydown', handleDocumentKeyDown)
      window.removeEventListener('resize', handleViewportChange)
      rail.remove()
    },
  }
}
