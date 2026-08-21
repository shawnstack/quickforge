import type { CapabilitySuggestion } from '../capability-suggestions'
import type { MessageEditorElement } from '../chat-utils'
import { patchContent } from '../chat-utils'
import { t } from '@/lib/i18n'
import { removeOpenCodeModeMenu } from './opencode-mode-menu'
import {
  attachmentIcon,
  documentPluginIcon,
  pluginsIcon,
  plusIcon,
  presentationPluginIcon,
  spreadsheetPluginIcon,
} from './icons'

type ComposerPlusPopoverElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
}

export type ComposerPlusMenuDeps = {
  panel: HTMLElement
  editor: MessageEditorElement
  leftControls: HTMLElement
  selectPluginCapability: (pluginName: string) => void
  removeCommandSuggestions: () => void
  removeCapabilitySuggestions: () => void
  removeFileReferenceSuggestions: () => void
  availablePluginRows: () => CapabilitySuggestion[]
  attachmentsEnabled: boolean
  pluginsEnabled: boolean
}

// Icons for capability rows, mirroring the iconKind mapping used by @ mentions.
// Rows produced for plugins only ever carry these kinds; the generic plugins
// icon covers any plugin without a dedicated builtin icon.
const pluginRowIcons: Record<CapabilitySuggestion['iconKind'], string> = {
  plugin: pluginsIcon,
  document: documentPluginIcon,
  spreadsheet: spreadsheetPluginIcon,
  presentation: presentationPluginIcon,
  skill: pluginsIcon,
  tool: pluginsIcon,
  command: pluginsIcon,
}

export function removeComposerPlusPopover(panel: HTMLElement) {
  const popover = panel.querySelector<ComposerPlusPopoverElement>('.quickforge-plus-popover')
  if (popover?.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', popover.__quickforgeDismissHandler, true)
    popover.__quickforgeDismissHandler = undefined
  }
  popover?.remove()
  panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.setAttribute('aria-expanded', 'false')
}

function clearMisplacedNativeAttachmentButtonMarks(editor: MessageEditorElement, leftControls: HTMLElement) {
  editor.querySelectorAll<HTMLButtonElement>('.quickforge-native-attachment-hidden').forEach((button) => {
    if (!leftControls.contains(button)) button.classList.remove('quickforge-native-attachment-hidden')
  })
}

function findNativeAttachmentButton(leftControls: HTMLElement) {
  const marked = leftControls.querySelector<HTMLButtonElement>('.quickforge-native-attachment-hidden')
  if (marked) return marked
  return Array.from(leftControls.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => !button.classList.contains('quickforge-plus-inline') && !button.classList.contains('quickforge-agent-access-inline') && !button.classList.contains('quickforge-yolo-inline') && !button.classList.contains('quickforge-plan-inline'))
}

export function hideNativeAttachmentControls(editor: MessageEditorElement, leftControls?: HTMLElement) {
  editor.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => { input.disabled = true })
  if (!leftControls) return
  clearMisplacedNativeAttachmentButtonMarks(editor, leftControls)
  findNativeAttachmentButton(leftControls)?.classList.add('quickforge-native-attachment-hidden')
}

function triggerAttachmentPicker(editor: MessageEditorElement, leftControls: HTMLElement) {
  const fileInput = editor.querySelector<HTMLInputElement>('input[type="file"]')
  if (fileInput) {
    fileInput.click()
    return
  }
  const nativeAttachmentButton = findNativeAttachmentButton(leftControls)
  nativeAttachmentButton?.click()
}

function createPlusMenuItem({
  className,
  icon,
  label,
  description,
  pluginName,
  onSelect,
}: {
  className?: string
  icon: string
  label: string
  description?: string
  pluginName?: string
  onSelect: () => void
}) {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = `quickforge-plus-popover-item${className ? ` ${className}` : ''}`
  if (pluginName) item.dataset.quickforgePluginName = pluginName
  item.innerHTML = `
    <span class="quickforge-plus-popover-item-icon">${icon}</span>
    <span class="quickforge-plus-popover-item-main">
      <span class="quickforge-plus-popover-item-label"></span>
      ${description ? '<span class="quickforge-plus-popover-item-description"></span>' : ''}
    </span>
  `
  item.querySelector<HTMLElement>('.quickforge-plus-popover-item-label')!.textContent = label
  const descriptionEl = item.querySelector<HTMLElement>('.quickforge-plus-popover-item-description')
  if (descriptionEl && description) descriptionEl.textContent = description
  item.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect()
  }
  return item
}

function renderComposerPlusPopover(deps: ComposerPlusMenuDeps, view: 'main' | 'plugins') {
  const { panel, editor, leftControls, selectPluginCapability, removeCommandSuggestions, removeCapabilitySuggestions, removeFileReferenceSuggestions } = deps
  // Composer menus are mutually exclusive: opening the plus popover closes the
  // OpenCode mode menu so the two can never overlap.
  removeOpenCodeModeMenu(panel)
  removeCommandSuggestions()
  removeCapabilitySuggestions()
  removeFileReferenceSuggestions()

  const popover = (panel.querySelector<ComposerPlusPopoverElement>('.quickforge-plus-popover') ?? document.createElement('div')) as ComposerPlusPopoverElement
  popover.className = 'quickforge-plus-popover'
  popover.setAttribute('role', 'menu')
  popover.innerHTML = ''

  const header = document.createElement('div')
  header.className = 'quickforge-plus-popover-header'
  header.textContent = view === 'plugins' ? t('composerAddPlugins') : t('composerAddMenu')
  popover.append(header)

  if (view === 'main') {
    if (deps.attachmentsEnabled) {
      popover.append(createPlusMenuItem({
        icon: attachmentIcon,
        label: t('composerAddAttachment'),
        onSelect: () => {
          removeComposerPlusPopover(panel)
          triggerAttachmentPicker(editor, leftControls)
        },
      }))
    }
    if (deps.pluginsEnabled && deps.availablePluginRows().length > 0) {
      popover.append(createPlusMenuItem({
        icon: pluginsIcon,
        label: t('composerAddPlugins'),
        onSelect: () => renderComposerPlusPopover(deps, 'plugins'),
      }))
    }
  } else {
    const backButton = createPlusMenuItem({
      className: 'quickforge-plus-popover-back',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
      label: t('composerAddBack'),
      onSelect: () => renderComposerPlusPopover(deps, 'main'),
    })
    popover.append(backButton)
    for (const row of deps.availablePluginRows()) {
      popover.append(createPlusMenuItem({
        icon: pluginRowIcons[row.iconKind],
        label: row.label,
        description: row.description,
        pluginName: row.pluginName,
        onSelect: () => {
          selectPluginCapability(row.pluginName)
          removeComposerPlusPopover(panel)
        },
      }))
    }
  }

  if (!popover.isConnected) {
    editor.parentElement?.insertBefore(popover, editor)
  }
  if (popover.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', popover.__quickforgeDismissHandler, true)
  }
  popover.__quickforgeDismissHandler = (event: Event) => {
    const target = event.target as Node
    if (popover.contains(target)) return
    if (panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.contains(target)) return
    removeComposerPlusPopover(panel)
  }
  document.addEventListener('pointerdown', popover.__quickforgeDismissHandler, true)
  panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')?.setAttribute('aria-expanded', 'true')
}

export function setupComposerPlusMenu(deps: ComposerPlusMenuDeps) {
  const { panel, editor, leftControls } = deps
  clearMisplacedNativeAttachmentButtonMarks(editor, leftControls)
  const nativeAttachmentButton = findNativeAttachmentButton(leftControls)
  nativeAttachmentButton?.classList.add('quickforge-native-attachment-hidden')

  const existingButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-plus-inline')
  const syncButton = (button: HTMLButtonElement) => {
    button.type = 'button'
    patchContent(button, plusIcon)
    button.title = t('composerAddMenu')
    button.setAttribute('aria-label', t('composerAddMenu'))
    button.setAttribute('aria-haspopup', 'menu')
    button.setAttribute('aria-expanded', panel.querySelector('.quickforge-plus-popover') ? 'true' : 'false')
    button.className = 'quickforge-plus-inline inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground'
    button.onpointerdown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (panel.querySelector('.quickforge-plus-popover')) {
        removeComposerPlusPopover(panel)
      } else {
        renderComposerPlusPopover(deps, 'main')
      }
    }
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  if (existingButton) {
    syncButton(existingButton)
    return
  }

  const button = document.createElement('button')
  syncButton(button)
  leftControls.prepend(button)
}
