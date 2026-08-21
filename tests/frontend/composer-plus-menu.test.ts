import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCapabilitySuggestions } from '../../src/components/chat/capability-suggestions'
import { setupComposerPlusMenu } from '../../src/components/chat/panel-decoration/composer-plus-menu'
import type { MessageEditorElement } from '../../src/components/chat/chat-utils'
import { loadPlugins } from '@/components/plugins/plugin-api'
import type { PluginsResponse, QuickForgePlugin } from '@/components/plugins/plugin-api'

vi.mock('@/components/plugins/plugin-api', () => ({
  loadPlugins: vi.fn(),
}))

// The real i18n module pulls in pi-web-ui/pdfjs which requires a browser DOM;
// composer-plus-menu only needs t() for labels.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

// removeOpenCodeModeMenu touches document/window listeners; the plus menu only
// calls it defensively, so a no-op keeps the fake DOM minimal.
vi.mock('../../src/components/chat/panel-decoration/opencode-mode-menu', () => ({
  removeOpenCodeModeMenu: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Minimal fake DOM (same style as capability-suggestions.test.ts): stubs just
// enough of document/panel for the plus menu to render and be interacted with.
// ---------------------------------------------------------------------------

type FakeNode = {
  tagName: string
  className: string
  textContent: string
  _innerHTML: string
  title?: string
  dataset: Record<string, string>
  attributes: Record<string, string>
  children: FakeNode[]
  parentElement: FakeNode | null
  onpointerdown: ((event: Event) => void) | null
  onclick: ((event: Event) => void) | null
  isConnected?: boolean
  value?: string
  selectionStart?: number
  selectionEnd?: number
  attachments?: unknown[]
  content?: { children: FakeNode[] }
  insertedSuggestions?: FakeNode | null
  insertedPopover?: FakeNode | null
  __quickforgeDismissHandler?: (event: Event) => void
  append: (...nodes: FakeNode[]) => void
  appendChild: (node: FakeNode) => FakeNode
  prepend: (node: FakeNode) => void
  setAttribute: (name: string, value: string) => void
  getAttribute: (name: string) => string | null
  remove: () => void
  querySelector: (selector: string) => FakeNode | null
  querySelectorAll: () => FakeNode[]
  contains: (node: unknown) => boolean
  addEventListener: () => void
  removeEventListener: () => void
  focus: () => void
  insertBefore: (child: FakeNode, reference?: FakeNode) => FakeNode
}

function createFakeElement(tagName: string): FakeNode {
  const node: FakeNode = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    _innerHTML: '',
    title: '',
    dataset: {},
    attributes: {},
    children: [],
    parentElement: null,
    onpointerdown: null,
    onclick: null,
    append(...nodes) {
      for (const child of nodes) {
        child.parentElement = node
        node.children.push(child)
      }
    },
    appendChild(child) {
      child.parentElement = node
      node.children.push(child)
      return child
    },
    prepend(child) {
      child.parentElement = node
      node.children.unshift(child)
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
      if (parent.insertedPopover === node) parent.insertedPopover = null
    },
    querySelector(selector) {
      if (selector === '.quickforge-plus-popover-item-label' || selector === '.quickforge-plus-popover-item-description') {
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
    insertBefore(child) {
      child.parentElement = node
      node.children.push(child)
      if (!node.insertedPopover && child.className.includes('quickforge-plus-popover')) {
        node.insertedPopover = child
      }
      return child
    },
  }
  if (tagName === 'template') node.content = { children: [] }
  Object.defineProperty(node, 'innerHTML', {
    get() {
      return node._innerHTML
    },
    set(value: string) {
      node._innerHTML = value
      node.children.length = 0
    },
  })
  return node
}

function createHarness(options: HarnessOptions = {}) {
  const textarea = createFakeElement('textarea')
  textarea.value = ''
  textarea.selectionStart = 0
  textarea.selectionEnd = 0

  const editor = createFakeElement('message-editor')
  editor.value = ''
  editor.attachments = []
  editor.append(textarea)

  const leftControls = createFakeElement('div')

  const panel = createFakeElement('div')
  panel.append(editor)
  editor.append(leftControls)
  const baseQuerySelector = panel.querySelector
  panel.querySelector = (selector: string) => {
    if (selector === 'message-editor') return editor
    if (selector === '.quickforge-plus-popover') return panel.insertedPopover ?? null
    if (selector === '.quickforge-plus-inline') {
      return leftControls.children.find((c) => c.className.includes('quickforge-plus-inline')) ?? null
    }
    return baseQuerySelector(selector)
  }

  const restoreDraftIntoComposer = vi.fn()
  const capabilitySuggestions = createCapabilitySuggestions({
    panel: panel as unknown as HTMLElement,
    enabled: true,
    restoreDraftIntoComposer,
  })

  const removeCommandSuggestions = vi.fn()
  const removeCapabilitySuggestions = vi.fn()
  const removeFileReferenceSuggestions = vi.fn()
  const selectPluginCapability = vi.fn()

  setupComposerPlusMenu({
    panel: panel as unknown as HTMLElement,
    editor: editor as unknown as MessageEditorElement,
    leftControls: leftControls as unknown as HTMLElement,
    selectPluginCapability,
    availablePluginRows: capabilitySuggestions.availablePluginRows,
    removeCommandSuggestions,
    removeCapabilitySuggestions,
    removeFileReferenceSuggestions,
    attachmentsEnabled: false,
    pluginsEnabled: options.pluginsEnabled ?? true,
  })

  const plusButton = leftControls.children.find((c) => c.className.includes('quickforge-plus-inline'))!

  return {
    panel,
    editor,
    leftControls,
    plusButton,
    restoreDraftIntoComposer,
    selectPluginCapability,
  }
}

type HarnessOptions = {
  pluginsEnabled?: boolean
}

type Harness = ReturnType<typeof createHarness>

const mockLoadPlugins = () => vi.mocked(loadPlugins)

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

const spreadsheetsPlugin: QuickForgePlugin = {
  ...documentsPlugin,
  name: 'spreadsheets',
  displayName: 'Spreadsheets',
  dir: '/plugins/spreadsheets',
}

const presentationsPlugin: QuickForgePlugin = {
  ...documentsPlugin,
  name: 'presentations',
  displayName: 'Presentations',
  dir: '/plugins/presentations',
}

const responseFor = (...plugins: QuickForgePlugin[]): PluginsResponse => ({ plugins, searchPaths: [], errors: [] })

const deferredResponse = () => {
  let resolve!: (value: PluginsResponse) => void
  const promise = new Promise<PluginsResponse>((r) => { resolve = r })
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const pointerDown = (node: FakeNode | null | undefined) => {
  expect(node).toBeTruthy()
  node!.onpointerdown!({ preventDefault() {}, stopPropagation() {} } as Event)
}

const popoverItems = (h: Harness) => {
  const popover = h.panel.insertedPopover
  expect(popover).toBeTruthy()
  return popover!.children.filter((c) => c.className.split(/\s+/).includes('quickforge-plus-popover-item'))
}

const itemLabel = (item: FakeNode) => item.querySelector('.quickforge-plus-popover-item-label')?.textContent ?? ''

const pluginsEntryOf = (h: Harness) => popoverItems(h).find((item) => itemLabel(item) === 'composerAddPlugins')

const pluginItems = (h: Harness) => popoverItems(h).filter((item) => item.dataset.quickforgePluginName)

const pluginNames = (h: Harness) => pluginItems(h).map((item) => item.dataset.quickforgePluginName)

const openMainMenu = (h: Harness) => pointerDown(h.plusButton)

const openPluginsView = (h: Harness) => {
  const entry = pluginsEntryOf(h)
  pointerDown(entry)
}

describe('composer + plugin menu availability', () => {
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

  it('shows every enabled and loaded plugin in the plugins view', async () => {
    mockLoadPlugins().mockResolvedValue(responseFor(documentsPlugin, spreadsheetsPlugin, presentationsPlugin))
    const h = createHarness()
    await flush()

    openMainMenu(h)
    expect(pluginsEntryOf(h)).toBeTruthy()
    openPluginsView(h)

    expect(pluginNames(h).sort()).toEqual(['documents', 'presentations', 'spreadsheets'])
  })

  it('omits disabled plugins from the plugins view', async () => {
    mockLoadPlugins().mockResolvedValue(responseFor(
      documentsPlugin,
      { ...spreadsheetsPlugin, enabled: false },
      presentationsPlugin,
    ))
    const h = createHarness()
    await flush()

    openMainMenu(h)
    openPluginsView(h)

    expect(pluginNames(h).sort()).toEqual(['documents', 'presentations'])
  })

  it('omits errored or otherwise non-loaded plugins from the plugins view', async () => {
    mockLoadPlugins().mockResolvedValue(responseFor(
      { ...documentsPlugin, status: 'error' },
      { ...spreadsheetsPlugin, status: 'loaded', enabled: false },
      presentationsPlugin,
    ))
    const h = createHarness()
    await flush()

    openMainMenu(h)
    openPluginsView(h)

    expect(pluginNames(h)).toEqual(['presentations'])
  })

  it('hides the plugins entry in the main menu when no plugin is available', async () => {
    mockLoadPlugins().mockResolvedValue(responseFor(
      { ...documentsPlugin, enabled: false },
      { ...spreadsheetsPlugin, status: 'error' },
    ))
    const h = createHarness()
    await flush()

    openMainMenu(h)
    expect(pluginsEntryOf(h)).toBeUndefined()
  })

  it('does not show the plugins entry while loading, but shows it after reopening once loaded', async () => {
    const deferred = deferredResponse()
    mockLoadPlugins().mockImplementation(() => deferred.promise)
    const h = createHarness()

    openMainMenu(h)
    expect(pluginsEntryOf(h)).toBeUndefined()

    pointerDown(h.plusButton) // close the popover while the request is still in flight
    deferred.resolve(responseFor(documentsPlugin, spreadsheetsPlugin, presentationsPlugin))
    await flush()

    openMainMenu(h)
    expect(pluginsEntryOf(h)).toBeTruthy()
    openPluginsView(h)
    expect(pluginNames(h).sort()).toEqual(['documents', 'presentations', 'spreadsheets'])
  })

  it('selects the plugin capability when a plugin item is clicked', async () => {
    mockLoadPlugins().mockResolvedValue(responseFor(documentsPlugin, spreadsheetsPlugin, presentationsPlugin))
    const h = createHarness()
    await flush()

    openMainMenu(h)
    openPluginsView(h)

    const documentsItem = pluginItems(h).find((item) => item.dataset.quickforgePluginName === 'documents')
    pointerDown(documentsItem)

    expect(h.selectPluginCapability).toHaveBeenCalledTimes(1)
    expect(h.selectPluginCapability.mock.calls[0][0]).toBe('documents')
  })

  it('does not issue additional /api/plugins requests when the plus menu is used', async () => {
    mockLoadPlugins().mockResolvedValue(responseFor(documentsPlugin, spreadsheetsPlugin, presentationsPlugin))
    const h = createHarness()
    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
    await flush()

    openMainMenu(h)
    openPluginsView(h)
    pointerDown(pluginItems(h).find((item) => item.dataset.quickforgePluginName === 'documents'))
    await flush()

    expect(mockLoadPlugins()).toHaveBeenCalledTimes(1)
  })

  it('keeps the plugins entry hidden when the capability switch is off', async () => {
    mockLoadPlugins().mockResolvedValue(responseFor(documentsPlugin, spreadsheetsPlugin, presentationsPlugin))
    const h = createHarness({ pluginsEnabled: false })
    await flush()

    openMainMenu(h)
    expect(pluginsEntryOf(h)).toBeUndefined()
  })
})
