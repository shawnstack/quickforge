import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCommandSuggestions } from '../../src/components/chat/command-suggestions'
import type { CommandTextareaElement, CustomCommandSummary, MessageEditorElement } from '../../src/components/chat/chat-utils'
import type { SlashCatalog } from '../../src/lib/slash-catalog'

// The real i18n module pulls in pi-web-ui which requires a browser DOM;
// command-suggestions only needs t() for group labels / descriptions.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

// ---------------------------------------------------------------------------
// Minimal fake DOM. The project's vitest setup runs in a node environment and
// has no jsdom/happy-dom dependency, so we stub just enough of document/panel
// for command-suggestions to render and navigate the slash menu.
// ---------------------------------------------------------------------------

type FakeEvent = { preventDefault: () => void; stopPropagation: () => void; stopImmediatePropagation: () => void }

type FakeNode = {
  tagName: string
  className: string
  textContent: string
  innerHTML: string
  type?: string
  dataset: Record<string, string>
  attributes: Record<string, string>
  style: Record<string, string>
  children: FakeNode[]
  parentElement: FakeNode | null
  onpointerdown: ((event: FakeEvent) => void) | null
  value?: string
  attachments?: unknown[]
  selectionStart?: number
  selectionEnd?: number
  listeners: Record<string, Array<(event: unknown) => void>>
  focus: () => void
  classList: { add: (...classes: string[]) => void; remove: (...classes: string[]) => void; contains: (cls: string) => boolean }
  append: (...nodes: FakeNode[]) => void
  insertBefore: (child: FakeNode, reference: FakeNode | null) => FakeNode
  setAttribute: (name: string, value: string) => void
  getAttribute: (name: string) => string | null
  removeAttribute: (name: string) => void
  remove: () => void
  querySelector: (selector: string) => FakeNode | null
  querySelectorAll: (selector: string) => FakeNode[]
  contains: (node: unknown) => boolean
  closest: (selector: string) => FakeNode | null
  addEventListener: (type: string, handler: (event: unknown) => void) => void
  removeEventListener: (type: string, handler: (event: unknown) => void) => void
  dispatchEvent: (event: { type: string }) => void
}

const hasClass = (node: FakeNode, cls: string) => node.className.split(/\s+/).includes(cls)

function collectByClass(node: FakeNode, cls: string, acc: FakeNode[] = []): FakeNode[] {
  for (const child of node.children) {
    if (hasClass(child, cls)) acc.push(child)
    collectByClass(child, cls, acc)
  }
  return acc
}

function createFakeElement(tagName: string): FakeNode {
  let html = ''
  const node: FakeNode = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    // Mirror the real DOM: assigning innerHTML replaces the children. The
    // module only assigns '' to clear; template strings are never re-parsed
    // by the fake, so storing the raw value is enough.
    get innerHTML() {
      return html
    },
    set innerHTML(value: string) {
      html = value
      if (value === '') {
        for (const child of node.children.splice(0)) child.parentElement = null
      }
    },
    dataset: {},
    attributes: {},
    style: {},
    children: [],
    parentElement: null,
    onpointerdown: null,
    listeners: {},
    focus() {},
    classList: {
      add: (...classes) => {
        const present = node.className.split(/\s+/).filter(Boolean)
        for (const cls of classes) if (!present.includes(cls)) present.push(cls)
        node.className = present.join(' ')
      },
      remove: (...classes) => {
        node.className = node.className
          .split(/\s+/)
          .filter((cls) => cls && !classes.includes(cls))
          .join(' ')
      },
      contains: (cls) => hasClass(node, cls),
    },
    append(...nodes) {
      for (const child of nodes) {
        child.parentElement = node
        node.children.push(child)
      }
    },
    insertBefore(child, reference) {
      child.parentElement = node
      const index = reference ? node.children.indexOf(reference) : -1
      if (index >= 0) node.children.splice(index, 0, child)
      else node.children.push(child)
      return child
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value)
    },
    getAttribute(name) {
      return node.attributes[name] ?? null
    },
    removeAttribute(name) {
      delete node.attributes[name]
    },
    remove() {
      const parent = node.parentElement
      if (!parent) return
      const index = parent.children.indexOf(node)
      if (index >= 0) parent.children.splice(index, 1)
      node.parentElement = null
    },
    querySelector(selector) {
      // innerHTML is not parsed in the fake DOM, so the name/description
      // spans the module fills in are found (or provisioned) directly.
      if (selector === '.quickforge-command-suggestion-name' || selector === '.quickforge-command-suggestion-description') {
        const cls = selector.slice(1)
        const child = node.children.find((c) => hasClass(c, cls))
        if (child) return child
        const created = createFakeElement('span')
        created.className = cls
        node.children.push(created)
        created.parentElement = node
        return created
      }
      if (selector.startsWith('.')) {
        return collectByClass(node, selector.slice(1))[0] ?? null
      }
      const byTag = (current: FakeNode): FakeNode | null => {
        for (const child of current.children) {
          if (child.tagName === selector.toUpperCase()) return child
          const nested = byTag(child)
          if (nested) return nested
        }
        return null
      }
      return byTag(node)
    },
    querySelectorAll(selector) {
      if (!selector.startsWith('.')) return []
      return collectByClass(node, selector.slice(1))
    },
    contains(target) {
      let current = (target && typeof target === 'object' ? target : null) as FakeNode | null
      while (current) {
        if (current === node) return true
        current = current.parentElement
      }
      return false
    },
    closest(selector) {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1)
        let current: FakeNode | null = node
        while (current) {
          if (hasClass(current, cls)) return current
          current = current.parentElement
        }
        return null
      }
      let current: FakeNode | null = node
      while (current) {
        if (current.tagName === selector.toUpperCase()) return current
        current = current.parentElement
      }
      return null
    },
    addEventListener(type, handler) {
      node.listeners[type] = [...(node.listeners[type] ?? []), handler]
    },
    removeEventListener(type, handler) {
      node.listeners[type] = (node.listeners[type] ?? []).filter((h) => h !== handler)
    },
    dispatchEvent(event) {
      for (const handler of [...(node.listeners[event.type] ?? [])]) handler(event)
    },
  }
  return node
}

const customCommands: CustomCommandSummary[] = [
  { name: 'deploy', description: 'Ship the project', argumentHint: '' },
]

const catalog: SlashCatalog = {
  skills: [{ name: 'skill-creator', description: 'Create and evaluate skills' }],
  agents: [{ name: 'explore', label: '只读调研', description: 'Locate files and call chains' }],
}

type Harness = {
  panel: FakeNode
  shell: FakeNode
  editor: FakeNode
  textarea: FakeNode
  instance: ReturnType<typeof createCommandSuggestions>
  restoreDraftIntoComposer: ReturnType<typeof vi.fn>
  setText: (text: string) => void
  menu: () => FakeNode | null
  overlay: () => FakeNode | null
  optionRows: () => FakeNode[]
  skeletonRows: () => FakeNode[]
  heads: () => FakeNode[]
  keydown: (key: string, extra?: Record<string, unknown>) => FakeEvent
  clickRow: (row: FakeNode) => void
}

function createHarness(loadSlashCatalog?: () => Promise<SlashCatalog | null>): Harness {
  const textarea = createFakeElement('textarea')
  textarea.value = ''
  textarea.selectionStart = 0
  textarea.selectionEnd = 0

  const editor = createFakeElement('message-editor')
  editor.value = ''
  editor.attachments = []
  editor.append(textarea)

  // The composer shell hosts the slash chip overlay (position:relative anchor).
  const shell = createFakeElement('div')
  shell.className = 'quickforge-composer-shell'
  shell.append(editor)

  const panel = createFakeElement('div')
  panel.append(shell)
  const baseQuerySelector = panel.querySelector
  panel.querySelector = (selector: string) => {
    if (selector === 'message-editor') return editor
    if (selector === 'message-editor textarea') return textarea
    return baseQuerySelector(selector)
  }

  const restoreDraftIntoComposer = vi.fn()
  const instance = createCommandSuggestions({
    panel: panel as unknown as HTMLElement,
    getCustomCommands: () => customCommands,
    getComposerDrafts: () => new Map(),
    sessionId: 's1',
    setComposerDrafts: () => {},
    restoreDraftIntoComposer,
    loadSlashCatalog,
  })
  instance.setupTextareaHandler(editor as unknown as MessageEditorElement)

  const commandTextarea = textarea as unknown as CommandTextareaElement
  const keydown = (key: string, extra: Record<string, unknown> = {}) => {
    const event = {
      key,
      shiftKey: false,
      isComposing: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      ...extra,
    }
    commandTextarea.__quickforgeCommandCompleteHandler?.(event as unknown as KeyboardEvent)
    return event
  }

  return {
    panel,
    shell,
    editor,
    textarea,
    instance,
    restoreDraftIntoComposer,
    setText(text: string) {
      editor.value = text
      textarea.value = text
      textarea.selectionStart = text.length
      textarea.selectionEnd = text.length
    },
    menu: () => panel.querySelector('.quickforge-command-suggestions'),
    overlay: () => shell.querySelector('.quickforge-slash-overlay'),
    optionRows: () => (panel.querySelector('.quickforge-command-suggestions')?.children ?? [])
      .filter((child) => hasClass(child, 'quickforge-command-suggestion-item') && child.tagName === 'BUTTON'),
    skeletonRows: () => (panel.querySelector('.quickforge-command-suggestions')?.children ?? [])
      .filter((child) => hasClass(child, 'quickforge-command-suggestion-item-skeleton')),
    heads: () => (panel.querySelector('.quickforge-command-suggestions')?.children ?? [])
      .filter((child) => hasClass(child, 'quickforge-command-suggestion-group-head')),
    keydown,
    clickRow(row: FakeNode) {
      row.onpointerdown?.({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      })
    },
  }
}

const deferred = () => {
  let resolve!: (value: SlashCatalog | null) => void
  const promise = new Promise<SlashCatalog | null>((r) => { resolve = r })
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const rowDescription = (row: FakeNode) =>
  row.querySelector('.quickforge-command-suggestion-description')!.textContent

const rowName = (row: FakeNode) =>
  row.querySelector('.quickforge-command-suggestion-name')!

describe('command suggestions slash menu', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: createFakeElement,
      createTextNode: (text: string) => {
        const node = createFakeElement('#text')
        node.textContent = text
        return node
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders commands plus loading skeletons and starts one catalog load on "/"', async () => {
    const pending = deferred()
    const loadSlashCatalog = vi.fn(() => pending.promise)
    const { instance, setText, menu, optionRows, skeletonRows, heads } = createHarness(loadSlashCatalog)

    setText('/')
    instance.update('/')

    expect(loadSlashCatalog).toHaveBeenCalledTimes(1)
    expect(menu()).not.toBeNull()
    expect(menu()!.getAttribute('role')).toBe('listbox')
    expect(menu()!.getAttribute('aria-busy')).toBe('true')
    // 7 built-in commands + 1 project custom command.
    expect(optionRows()).toHaveLength(8)
    expect(optionRows()[0].dataset.quickforgeCommandName).toBe('init')
    expect(optionRows()[7].dataset.quickforgeCommandName).toBe('deploy')
    // Skills / subagents show a group head + 2 skeleton rows each while loading.
    expect(heads()).toHaveLength(3)
    expect(skeletonRows()).toHaveLength(4)
    expect(skeletonRows().every((row) => row.dataset.skeleton !== undefined)).toBe(true)

    pending.resolve(catalog)
    await flush()
    expect(loadSlashCatalog).toHaveBeenCalledTimes(1)
  })

  it('re-renders grouped rows with counts once the catalog resolves', async () => {
    const pending = deferred()
    const { instance, setText, optionRows, heads, menu } = createHarness(() => pending.promise)

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    expect(menu()!.getAttribute('aria-busy')).toBeNull()
    const labels = heads().map((head) => head.children[0].textContent)
    const counts = heads().map((head) => head.children[1].textContent)
    expect(labels).toEqual(['slashGroupCommands', 'slashGroupSkills', 'slashGroupAgents'])
    expect(counts).toEqual(['8', '1', '1'])

    const skillRow = optionRows().find((row) => row.dataset.quickforgeCommandName === 'skill-creator')
    expect(skillRow).toBeDefined()
    expect(skillRow!.dataset.quickforgeInsert).toBe('/skill skill-creator ')
    expect(rowDescription(skillRow!)).toBe('Create and evaluate skills')

    const agentRow = optionRows().find((row) => row.dataset.quickforgeCommandName === 'explore')
    expect(agentRow).toBeDefined()
    expect(agentRow!.dataset.quickforgeInsert).toBe('/agent explore ')
    expect(rowDescription(agentRow!)).toBe('只读调研 · Locate files and call chains')
  })

  it('filters rows by query and bolds the matched segment', async () => {
    const pending = deferred()
    const { instance, setText, optionRows, heads } = createHarness(() => pending.promise)

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    setText('/sk')
    instance.update('/sk')

    const rows = optionRows()
    // '/sk' matches /skill skill-creator and also /plan [task] — the usage
    // haystack includes the argument hint.
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.dataset.quickforgeCommandName)).toEqual(['plan', 'skill-creator'])
    expect(heads().map((head) => head.children[0].textContent)).toEqual(['slashGroupCommands', 'slashGroupSkills'])
    const skillRow = rows[1]
    const name = rowName(skillRow)
    const bold = name.children.find((child) => child.tagName === 'B')
    expect(bold).toBeDefined()
    expect(bold!.textContent).toBe('sk')

    setText('/agent ')
    instance.update('/agent ')
    const agentRows = optionRows()
    expect(agentRows).toHaveLength(1)
    expect(agentRows[0].dataset.quickforgeCommandName).toBe('explore')
    expect(heads().map((head) => head.children[0].textContent)).toEqual(['slashGroupAgents'])
  })

  it('inserts the full usage text with a trailing space on row click', async () => {
    const pending = deferred()
    const { instance, setText, optionRows, restoreDraftIntoComposer } = createHarness(() => pending.promise)

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    const skillRow = optionRows().find((row) => row.dataset.quickforgeCommandName === 'skill-creator')
    skillRow!.onpointerdown?.({ preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() })

    expect(restoreDraftIntoComposer).toHaveBeenCalledTimes(1)
    expect(restoreDraftIntoComposer.mock.calls[0][0]).toEqual({
      text: '/skill skill-creator ',
      attachments: [],
      contextReferences: [],
      selectedCapabilities: [],
    })
  })

  it('supports arrow navigation, Tab completion, Escape close, and Enter passthrough', async () => {
    const pending = deferred()
    const { instance, setText, optionRows, menu, keydown, restoreDraftIntoComposer } = createHarness(() => pending.promise)

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    const rows = optionRows()
    // Initial active row is the first one (aria-selected).
    expect(rows[0].getAttribute('aria-selected')).toBe('true')
    expect(rows[1].getAttribute('aria-selected')).toBeNull()

    const down = keydown('ArrowDown')
    expect(down.preventDefault).toHaveBeenCalledTimes(1)
    expect(rows[0].getAttribute('aria-selected')).toBeNull()
    expect(rows[1].getAttribute('aria-selected')).toBe('true')

    keydown('ArrowUp')
    expect(rows[0].getAttribute('aria-selected')).toBe('true')
    expect(rows[1].getAttribute('aria-selected')).toBeNull()

    // Tab completes the active (first) row: /init.
    const tab = keydown('Tab')
    expect(tab.preventDefault).toHaveBeenCalledTimes(1)
    expect(tab.stopPropagation).toHaveBeenCalledTimes(1)
    expect(restoreDraftIntoComposer).toHaveBeenCalledTimes(1)
    expect(restoreDraftIntoComposer.mock.calls[0][0]).toMatchObject({ text: '/init ' })

    // Re-open after the Tab completion removed the menu, then Escape closes it.
    setText('/')
    instance.update('/')
    expect(menu()).not.toBeNull()
    const escape = keydown('Escape')
    expect(escape.preventDefault).not.toHaveBeenCalled()
    expect(menu()).toBeNull()

    // Enter is never intercepted: the composer sends the raw text.
    setText('/')
    instance.update('/')
    const enter = keydown('Enter')
    expect(enter.preventDefault).not.toHaveBeenCalled()
    expect(menu()).not.toBeNull()
  })

  it('degrades to commands-only on rejection and retries once after reopening', async () => {
    const loadSlashCatalog = vi.fn(() => Promise.reject(new Error('boom')))
    const { instance, setText, optionRows, skeletonRows, heads, menu } = createHarness(loadSlashCatalog)

    setText('/')
    instance.update('/')
    await flush()

    // No throw; the menu shows only the commands group.
    expect(menu()).not.toBeNull()
    expect(optionRows()).toHaveLength(8)
    expect(skeletonRows()).toHaveLength(0)
    expect(heads()).toHaveLength(1)
    expect(loadSlashCatalog).toHaveBeenCalledTimes(1)

    // Staying within the same open menu never retries.
    setText('/de')
    instance.update('/de')
    await flush()
    expect(loadSlashCatalog).toHaveBeenCalledTimes(1)

    // Closing (non-"/" text) and reopening retries exactly once.
    setText('plain text')
    instance.update('plain text')
    expect(menu()).toBeNull()
    setText('/')
    instance.update('/')
    expect(loadSlashCatalog).toHaveBeenCalledTimes(2)
  })

  it('removes the menu for non-slash text', async () => {
    const pending = deferred()
    const { instance, setText, menu } = createHarness(() => pending.promise)

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()
    expect(menu()).not.toBeNull()

    setText('hello world')
    instance.update('hello world')
    expect(menu()).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Slash 选中态 chip（方案 A）
  // -------------------------------------------------------------------------

  /** 模拟真实 restoreComposerDraft：写回文本并同步触发一次 input → update。 */
  const wireDraftRestore = (h: Harness) => {
    h.restoreDraftIntoComposer.mockImplementation((draft: { text: string }) => {
      h.setText(draft.text)
      h.instance.update(draft.text)
    })
  }

  it('engages the chip when an agent row is selected and suppresses the menu', async () => {
    const pending = deferred()
    const h = createHarness(() => pending.promise)
    wireDraftRestore(h)
    const { instance, setText, optionRows, menu, overlay, textarea } = h

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    const agentRow = optionRows().find((row) => row.dataset.quickforgeCommandName === 'explore')
    h.clickRow(agentRow!)

    expect(h.restoreDraftIntoComposer).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe('/agent explore ')
    expect(overlay()).not.toBeNull()
    expect(menu()).toBeNull()
    expect(textarea.classList.contains('quickforge-slash-source-text')).toBe(true)

    // 继续输入任务文本：chip 保持，菜单不再弹出。
    setText('/agent explore fix the bug')
    instance.update('/agent explore fix the bug')
    expect(overlay()).not.toBeNull()
    expect(menu()).toBeNull()
  })

  it('does not engage the chip for command rows', async () => {
    const pending = deferred()
    const h = createHarness(() => pending.promise)
    wireDraftRestore(h)
    const { instance, setText, optionRows, overlay } = h

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    h.clickRow(optionRows()[0]) // /init
    expect(h.restoreDraftIntoComposer.mock.calls[0][0]).toMatchObject({ text: '/init ' })
    expect(overlay()).toBeNull()
  })

  it('auto-engages a fully typed command once the catalog is ready', async () => {
    const pending = deferred()
    const { instance, setText, menu, overlay } = createHarness(() => pending.promise)

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    setText('/skill skill-creator ')
    instance.update('/skill skill-creator ')
    expect(overlay()).not.toBeNull()
    expect(menu()).toBeNull()
  })

  it('Backspace at the chip boundary removes the whole prefix', async () => {
    const pending = deferred()
    const h = createHarness(() => pending.promise)
    wireDraftRestore(h)
    const { instance, setText, optionRows, textarea, keydown } = h

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    const skillRow = optionRows().find((row) => row.dataset.quickforgeCommandName === 'skill-creator')
    h.clickRow(skillRow!)
    expect(textarea.value).toBe('/skill skill-creator ')

    setText('/skill skill-creator do things')
    instance.update('/skill skill-creator do things')
    // 光标在 chip 右边界（cmd.length）。
    textarea.selectionStart = '/skill skill-creator'.length
    textarea.selectionEnd = '/skill skill-creator'.length
    const backspace = keydown('Backspace')
    expect(backspace.preventDefault).toHaveBeenCalledTimes(1)
    expect(backspace.stopPropagation).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe('do things')

    // 光标不在边界时退格按原生行为放行。
    setText('/skill skill-creator do things')
    instance.update('/skill skill-creator do things')
    const passthrough = keydown('Backspace')
    expect(passthrough.preventDefault).not.toHaveBeenCalled()
    expect(textarea.value).toBe('/skill skill-creator do things')
  })

  it('Escape exits the chip keeping the text and the prefix stays dismissed', async () => {
    const pending = deferred()
    const h = createHarness(() => pending.promise)
    wireDraftRestore(h)
    const { instance, setText, optionRows, menu, overlay, textarea, keydown } = h

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    const agentRow = optionRows().find((row) => row.dataset.quickforgeCommandName === 'explore')
    h.clickRow(agentRow!)
    expect(overlay()).not.toBeNull()

    setText('/agent explore task')
    instance.update('/agent explore task')
    keydown('Escape')
    expect(overlay()).toBeNull()
    expect(textarea.value).toBe('/agent explore task')

    // 同前缀继续输入不再自动 engage（Esc 的 dismissed 语义）。
    setText('/agent explore task continues')
    instance.update('/agent explore task continues')
    expect(overlay()).toBeNull()

    // 重新从菜单选中会重置 dismissed。
    setText('/agent ')
    instance.update('/agent ')
    const agentRowAgain = optionRows().find((row) => row.dataset.quickforgeCommandName === 'explore')
    h.clickRow(agentRowAgain!)
    expect(overlay()).not.toBeNull()
    expect(menu()).toBeNull()
  })

  it('editing the prefix self-destructs the chip and the menu can open again', async () => {
    const pending = deferred()
    const h = createHarness(() => pending.promise)
    wireDraftRestore(h)
    const { instance, setText, optionRows, menu, overlay } = h

    setText('/')
    instance.update('/')
    pending.resolve(catalog)
    await flush()

    const agentRow = optionRows().find((row) => row.dataset.quickforgeCommandName === 'explore')
    h.clickRow(agentRow!)
    expect(overlay()).not.toBeNull()

    // 前缀被编辑 → chip 自毁（文本不动），文本仍以 / 开头时菜单恢复可弹。
    setText('/age')
    instance.update('/age')
    expect(overlay()).toBeNull()
    expect(menu()).not.toBeNull()
  })
})
