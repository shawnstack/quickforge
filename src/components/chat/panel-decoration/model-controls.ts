import type { MessageEditorElement } from '../chat-utils'
import { t } from '@/lib/i18n'

type EditorModelState = {
  currentModel?: { id?: string; reasoning?: boolean }
  thinkingLevel?: string
}

function thinkingLevelLabel(level: string | undefined) {
  switch (level) {
    case 'low': return t('thinkingLow')
    case 'medium': return t('thinkingMedium')
    case 'high': return t('thinkingHigh')
    case 'xhigh': return t('thinkingXHigh')
    default: return t('thinkingOff')
  }
}

export function decorateModelButtonLabel(editor: MessageEditorElement | null, rightControls: HTMLElement) {
  const modelState = editor as (MessageEditorElement & EditorModelState) | null
  const model = modelState?.currentModel
  rightControls.querySelector<HTMLElement>('[data-quickforge-thinking-badge]')?.remove()
  const modelButton = Array.from(rightControls.querySelectorAll<HTMLButtonElement>('button:not(.quickforge-agent-access-inline):not(.quickforge-yolo-inline):not(.quickforge-plan-inline)'))
    .find((button) => Boolean(model?.id && button.textContent?.includes(model.id)))
  if (!modelButton) return

  modelButton.classList.add('quickforge-model-trigger')
  modelButton.setAttribute('aria-haspopup', 'menu')
  modelButton.setAttribute('aria-expanded', document.querySelector('.quickforge-model-menu') ? 'true' : 'false')
  if (model?.reasoning) {
    modelButton.dataset.quickforgeThinkingLevel = `· ${thinkingLevelLabel(modelState?.thinkingLevel)}`
  } else {
    delete modelButton.dataset.quickforgeThinkingLevel
  }
}
