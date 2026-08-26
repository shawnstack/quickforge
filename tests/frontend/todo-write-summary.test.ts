import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTodoWriteSummaryController,
  extractLatestTodoWriteSnapshot,
} from '../../src/components/chat/panel-decoration/todo-write-summary'

vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    if (!params) return key
    return `${key}:${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}`
  },
}), { virtual: true })

type Listener = (event?: unknown) => void

class FakeClassList {
  constructor(private element: FakeElement) {}
  add(...names: string[]) {
    const current = new Set(this.element.className.split(/\s+/).filter(Boolean))
    names.forEach((name) => current.add(name))
    this.element.className = [...current].join(' ')
  }
  contains(name: string) {
    return this.element.className.split(/\s+/).includes(name)
  }
}

class FakeElement {
  className = ''
  dataset: Record<string, string> = {}
  parentElement: FakeElement | null = null
  children: FakeElement[] = []
  hidden = false
  textContent = ''
  innerHTML = ''
  type = ''
  attributes = new Map<string, string>()
  listeners = new Map<string, Set<Listener>>()
  classList = new FakeClassList(this)

  get firstElementChild() { return this.children[0] ?? null }
  get previousElementSibling() {
    if (!this.parentElement) return null
    return this.parentElement.children[this.parentElement.children.indexOf(this) - 1] ?? null
  }
  get nextElementSibling() {
    if (!this.parentElement) return null
    return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] ?? null
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.remove()
      node.parentElement = this
      this.children.push(node)
    }
  }

  insertBefore(node: FakeElement, reference: FakeElement | null) {
    node.remove()
    node.parentElement = this
    const index = reference ? this.children.indexOf(reference) : -1
    if (index < 0) this.children.push(node)
    else this.children.splice(index, 0, node)
    return node
  }

  replaceChildren(...nodes: FakeElement[]) {
    for (const child of this.children) child.parentElement = null
    this.children = []
    this.append(...nodes)
  }

  remove() {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }

  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: Listener) { this.listeners.get(type)?.delete(listener) }
  click() { for (const listener of this.listeners.get('click') ?? []) listener({ currentTarget: this }) }

  matches(selector: string) {
    if (!selector.startsWith('.')) return false
    return this.className.split(/\s+/).includes(selector.slice(1))
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === 'message-list' && this.className === 'message-list') return this
    if (selector === 'message-editor' && this.className === 'message-editor') return this
    if (selector.startsWith('.')) {
      const className = selector.slice(1)
      if (this.className.split(/\s+/).includes(className)) return this
    }
    for (const child of this.children) {
      const match = child.querySelector(selector)
      if (match) return match
    }
    return null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = []
    if (selector.startsWith('.') && this.className.split(/\s+/).includes(selector.slice(1))) matches.push(this)
    for (const child of this.children) matches.push(...child.querySelectorAll(selector))
    return matches
  }
}

const originalDocument = globalThis.document

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new FakeElement() })
})

afterEach(() => {
  vi.stubGlobal('document', originalDocument)
})

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status })
const quickForgeResult = (todos: unknown, options: Record<string, unknown> = {}) => ({
  role: 'toolResult', toolName: 'todo_write', details: { todos }, isError: false, ...options,
})
const openCodeMessages = (id: string, todos: unknown, metadata: Record<string, unknown> = { kind: 'Todo Write' }) => ([
  {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name: 'opencode_tool', arguments: { rawInput: { todos }, __quickforgeAcp: metadata } }],
  },
  { role: 'toolResult', toolCallId: id, toolName: 'opencode_tool', details: { __quickforgeAcp: metadata }, isError: false },
])

describe('extractLatestTodoWriteSnapshot', () => {
  it('extracts QuickForge todo_write details.todos', () => {
    expect(extractLatestTodoWriteSnapshot([
      quickForgeResult([todo('Research', 'in_progress'), todo('Test', 'pending')]),
    ])).toEqual({ todos: [todo('Research', 'in_progress'), todo('Test', 'pending')] })
  })

  it('matches OpenCode todowrite metadata and pairs tool results with assistant arguments', () => {
    expect(extractLatestTodoWriteSnapshot(openCodeMessages('todo-1', [todo('Implement', 'completed')], { title: 'TodoWrite' })))
      .toEqual({ todos: [todo('Implement', 'completed')] })
  })

  it('uses assistant metadata when stale result metadata is non-todo', () => {
    const messages = openCodeMessages('todo-stale', [todo('Current', 'in_progress')])
    messages[1].details = { __quickforgeAcp: { title: 'stale' } }
    expect(extractLatestTodoWriteSnapshot(messages)).toEqual({ todos: [todo('Current', 'in_progress')] })
  })

  it('supports top-level OpenCode arguments.todos', () => {
    const messages = openCodeMessages('todo-2', [])
    ;(messages[0].content[0].arguments as Record<string, unknown>).todos = [todo('Verify', 'pending')]
    delete ((messages[0].content[0].arguments as Record<string, unknown>).rawInput as Record<string, unknown>).todos
    expect(extractLatestTodoWriteSnapshot(messages)).toEqual({ todos: [todo('Verify', 'pending')] })
  })

  it('falls back to the previous valid snapshot when a newer candidate is invalid or errored', () => {
    expect(extractLatestTodoWriteSnapshot([
      quickForgeResult([todo('Keep me', 'in_progress')]),
      quickForgeResult([{ content: '', status: 'completed' }]),
      quickForgeResult([todo('Ignore error', 'completed')], { isError: true }),
    ])).toEqual({ todos: [todo('Keep me', 'in_progress')] })
  })
})

function createHarness(initialMessages: unknown[], {
  withEditor = true,
  suggestionMenu,
}: { withEditor?: boolean; suggestionMenu?: 'command' | 'file' } = {}) {
  const scrollContent = new FakeElement()
  const streaming = new FakeElement()
  streaming.className = 'streaming-message-container'
  const messageList = new FakeElement()
  messageList.className = 'message-list'
  scrollContent.append(streaming, messageList)
  const composerDock = new FakeElement()
  composerDock.className = 'quickforge-composer-dock'
  const composerShell = new FakeElement()
  composerShell.className = 'quickforge-composer-shell'
  const menu = suggestionMenu ? new FakeElement() : null
  if (menu) menu.className = suggestionMenu === 'command'
    ? 'quickforge-command-suggestions'
    : 'quickforge-file-reference-suggestions'
  const editor = new FakeElement()
  editor.className = 'message-editor'
  const stats = new FakeElement()
  stats.className = 'composer-stats'
  if (withEditor) composerShell.append(...(menu ? [menu, editor, stats] : [editor, stats]))
  else composerShell.append(stats)
  composerDock.append(composerShell)
  const panel = new FakeElement()
  panel.append(scrollContent, composerDock)
  let messages = initialMessages
  const timers: Array<{ handler: () => void; cleared: boolean }> = []
  const controller = createTodoWriteSummaryController({
    panel: panel as unknown as HTMLElement,
    getMessages: () => messages as never,
    env: {
      setTimeout: (handler) => {
        const timer = { handler, cleared: false }
        timers.push(timer)
        return timer
      },
      clearTimeout: (token) => { (token as { cleared: boolean }).cleared = true },
    },
  })
  return {
    panel,
    scrollContent,
    streaming,
    messageList,
    composerDock,
    composerShell,
    menu,
    editor,
    stats,
    controller,
    timers,
    setMessages(next: unknown[]) { messages = next },
    removeEditor() { editor.remove() },
    removeMenu() { menu?.remove() },
    rebuildShell({ withMenu = false } = {}) {
      const nextShell = new FakeElement()
      nextShell.className = 'quickforge-composer-shell'
      const nextMenu = withMenu ? new FakeElement() : null
      if (nextMenu) nextMenu.className = suggestionMenu === 'file'
        ? 'quickforge-file-reference-suggestions'
        : 'quickforge-command-suggestions'
      const nextEditor = new FakeElement()
      nextEditor.className = 'message-editor'
      const nextStats = new FakeElement()
      nextStats.className = 'composer-stats'
      nextShell.append(...(nextMenu ? [nextMenu, nextEditor, nextStats] : [nextEditor, nextStats]))
      composerShell.remove()
      composerDock.append(nextShell)
      return { nextShell, nextMenu, nextEditor, nextStats }
    },
    rebuildEditor() {
      const nextEditor = new FakeElement()
      nextEditor.className = 'message-editor'
      composerShell.insertBefore(nextEditor, stats)
      return nextEditor
    },
    root() { return panel.querySelector('.quickforge-todo-summary') },
    toggle() { return panel.querySelector('.quickforge-todo-summary-toggle') },
    ring() { return panel.querySelector('.quickforge-todo-summary-ring') },
    body() { return panel.querySelector('.quickforge-todo-summary-body') },
    statsCompact() { return panel.querySelector('.quickforge-todo-summary-stats-compact') },
    updated() { return panel.querySelector('.quickforge-todo-summary-updated') },
  }
}

describe('TodoWrite composer summary controller', () => {
  it('inserts before message-editor in the composer shell and outside the message scroller', () => {
    const harness = createHarness([quickForgeResult([todo('Work', 'in_progress')])])
    harness.controller.update()
    expect(harness.composerShell.children).toEqual([harness.root(), harness.editor, harness.stats])
    expect(harness.root()?.parentElement).toBe(harness.composerShell)
    expect(harness.root()?.parentElement).not.toBe(harness.scrollContent)
    expect(harness.scrollContent.children).toEqual([harness.streaming, harness.messageList])
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('true')
    expect(harness.body()?.hidden).toBe(false)
    expect(harness.root()?.querySelectorAll('.quickforge-todo-summary-item')).toHaveLength(1)
  })

  it.each([
    ['command', 'quickforge-command-suggestions'],
    ['file', 'quickforge-file-reference-suggestions'],
  ] as const)('keeps the summary before the %s menu while the menu stays adjacent to the editor', (suggestionMenu, menuClass) => {
    const harness = createHarness([quickForgeResult([todo('Work', 'in_progress')])], { suggestionMenu })
    harness.controller.update()

    expect(harness.composerShell.children).toEqual([harness.root(), harness.menu, harness.editor, harness.stats])
    expect(harness.root()?.nextElementSibling).toBe(harness.menu)
    expect(harness.editor.previousElementSibling).toBe(harness.menu)
    expect(harness.menu?.matches(`.${menuClass}`)).toBe(true)

    // Controller updates must not move the summary between the menu and editor.
    harness.controller.update()
    expect(harness.composerShell.children).toEqual([harness.root(), harness.menu, harness.editor, harness.stats])
  })

  it.each(['command', 'file'] as const)('returns the summary to immediately before the editor after the %s menu is removed', (suggestionMenu) => {
    const harness = createHarness([quickForgeResult([todo('Work', 'in_progress')])], { suggestionMenu })
    harness.controller.update()
    harness.removeMenu()
    harness.controller.update()

    expect(harness.composerShell.children).toEqual([harness.root(), harness.editor, harness.stats])
    expect(harness.editor.previousElementSibling).toBe(harness.root())
  })

  it('preserves state and placement when the composer shell is rebuilt', () => {
    const harness = createHarness([quickForgeResult([todo('Work', 'in_progress')])], { suggestionMenu: 'file' })
    harness.controller.update()
    harness.toggle()?.click()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('false')

    const { nextShell, nextMenu, nextEditor, nextStats } = harness.rebuildShell({ withMenu: true })
    harness.controller.update()

    expect(nextShell.children).toEqual([harness.root(), nextMenu, nextEditor, nextStats])
    expect(nextEditor.previousElementSibling).toBe(nextMenu)
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('does not display when message-editor is missing', () => {
    const harness = createHarness([quickForgeResult([todo('Work', 'in_progress')])], { withEditor: false })
    harness.controller.update()
    expect(harness.root()).toBeNull()
  })

  it('removes the displayed summary when message-editor disappears without resetting user state', () => {
    const harness = createHarness([quickForgeResult([todo('Work', 'in_progress')])])
    harness.controller.update()
    harness.toggle()?.click()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('false')

    harness.removeEditor()
    harness.controller.update()
    expect(harness.root()).toBeNull()

    const rebuiltEditor = harness.rebuildEditor()
    harness.controller.update()
    expect(harness.composerShell.children).toEqual([harness.root(), rebuiltEditor, harness.stats])
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('self-heals after the composer editor is rebuilt and preserves a manually expanded state', () => {
    const harness = createHarness([quickForgeResult([todo('Done', 'completed')])])
    harness.controller.update()
    harness.toggle()?.click()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('true')

    harness.removeEditor()
    harness.controller.update()
    const rebuiltEditor = harness.rebuildEditor()
    harness.controller.update()
    expect(harness.composerShell.children).toEqual([harness.root(), rebuiltEditor, harness.stats])
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('starts collapsed when the first snapshot is fully completed', () => {
    const harness = createHarness([quickForgeResult([todo('Done', 'completed')])])
    harness.controller.update()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('false')
    expect(harness.body()?.hidden).toBe(true)
  })

  it('keeps the user collapsed after a new unfinished snapshot and briefly marks it updated', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'in_progress')])])
    harness.controller.update()
    harness.toggle()?.click()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('false')

    harness.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([todo('One', 'completed'), todo('Two', 'pending')]),
    ])
    harness.controller.update()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('false')
    expect(harness.updated()?.hidden).toBe(false)
    expect(harness.timers).toHaveLength(1)
    harness.timers[0].handler()
    expect(harness.updated()?.hidden).toBe(true)
  })

  it('marks a newer tool snapshot updated even when its todo content is unchanged', () => {
    const sameTodos = [todo('Stable', 'in_progress')]
    const harness = createHarness([quickForgeResult(sameTodos, { toolCallId: 'first' })])
    harness.controller.update()
    harness.setMessages([
      quickForgeResult(sameTodos, { toolCallId: 'first' }),
      quickForgeResult(sameTodos, { toolCallId: 'second' }),
    ])
    harness.controller.update()
    expect(harness.updated()?.hidden).toBe(false)
    expect(harness.timers).toHaveLength(1)
  })

  it('auto-collapses every fully completed snapshot and allows the user to reopen it', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'in_progress')])])
    harness.controller.update()
    harness.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([todo('One', 'completed')]),
    ])
    harness.controller.update()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('false')
    harness.toggle()?.click()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('resets after an explicit empty snapshot', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'in_progress')])])
    harness.controller.update()
    harness.toggle()?.click()
    harness.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([]),
    ])
    harness.controller.update()
    expect(harness.root()).toBeNull()

    harness.setMessages([quickForgeResult([todo('Fresh', 'pending')])])
    harness.controller.update()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('removes and resets on rollback to no snapshot', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'in_progress')])])
    harness.controller.update()
    harness.toggle()?.click()
    harness.setMessages([])
    harness.controller.update()
    expect(harness.root()).toBeNull()

    harness.setMessages([quickForgeResult([todo('Fresh', 'pending')])])
    harness.controller.update()
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('cleanup clears timers, listeners, and DOM', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'in_progress')])])
    harness.controller.update()
    harness.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([todo('One', 'pending')]),
    ])
    harness.controller.update()
    const toggle = harness.toggle()
    harness.controller.cleanup()
    expect(harness.root()).toBeNull()
    expect(harness.timers[0]?.cleared).toBe(true)
    expect(toggle?.listeners.get('click')?.size ?? 0).toBe(0)
  })
})

describe('TodoWrite capsule structure', () => {
  it('wraps the toggle in a row and renders ring, dual stats, spacer, and chevron in order', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'in_progress'), todo('Two', 'pending')])])
    harness.controller.update()

    expect(harness.root()?.children.map((child) => child.className)).toEqual([
      'quickforge-todo-summary-toggle-row',
      'quickforge-todo-summary-body',
    ])
    expect(harness.toggle()?.children.map((child) => child.className)).toEqual([
      'quickforge-todo-summary-ring',
      'quickforge-todo-summary-heading',
      'quickforge-todo-summary-stats',
      'quickforge-todo-summary-stats-compact',
      'quickforge-todo-summary-updated',
      'quickforge-todo-summary-spacer',
      'quickforge-todo-summary-chevron',
    ])
    expect(harness.ring()?.getAttribute('aria-hidden')).toBe('true')
    expect(harness.root()?.querySelector('.quickforge-todo-summary-spacer')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows the aria-hidden compact count and drives the progress arc from completion', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'completed'), todo('Two', 'in_progress')])])
    harness.controller.update()

    expect(harness.statsCompact()?.textContent).toBe('1/2')
    expect(harness.statsCompact()?.getAttribute('aria-hidden')).toBe('true')
    expect(harness.ring()?.getAttribute('style')).toBe('--quickforge-todo-ring-offset: 28.27')
    expect(harness.root()?.dataset.complete).toBe('false')
    expect(harness.root()?.dataset.running).toBe('true')
  })

  it('marks completion and zeroes the arc when every todo is completed', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'completed')])])
    harness.controller.update()

    expect(harness.root()?.dataset.complete).toBe('true')
    expect(harness.root()?.dataset.running).toBe('false')
    expect(harness.ring()?.getAttribute('style')).toBe('--quickforge-todo-ring-offset: 0.00')
    expect(harness.toggle()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('wraps the list in the collapsible body inner container', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'in_progress')])])
    harness.controller.update()

    expect(harness.body()?.children.map((child) => child.className)).toEqual(['quickforge-todo-summary-body-inner'])
    expect(harness.root()?.querySelectorAll('.quickforge-todo-summary-item')).toHaveLength(1)
  })

  it('keeps the persistent toggle structure and advances the arc across snapshot updates', () => {
    const harness = createHarness([quickForgeResult([todo('One', 'in_progress')])])
    harness.controller.update()
    const firstRing = harness.ring()
    const firstToggle = harness.toggle()
    expect(firstRing?.getAttribute('style')).toBe('--quickforge-todo-ring-offset: 56.55')

    harness.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([todo('One', 'completed')]),
    ])
    harness.controller.update()

    expect(harness.ring()).toBe(firstRing)
    expect(harness.toggle()).toBe(firstToggle)
    expect(firstRing?.getAttribute('style')).toBe('--quickforge-todo-ring-offset: 0.00')
  })
})
