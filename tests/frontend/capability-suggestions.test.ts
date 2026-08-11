import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCapabilitySuggestions } from '../../src/components/chat/capability-suggestions'
import { loadPlugins } from '@/components/plugins/plugin-api'
import type { PluginsResponse, QuickForgePlugin } from '@/components/plugins/plugin-api'

vi.mock('@/components/plugins/plugin-api', () => ({
  loadPlugins: vi.fn(),
}))

// The real i18n module pulls in pi-web-ui/pdfjs which requires a browser DOM;
// capability-suggestions only needs t() for labels.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

// ---------------------------------------------------------------------------
// Minimal fake DOM. The project's vitest setup runs in a node environment and
// has no jsdom/happy-dom dependency, so we stub just enough of document/panel
// for capability-suggestions to render and insert suggestions.
// ---------------------------------------------------------------------------

type FakeNode = {
  tagName: string
  className: string
  textContent: string
  innerHTML: string
  dataset: Record<string, string>
  attributes: Record<string, string>
  children: FakeNode[]
  parentElement: FakeNode | null
  onpointerdown: ((event: unknown) => void) | null
  value?: string
  selectionStart?: number
  selectionEnd?: number
  attachments?: unknown[]
  insertedSuggestions?: FakeNode | null
  append: (...nodes: FakeNode[]) => void
  setAttribute: (name: string, value: string) => void
  getAttribute: (name: string) => string | null
  remove: () => void
  querySelector: (selector: string) => FakeNode | null
  querySelectorAll: () => FakeNode[]
  contains: (node: unknown) => boolean
  addEventListener: () => void
  removeEventListener: () => void
  focus: () => void
  insertBefore?: (child: FakeNode, reference: FakeNode) => FakeNode
}

function createFakeElement(tagName: string): FakeNode {
  const node: FakeNode = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    attributes: {},
    children: [],
    parentElement: null,
    onpointerdown: null,
    append(...nodes) {
      for (const child of nodes) {
        child.parentElement = node
        node.children.push(child)
      }
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value)
    },
    getAttribute(name) {
      return node.attributes[name] ?? null
    },
    remove() {
      const parent = node.parentElement
      if (!parent) return
      const index = parent.children.indexOf(node)
      if (index >= 0) parent.children.splice(index, 1)
      node.parentElement = null
      if (parent.insertedSuggestions === node) parent.insertedSuggestions = null
    },
    querySelector(selector) {
      if (selector === '.quickforge-capability-suggestion-name' || selector === '.quickforge-capability-suggestion-description') {
        const cls = selector.slice(1)
        let child = node.children.find((c) => c.className.split(/\s+/).includes(cls))
        if (!child) {
          child = createFakeElement('span')
          child.className = cls
          node.children.push(child)
        }
        return child
      }
      if (selector.startsWith('.')) {
        const cls = selector.slice(1)
        return node.children.find((c) => c.className.split(/\s+/).includes(cls)) ?? null
      }
      return node.children.find((c) => c.tagName === selector.toUpperCase()) ?? null
    },
    querySelectorAll() {
      return []
    },
    contains() {
      return false
    },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  }
  return node
}

type Harness = {
  panel: FakeNode
  editor: FakeNode
  textarea: FakeNode
  instance: ReturnType<typeof createCapabilitySuggestions>
  restoreDraftIntoComposer: ReturnType<typeof vi.fn>
  onSelectionChange: ReturnType<typeof vi.fn>
  setText: (text: string) => void
}

function createHarness(enabled = false): Harness {
  const textarea = createFakeElement('textarea')
  textarea.value = ''
  textarea.selectionStart = 0
  textarea.selectionEnd = 0

  const editor = createFakeElement('message-editor')
  editor.value = ''
  editor.attachments = []
  editor.append(textarea)

  const panel = createFakeElement('div')
  panel.insertedSuggestions = null
  panel.append(editor)
  panel.insertBefore = (child) => {
    child.parentElement = panel
    panel.children.push(child)
    if (!panel.insertedSuggestions) panel.insertedSuggestions = child
    return child
  }
  const baseQuerySelector = panel.querySelector
  panel.querySelector = (selector) => {
    if (selector === 'message-editor') return editor
    if (selector === '.quickforge-capability-suggestions') return panel.insertedSuggestions ?? null
    return baseQuerySelector(selector)
  }

  const restoreDraftIntoComposer = vi.fn()
  const onSelectionChange = vi.fn()
  const instance = createCapabilitySuggestions({
    panel: panel as unknown as HTMLElement,
    restoreDraftIntoComposer,
    onSelectionChange,
    enabled,
  })

  return {
    panel,
    editor,
    textarea,
    instance,
    restoreDraftIntoComposer,
    onSelectionChange,
    setText(text: string) {
      editor.value = text
      textarea.value = text
      textarea.selectionStart = text.length
      textarea.selectionEnd = text.length
    },
  }
}

const mockLoadPlugins = () => vi.mocked(loadPlugins)

const emptyResponse: PluginsResponse = { plugins: [], searchPaths: [], errors: [] }

const documentsPlugin: QuickForgePlugin = {
  name: 'documents',
  displayName: 'Documents',
  version: '1.0.0',
  dir: '/plugins/documents',
  enabled: true,
  status: 'loaded',
  permissions: [],
  tools: [],
}

const deferredResponse = () => {
  let resolve!: (value: PluginsResponse) => void
  const promise = new Promise<PluginsResponse>((r) => { resolve = r })
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('capability suggestions @-mention plugin loading', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: createFakeElement,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests the plugin list exactly once when it loads empty and never loops', async () => {
    mockLoadPlugins().mockResolvedValue(emptyResponse)
    const { instance, setText } = createHarness()

    setText('hello @')
    instance.update('hello @')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)

    instance.update('@do')
    await flush()
    instance.update('@')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
  })

  it('does not loop when the plugin request fails', async () => {
    mockLoadPlugins().mockRejectedValueOnce(new Error('boom'))
    const { instance, setText } = createHarness()

    setText('@')
    instance.update('@')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)

    setText('@x')
    instance.update('@x')
    await flush()
    setText('@xy')
    instance.update('@xy')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
  })

  it('does not loop when every plugin is filtered out after loading', async () => {
    mockLoadPlugins().mockResolvedValue({ plugins: [{ ...documentsPlugin, enabled: false }], searchPaths: [], errors: [] })
    const { instance, setText } = createHarness()

    setText('@')
    instance.update('@')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)

    instance.update('@d')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
  })

  it('does not loop when the query matches no loaded plugin', async () => {
    mockLoadPlugins().mockResolvedValue({ plugins: [documentsPlugin], searchPaths: [], errors: [] })
    const { instance, setText } = createHarness()

    setText('@zzz-no-match')
    instance.update('@zzz-no-match')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)

    setText('@another-no-match')
    instance.update('@another-no-match')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
  })

  it('renders suggestions for the current value once the load settles', async () => {
    const deferred = deferredResponse()
    mockLoadPlugins().mockImplementation(() => deferred.promise)
    const { instance, setText, panel } = createHarness()

    setText('@do')
    instance.update('@do')
    expect(panel.insertedSuggestions).toBeNull()

    deferred.resolve({ plugins: [documentsPlugin], searchPaths: [], errors: [] })
    await flush()

    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
    expect(panel.insertedSuggestions).not.toBeNull()
    const items = panel.insertedSuggestions!.children.filter((c) => c.className.includes('quickforge-capability-suggestion-item'))
    expect(items.length).toBeGreaterThan(0)
  })

  it('does not issue duplicate requests for concurrent updates', async () => {
    const deferred = deferredResponse()
    mockLoadPlugins().mockImplementation(() => deferred.promise)
    const { instance, setText } = createHarness()

    setText('@')
    instance.update('@')
    instance.update('@d')
    instance.update('@do')
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)

    deferred.resolve(emptyResponse)
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
  })

  it('allows a retry after the user clears the @ token following a failed load', async () => {
    mockLoadPlugins()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ plugins: [documentsPlugin], searchPaths: [], errors: [] })
    const { instance, setText, panel } = createHarness()

    setText('@')
    instance.update('@')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)

    setText('plain text')
    instance.update('plain text')
    setText('plain text @')
    instance.update('plain text @')
    await flush()

    expect(mockLoadPlugins()).toHaveBeenCalledTimes(2)
    expect(panel.insertedSuggestions).not.toBeNull()
  })

  it('stays silent on retry within the same @-token lifetime after a failure', async () => {
    mockLoadPlugins().mockRejectedValueOnce(new Error('boom'))
    const { instance, setText } = createHarness()

    setText('@')
    instance.update('@')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)

    setText('@other')
    instance.update('@other')
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
  })

  it('requests once on creation when enabled', async () => {
    mockLoadPlugins().mockResolvedValue(emptyResponse)
    createHarness(true)
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
    await flush()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
  })

  it('inserts a builtin mention once after an async load and dedupes re-entry', async () => {
    const deferred = deferredResponse()
    mockLoadPlugins().mockImplementation(() => deferred.promise)
    const { instance, restoreDraftIntoComposer } = createHarness()

    instance.insertBuiltinPluginMention('Documents')
    instance.insertBuiltinPluginMention('Documents')
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)

    deferred.resolve({ plugins: [documentsPlugin], searchPaths: [], errors: [] })
    await flush()

    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
    expect(restoreDraftIntoComposer).toHaveBeenCalledTimes(1)
    expect(restoreDraftIntoComposer.mock.calls[0][0]).toMatchObject({ text: '@Documents ' })
  })

  it('inserts a builtin mention directly when plugins are already loaded', async () => {
    mockLoadPlugins().mockResolvedValue({ plugins: [documentsPlugin], searchPaths: [], errors: [] })
    const { instance, restoreDraftIntoComposer } = createHarness(true)
    await flush()

    instance.insertBuiltinPluginMention('Documents')

    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
    expect(restoreDraftIntoComposer).toHaveBeenCalledTimes(1)
  })

  it('does not refetch when the plus menu is used after a failed load', async () => {
    mockLoadPlugins().mockRejectedValueOnce(new Error('boom'))
    const { instance } = createHarness()

    instance.insertBuiltinPluginMention('Documents')
    await flush()
    instance.insertBuiltinPluginMention('Spreadsheets')
    await flush()
    instance.insertBuiltinPluginMention('Presentations')
    await flush()

    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
  })
})
