import { t } from '@/lib/i18n'
import { ensureComposerContextChips, syncComposerContextChipsAriaLabel, type ComposerDraft, type FileContextReference, type MessageEditorElement } from './chat-utils'
import { capabilityIcons, folderIcon } from './capability-icons'

export type FileMentionEntry = { name: string; path: string; type: 'file' | 'directory' }
export type FileMentionToken = { start: number; end: number; query: string }

type FileReferenceSuggestionsOptions = {
  panel: HTMLElement
  projectId?: string
  enabled: boolean
  restoreDraftIntoComposer: (draft: ComposerDraft) => void
  removeCommandSuggestions: () => void
  removeCapabilitySuggestions?: () => void
  removePlusMenu?: () => void
  fetchImpl?: typeof fetch
}

type FileSuggestionElement = HTMLDivElement & { __quickforgeDismissHandler?: (event: Event) => void }
type FileTextareaElement = HTMLTextAreaElement & {
  __quickforgeFileReferenceHandler?: (event: KeyboardEvent) => void
  __quickforgeFileReferenceCompositionStart?: () => void
  __quickforgeFileReferenceCompositionEnd?: () => void
}

const MAX_REFERENCES = 8

export function canUseFileReferenceSuggestions(options: {
  projectId?: string
  readOnly: boolean
  harness?: string
  shared: boolean
}) {
  return Boolean(options.projectId && !options.readOnly && options.harness === 'quickforge' && !options.shared)
}

export function findFileMentionToken(text: string, caret: number): FileMentionToken | null {
  const beforeCaret = text.slice(0, caret)
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret)
  if (!match) return null
  const prefixLength = match[1]?.length ?? 0
  const start = beforeCaret.length - match[0].length + prefixLength
  return { start, end: caret, query: match[2] ?? '' }
}

export function replaceFileMentionToken(text: string, token: FileMentionToken) {
  return `${text.slice(0, token.start)}${text.slice(token.end)}`
}

export function normalizeFileMentionEntries(value: unknown): FileMentionEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const entries: FileMentionEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if ((record.type !== 'file' && record.type !== 'directory') || typeof record.name !== 'string' || typeof record.path !== 'string') continue
    const path = record.path.trim().replace(/\\/g, '/')
    const name = record.name.trim()
    if (!name || !path || path.startsWith('/') || /^[a-zA-Z]:\//.test(path) || path.split('/').includes('..') || seen.has(path)) continue
    seen.add(path)
    entries.push({ name, path, type: record.type })
  }
  return entries
}

export function addFileContextReference(references: FileContextReference[], reference: FileContextReference) {
  if (references.some((item) => item.projectId === reference.projectId && item.path === reference.path)) return references
  return [...references, reference].slice(0, MAX_REFERENCES)
}

function appendHighlightedText(root: HTMLElement, text: string, query: string) {
  if (!query) {
    root.textContent = text
    return
  }
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) {
    root.textContent = text
    return
  }
  const mark = document.createElement('mark')
  mark.textContent = text.slice(at, at + query.length)
  root.append(document.createTextNode(text.slice(0, at)), mark, document.createTextNode(text.slice(at + query.length)))
}

export function createFileReferenceChip(reference: FileContextReference, onRemove?: () => void) {
  const chip = document.createElement('span')
  chip.className = 'quickforge-context-chip quickforge-file-reference-chip'
  chip.dataset.quickforgeFileReference = `${reference.projectId}:${reference.path}`
  chip.title = reference.path
  const icon = document.createElement('span')
  icon.className = 'quickforge-context-chip-icon'
  icon.innerHTML = capabilityIcons.document
  const label = document.createElement('span')
  label.className = 'quickforge-context-chip-label'
  label.textContent = reference.path.split('/').filter(Boolean).at(-1) ?? reference.path
  chip.append(icon, label)
  if (onRemove) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'quickforge-context-chip-remove'
    remove.setAttribute('aria-label', t('removeFileReference', { path: reference.path }))
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

export function createFileReferenceSuggestions({
  panel,
  projectId,
  enabled,
  restoreDraftIntoComposer,
  removeCommandSuggestions,
  removeCapabilitySuggestions,
  removePlusMenu,
  fetchImpl = fetch,
}: FileReferenceSuggestionsOptions) {
  let controller: AbortController | undefined
  let generation = 0
  let activeIndex = 0
  let entries: FileMentionEntry[] = []
  let state: 'idle' | 'loading' | 'ready' | 'empty' | 'error' = 'idle'
  let currentDirectory = '.'
  let currentQuery = ''
  let composing = false

  const suggestionsElement = () => panel.querySelector<FileSuggestionElement>('.quickforge-file-reference-suggestions')
  const readEditor = () => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    const text = editor?.value ?? textarea?.value ?? ''
    return { editor, textarea, text }
  }

  const remove = () => {
    controller?.abort()
    controller = undefined
    generation += 1
    currentDirectory = '.'
    currentQuery = ''
    entries = []
    state = 'idle'
    const suggestions = suggestionsElement()
    if (suggestions?.__quickforgeDismissHandler) document.removeEventListener('pointerdown', suggestions.__quickforgeDismissHandler, true)
    suggestions?.remove()
  }

  const syncChips = () => {
    const { editor } = readEditor()
    if (!editor) return
    const references = editor.contextReferences ?? []
    const existing = editor.querySelector<HTMLElement>('.quickforge-context-chips')
    if (references.length === 0 && !existing?.querySelector('.quickforge-capability-chip')) {
      existing?.remove()
      return
    }
    const container = ensureComposerContextChips(editor)
    if (!container) return
    container.querySelectorAll('.quickforge-file-reference-chip').forEach((chip) => chip.remove())
    for (const reference of references) {
      container.append(createFileReferenceChip(reference, () => {
        editor.contextReferences = (editor.contextReferences ?? []).filter((item) => !(item.projectId === reference.projectId && item.path === reference.path))
        editor.requestUpdate?.()
        syncChips()
        const { text } = readEditor()
        restoreDraftIntoComposer({
          text,
          attachments: editor.attachments ? [...editor.attachments] : [],
          contextReferences: [...(editor.contextReferences ?? [])],
          selectedCapabilities: editor.selectedCapabilities ? [...editor.selectedCapabilities] : [],
        })
      }))
    }
    syncComposerContextChipsAriaLabel(container, {
      plugins: t('selectedCapabilities'),
      files: t('fileReferences'),
      mixed: t('selectedPluginsAndFiles'),
    })
  }

  const statusText = () => {
    if (state === 'loading') return t('fileReferenceLoading')
    if (state === 'error') return t('fileReferenceError')
    if (state === 'empty') return currentQuery ? t('fileReferenceEmpty') : t('fileReferenceDirectoryEmpty')
    return ''
  }

  const visibleEntries = () => {
    const query = currentQuery.toLocaleLowerCase()
    if (!query) return entries
    return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query))
  }

  const setActiveRow = (rows: HTMLButtonElement[], index: number) => {
    if (rows.length === 0) return
    activeIndex = (index + rows.length) % rows.length
    rows.forEach((row, rowIndex) => row.setAttribute('aria-selected', rowIndex === activeIndex ? 'true' : 'false'))
    rows[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
  }

  const select = (entry: FileMentionEntry, token?: FileMentionToken) => {
    if (!projectId) return
    const { editor, textarea, text } = readEditor()
    if (!editor || !textarea) return
    const activeToken = token ?? findFileMentionToken(text, textarea.selectionStart ?? text.length)
    if (!activeToken) return
    if (entry.type === 'directory') {
      currentDirectory = entry.path
      currentQuery = ''
      const nextText = `${text.slice(0, activeToken.start)}@${text.slice(activeToken.end)}`
      restoreDraftIntoComposer({
        text: nextText,
        attachments: editor.attachments ? [...editor.attachments] : [],
        contextReferences: editor.contextReferences ? [...editor.contextReferences] : [],
        selectedCapabilities: editor.selectedCapabilities ? [...editor.selectedCapabilities] : [],
      })
      const nextTextarea = editor.querySelector<HTMLTextAreaElement>('textarea')
      nextTextarea?.focus()
      if (nextTextarea) nextTextarea.selectionStart = nextTextarea.selectionEnd = activeToken.start + 1
      void loadDirectory({ start: activeToken.start, end: activeToken.start + 1, query: '' })
      return
    }
    const nextText = replaceFileMentionToken(text, activeToken)
    editor.contextReferences = addFileContextReference(editor.contextReferences ?? [], { type: 'file', projectId, path: entry.path })
    restoreDraftIntoComposer({
      text: nextText,
      attachments: editor.attachments ? [...editor.attachments] : [],
      contextReferences: [...editor.contextReferences],
      selectedCapabilities: editor.selectedCapabilities ? [...editor.selectedCapabilities] : [],
    })
    syncChips()
    const nextTextarea = editor.querySelector<HTMLTextAreaElement>('textarea')
    nextTextarea?.focus()
    if (nextTextarea) nextTextarea.selectionStart = nextTextarea.selectionEnd = activeToken.start
    remove()
  }

  const render = (token: FileMentionToken) => {
    const { editor } = readEditor()
    if (!editor) return
    removeCommandSuggestions()
    removeCapabilitySuggestions?.()
    removePlusMenu?.()
    const existing = suggestionsElement()
    if (existing?.__quickforgeDismissHandler) document.removeEventListener('pointerdown', existing.__quickforgeDismissHandler, true)
    const suggestions = existing ?? document.createElement('div') as FileSuggestionElement
    suggestions.className = 'quickforge-file-reference-suggestions'
    suggestions.setAttribute('role', 'listbox')
    suggestions.setAttribute('aria-label', t('fileReferenceMenuLabel'))
    suggestions.innerHTML = ''
    suggestions.replaceChildren()

    const header = document.createElement('div')
    header.className = 'quickforge-file-reference-header'
    header.textContent = currentDirectory === '.' ? t('fileReferenceProjectRoot') : currentDirectory
    suggestions.append(header)

    visibleEntries().forEach((entry) => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'quickforge-file-reference-item'
      item.setAttribute('role', 'option')
      item.dataset.quickforgeFilePath = entry.path
      item.dataset.quickforgeFileType = entry.type
      const icon = document.createElement('span')
      icon.className = `quickforge-file-reference-icon quickforge-file-reference-icon-${entry.type}`
      icon.innerHTML = entry.type === 'directory' ? folderIcon : capabilityIcons.document
      const main = document.createElement('span')
      main.className = 'quickforge-file-reference-main'
      const name = document.createElement('span')
      name.className = 'quickforge-file-reference-name'
      appendHighlightedText(name, entry.name, currentQuery)
      const path = document.createElement('span')
      path.className = 'quickforge-file-reference-path'
      path.textContent = entry.type === 'directory' ? t('fileReferenceOpenDirectory') : entry.path
      main.append(name, path)
      item.append(icon, main)
      item.onpointerdown = (event) => {
        event.preventDefault()
        event.stopPropagation()
        select(entry, token)
      }
      suggestions.append(item)
    })

    const status = document.createElement('div')
    status.className = 'quickforge-file-reference-status'
    status.setAttribute('aria-live', 'polite')
    status.textContent = statusText()
    if (status.textContent) suggestions.append(status)

    const footer = document.createElement('div')
    footer.className = 'quickforge-file-reference-footer'
    footer.textContent = t('fileReferenceFooter')
    suggestions.append(footer)

    if (!existing) editor.parentElement?.insertBefore(suggestions, editor)
    setActiveRow(Array.from(suggestions.querySelectorAll<HTMLButtonElement>('.quickforge-file-reference-item')), 0)
    suggestions.__quickforgeDismissHandler = (event: Event) => {
      if (suggestions.contains(event.target as Node) || editor.contains(event.target as Node)) return
      remove()
    }
    document.addEventListener('pointerdown', suggestions.__quickforgeDismissHandler, true)
  }

  const loadDirectory = async (token: FileMentionToken) => {
    if (!projectId) return
    const requestGeneration = ++generation
    controller?.abort()
    controller = new AbortController()
    state = 'loading'
    entries = []
    render(token)
    try {
      const params = new URLSearchParams({ projectId, path: currentDirectory })
      const response = await fetchImpl(`/api/workspace/mention-children?${params}`, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as { path?: unknown; entries?: unknown }
      if (requestGeneration !== generation) return
      if (typeof payload.path === 'string' && payload.path) currentDirectory = payload.path
      entries = normalizeFileMentionEntries(payload.entries)
      state = visibleEntries().length > 0 ? 'ready' : 'empty'
      render(token)
    } catch (error) {
      if (requestGeneration !== generation || (error instanceof DOMException && error.name === 'AbortError')) return
      entries = []
      state = 'error'
      render(token)
    }
  }

  const update = (value?: string) => {
    const { editor, textarea, text: editorText } = readEditor()
    const text = value ?? editorText
    const token = findFileMentionToken(text, textarea?.selectionStart ?? text.length)
    if (composing || !enabled || !projectId || !editor || !textarea || !token) {
      remove()
      return
    }
    currentQuery = token.query
    if (state === 'idle' || state === 'error') {
      void loadDirectory(token)
      return
    }
    state = visibleEntries().length > 0 ? 'ready' : 'empty'
    render(token)
  }

  const setupTextareaHandler = (editor: MessageEditorElement | null) => {
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea') as FileTextareaElement | null
    if (!textarea) return
    if (textarea.__quickforgeFileReferenceHandler) textarea.removeEventListener('keydown', textarea.__quickforgeFileReferenceHandler, true)
    if (textarea.__quickforgeFileReferenceCompositionStart) textarea.removeEventListener('compositionstart', textarea.__quickforgeFileReferenceCompositionStart)
    if (textarea.__quickforgeFileReferenceCompositionEnd) textarea.removeEventListener('compositionend', textarea.__quickforgeFileReferenceCompositionEnd)
    textarea.__quickforgeFileReferenceHandler = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process') return
      const suggestions = suggestionsElement()
      if (!suggestions) return
      const rows = Array.from(suggestions.querySelectorAll<HTMLButtonElement>('.quickforge-file-reference-item'))
      if (event.key === 'Escape') {
        event.preventDefault()
        remove()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveRow(rows, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && rows[activeIndex]) {
        const path = rows[activeIndex].dataset.quickforgeFilePath
        const type = rows[activeIndex].dataset.quickforgeFileType
        const entry = entries.find((candidate) => candidate.path === path && candidate.type === type)
        if (!entry) return
        event.preventDefault()
        event.stopPropagation()
        select(entry)
      }
    }
    textarea.__quickforgeFileReferenceCompositionStart = () => {
      composing = true
      remove()
    }
    textarea.__quickforgeFileReferenceCompositionEnd = () => {
      composing = false
      update()
    }
    textarea.addEventListener('keydown', textarea.__quickforgeFileReferenceHandler, true)
    textarea.addEventListener('compositionstart', textarea.__quickforgeFileReferenceCompositionStart)
    textarea.addEventListener('compositionend', textarea.__quickforgeFileReferenceCompositionEnd)
  }

  const cleanupTextareaHandler = () => {
    const textarea = panel.querySelector<FileTextareaElement>('message-editor textarea')
    if (!textarea) return
    composing = false
    if (textarea.__quickforgeFileReferenceHandler) textarea.removeEventListener('keydown', textarea.__quickforgeFileReferenceHandler, true)
    if (textarea.__quickforgeFileReferenceCompositionStart) textarea.removeEventListener('compositionstart', textarea.__quickforgeFileReferenceCompositionStart)
    if (textarea.__quickforgeFileReferenceCompositionEnd) textarea.removeEventListener('compositionend', textarea.__quickforgeFileReferenceCompositionEnd)
    textarea.__quickforgeFileReferenceHandler = undefined
    textarea.__quickforgeFileReferenceCompositionStart = undefined
    textarea.__quickforgeFileReferenceCompositionEnd = undefined
  }

  return { update, remove, setupTextareaHandler, cleanupTextareaHandler, syncChips }
}
