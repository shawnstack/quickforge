import type { CommandTextareaElement, MessageEditorElement } from '../chat-utils'
import { patchContent } from '../chat-utils'
import { t } from '@/lib/i18n'
import { planIcon, removePlanIcon } from './icons'

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

export function syncPlanModeButton(options: {
  panel: HTMLElement
  leftControls: HTMLElement
  planMode: boolean
  onTogglePlanMode: () => void
}) {
  const { panel, leftControls, planMode, onTogglePlanMode } = options
  const planModeTitle = t('planModeEnabledTitle')
  const planModeLabel = `${planIcon}${removePlanIcon}<span>${t('planModeLabel')}</span>`
  const planModeClass = 'quickforge-plan-inline inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground'
  const handlePlanToggle = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    onTogglePlanMode()
  }
  const handlePlanKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    handlePlanToggle(event)
  }
  const existingPlanButton = panel.querySelector<HTMLButtonElement>('.quickforge-plan-inline')
  const syncPlanButton = (planButton: HTMLButtonElement) => {
    patchContent(planButton, planModeLabel)
    planButton.title = planModeTitle
    planButton.setAttribute('aria-label', planModeTitle)
    planButton.setAttribute('aria-pressed', String(planMode))
    planButton.className = planModeClass
    planButton.onpointerdown = handlePlanToggle
    planButton.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    planButton.onkeydown = handlePlanKeyDown
  }
  if (!planMode) {
    existingPlanButton?.remove()
  } else if (existingPlanButton) {
    syncPlanButton(existingPlanButton)
  } else {
    const planButton = document.createElement('button')
    planButton.type = 'button'
    syncPlanButton(planButton)
    const accessButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')
    if (accessButton) {
      leftControls.insertBefore(planButton, accessButton.nextSibling)
    } else {
      leftControls.append(planButton)
    }
  }
}
