/**
 * OpenCode Harness config menu (P1).
 *
 * Adds a composer inline control for OpenCode sessions that surfaces the
 * runtime-advertised ACP `configOptions` (boolean toggles and select radios).
 * ACP `modes` are surfaced separately by the composer-side mode button
 * (opencode-mode-menu.ts). The server is authoritative; every change is sent
 * through the existing harness config API and the local snapshot refreshes
 * from the response. The control is disabled while a generation is running.
 */

import { patchContent } from '../chat-utils'
import { t } from '@/lib/i18n'
import type { OpenCodeAcpConfigOption, OpenCodeAcpConfigSelectOption, OpenCodeAcpSession } from '@/lib/server-agent'
import {
  agentAccessCheckIcon,
  agentAccessChevronIcon,
  openCodeConfigIcon,
} from './icons'

type OpenCodeConfigMenuElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
}

type OpenCodeConfigMenuOptions = {
  panel: HTMLElement
  leftControls: HTMLElement
  getAcpSession: () => OpenCodeAcpSession | null | undefined
  isStreaming: () => boolean
  onConfigOptionChange: (configId: string, value: boolean | string) => void
  onModeChange: (modeId: string) => void
  dismissComposerMenus: () => void
}

type RenderOpenCodeConfigMenuOptions = OpenCodeConfigMenuOptions & {
  trigger: HTMLButtonElement
  acpSession: OpenCodeAcpSession | null | undefined
  disabled: boolean
}

type OpenCodeConfigSelectGroup = { group: string; name: string; options: OpenCodeAcpConfigSelectOption[] }

function isSelectGroup(item: OpenCodeAcpConfigSelectOption | OpenCodeConfigSelectGroup): item is OpenCodeConfigSelectGroup {
  return typeof (item as OpenCodeConfigSelectGroup).group === 'string' && Array.isArray((item as OpenCodeConfigSelectGroup).options)
}

/**
 * Whether the ACP session currently exposes any displayable OpenCode config
 * options (boolean toggles / select radios). Modes are surfaced separately by
 * the composer-side mode button (opencode-mode-menu.ts). Used to avoid
 * rendering an empty inline button/menu when the session has not yet reported
 * `configOptions`.
 */
export function hasOpenCodeConfigContent(acpSession: OpenCodeAcpSession | null | undefined): boolean {
  const configOptions = acpSession?.configOptions
  return Array.isArray(configOptions) && configOptions.length > 0
}

function selectOptionLabel(option: { name: string; description?: string }): string {
  return option.description ? `${option.name} — ${option.description}` : option.name
}

function flattenSelectOptions(options: OpenCodeAcpConfigOption['options']) {
  if (!Array.isArray(options)) return { groups: [] as Array<{ group: string; options: Array<{ value: string; name: string; description?: string }> }>, flat: [] as Array<{ value: string; name: string; description?: string }> }
  const groups: Array<{ group: string; options: Array<{ value: string; name: string; description?: string }> }> = []
  const flat: Array<{ value: string; name: string; description?: string }> = []
  for (const item of options) {
    if (item && isSelectGroup(item)) {
      groups.push({ group: item.group, options: item.options })
      flat.push(...item.options)
    } else if (item && typeof item.value === 'string') {
      flat.push(item)
    }
  }
  return { groups, flat }
}

export function removeOpenCodeConfigMenu(panel: HTMLElement) {
  const menu = document.querySelector<OpenCodeConfigMenuElement>('.quickforge-opencode-config-menu')
  if (menu?.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', menu.__quickforgeDismissHandler, true)
    document.removeEventListener('keydown', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('resize', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('scroll', menu.__quickforgeDismissHandler, true)
    menu.__quickforgeDismissHandler = undefined
  }
  menu?.remove()
  panel.querySelector<HTMLButtonElement>('.quickforge-opencode-config-inline')?.setAttribute('aria-expanded', 'false')
}

function createBooleanItem(option: OpenCodeAcpConfigOption, disabled: boolean, onToggle: (value: boolean) => void) {
  const checked = option.currentValue === true
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'quickforge-opencode-config-item quickforge-opencode-config-toggle'
  item.setAttribute('role', 'menuitemcheckbox')
  item.setAttribute('aria-checked', String(checked))
  item.disabled = disabled
  item.innerHTML = `
    <span class="quickforge-opencode-config-check-slot">${checked ? agentAccessCheckIcon : ''}</span>
    <span class="quickforge-opencode-config-item-label"></span>
  `
  item.querySelector<HTMLElement>('.quickforge-opencode-config-item-label')!.textContent = option.name
  if (option.description) item.title = option.description
  item.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!disabled) onToggle(!checked)
  }
  return item
}

function createSelectOptionItem(
  optionItem: { value: string; name: string; description?: string },
  currentValue: string,
  disabled: boolean,
  onSelect: (value: string) => void,
) {
  const selected = optionItem.value === currentValue
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'quickforge-opencode-config-item quickforge-opencode-config-select-option'
  item.setAttribute('role', 'menuitemradio')
  item.setAttribute('aria-checked', String(selected))
  item.disabled = disabled
  item.innerHTML = `
    <span class="quickforge-opencode-config-check-slot">${selected ? agentAccessCheckIcon : ''}</span>
    <span class="quickforge-opencode-config-item-label"></span>
  `
  item.querySelector<HTMLElement>('.quickforge-opencode-config-item-label')!.textContent = selectOptionLabel(optionItem)
  item.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!disabled && !selected) onSelect(optionItem.value)
  }
  return item
}

function createSectionHeader(text: string) {
  const header = document.createElement('div')
  header.className = 'quickforge-opencode-config-section-title'
  header.textContent = text
  return header
}

function renderOpenCodeConfigMenu(options: RenderOpenCodeConfigMenuOptions) {
  const { panel, trigger, acpSession, disabled, onConfigOptionChange, dismissComposerMenus } = options
  const existing = document.querySelector<OpenCodeConfigMenuElement>('.quickforge-opencode-config-menu')
  if (existing) {
    removeOpenCodeConfigMenu(panel)
    return
  }

  if (!hasOpenCodeConfigContent(acpSession)) {
    // Defensive: never create an empty menu, e.g. if the session data changed
    // between the button render and this click.
    removeOpenCodeConfigMenu(panel)
    return
  }

  dismissComposerMenus()
  removeOpenCodeConfigMenu(panel)

  const menu = document.createElement('div') as OpenCodeConfigMenuElement
  menu.className = 'quickforge-opencode-config-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('openCodeConfigMenuLabel'))

  const configOptions = Array.isArray(acpSession?.configOptions) ? acpSession.configOptions : []
  if (configOptions.length > 0) {
    menu.append(createSectionHeader(t('openCodeConfigOptionsTitle')))
    for (const option of configOptions) {
      if (option.type === 'boolean') {
        menu.append(createBooleanItem(option, disabled, (value) => onConfigOptionChange(option.id, value)))
        continue
      }
      if (option.type === 'select') {
        const { groups, flat } = flattenSelectOptions(option.options)
        const currentValue = typeof option.currentValue === 'string' ? option.currentValue : ''
        const header = createSectionHeader(option.name)
        if (option.description) header.title = option.description
        menu.append(header)
        if (groups.length > 0) {
          for (const group of groups) {
            const groupLabel = document.createElement('div')
            groupLabel.className = 'quickforge-opencode-config-group-label'
            groupLabel.textContent = group.group
            menu.append(groupLabel)
            for (const item of group.options) {
              menu.append(createSelectOptionItem(item, currentValue, disabled, (value) => onConfigOptionChange(option.id, value)))
            }
          }
        } else {
          for (const item of flat) {
            menu.append(createSelectOptionItem(item, currentValue, disabled, (value) => onConfigOptionChange(option.id, value)))
          }
        }
      }
    }
  }

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect()
    const gap = 8
    const width = Math.min(232, window.innerWidth - 24)
    menu.style.width = `${width}px`
    menu.style.maxHeight = `${Math.max(180, window.innerHeight - 32)}px`
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
    removeOpenCodeConfigMenu(panel)
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

export function setupOpenCodeConfigMenu(options: OpenCodeConfigMenuOptions) {
  const { panel, leftControls, getAcpSession, isStreaming, onConfigOptionChange, onModeChange, dismissComposerMenus } = options
  leftControls.classList.add('quickforge-composer-left-controls')

  if (!hasOpenCodeConfigContent(getAcpSession())) {
    // No displayable config yet (modes/configOptions not reported). Remove any
    // existing button/open menu and wait for the next decorate pass; the
    // button will be recreated once the acpSession data arrives.
    leftControls.querySelector<HTMLButtonElement>('.quickforge-opencode-config-inline')?.remove()
    removeOpenCodeConfigMenu(panel)
    return
  }

  const renderMenu = (trigger: HTMLButtonElement) => {
    renderOpenCodeConfigMenu({
      panel,
      leftControls,
      getAcpSession,
      isStreaming,
      trigger,
      acpSession: getAcpSession(),
      disabled: isStreaming(),
      onConfigOptionChange,
      onModeChange,
      dismissComposerMenus,
    })
  }

  const syncButton = (button: HTMLButtonElement) => {
    const disabled = isStreaming()
    const title = disabled ? t('openCodeConfigDisabledWhileStreaming') : t('openCodeConfigMenuLabel')
    const content = `${openCodeConfigIcon}<span class="quickforge-opencode-config-label"></span>${agentAccessChevronIcon}`
    patchContent(button, content)
    button.querySelector<HTMLElement>('.quickforge-opencode-config-label')!.textContent = t('openCodeConfigButtonLabel')
    button.title = title
    button.setAttribute('aria-label', title)
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', document.querySelector('.quickforge-opencode-config-menu') ? 'true' : 'false')
    button.disabled = disabled
    button.className = 'quickforge-opencode-config-inline inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground'
    button.onpointerdown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!button.disabled) renderMenu(button)
    }
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    button.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
      event.preventDefault()
      if (!button.disabled) renderMenu(button)
    }
  }

  const existingButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-opencode-config-inline')
  if (existingButton) {
    syncButton(existingButton)
  } else {
    const button = document.createElement('button')
    button.type = 'button'
    syncButton(button)
    leftControls.append(button)
  }
}
