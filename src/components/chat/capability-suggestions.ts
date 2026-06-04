import { loadPlugins, type QuickForgePlugin } from '@/components/plugins/plugin-api'
import { t } from '@/lib/i18n'
import type {
  CapabilitySuggestionElement,
  CapabilityTextareaElement,
  MessageEditorElement,
  ComposerDraft,
} from './chat-utils'

export type BuiltinPluginMention = 'Documents' | 'Spreadsheets' | 'Presentations'

export type SelectedCapability = {
  type: 'plugin' | 'skill' | 'tool' | 'command'
  pluginName: string
  name: string
  label: string
  description?: string
  mention: string
}

type IconKind = SelectedCapability['type'] | 'document' | 'spreadsheet' | 'presentation'

type CapabilitySuggestion = SelectedCapability & {
  insertText: string
  iconKind: IconKind
}

type CapabilitySuggestionsOptions = {
  panel: HTMLElement
  restoreDraftIntoComposer: (draft: ComposerDraft) => void
  onSelectionChange?: (selected: SelectedCapability[]) => void
}

const capabilityIcons: Record<IconKind, string> = {
  plugin: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7.4 3.2h5.2a1.2 1.2 0 0 1 1.2 1.2v2.1h.9a2.1 2.1 0 1 1 0 4.2h-.9v2.1a1.2 1.2 0 0 1-1.2 1.2h-2.1v.7a2.1 2.1 0 1 1-4.2 0V14H4.4a1.2 1.2 0 0 1-1.2-1.2V9.9h.8a1.8 1.8 0 1 0 0-3.6h-.8V4.4a1.2 1.2 0 0 1 1.2-1.2h2.1v-.8a1.8 1.8 0 1 1 3.6 0v.8Z" />
    </svg>`,
  document: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5.4 2.8h6.1L15.8 7v10.2H5.4z" />
      <path d="M11.4 2.9V7h4.1" />
      <path d="M7.6 10.2h5" />
      <path d="M7.6 13h4.3" />
    </svg>`,
  spreadsheet: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3.4" y="4" width="13.2" height="12.2" rx="1.5" />
      <path d="M3.4 8h13.2" />
      <path d="M7.8 4v12.2" />
      <path d="M12.2 4v12.2" />
      <path d="M3.4 12h13.2" />
    </svg>`,
  presentation: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 4.2h14" />
      <rect x="4.2" y="4.2" width="11.6" height="8.4" rx="1.2" />
      <path d="M10 12.6v3.2" />
      <path d="m7.2 17 2.8-1.2 2.8 1.2" />
      <path d="M7.1 9.5 9 7.7l1.5 1.3 2.4-2.5" />
    </svg>`,
  skill: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4.2 3.2h4.4A2.4 2.4 0 0 1 11 5.6v11a2.4 2.4 0 0 0-2.4-2.4H4.2V3.2Z" />
      <path d="M11 5.6a2.4 2.4 0 0 1 2.4-2.4h2.4v11.1h-2.4A2.4 2.4 0 0 0 11 16.7" />
    </svg>`,
  tool: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12.8 3.5a4.2 4.2 0 0 0 4 5.5l-7.6 7.6a2.2 2.2 0 0 1-3.1-3.1l7.6-7.6a4.2 4.2 0 0 0-5.5-4" />
    </svg>`,
  command: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="m5 6 4 4-4 4" />
      <path d="M10.5 14h4.5" />
    </svg>`,
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
    case 'openai-documents':
      return { label: t('pluginOpenaiDocumentsName'), description: t('pluginOpenaiDocumentsDescription'), mention: 'Documents', iconKind: 'document' as const }
    case 'openai-spreadsheets':
      return { label: t('pluginOpenaiSpreadsheetsName'), description: t('pluginOpenaiSpreadsheetsDescription'), mention: 'Spreadsheets', iconKind: 'spreadsheet' as const }
    case 'openai-presentations':
      return { label: t('pluginOpenaiPresentationsName'), description: t('pluginOpenaiPresentationsDescription'), mention: 'Presentations', iconKind: 'presentation' as const }
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
  const pluginLabel = builtin?.label ?? pluginDisplayName(plugin)
  const mention = builtin?.mention ?? pluginLabel.replace(/\s+/g, '')
  return [{
    type: 'plugin',
    iconKind: builtin?.iconKind ?? 'plugin',
    pluginName: plugin.name,
    name: plugin.name,
    label: pluginLabel,
    mention,
    insertText: mention,
    description: builtin?.description ?? plugin.description,
  }]
}

function findMentionToken(text: string, caret: number) {
  const beforeCaret = text.slice(0, caret)
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret)
  if (!match) return null
  const prefixLength = match[1]?.length ?? 0
  const start = beforeCaret.length - match[0].length + prefixLength
  return { start, end: caret, query: match[2] ?? '' }
}

function parseMentionLabels(text: string) {
  const labels = new Set<string>()
  const regex = /(^|\s)@([\p{L}\p{N}_-]+)/gu
  let match: RegExpExecArray | null
  while ((match = regex.exec(text))) labels.add((match[2] || '').toLowerCase())
  return labels
}

export function createCapabilitySuggestions({
  panel,
  restoreDraftIntoComposer,
  onSelectionChange,
}: CapabilitySuggestionsOptions) {
  let plugins: QuickForgePlugin[] = []
  let loadPromise: Promise<void> | null = null
  let selected = new Map<string, SelectedCapability>()

  const emitSelection = () => onSelectionChange?.([...selected.values()])

  const refresh = () => {
    if (loadPromise) return loadPromise
    loadPromise = loadPlugins()
      .then((payload) => {
        plugins = (payload.plugins ?? []).filter((plugin) => plugin.enabled && plugin.status === 'loaded')
      })
      .catch(() => {
        plugins = []
      })
      .finally(() => {
        loadPromise = null
      })
    return loadPromise
  }

  void refresh()

  const rows = () => plugins.flatMap(capabilityRows)

  const selectedCapabilityFromSuggestions = (): CapabilitySuggestion | undefined => {
    const suggestions = panel.querySelector<CapabilitySuggestionElement>('.quickforge-capability-suggestions')
    const firstItem = suggestions?.querySelector<HTMLButtonElement>('.quickforge-capability-suggestion-item')
    const key = firstItem?.dataset.quickforgeCapabilityKey
    if (!key) return undefined
    return rows().find((capability) => capabilityKey(capability) === key)
  }

  const remove = () => {
    const suggestions = panel.querySelector<CapabilitySuggestionElement>('.quickforge-capability-suggestions')
    if (suggestions?.__quickforgeDismissHandler) {
      document.removeEventListener('pointerdown', suggestions.__quickforgeDismissHandler, true)
      suggestions.__quickforgeDismissHandler = undefined
    }
    suggestions?.remove()
  }

  const insertCapabilityIntoComposer = (capability: CapabilitySuggestion, token?: ReturnType<typeof findMentionToken>) => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    const text = editor?.value ?? textarea?.value ?? ''
    const caret = textarea?.selectionStart ?? text.length
    const activeToken = token ?? findMentionToken(text, caret)
    const mention = `@${capability.insertText}`
    const nextText = activeToken
      ? `${text.slice(0, activeToken.start)}${mention} ${text.slice(activeToken.end)}`
      : `${text}${text.endsWith(' ') || text.length === 0 ? '' : ' '}${mention} `
    const nextCaret = activeToken ? activeToken.start + mention.length + 1 : nextText.length

    selected.set(capabilityKey(capability), capability)
    emitSelection()
    restoreDraftIntoComposer({ text: nextText, attachments: editor?.attachments ? [...editor.attachments] : [] })
    const nextTextarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    nextTextarea?.focus()
    if (nextTextarea) {
      nextTextarea.selectionStart = nextCaret
      nextTextarea.selectionEnd = nextCaret
    }
    remove()
  }

  const insertBuiltinPluginMention = (mention: BuiltinPluginMention) => {
    const insert = () => {
      const capability = rows().find((row) => row.insertText === mention)
      if (capability) insertCapabilityIntoComposer(capability)
    }
    if (plugins.length === 0) {
      void refresh().then(insert)
      return
    }
    insert()
  }

  const update = (value?: string) => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    const text = value ?? editor?.value ?? textarea?.value ?? ''
    const caret = textarea?.selectionStart ?? text.length
    const token = findMentionToken(text, caret)
    const existing = panel.querySelector<CapabilitySuggestionElement>('.quickforge-capability-suggestions')

    if (!editor || !textarea || !token) {
      existing?.remove()
      return
    }

    if (plugins.length === 0) {
      void refresh().then(() => update(value))
    }

    const query = token.query.toLowerCase()
    const capabilities = rows()
      .filter((capability) => {
        const haystack = [capability.label, capability.name, capability.pluginName, capability.description]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(query)
      })
      .slice(0, 8)

    if (capabilities.length === 0) {
      existing?.remove()
      return
    }

    const suggestions = existing ?? document.createElement('div') as CapabilitySuggestionElement
    suggestions.className = 'quickforge-capability-suggestions'
    suggestions.setAttribute('role', 'listbox')
    suggestions.innerHTML = ''

    const header = document.createElement('div')
    header.className = 'quickforge-capability-suggestions-header'
    header.textContent = t('pluginMentionHeader')
    suggestions.append(header)

    for (const capability of capabilities) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'quickforge-capability-suggestion-item'
      item.dataset.quickforgeCapabilityKey = capabilityKey(capability)
      item.dataset.quickforgePluginName = capability.pluginName
      item.setAttribute('role', 'option')
      item.innerHTML = `
        <span class="quickforge-capability-suggestion-icon quickforge-capability-suggestion-icon-${capability.iconKind}">${capabilityIcons[capability.iconKind]}</span>
          <span class="quickforge-capability-suggestion-main">
          <span class="quickforge-capability-suggestion-line">
            <span class="quickforge-capability-suggestion-name"></span>
          </span>
          <span class="quickforge-capability-suggestion-description"></span>
        </span>
      `
      item.querySelector<HTMLElement>('.quickforge-capability-suggestion-name')!.textContent = capability.label
      item.querySelector<HTMLElement>('.quickforge-capability-suggestion-description')!.textContent = capability.description ?? capability.pluginName
      item.onpointerdown = (event) => {
        event.preventDefault()
        event.stopPropagation()
        insertCapabilityIntoComposer(capability, token)
      }
      suggestions.append(item)
    }

    if (!existing) {
      editor.parentElement?.insertBefore(suggestions, editor)
    }

    if (!suggestions.__quickforgeDismissHandler) {
      suggestions.__quickforgeDismissHandler = (event: Event) => {
        if (suggestions.contains(event.target as Node)) return
        if (editor.contains(event.target as Node)) return
        remove()
      }
      document.addEventListener('pointerdown', suggestions.__quickforgeDismissHandler, true)
    }
  }

  const setupTextareaHandler = (editor: MessageEditorElement | null) => {
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    if (!textarea) return
    const capabilityTextarea = textarea as CapabilityTextareaElement
    if (capabilityTextarea.__quickforgeCapabilityCompleteHandler) {
      capabilityTextarea.removeEventListener('keydown', capabilityTextarea.__quickforgeCapabilityCompleteHandler, true)
    }
    capabilityTextarea.__quickforgeCapabilityCompleteHandler = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process') return
      if (event.key === 'Escape') {
        remove()
        return
      }
      if (event.key !== 'Tab' && event.key !== 'Enter') return
      const currentText = editor?.value ?? capabilityTextarea.value ?? ''
      const token = findMentionToken(currentText, capabilityTextarea.selectionStart ?? currentText.length)
      if (!token || event.shiftKey) return
      const capability = selectedCapabilityFromSuggestions()
      if (!capability) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      insertCapabilityIntoComposer(capability, token)
    }
    capabilityTextarea.addEventListener('keydown', capabilityTextarea.__quickforgeCapabilityCompleteHandler, true)
  }

  const cleanupTextareaHandler = () => {
    const completeTextarea = panel.querySelector<CapabilityTextareaElement>('message-editor textarea')
    if (completeTextarea?.__quickforgeCapabilityCompleteHandler) {
      completeTextarea.removeEventListener('keydown', completeTextarea.__quickforgeCapabilityCompleteHandler, true)
    }
  }

  const consumeSelectedCapabilities = (input: string) => {
    const mentionedLabels = parseMentionLabels(input)
    const explicit = [...selected.values()].filter((capability) => mentionedLabels.has(capability.mention.toLowerCase()))
    const inferred = rows().filter((capability) => mentionedLabels.has(capability.insertText.toLowerCase()) || mentionedLabels.has(capability.label.replace(/\s+/g, '').toLowerCase()))
    const merged = new Map<string, SelectedCapability>()
    for (const capability of [...explicit, ...inferred]) merged.set(capabilityKey(capability), capability)
    selected = new Map()
    emitSelection()
    return [...merged.values()].slice(0, 4)
  }

  return {
    update,
    remove,
    setupTextareaHandler,
    cleanupTextareaHandler,
    consumeSelectedCapabilities,
    insertBuiltinPluginMention,
  }
}

function capabilityKey(capability: SelectedCapability) {
  return `${capability.type}:${capability.pluginName}:${capability.name}`
}
