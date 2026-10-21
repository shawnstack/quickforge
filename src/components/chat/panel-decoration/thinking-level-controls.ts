import { patchContent, type MessageEditorElement } from '../chat-utils'
import { t } from '@/lib/i18n'
import { agentAccessCheckIcon, thinkingBrainIcon, thinkingChevronIcon } from './icons'

export type QuickForgeThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

const THINKING_LEVELS: QuickForgeThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh']

type EditorModelState = {
  currentModel?: { id?: string; reasoning?: boolean }
  thinkingLevel?: string
  onThinkingChange?: (level: QuickForgeThinkingLevel) => void
  requestUpdate?: () => void
}

function isQuickForgeThinkingLevel(value: unknown): value is QuickForgeThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as string[]).includes(value)
}

function thinkingLevelLabel(level: QuickForgeThinkingLevel) {
  switch (level) {
    case 'low': return t('thinkingLow')
    case 'medium': return t('thinkingMedium')
    case 'high': return t('thinkingHigh')
    case 'xhigh': return t('thinkingXHigh')
    default: return t('thinkingOff')
  }
}

type ThinkingMenuElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
  __quickforgeOwnerTrigger?: HTMLButtonElement
  // Menus are appended to `document.body` (they need to escape the panel's
  // stacking/clipping context), so ownership must be recorded explicitly.
  // Without it a decorate pass in one panel would close the menu opened by
  // another panel — visible once both the main chat and the side-chat are
  // mounted at the same time.
  __quickforgeOwnerPanel?: HTMLElement
}

function closeThinkingMenu(menu: ThinkingMenuElement) {
  if (menu.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', menu.__quickforgeDismissHandler, true)
    document.removeEventListener('keydown', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('resize', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('scroll', menu.__quickforgeDismissHandler, true)
    menu.__quickforgeDismissHandler = undefined
  }
  menu.__quickforgeOwnerTrigger?.setAttribute('aria-expanded', 'false')
  menu.remove()
}

// `panel` narrows the operation to the menu/trigger owned by that panel.
// Omitting it keeps the legacy "whole document" behaviour for callers that
// have no panel scope: with a single mounted panel that is identical, and with
// several panels it correctly closes every menu instead of one arbitrary menu.
export function removeThinkingLevelMenu(panel?: HTMLElement | null) {
  const menus = Array.from(document.querySelectorAll<ThinkingMenuElement>('.quickforge-thinking-menu'))
    .filter((menu) => (panel ? menu.__quickforgeOwnerPanel === panel : true))
  for (const menu of menus) closeThinkingMenu(menu)
  const triggers = panel
    ? [panel.querySelector<HTMLButtonElement>('.quickforge-thinking-inline')]
    : Array.from(document.querySelectorAll<HTMLButtonElement>('.quickforge-thinking-inline'))
  for (const trigger of triggers) trigger?.setAttribute('aria-expanded', 'false')
}

function createThinkingItem(level: QuickForgeThinkingLevel, currentLevel: QuickForgeThinkingLevel, onSelect: (level: QuickForgeThinkingLevel) => void) {
  const selected = level === currentLevel
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'quickforge-thinking-item'
  item.setAttribute('role', 'menuitemradio')
  item.setAttribute('aria-checked', String(selected))
  item.dataset.quickforgeThinkingLevel = level
  item.innerHTML = `
    <span class="quickforge-thinking-check-slot">${selected ? agentAccessCheckIcon : ''}</span>
    <span class="quickforge-thinking-item-label"></span>
  `
  item.querySelector<HTMLElement>('.quickforge-thinking-item-label')!.textContent = thinkingLevelLabel(level)
  item.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect(level)
  }
  return item
}

function renderThinkingMenu(options: {
  trigger: HTMLButtonElement
  currentLevel: QuickForgeThinkingLevel
  onLevelSelect: (level: QuickForgeThinkingLevel) => void
  dismissComposerMenus: () => void
}) {
  const { trigger, currentLevel, onLevelSelect, dismissComposerMenus } = options
  // Owned by the panel that hosts the trigger, so menu bookkeeping stays
  // per-panel when several chat panels are mounted at once.
  const ownerPanel = trigger.closest<HTMLElement>('.qf-chat-panel')
  const ownMenuOpen = ownerPanel
    ? Array.from(document.querySelectorAll<ThinkingMenuElement>('.quickforge-thinking-menu'))
      .some((menu) => menu.__quickforgeOwnerPanel === ownerPanel)
    : Boolean(document.querySelector('.quickforge-thinking-menu'))
  if (ownMenuOpen) {
    // Toggle: a second click in the same panel closes its own menu.
    removeThinkingLevelMenu(ownerPanel)
    return
  }

  dismissComposerMenus()
  // Menus are mutually exclusive across panels: opening one closes every
  // other thinking menu so two popovers can never overlap.
  removeThinkingLevelMenu()

  const menu = document.createElement('div') as ThinkingMenuElement
  menu.className = 'quickforge-thinking-menu'
  menu.__quickforgeOwnerTrigger = trigger
  menu.__quickforgeOwnerPanel = ownerPanel ?? undefined
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('thinkingLevel'))

  const select = (level: QuickForgeThinkingLevel) => {
    closeThinkingMenu(menu)
    if (level !== currentLevel) onLevelSelect(level)
  }

  for (const level of THINKING_LEVELS) {
    menu.append(createThinkingItem(level, currentLevel, select))
  }

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect()
    const gap = 8
    const width = Math.min(148, window.innerWidth - 24)
    menu.style.width = `${width}px`
    const measuredHeight = menu.offsetHeight || 160
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const top = Math.max(12, rect.top - measuredHeight - gap)
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }

  const dismiss = (event: Event) => {
    if (event.type === 'resize' || event.type === 'scroll') {
      positionMenu()
      return
    }
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
    } else {
      const target = event.target as Node
      if (menu.contains(target) || trigger.contains(target)) return
    }
    closeThinkingMenu(menu)
  }
  menu.__quickforgeDismissHandler = dismiss
  menu.addEventListener('pointerdown', (event) => event.stopPropagation())
  document.addEventListener('pointerdown', dismiss, true)
  document.addEventListener('keydown', dismiss, true)
  window.addEventListener('resize', dismiss, true)
  window.addEventListener('scroll', dismiss, true)
  document.body.append(menu)
  positionMenu()
  trigger.setAttribute('aria-expanded', 'true')
}

export function removeThinkingLevelControl(panel?: HTMLElement | null) {
  removeThinkingLevelMenu(panel)
  const triggers = panel
    ? [panel.querySelector<HTMLButtonElement>('.quickforge-thinking-inline')]
    : Array.from(document.querySelectorAll<HTMLButtonElement>('.quickforge-thinking-inline'))
  for (const trigger of triggers) trigger?.remove()
}

export function setupThinkingLevelControl(options: {
  editor: MessageEditorElement | null
  rightControls: HTMLElement
  dismissComposerMenus: () => void
  onThinkingLevelChange: (level: QuickForgeThinkingLevel) => void
}) {
  const { editor, rightControls, dismissComposerMenus, onThinkingLevelChange } = options
  const modelState = editor as (MessageEditorElement & EditorModelState) | null
  const modelButton = rightControls.querySelector<HTMLButtonElement>('.quickforge-model-trigger')
  const ownerPanel = rightControls.closest<HTMLElement>('.qf-chat-panel')

  if (!modelButton || modelState?.currentModel?.reasoning !== true) {
    removeThinkingLevelControl(ownerPanel)
    return
  }

  const rawLevel = modelState?.thinkingLevel
  const currentLevel = isQuickForgeThinkingLevel(rawLevel) ? rawLevel : 'off'
  const label = thinkingLevelLabel(currentLevel)
  const title = `${t('thinkingLevel')}: ${label}`
  const content = `${thinkingBrainIcon}<span class="quickforge-thinking-label"></span>${thinkingChevronIcon}`
  const buttonClass = 'quickforge-thinking-inline inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground'

  const applyLevel = (level: QuickForgeThinkingLevel) => {
    modelState.thinkingLevel = level
    modelState.onThinkingChange?.(level)
    modelState.requestUpdate?.()
    onThinkingLevelChange(level)
  }

  const syncButton = (button: HTMLButtonElement) => {
    patchContent(button, content)
    button.querySelector<HTMLElement>('.quickforge-thinking-label')!.textContent = label
    button.title = title
    button.setAttribute('aria-label', title)
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', String(ownerPanel
      ? Array.from(document.querySelectorAll('.quickforge-thinking-menu'))
        .some((menu) => (menu as ThinkingMenuElement).__quickforgeOwnerPanel === ownerPanel)
      : Boolean(document.querySelector('.quickforge-thinking-menu'))))
    button.dataset.quickforgeThinkingLevel = currentLevel
    button.className = buttonClass
    button.onpointerdown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      renderThinkingMenu({ trigger: button, currentLevel, onLevelSelect: applyLevel, dismissComposerMenus })
    }
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    button.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
      event.preventDefault()
      renderThinkingMenu({ trigger: button, currentLevel, onLevelSelect: applyLevel, dismissComposerMenus })
    }
  }

  const existingButton = rightControls.querySelector<HTMLButtonElement>('.quickforge-thinking-inline')
  if (existingButton) {
    syncButton(existingButton)
  } else {
    const button = document.createElement('button')
    button.type = 'button'
    syncButton(button)
    modelButton.insertAdjacentElement('afterend', button)
  }
}
