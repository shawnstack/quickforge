import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { t } from '../../lib/i18n'
import type { MessageWindowController } from './windowed-messages'
import { buildConversationTurns, isTurnUserMessage, type ConversationTurn } from './turn-navigation-data'

export { buildConversationTurns } from './turn-navigation-data'

const isUserMessage = isTurnUserMessage

type TurnNavigationOptions = {
  host: HTMLElement
  panel: HTMLElement
  getMessages: () => AgentMessage[]
  isStreaming: () => boolean
  windowLayer: MessageWindowController
  beginProgrammaticScroll: () => () => void
  onWindowChanged: () => void
}

type MessageListElement = HTMLElement & {
  messages: AgentMessage[]
  updateComplete?: Promise<unknown>
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
  windowLayer,
  beginProgrammaticScroll,
  onWindowChanged,
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

    const userSection = document.createElement('section')
    const userLabel = document.createElement('div')
    userLabel.className = 'quickforge-turn-navigation-tooltip-label'
    userLabel.textContent = t('turnNavigationUserMessage')
    const userText = document.createElement('div')
    userText.className = 'quickforge-turn-navigation-tooltip-text quickforge-turn-navigation-tooltip-user'
    userText.textContent = textPreview(turn.userText, t('turnNavigationAttachmentOnly'))
    userSection.append(userLabel, userText)

    const answerSection = document.createElement('section')
    const answerLabel = document.createElement('div')
    answerLabel.className = 'quickforge-turn-navigation-tooltip-label'
    answerLabel.textContent = t('turnNavigationFinalAnswer')
    const answerText = document.createElement('div')
    answerText.className = 'quickforge-turn-navigation-tooltip-text quickforge-turn-navigation-tooltip-answer'
    answerText.textContent = turn.isGenerating
      ? t('turnNavigationGenerating')
      : textPreview(turn.finalAnswerText, t('turnNavigationNoAnswer'))
    answerSection.append(answerLabel, answerText)

    popover.append(userSection, answerSection)
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
    const list = panel.querySelector<MessageListElement>('message-list')
    if (!container || !list || turns.length === 0) return

    const messages = getMessages()
    const renderedMessages = windowLayer.isEnabled() ? windowLayer.getWindowMessages() : messages
    const renderedTurnOrdinals = renderedMessages
      .map((message) => isUserMessage(message) ? messages.indexOf(message) : -1)
      .filter((messageIndex) => messageIndex >= 0)
      .map((messageIndex) => turns.findIndex((turn) => turn.messageIndex === messageIndex))
      .filter((ordinal) => ordinal >= 0)
    const userElements = Array.from(list.querySelectorAll<HTMLElement>('user-message'))
      .filter((element) => element.closest('message-list') === list)
    if (userElements.length === 0 || renderedTurnOrdinals.length === 0) return

    const threshold = container.getBoundingClientRect().top + Math.min(120, container.clientHeight * 0.2)
    let visibleIndex = 0
    for (let index = 0; index < userElements.length; index++) {
      if (userElements[index].getBoundingClientRect().top <= threshold) visibleIndex = index
      else break
    }
    setActiveOrdinal(renderedTurnOrdinals[Math.min(visibleIndex, renderedTurnOrdinals.length - 1)])
  }

  const attachScrollContainer = () => {
    const next = panel.querySelector<HTMLElement>('agent-interface .overflow-y-auto')
    if (next === scrollContainer) return
    scrollContainer?.removeEventListener('scroll', updateActiveFromScroll)
    scrollContainer = next
    scrollContainer?.addEventListener('scroll', updateActiveFromScroll, { passive: true })
  }

  const scrollToTurn = (ordinal: number) => {
    const turn = turns[ordinal]
    const list = panel.querySelector<MessageListElement>('message-list')
    const container = panel.querySelector<HTMLElement>('agent-interface .overflow-y-auto')
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
    const nextWindow = windowLayer.showMessageIndex(turn.messageIndex)
    if (nextWindow && list.messages !== nextWindow) list.messages = nextWindow

    const finish = () => {
      window.requestAnimationFrame(() => {
        if (generation !== jumpGeneration) return
        const messages = getMessages()
        const renderedMessages = windowLayer.isEnabled() ? windowLayer.getWindowMessages() : messages
        const targetIndex = renderedMessages.findIndex((message) => message === messages[turn.messageIndex])
        if (targetIndex < 0) {
          finishProgrammaticScroll()
          return
        }
        const userBeforeTarget = renderedMessages
          .slice(0, targetIndex + 1)
          .filter(isUserMessage).length - 1
        const target = Array.from(list.querySelectorAll<HTMLElement>('user-message'))
          .filter((element) => element.closest('message-list') === list)[userBeforeTarget]
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
    void (list.updateComplete ?? Promise.resolve()).then(finish, finish)
  }

  const renderNodes = () => {
    track.replaceChildren()
    if (turns.length === 0) {
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
      scrollContainer?.removeEventListener('scroll', updateActiveFromScroll)
      document.removeEventListener('keydown', handleDocumentKeyDown)
      window.removeEventListener('resize', handleViewportChange)
      rail.remove()
    },
  }
}
