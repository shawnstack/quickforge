import { loadPlugins, type QuickForgePlugin } from '@/components/plugins/plugin-api'
import { t } from '@/lib/i18n'
import { capabilityIcons, type CapabilityIconKind } from './capability-icons'
import { ensureComposerContextChips, syncComposerContextChipsAriaLabel, type ComposerDraft, type MessageEditorElement } from './chat-utils'
import { normalizeSelectedCapabilities, selectedCapabilityKey, type SelectedCapability } from '@/lib/selected-capabilities'

export type { SelectedCapability } from '@/lib/selected-capabilities'

export type CapabilitySuggestion = SelectedCapability & {
  iconKind: CapabilityIconKind
}

type CapabilitySuggestionsOptions = {
  panel: HTMLElement
  restoreDraftIntoComposer: (draft: ComposerDraft) => void
  onSelectionChange?: (selected: SelectedCapability[]) => void
  enabled?: boolean
}

function titleCase(value: string) {
  return value
    .split(/[-_/\\]+/)
    .filter(Boolean)
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(' ')
}

function builtinPluginDisplay(plugin: QuickForgePlugin) {
  switch (plugin.name) {
    case 'documents':
      return { label: t('pluginDocumentsName'), description: t('pluginDocumentsDescription'), iconKind: 'document' as const }
    case 'spreadsheets':
      return { label: t('pluginSpreadsheetsName'), description: t('pluginSpreadsheetsDescription'), iconKind: 'spreadsheet' as const }
    case 'presentations':
      return { label: t('pluginPresentationsName'), description: t('pluginPresentationsDescription'), iconKind: 'presentation' as const }
    default:
      return null
  }
}

function pluginDisplayName(plugin: QuickForgePlugin) {
  const builtin = builtinPluginDisplay(plugin)
  if (builtin) return builtin.label
  const displayName = plugin.displayName || titleCase(plugin.name.replace(/^openai-/, ''))
  return displayName.replace(/^OpenAI\s+/i, '')
}

function capabilityRows(plugin: QuickForgePlugin): CapabilitySuggestion[] {
  const builtin = builtinPluginDisplay(plugin)
  return [{
    type: 'plugin',
    iconKind: builtin?.iconKind ?? 'plugin',
    pluginName: plugin.name,
    name: plugin.name,
    label: builtin?.label ?? pluginDisplayName(plugin),
    description: builtin?.description ?? plugin.description,
  }]
}

function capabilityIconKind(capability: SelectedCapability): CapabilityIconKind {
  if (capability.type !== 'plugin') return 'plugin'
  switch (capability.pluginName) {
    case 'documents': return 'document'
    case 'spreadsheets': return 'spreadsheet'
    case 'presentations': return 'presentation'
    default: return 'plugin'
  }
}

export function createCapabilityChip(capability: SelectedCapability, onRemove?: () => void) {
  const chip = document.createElement('span')
  chip.className = 'quickforge-context-chip quickforge-capability-chip'
  chip.dataset.quickforgeCapabilityKey = selectedCapabilityKey(capability)
  chip.title = capability.description ?? capability.label
  const icon = document.createElement('span')
  icon.className = 'quickforge-context-chip-icon'
  icon.innerHTML = capabilityIcons[capabilityIconKind(capability)]
  const label = document.createElement('span')
  label.className = 'quickforge-context-chip-label'
  label.textContent = capability.label
  chip.append(icon, label)
  if (onRemove) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'quickforge-context-chip-remove'
    remove.setAttribute('aria-label', t('removeCapabilityReference', { name: capability.label }))
    remove.textContent = '×'
    remove.onpointerdown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      onRemove()
    }
    chip.append(remove)
  }
  return chip
}

export function createCapabilitySuggestions({
  panel,
  restoreDraftIntoComposer,
  onSelectionChange,
  enabled = true,
}: CapabilitySuggestionsOptions) {
  let plugins: QuickForgePlugin[] = []
  let loadPromise: Promise<void> | null = null
  let loadState: 'idle' | 'loading' | 'loaded' = 'idle'
  let selected = new Map<string, SelectedCapability>()

  const emitSelection = () => onSelectionChange?.([...selected.values()])

  const refresh = () => {
    if (loadPromise) return loadPromise
    if (loadState === 'loaded') return Promise.resolve()
    loadState = 'loading'
    loadPromise = loadPlugins()
      .then((payload) => {
        plugins = (payload.plugins ?? []).filter((plugin) => plugin.enabled && plugin.status === 'loaded')
      })
      .catch(() => {
        plugins = []
      })
      .finally(() => {
        loadPromise = null
        loadState = 'loaded'
      })
    return loadPromise
  }

  if (enabled) void refresh()

  const rows = () => plugins.flatMap(capabilityRows)

  const restoreCurrentDraft = (editor: MessageEditorElement, capabilities = [...selected.values()]) => {
    const textarea = editor.querySelector<HTMLTextAreaElement>('textarea')
    restoreDraftIntoComposer({
      text: editor.value ?? textarea?.value ?? '',
      attachments: editor.attachments ? [...editor.attachments] : [],
      contextReferences: editor.contextReferences ? [...editor.contextReferences] : [],
      selectedCapabilities: capabilities,
    })
  }

  const syncChips = () => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    if (!editor) return
    const existing = editor.querySelector<HTMLElement>('.quickforge-context-chips')
    if (selected.size === 0 && !existing?.querySelector('.quickforge-file-reference-chip')) {
      existing?.remove()
      return
    }
    const container = ensureComposerContextChips(editor)
    if (!container) return
    container.querySelectorAll('.quickforge-capability-chip').forEach((chip) => chip.remove())
    for (const capability of selected.values()) {
      container.append(createCapabilityChip(capability, () => {
        selected.delete(selectedCapabilityKey(capability))
        const editor = panel.querySelector<MessageEditorElement>('message-editor')
        if (editor) {
          const capabilities = [...selected.values()]
          editor.selectedCapabilities = capabilities
          restoreCurrentDraft(editor, capabilities)
        }
        emitSelection()
        syncChips()
      }))
    }
    syncComposerContextChipsAriaLabel(container, {
      plugins: t('selectedCapabilities'),
      files: t('fileReferences'),
      mixed: t('selectedPluginsAndFiles'),
    })
  }

  const selectCapability = (capability: CapabilitySuggestion) => {
    selected.set(selectedCapabilityKey(capability), capability)
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    if (editor) {
      const capabilities = [...selected.values()]
      editor.selectedCapabilities = capabilities
      restoreCurrentDraft(editor, capabilities)
    }
    emitSelection()
    syncChips()
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    textarea?.focus()
  }

  const selectPlugin = (pluginName: string) => {
    const select = () => {
      const capability = rows().find((row) => row.pluginName === pluginName)
      if (capability) selectCapability(capability)
    }
    if (loadState === 'loaded') {
      select()
      return
    }
    if (enabled) void refresh().then(select)
  }

  const consumeSelectedCapabilities = () => {
    const result = normalizeSelectedCapabilities([...selected.values()])
    selected = new Map()
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    if (editor) editor.selectedCapabilities = []
    emitSelection()
    syncChips()
    return result
  }

  const snapshotSelectedCapabilities = () => normalizeSelectedCapabilities([...selected.values()])
  const restoreSelectedCapabilities = (capabilities: SelectedCapability[]) => {
    selected = new Map(normalizeSelectedCapabilities(capabilities).map((capability) => [selectedCapabilityKey(capability), capability]))
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    if (editor) editor.selectedCapabilities = [...selected.values()]
    emitSelection()
    syncChips()
  }

  return {
    refresh,
    availablePluginRows: rows,
    selectPlugin,
    consumeSelectedCapabilities,
    snapshotSelectedCapabilities,
    restoreSelectedCapabilities,
    syncChips,
    // Compatibility no-ops: @ is exclusively owned by file-reference suggestions.
    update: () => {},
    remove: () => {},
    setupTextareaHandler: () => {},
    cleanupTextareaHandler: () => {},
  }
}
