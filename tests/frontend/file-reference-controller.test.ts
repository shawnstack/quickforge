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
    debounceMs: 300,
  })
  const setText = (text: string) => { editor.value = text; textarea.value = text; textarea.selectionStart = textarea.selectionEnd = text.length }
  return { panel, editor, inputCard, textarea, controller, restoreDraftIntoComposer, setText }
}

const response = (entries: unknown[]) => Promise.resolve({ ok: true, json: async () => ({ entries }) })

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

  it('shows no recents for bare @ and waits until two characters', () => {
    const fetchImpl = vi.fn()
    const h = createHarness(fetchImpl)
    h.setText('@')
    h.controller.update('@')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(h.panel.querySelector<HTMLElement>('.quickforge-file-reference-status')?.textContent).toBe('fileReferenceTypeTwoCharacters')
    expect(h.panel.querySelectorAll<HTMLElement>('.quickforge-file-reference-item')).toHaveLength(0)
    h.setText('@a')
    h.controller.update('@a')
    vi.advanceTimersByTime(500)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('debounces search, cancels the previous request, and ignores stale responses', async () => {
    const resolvers: Array<(value: Response) => void> = []
    const signals: AbortSignal[] = []
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      return new Promise<Response>((resolve) => resolvers.push(resolve))
    })
    const h = createHarness(fetchImpl)
    h.setText('@ab')
    h.controller.update('@ab')
    vi.advanceTimersByTime(300)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    h.setText('@abc')
    h.controller.update('@abc')
    vi.advanceTimersByTime(300)
    expect(signals[0].aborted).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    resolvers[0](await response([{ name: 'old.ts', path: 'old.ts', type: 'file' }]) as Response)
    resolvers[1](await response([{ name: 'new.ts', path: 'src/new.ts', type: 'file' }]) as Response)
    await Promise.resolve(); await Promise.resolve()
    const rows = h.panel.querySelectorAll<HTMLElement>('.quickforge-file-reference-item')
    expect(rows).toHaveLength(1)
    expect(rows[0].dataset.quickforgeFilePath).toBe('src/new.ts')
  })

  it('selects with Enter, removes the token, preserves attachments, and deduplicates refs', async () => {
    const fetchImpl = vi.fn(() => response([{ name: 'file.ts', path: 'src/file.ts', type: 'file' }]))
    const h = createHarness(fetchImpl)
    h.editor.attachments = [{ id: 'attachment' }]
    h.setText('before @fi after')
    h.textarea.selectionStart = h.textarea.selectionEnd = 'before @fi'.length
    h.controller.update()
    vi.advanceTimersByTime(300)
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
