import type { MessageEditorElement } from '../chat-utils'

export function decorateModelButtonLabel(editor: MessageEditorElement | null, rightControls: HTMLElement) {
  const modelState = editor as (MessageEditorElement & { currentModel?: { id?: string } }) | null
  const model = modelState?.currentModel
  rightControls.querySelector<HTMLElement>('[data-quickforge-thinking-badge]')?.remove()
  const modelButton = Array.from(rightControls.querySelectorAll<HTMLButtonElement>('button:not(.quickforge-agent-access-inline):not(.quickforge-yolo-inline):not(.quickforge-plan-inline):not(.quickforge-thinking-inline)'))
    .find((button) => Boolean(model?.id && button.textContent?.includes(model.id)))
  if (!modelButton) return

  modelButton.classList.add('quickforge-model-trigger')
  modelButton.setAttribute('aria-haspopup', 'menu')
  // Only count menus owned by this trigger: when the main chat and the
  // side-chat are both mounted, a document-wide lookup would report the other
  // panel's menu as this panel's state. Menus opened without an explicit
  // anchor (legacy callers) carry no owner, so fall back to global presence.
  const menus = Array.from(document.querySelectorAll<HTMLElement & { __quickforgeOwnerAnchor?: HTMLElement }>('.quickforge-model-menu'))
  const owned = menus.filter((menu) => menu.__quickforgeOwnerAnchor)
  const isOpen = owned.length > 0
    ? owned.some((menu) => menu.__quickforgeOwnerAnchor === modelButton)
    : menus.length > 0
  modelButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
}
