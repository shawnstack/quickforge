import type { MessageEditorElement } from '../chat-utils'

export function decorateModelButtonLabel(editor: MessageEditorElement | null, rightControls: HTMLElement) {
  const modelState = editor as (MessageEditorElement & { currentModel?: { id?: string } }) | null
  const model = modelState?.currentModel
  rightControls.querySelector<HTMLElement>('[data-quickforge-thinking-badge]')?.remove()
  const modelButton = Array.from(rightControls.querySelectorAll<HTMLButtonElement>('button:not(.quickforge-agent-access-inline):not(.quickforge-yolo-inline):not(.quickforge-plan-inline):not(.quickforge-opencode-mode-inline):not(.quickforge-thinking-inline)'))
    .find((button) => Boolean(model?.id && button.textContent?.includes(model.id)))
  if (!modelButton) return

  modelButton.classList.add('quickforge-model-trigger')
  modelButton.setAttribute('aria-haspopup', 'menu')
  modelButton.setAttribute('aria-expanded', document.querySelector('.quickforge-model-menu') ? 'true' : 'false')
}
