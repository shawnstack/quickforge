import { patchContent } from '../chat-utils'
import { t } from '@/lib/i18n'
import type { AgentAccessMode } from '@/lib/types'
import {
  agentAccessCheckIcon,
  agentAccessChevronIcon,
  agentAccessShieldIcon,
  agentAccessWarningIcon,
} from './icons'

type AgentAccessMenuElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
}

function agentAccessLabel(mode: AgentAccessMode) {
  return mode === 'full-access' ? t('agentAccessFullLabel') : t('agentAccessDefaultLabel')
}

export function removeAgentAccessMenu(panel: HTMLElement) {
  const menu = document.querySelector<AgentAccessMenuElement>('.quickforge-agent-access-menu')
  if (menu?.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', menu.__quickforgeDismissHandler, true)
    document.removeEventListener('keydown', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('resize', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('scroll', menu.__quickforgeDismissHandler, true)
    menu.__quickforgeDismissHandler = undefined
  }
  menu?.remove()
  panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')?.setAttribute('aria-expanded', 'false')
}

function createAgentAccessItem(mode: AgentAccessMode, currentMode: AgentAccessMode, onSelect: (mode: AgentAccessMode) => void) {
  const selected = mode === currentMode
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'quickforge-agent-access-item'
  item.setAttribute('role', 'menuitemradio')
  item.setAttribute('aria-checked', String(selected))
  item.dataset.quickforgeAgentAccessMode = mode
  item.innerHTML = `
    <span class="quickforge-agent-access-check-slot">${selected ? agentAccessCheckIcon : ''}</span>
    <span class="quickforge-agent-access-option-icon-wrap">${mode === 'full-access' ? agentAccessWarningIcon : agentAccessShieldIcon}</span>
    <span class="quickforge-agent-access-item-label"></span>
  `
  item.querySelector<HTMLElement>('.quickforge-agent-access-item-label')!.textContent = agentAccessLabel(mode)
  item.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect(mode)
  }
  return item
}

function renderAgentAccessMenu(options: {
  panel: HTMLElement
  trigger: HTMLButtonElement
  agentAccessMode: AgentAccessMode
  onAccessModeChange: (mode: AgentAccessMode) => void
  dismissComposerMenus: () => void
}) {
  const { panel, trigger, agentAccessMode, onAccessModeChange, dismissComposerMenus } = options
  const existing = document.querySelector<AgentAccessMenuElement>('.quickforge-agent-access-menu')
  if (existing) {
    removeAgentAccessMenu(panel)
    return
  }

  dismissComposerMenus()
  removeAgentAccessMenu(panel)

  const menu = document.createElement('div') as AgentAccessMenuElement
  menu.className = 'quickforge-agent-access-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('agentAccessMenuLabel'))

  const select = (mode: AgentAccessMode) => {
    removeAgentAccessMenu(panel)
    if (mode !== agentAccessMode) onAccessModeChange(mode)
  }

  menu.append(
    createAgentAccessItem('default', agentAccessMode, select),
    createAgentAccessItem('full-access', agentAccessMode, select),
  )

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect()
    const gap = 8
    const width = Math.min(196, window.innerWidth - 24)
    menu.style.width = `${width}px`
    const measuredHeight = menu.offsetHeight || 96
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
    removeAgentAccessMenu(panel)
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

export function setupAgentAccessMenu(options: {
  panel: HTMLElement
  leftControls: HTMLElement
  agentAccessMode: AgentAccessMode
  onAccessModeChange: (mode: AgentAccessMode) => void
  dismissComposerMenus: () => void
}) {
  const { panel, leftControls, agentAccessMode, onAccessModeChange, dismissComposerMenus } = options
  leftControls.classList.add('quickforge-composer-left-controls')
  panel.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
  const label = agentAccessLabel(agentAccessMode)
  const title = agentAccessMode === 'full-access' ? t('agentAccessFullTitle') : t('agentAccessDefaultTitle')
  const content = `${agentAccessMode === 'full-access' ? agentAccessWarningIcon : agentAccessShieldIcon}<span class="quickforge-agent-access-label"></span>${agentAccessChevronIcon}`
  const buttonClass = `quickforge-agent-access-inline inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground${agentAccessMode === 'full-access' ? ' quickforge-agent-access-inline-full' : ''}`
  const existingButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')
  const syncButton = (button: HTMLButtonElement) => {
    patchContent(button, content)
    button.querySelector<HTMLElement>('.quickforge-agent-access-label')!.textContent = label
    button.title = title
    button.setAttribute('aria-label', title)
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', document.querySelector('.quickforge-agent-access-menu') ? 'true' : 'false')
    button.dataset.quickforgeAgentAccessMode = agentAccessMode
    button.className = buttonClass
    button.onpointerdown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      renderAgentAccessMenu({ panel, trigger: button, agentAccessMode, onAccessModeChange, dismissComposerMenus })
    }
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    button.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
      event.preventDefault()
      renderAgentAccessMenu({ panel, trigger: button, agentAccessMode, onAccessModeChange, dismissComposerMenus })
    }
  }

  if (existingButton) {
    syncButton(existingButton)
  } else {
    const button = document.createElement('button')
    button.type = 'button'
    syncButton(button)
    leftControls.append(button)
  }

  const accessButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')
  const planButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-plan-inline')
  if (accessButton && planButton && accessButton.nextSibling !== planButton) {
    leftControls.insertBefore(planButton, accessButton.nextSibling)
  }
}
