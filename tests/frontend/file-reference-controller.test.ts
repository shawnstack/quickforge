import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCapabilitySuggestions } from '../../src/components/chat/capability-suggestions'
import { createFileReferenceSuggestions } from '../../src/components/chat/file-reference-suggestions'
import type { MessageEditorElement } from '../../src/components/chat/chat-utils'
import { loadPlugins } from '@/components/plugins/plugin-api'

vi.mock('@/components/plugins/plugin-api', () => ({ loadPlugins: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

const plugin = { name: 'documents', displayName: 'Documents', version: '1', dir: '/plugins/documents', enabled: true, status: 'loaded', permissions: [], tools: [] }

class FakeElement {
  className = ''
  textContent = ''
  innerHTML = ''
  title = ''
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  onpointerdown?: (event: { preventDefault(): void; stopPropagation(): void }) => void
  value = ''
  selectionStart = 0
  selectionEnd = 0
  attachments: unknown[] = []
  contextReferences: Array<{ type: 'file'; projectId: string; path: string }> = []
  selectedCapabilities: Array<{ type: 'plugin'; pluginName: string; name: string; label: string }> = []
  listeners = new Map<string, (event: KeyboardEvent) => void>()
  constructor(readonly tagName: string) {}
  append(...children: Array<FakeElement | { textContent?: string }>) {
    for (const child of children) if (child instanceof FakeElement) {
      child.remove()
      child.parentElement = this
      this.children.push(child)
    }
  }
  prepend(child: FakeElement) { child.remove(); child.parentElement = this; this.children.unshift(child) }
  replaceChildren(...children: FakeElement[]) { this.children = []; this.append(...children) }
  insertBefore(child: FakeElement, reference?: FakeElement) {
    child.remove()
    child.parentElement = this
    const index = reference ? this.children.indexOf(reference) : -1
    this.children.splice(index >= 0 ? index : this.children.length, 0, child)
    return child
  }
  remove() { if (!this.parentElement) return; this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  contains(target: unknown) { return target === this || this.children.some((child) => child.contains(target)) }
  focus() {}
  scrollIntoView() {}
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) { this.listeners.set(type, listener as (event: KeyboardEvent) => void) }
  removeEventListener(type: string) { this.listeners.delete(type) }
  dispatchKey(event: KeyboardEvent) { this.listeners.get('keydown')?.(event) }
  querySelector<T>(selector: string): T | null {
    if (selector === 'message-editor textarea') return this.find((child) => child.tagName === 'textarea') as T ?? null
    if (selector === 'message-editor') return this.find((child) => child.tagName === 'message-editor') as T ?? null
    if (selector.startsWith('.')) return this.find((child) => child.className.split(/\s+/).includes(selector.slice(1))) as T ?? null
    return this.find((child) => child.tagName === selector) as T ?? null
  }
  querySelectorAll<T>(selector: string): T[] {
    const className = selector.startsWith('.') ? selector.slice(1) : ''
    const found: FakeElement[] = []
    const visit = (node: FakeElement) => { for (const child of node.children) { if (!className || child.className.split(/\s+/).includes(className)) found.push(child); visit(child) } }
    visit(this)
    return found as T[]
  }
  private find(predicate: (child: FakeElement) => boolean): FakeElement | undefined {
    for (const child of this.children) { if (predicate(child)) return child; const nested = child.find(predicate); if (nested) return nested }
  }
}

function createHarness(fetchImpl = vi.fn()) {
  const panel = new FakeElement('div')
  const shell = new FakeElement('div')
  const editor = new FakeElement('message-editor')
  const inputCard = new FakeElement('div')
  const textarea = new FakeElement('textarea')
  inputCard.append(textarea)
  editor.append(inputCard)
  shell.append(editor)
  panel.append(shell)
  const restoreDraftIntoComposer = vi.fn((draft) => {
    editor.value = draft.text
    textarea.value = draft.text
    editor.contextReferences = draft.contextReferences ?? []
  })
  const controller = createFileReferenceSuggestions({
    panel: panel as unknown as HTMLElement,
    projectId: 'project-1',
    enabled: true,
    restoreDraftIntoComposer,
    removeCommandSuggestions: vi.fn(),
    fetchImpl: fetchImpl as typeof fetch,
  })
  const setText = (text: string) => { editor.value = text; textarea.value = text; textarea.selectionStart = textarea.selectionEnd = text.length }
  return { panel, editor, inputCard, textarea, controller, restoreDraftIntoComposer, setText }
}

const response = (entries: unknown[], directoryPath = '.') => Promise.resolve({ ok: true, json: async () => ({ path: directoryPath, entries }) })

describe('file reference suggestions controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => ({ textContent: text }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.mocked(loadPlugins).mockResolvedValue({ plugins: [plugin] as never, searchPaths: [], errors: [] })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('loads project-root children for bare @ and filters only the current directory', async () => {
    const fetchImpl = vi.fn(() => response([
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'README.md', path: 'README.md', type: 'file' },
      { name: 'source-map.js', path: 'source-map.js', type: 'file' },
    ]))
    const h = createHarness(fetchImpl)
    h.setText('@')
    h.controller.update('@')
    await Promise.resolve(); await Promise.resolve()
    expect(fetchImpl).toHaveBeenCalledWith('/api/workspace/mention-children?projectId=project-1&path=.', expect.any(Object))
    expect(h.panel.querySelectorAll<HTMLElement>('.quickforge-file-reference-item').map((row) => row.dataset.quickforgeFilePath))
      .toEqual(['src', 'README.md', 'source-map.js'])

    h.setText('@src')
    h.controller.update('@src')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(h.panel.querySelectorAll<HTMLElement>('.quickforge-file-reference-item').map((row) => row.dataset.quickforgeFilePath))
      .toEqual(['src'])
    h.controller.remove()
    h.setText('@')
    h.controller.update('@')
    await Promise.resolve(); await Promise.resolve()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenLastCalledWith('/api/workspace/mention-children?projectId=project-1&path=.', expect.any(Object))
  })

  it('keeps the current directory when an aborted older request resolves late', async () => {
    let resolveOldDirectory!: (value: Awaited<ReturnType<typeof response>>) => void
    const oldDirectory = new Promise<Awaited<ReturnType<typeof response>>>((resolve) => { resolveOldDirectory = resolve })
    const signals: AbortSignal[] = []
    let rootRequestCount = 0
    const fetchImpl = vi.fn((url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      if (url.includes('path=src')) return oldDirectory
      rootRequestCount += 1
      return response(rootRequestCount === 1
        ? [{ name: 'src', path: 'src', type: 'directory' }]
        : [{ name: 'README.md', path: 'README.md', type: 'file' }])
    })
    const h = createHarness(fetchImpl)
    h.setText('@')
    h.controller.update('@')
    await Promise.resolve(); await Promise.resolve()
    h.controller.setupTextareaHandler(h.editor as unknown as MessageEditorElement)
    h.textarea.dispatchKey({ key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn(), isComposing: false } as unknown as KeyboardEvent)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    h.controller.remove()
    expect(signals[1].aborted).toBe(true)
    h.setText('@')
    h.controller.update('@')
    await Promise.resolve(); await Promise.resolve()
    expect(h.panel.querySelectorAll<HTMLElement>('.quickforge-file-reference-item').map((row) => row.dataset.quickforgeFilePath))
      .toEqual(['README.md'])

    resolveOldDirectory(await response([{ name: 'old.ts', path: 'src/old.ts', type: 'file' }], 'src'))
    await Promise.resolve(); await Promise.resolve()
    expect(h.panel.querySelector<HTMLElement>('.quickforge-file-reference-header')?.textContent).toBe('fileReferenceProjectRoot')
    expect(h.panel.querySelectorAll<HTMLElement>('.quickforge-file-reference-item').map((row) => row.dataset.quickforgeFilePath))
      .toEqual(['README.md'])
  })

  it('removes textarea listeners during cleanup', () => {
    const h = createHarness()
    h.controller.setupTextareaHandler(h.editor as unknown as MessageEditorElement)
    expect([...h.textarea.listeners.keys()].sort()).toEqual(['compositionend', 'compositionstart', 'keydown'])

    h.controller.cleanupTextareaHandler()
    expect([...h.textarea.listeners.keys()]).toEqual([])
  })

  it('opens directories with Enter and then selects a file with Tab', async () => {
    const fetchImpl = vi.fn((url: string) => url.includes('path=src')
      ? response([{ name: 'file.ts', path: 'src/file.ts', type: 'file' }], 'src')
      : response([{ name: 'src', path: 'src', type: 'directory' }]))
    const h = createHarness(fetchImpl)
    h.setText('@')
    h.controller.update('@')
    await Promise.resolve(); await Promise.resolve()
    h.controller.setupTextareaHandler(h.editor as unknown as MessageEditorElement)
    h.textarea.dispatchKey({ key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn(), isComposing: false } as unknown as KeyboardEvent)
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenLastCalledWith('/api/workspace/mention-children?projectId=project-1&path=src', expect.any(Object))
      expect(h.panel.querySelectorAll('.quickforge-file-reference-item')).toHaveLength(1)
    })
    expect(h.editor.contextReferences).toEqual([])
    expect(h.editor.value).toBe('@')

    h.textarea.dispatchKey({ key: 'Tab', preventDefault: vi.fn(), stopPropagation: vi.fn(), isComposing: false } as unknown as KeyboardEvent)
    expect(h.restoreDraftIntoComposer).toHaveBeenCalledWith(expect.objectContaining({
      text: '',
      contextReferences: [{ type: 'file', projectId: 'project-1', path: 'src/file.ts' }],
    }))
  })

  it('returns every current-level entry and relies on menu scrolling instead of truncating', async () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({ name: `${index}.txt`, path: `${index}.txt`, type: 'file' }))
    const h = createHarness(vi.fn(() => response(entries)))
    h.setText('@')
    h.controller.update('@')
    await Promise.resolve(); await Promise.resolve()
    expect(h.panel.querySelectorAll('.quickforge-file-reference-item')).toHaveLength(25)
  })

  it('selects with Enter, removes the token, preserves attachments, and deduplicates refs', async () => {
    const fetchImpl = vi.fn(() => response([{ name: 'file.ts', path: 'src/file.ts', type: 'file' }]))
    const h = createHarness(fetchImpl)
    h.editor.attachments = [{ id: 'attachment' }]
    h.setText('before @fi after')
    h.textarea.selectionStart = h.textarea.selectionEnd = 'before @fi'.length
    h.controller.update()
    await Promise.resolve(); await Promise.resolve()
    h.controller.setupTextareaHandler(h.editor as unknown as MessageEditorElement)
    h.textarea.dispatchKey({ key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn(), isComposing: false } as unknown as KeyboardEvent)
    expect(h.restoreDraftIntoComposer).toHaveBeenCalledWith(expect.objectContaining({
      text: 'before  after',
      attachments: [{ id: 'attachment' }],
      contextReferences: [{ type: 'file', projectId: 'project-1', path: 'src/file.ts' }],
    }))
    const chips = h.editor.querySelector<FakeElement>('.quickforge-context-chips')
    expect(chips?.parentElement).toBe(h.inputCard)
    expect(h.inputCard.children.indexOf(chips!)).toBeLessThan(h.inputCard.children.indexOf(h.textarea))
  })

  it.each(['file-first', 'plugin-first'] as const)(
    'keeps shared file/plugin chips independent for %s synchronization',
    async (order) => {
      const h = createHarness()
      const capabilityController = createCapabilitySuggestions({
        panel: h.panel as unknown as HTMLElement,
        restoreDraftIntoComposer: h.restoreDraftIntoComposer,
        enabled: true,
      })
      await capabilityController.refresh()
      const reference = { type: 'file' as const, projectId: 'project-1', path: 'src/file.ts' }
      const addFile = () => {
        h.editor.contextReferences = [reference]
        h.controller.syncChips()
      }
      const addPlugin = () => capabilityController.selectPlugin('documents')

      if (order === 'file-first') {
        addFile()
        expect(h.editor.querySelector<FakeElement>('.quickforge-context-chips')?.getAttribute('aria-label')).toBe('fileReferences')
        addPlugin()
      } else {
        addPlugin()
        expect(h.editor.querySelector<FakeElement>('.quickforge-context-chips')?.getAttribute('aria-label')).toBe('selectedCapabilities')
        addFile()
      }

      let container = h.editor.querySelector<FakeElement>('.quickforge-context-chips')
      expect(container?.querySelectorAll('.quickforge-file-reference-chip')).toHaveLength(1)
      expect(container?.querySelectorAll('.quickforge-capability-chip')).toHaveLength(1)
      expect(container?.getAttribute('aria-label')).toBe('selectedPluginsAndFiles')

      if (order === 'file-first') {
        expect(capabilityController.consumeSelectedCapabilities()).toHaveLength(1)
        container = h.editor.querySelector<FakeElement>('.quickforge-context-chips')
        expect(container?.querySelectorAll('.quickforge-file-reference-chip')).toHaveLength(1)
        expect(container?.querySelectorAll('.quickforge-capability-chip')).toHaveLength(0)
        expect(container?.getAttribute('aria-label')).toBe('fileReferences')
        container?.querySelector<FakeElement>('.quickforge-file-reference-chip')?.querySelector<FakeElement>('button')
          ?.onpointerdown?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() })
      } else {
        container?.querySelector<FakeElement>('.quickforge-file-reference-chip')?.querySelector<FakeElement>('button')
          ?.onpointerdown?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() })
        container = h.editor.querySelector<FakeElement>('.quickforge-context-chips')
        expect(container?.querySelectorAll('.quickforge-file-reference-chip')).toHaveLength(0)
        expect(container?.querySelectorAll('.quickforge-capability-chip')).toHaveLength(1)
        expect(container?.getAttribute('aria-label')).toBe('selectedCapabilities')
        expect(capabilityController.consumeSelectedCapabilities()).toHaveLength(1)
      }

      expect(h.editor.querySelector('.quickforge-context-chips')).toBeNull()
    },
  )
})
