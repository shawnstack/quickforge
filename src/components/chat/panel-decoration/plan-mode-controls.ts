import type { CommandTextareaElement, MessageEditorElement } from '../chat-utils'

/**
 * Plan-mode textarea shortcut + its cleanup.
 *
 * The plan-mode *trigger* is rendered by `surface/ComposerAccessControls.tsx`
 * now (it used to be injected into the composer's left control row by
 * `syncPlanModeButton`). What stays here is the Shift+Tab shortcut: it is bound
 * to the editor's textarea element, which is a DOM node the surface owns but
 * does not expose as an event surface — the only way in is the bridge.
 */

export function removePlanModeControls(editor: MessageEditorElement | null) {
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea') as CommandTextareaElement | null
  if (textarea?.__quickforgePlanModeHandler) {
    textarea.removeEventListener('keydown', textarea.__quickforgePlanModeHandler, true)
    textarea.__quickforgePlanModeHandler = undefined
  }
  if (editor) delete editor.dataset.quickforgePlanMode
}

export function setupPlanModeControls(
  editor: MessageEditorElement | null,
  planMode: boolean,
  onTogglePlanMode: () => void,
) {
  const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
  if (!textarea) return

  const planTextarea = textarea as CommandTextareaElement
  if (planTextarea.__quickforgePlanModeHandler) {
    planTextarea.removeEventListener('keydown', planTextarea.__quickforgePlanModeHandler, true)
  }

  // Capture phase so Shift+Tab never reaches the browser's focus navigation
  // (which would move focus out of the composer) or any bubble-phase handler.
  planTextarea.__quickforgePlanModeHandler = (event: KeyboardEvent) => {
    if (event.isComposing || event.key === 'Process') return
    if (event.key !== 'Tab' || !event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    onTogglePlanMode()
  }
  planTextarea.addEventListener('keydown', planTextarea.__quickforgePlanModeHandler, true)
  if (editor) editor.dataset.quickforgePlanMode = String(planMode)
}
