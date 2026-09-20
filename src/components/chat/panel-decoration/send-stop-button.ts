import type { QuickForgeActionButton } from '../chat-utils'

/**
 * Streaming-state decoration for the composer's action button.
 *
 * React owns the button's DOM (base class, icon svg, title); this layer only
 * decorates state: the waiting ring, the stop title/aria, and the
 * capture-phase stop handler that aborts on pointerdown. It must never
 * replace or restructure React-owned children — grafting a foreign svg used
 * to make React's commit throw NotFoundError when isStreaming flipped.
 */
export function syncSendStopButton(options: {
  rightControls: HTMLElement
  isStreaming: () => boolean
  isWaiting?: () => boolean
  abort: () => void
  removeCommandSuggestions: () => void
}) {
  const { rightControls, isStreaming, isWaiting, abort, removeCommandSuggestions } = options
  const actionButton = rightControls.querySelector<QuickForgeActionButton>('button:last-child')
  if (!actionButton) return

  const removeStopHandler = () => {
    if (!actionButton.__quickforgeStopHandler) return
    actionButton.removeEventListener('pointerdown', actionButton.__quickforgeStopHandler, true)
    actionButton.removeEventListener('click', actionButton.__quickforgeStopHandler, true)
    actionButton.__quickforgeStopHandler = undefined
  }

  if (isStreaming()) {
    actionButton.disabled = false
    actionButton.classList.toggle('quickforge-stop-button--waiting', isWaiting ? isWaiting() : false)
    actionButton.title = 'Stop'
    actionButton.setAttribute('aria-label', 'Stop')
    if (!actionButton.__quickforgeStopHandler) {
      actionButton.__quickforgeStopHandler = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        removeCommandSuggestions()
        abort()
      }
      actionButton.addEventListener('pointerdown', actionButton.__quickforgeStopHandler, true)
      actionButton.addEventListener('click', actionButton.__quickforgeStopHandler, true)
    }
  } else {
    removeStopHandler()
    actionButton.classList.remove('quickforge-stop-button--waiting')
  }
}
