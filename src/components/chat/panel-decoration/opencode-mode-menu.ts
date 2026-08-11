/**
 * OpenCode ACP mode selector (composer right side).
 *
 * The native model selector is disabled for OpenCode sessions, so the current
 * ACP mode (Build/Plan/...) is surfaced as a dedicated inline button in the
 * composer's right controls, positioned right before the send/stop button so
 * the send button stays `:last-child` (syncSendStopButton depends on it).
 * Clicking the button opens a small radio menu reusing the quickforge model
 * trigger/menu/menu-item look with right-aligned positioning. Every change is
 * sent through the harness mode API; the control is disabled while streaming.
 */

import { patchContent } from '../chat-utils'
import { t } from '@/lib/i18n'
import type { OpenCodeAcpSession } from '@/lib/server-agent'

type OpenCodeModeMenuElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
}

type OpenCodeModeMenuOptions = {
  panel: HTMLElement
  rightControls: HTMLElement
  getAcpSession: () => OpenCodeAcpSession | null | undefined
  isStreaming: () => boolean
  onModeChange: (modeId: string) => void
  dismissComposerMenus: () => void
}

type RenderOpenCodeModeMenuOptions = OpenCodeModeMenuOptions & {
  trigger: HTMLButtonElement
  acpSession: OpenCodeAcpSession | null | undefined
  disabled: boolean
}

/**
 * Whether the ACP session exposes at least one selectable mode. Used to avoid
 * rendering an empty mode button/menu until `modes` is reported by the server.
 */
export function hasOpenCodeModes(acpSession: OpenCodeAcpSession | null | undefined): boolean {
  const modes = acpSession?.modes
  return Boolean(modes && Array.isArray(modes.availableModes) && modes.availableModes.length > 0)
}

/**
 * Button label for the current mode: the matching mode's display name when the
 * currentModeId resolves, otherwise the raw currentModeId as a sane fallback.
 */
export function opencodeModeButtonLabel(acpSession: OpenCodeAcpSession | null | undefined): string {
  const currentModeId = acpSession?.modes?.currentModeId
  if (!currentModeId) return ''
  const mode = acpSession?.modes?.availableModes?.find((candidate) => candidate.id === currentModeId)
  return mode?.name ?? currentModeId
}

export function removeOpenCodeModeMenu(panel: HTMLElement) {
  const menu = document.querySelector<OpenCodeModeMenuElement>('.quickforge-opencode-mode-menu')
  if (menu?.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', menu.__quickforgeDismissHandler, true)
    document.removeEventListener('keydown', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('resize', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('scroll', menu.__quickforgeDismissHandler, true)
    menu.__quickforgeDismissHandler = undefined
  }
  menu?.remove()
  panel.querySelector<HTMLButtonElement>('.quickforge-opencode-mode-inline')?.setAttribute('aria-expanded', 'false')
}

function createModeMenuItem(
  mode: { id: string; name: string; description?: string },
  currentModeId: string,
  disabled: boolean,
  onSelect: (modeId: string) => void,
) {
  const selected = mode.id === currentModeId
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'quickforge-model-menu-item'
  item.setAttribute('role', 'menuitemradio')
  item.setAttribute('aria-checked', String(selected))
  item.disabled = disabled

  const label = document.createElement('span')
  label.className = 'quickforge-model-menu-item-label'
  label.textContent = mode.description ? `${mode.name} — ${mode.description}` : mode.name

  const suffix = document.createElement('span')
  suffix.className = 'quickforge-model-menu-item-suffix'
  suffix.textContent = selected ? '✓' : ''

  item.append(label, suffix)
  item.onpointerdown = (event) => {
    // Swallow the pointer so the document capture dismiss cannot drop the
    // selection: close our own menu first, then run the callback.
    event.preventDefault()
    event.stopPropagation()
    onSelect(mode.id)
  }
  return item
}

function renderOpenCodeModeMenu(options: RenderOpenCodeModeMenuOptions) {
  const { panel, trigger, acpSession, disabled, onModeChange, dismissComposerMenus } = options
  const existing = document.querySelector<OpenCodeModeMenuElement>('.quickforge-opencode-mode-menu')
  if (existing) {
    removeOpenCodeModeMenu(panel)
    return
  }

  if (!hasOpenCodeModes(acpSession)) {
    // Defensive: never create an empty menu if the session data changed
    // between the button render and this click.
    removeOpenCodeModeMenu(panel)
    return
  }

  dismissComposerMenus()
  removeOpenCodeModeMenu(panel)

  const menu = document.createElement('div') as OpenCodeModeMenuElement
  menu.className = 'quickforge-opencode-mode-menu quickforge-model-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('openCodeModeMenuLabel'))

  const currentModeId = acpSession?.modes?.currentModeId ?? ''
  const header = document.createElement('div')
  header.className = 'quickforge-model-menu-header'
  header.textContent = t('openCodeConfigModesTitle')
  menu.append(header)

  const select = (modeId: string) => {
    // Close before firing the callback so the document capture dismiss cannot
    // swallow the change, and avoid re-sending the already-active mode.
    removeOpenCodeModeMenu(panel)
    if (modeId !== currentModeId) onModeChange(modeId)
  }

  for (const mode of acpSession?.modes?.availableModes ?? []) {
    menu.append(createModeMenuItem(mode, currentModeId, disabled, select))
  }

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect()
    const gap = 8
    const width = Math.min(260, window.innerWidth - 24)
    menu.style.width = `${width}px`
    const measuredHeight = menu.offsetHeight || 160
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
    const preferredTop = rect.top - measuredHeight - gap
    const fallbackTop = rect.bottom + gap
    const top = preferredTop >= 12
      ? preferredTop
      : Math.min(fallbackTop, window.innerHeight - measuredHeight - 12)
    menu.style.left = `${left}px`
    menu.style.top = `${Math.max(12, top)}px`
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
    removeOpenCodeModeMenu(panel)
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

export function setupOpenCodeModeMenu(options: OpenCodeModeMenuOptions) {
  const { panel, rightControls, getAcpSession, isStreaming, onModeChange, dismissComposerMenus } = options

  if (!hasOpenCodeModes(getAcpSession())) {
    // No modes reported yet; remove any stale button/open menu and wait for
    // the next decorate pass once the acpSession data arrives.
    panel.querySelector<HTMLButtonElement>('.quickforge-opencode-mode-inline')?.remove()
    removeOpenCodeModeMenu(panel)
    return
  }

  const renderMenu = (trigger: HTMLButtonElement) => {
    renderOpenCodeModeMenu({
      panel,
      rightControls,
      getAcpSession,
      isStreaming,
      onModeChange,
      dismissComposerMenus,
      trigger,
      acpSession: getAcpSession(),
      disabled: isStreaming(),
    })
  }

  const existingButton = rightControls.querySelector<HTMLButtonElement>('.quickforge-opencode-mode-inline')
  const button = existingButton ?? document.createElement('button')
  button.type = 'button'

  const disabled = isStreaming()
  const title = disabled ? t('openCodeModeDisabledWhileStreaming') : t('openCodeModeMenuLabel')
  patchContent(button, '<span class="quickforge-opencode-mode-label"></span>')
  button.querySelector<HTMLElement>('.quickforge-opencode-mode-label')!.textContent = opencodeModeButtonLabel(getAcpSession())
  button.title = title
  button.setAttribute('aria-label', title)
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', document.querySelector('.quickforge-opencode-mode-menu') ? 'true' : 'false')
  button.disabled = disabled
  button.className = 'quickforge-opencode-mode-inline quickforge-model-trigger inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground'
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

  // Keep the send/stop button as `:last-child`: insert right before it (and
  // re-insert whenever the button ended up somewhere else on a re-decorate).
  const sendButton = rightControls.querySelector<HTMLButtonElement>('button:last-child')
  if (!sendButton) {
    rightControls.append(button)
  } else if (sendButton !== button) {
    rightControls.insertBefore(button, sendButton)
  } else {
    const lastOtherButton = Array.from(rightControls.querySelectorAll<HTMLButtonElement>('button'))
      .filter((candidate) => candidate !== button)
      .pop()
    if (lastOtherButton) rightControls.insertBefore(button, lastOtherButton.nextSibling)
    else rightControls.prepend(button)
  }
}
