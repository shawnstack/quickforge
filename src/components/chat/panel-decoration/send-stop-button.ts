import type { QuickForgeActionButton } from '../chat-utils'
import { replaceSvg } from '../chat-utils'

export function syncSendStopButton(options: {
  rightControls: HTMLElement
  isStreaming: () => boolean
  abort: () => void
  removeCommandSuggestions: () => void
}) {
  const { rightControls, isStreaming, abort, removeCommandSuggestions } = options
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
    actionButton.classList.remove('quickforge-send-button')
    actionButton.classList.add('quickforge-stop-button')
    actionButton.title = 'Stop'
    actionButton.setAttribute('aria-label', 'Stop')
    delete actionButton.dataset.quickforgeSendIcon
    replaceSvg(actionButton, '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>')
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
    actionButton.classList.remove('quickforge-stop-button')
    actionButton.classList.add('quickforge-send-button')
    if (actionButton.dataset.quickforgeSendIcon !== 'arrow-up') {
      actionButton.dataset.quickforgeSendIcon = 'arrow-up'
      replaceSvg(actionButton, '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>')
      // Remove the Lit element's rotate(-45deg) wrapper so our upward arrow stays pointing up
      const svg = actionButton.querySelector('svg')
      const wrapper = svg?.parentElement
      if (wrapper && wrapper !== actionButton && wrapper.style.transform) {
        wrapper.style.transform = ''
      }
    }
  }
}
