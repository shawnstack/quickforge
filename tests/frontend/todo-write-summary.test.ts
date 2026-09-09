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

describe('extractLatestTodoWriteSnapshot', () => {
  it('extracts QuickForge todo_write details.todos', () => {
    expect(extractLatestTodoWriteSnapshot([
      quickForgeResult([todo('Research', 'in_progress'), todo('Test', 'pending')]),
    ])).toEqual({ todos: [todo('Research', 'in_progress'), todo('Test', 'pending')] })
  })

  it('falls back to the previous valid snapshot when a newer candidate is invalid or errored', () => {
    expect(extractLatestTodoWriteSnapshot([
      quickForgeResult([todo('Keep me', 'in_progress')]),
      quickForgeResult([{ content: '', status: 'completed' }]),
      quickForgeResult([todo('Ignore error', 'completed')], { isError: true }),
    ])).toEqual({ todos: [todo('Keep me', 'in_progress')] })
  })
})

function createEnv(initialMessages: unknown[], {
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
    const env = createEnv([quickForgeResult([todo('Work', 'in_progress')])])
    env.controller.update()
    expect(env.composerShell.children).toEqual([env.root(), env.editor, env.stats])
    expect(env.root()?.parentElement).toBe(env.composerShell)
    expect(env.root()?.parentElement).not.toBe(env.scrollContent)
    expect(env.scrollContent.children).toEqual([env.streaming, env.messageList])
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('true')
    expect(env.body()?.hidden).toBe(false)
    expect(env.root()?.querySelectorAll('.quickforge-todo-summary-item')).toHaveLength(1)
  })

  it.each([
    ['command', 'quickforge-command-suggestions'],
    ['file', 'quickforge-file-reference-suggestions'],
  ] as const)('keeps the summary before the %s menu while the menu stays adjacent to the editor', (suggestionMenu, menuClass) => {
    const env = createEnv([quickForgeResult([todo('Work', 'in_progress')])], { suggestionMenu })
    env.controller.update()

    expect(env.composerShell.children).toEqual([env.root(), env.menu, env.editor, env.stats])
    expect(env.root()?.nextElementSibling).toBe(env.menu)
    expect(env.editor.previousElementSibling).toBe(env.menu)
    expect(env.menu?.matches(`.${menuClass}`)).toBe(true)

    // Controller updates must not move the summary between the menu and editor.
    env.controller.update()
    expect(env.composerShell.children).toEqual([env.root(), env.menu, env.editor, env.stats])
  })

  it.each(['command', 'file'] as const)('returns the summary to immediately before the editor after the %s menu is removed', (suggestionMenu) => {
    const env = createEnv([quickForgeResult([todo('Work', 'in_progress')])], { suggestionMenu })
    env.controller.update()
    env.removeMenu()
    env.controller.update()

    expect(env.composerShell.children).toEqual([env.root(), env.editor, env.stats])
    expect(env.editor.previousElementSibling).toBe(env.root())
  })

  it('preserves state and placement when the composer shell is rebuilt', () => {
    const env = createEnv([quickForgeResult([todo('Work', 'in_progress')])], { suggestionMenu: 'file' })
    env.controller.update()
    env.toggle()?.click()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('false')

    const { nextShell, nextMenu, nextEditor, nextStats } = env.rebuildShell({ withMenu: true })
    env.controller.update()

    expect(nextShell.children).toEqual([env.root(), nextMenu, nextEditor, nextStats])
    expect(nextEditor.previousElementSibling).toBe(nextMenu)
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('does not display when message-editor is missing', () => {
    const env = createEnv([quickForgeResult([todo('Work', 'in_progress')])], { withEditor: false })
    env.controller.update()
    expect(env.root()).toBeNull()
  })

  it('removes the displayed summary when message-editor disappears without resetting user state', () => {
    const env = createEnv([quickForgeResult([todo('Work', 'in_progress')])])
    env.controller.update()
    env.toggle()?.click()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('false')

    env.removeEditor()
    env.controller.update()
    expect(env.root()).toBeNull()

    const rebuiltEditor = env.rebuildEditor()
    env.controller.update()
    expect(env.composerShell.children).toEqual([env.root(), rebuiltEditor, env.stats])
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('self-heals after the composer editor is rebuilt and preserves a manually expanded state', () => {
    const env = createEnv([quickForgeResult([todo('Done', 'completed')])])
    env.controller.update()
    env.toggle()?.click()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('true')

    env.removeEditor()
    env.controller.update()
    const rebuiltEditor = env.rebuildEditor()
    env.controller.update()
    expect(env.composerShell.children).toEqual([env.root(), rebuiltEditor, env.stats])
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('starts collapsed when the first snapshot is fully completed', () => {
    const env = createEnv([quickForgeResult([todo('Done', 'completed')])])
    env.controller.update()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('false')
    expect(env.body()?.hidden).toBe(true)
  })

  it('keeps the user collapsed after a new unfinished snapshot and briefly marks it updated', () => {
    const env = createEnv([quickForgeResult([todo('One', 'in_progress')])])
    env.controller.update()
    env.toggle()?.click()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('false')

    env.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([todo('One', 'completed'), todo('Two', 'pending')]),
    ])
    env.controller.update()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('false')
    expect(env.updated()?.hidden).toBe(false)
    expect(env.timers).toHaveLength(1)
    env.timers[0].handler()
    expect(env.updated()?.hidden).toBe(true)
  })

  it('marks a newer tool snapshot updated even when its todo content is unchanged', () => {
    const sameTodos = [todo('Stable', 'in_progress')]
    const env = createEnv([quickForgeResult(sameTodos, { toolCallId: 'first' })])
    env.controller.update()
    env.setMessages([
      quickForgeResult(sameTodos, { toolCallId: 'first' }),
      quickForgeResult(sameTodos, { toolCallId: 'second' }),
    ])
    env.controller.update()
    expect(env.updated()?.hidden).toBe(false)
    expect(env.timers).toHaveLength(1)
  })

  it('auto-collapses every fully completed snapshot and allows the user to reopen it', () => {
    const env = createEnv([quickForgeResult([todo('One', 'in_progress')])])
    env.controller.update()
    env.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([todo('One', 'completed')]),
    ])
    env.controller.update()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('false')
    env.toggle()?.click()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('resets after an explicit empty snapshot', () => {
    const env = createEnv([quickForgeResult([todo('One', 'in_progress')])])
    env.controller.update()
    env.toggle()?.click()
    env.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([]),
    ])
    env.controller.update()
    expect(env.root()).toBeNull()

    env.setMessages([quickForgeResult([todo('Fresh', 'pending')])])
    env.controller.update()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('removes and resets on rollback to no snapshot', () => {
    const env = createEnv([quickForgeResult([todo('One', 'in_progress')])])
    env.controller.update()
    env.toggle()?.click()
    env.setMessages([])
    env.controller.update()
    expect(env.root()).toBeNull()

    env.setMessages([quickForgeResult([todo('Fresh', 'pending')])])
    env.controller.update()
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('cleanup clears timers, listeners, and DOM', () => {
    const env = createEnv([quickForgeResult([todo('One', 'in_progress')])])
    env.controller.update()
    env.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([todo('One', 'pending')]),
    ])
    env.controller.update()
    const toggle = env.toggle()
    env.controller.cleanup()
    expect(env.root()).toBeNull()
    expect(env.timers[0]?.cleared).toBe(true)
    expect(toggle?.listeners.get('click')?.size ?? 0).toBe(0)
  })
})

describe('TodoWrite capsule structure', () => {
  it('wraps the toggle in a row and renders ring, dual stats, spacer, and chevron in order', () => {
    const env = createEnv([quickForgeResult([todo('One', 'in_progress'), todo('Two', 'pending')])])
    env.controller.update()

    expect(env.root()?.children.map((child) => child.className)).toEqual([
      'quickforge-todo-summary-toggle-row',
      'quickforge-todo-summary-body',
    ])
    expect(env.toggle()?.children.map((child) => child.className)).toEqual([
      'quickforge-todo-summary-ring',
      'quickforge-todo-summary-heading',
      'quickforge-todo-summary-stats',
      'quickforge-todo-summary-stats-compact',
      'quickforge-todo-summary-updated',
      'quickforge-todo-summary-spacer',
      'quickforge-todo-summary-chevron',
    ])
    expect(env.ring()?.getAttribute('aria-hidden')).toBe('true')
    expect(env.root()?.querySelector('.quickforge-todo-summary-spacer')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows the aria-hidden compact count and drives the progress arc from completion', () => {
    const env = createEnv([quickForgeResult([todo('One', 'completed'), todo('Two', 'in_progress')])])
    env.controller.update()

    expect(env.statsCompact()?.textContent).toBe('1/2')
    expect(env.statsCompact()?.getAttribute('aria-hidden')).toBe('true')
    expect(env.ring()?.getAttribute('style')).toBe('--quickforge-todo-ring-offset: 28.27')
    expect(env.root()?.dataset.complete).toBe('false')
    expect(env.root()?.dataset.running).toBe('true')
  })

  it('marks completion and zeroes the arc when every todo is completed', () => {
    const env = createEnv([quickForgeResult([todo('One', 'completed')])])
    env.controller.update()

    expect(env.root()?.dataset.complete).toBe('true')
    expect(env.root()?.dataset.running).toBe('false')
    expect(env.ring()?.getAttribute('style')).toBe('--quickforge-todo-ring-offset: 0.00')
    expect(env.toggle()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('wraps the list in the collapsible body inner container', () => {
    const env = createEnv([quickForgeResult([todo('One', 'in_progress')])])
    env.controller.update()

    expect(env.body()?.children.map((child) => child.className)).toEqual(['quickforge-todo-summary-body-inner'])
    expect(env.root()?.querySelectorAll('.quickforge-todo-summary-item')).toHaveLength(1)
  })

  it('keeps the persistent toggle structure and advances the arc across snapshot updates', () => {
    const env = createEnv([quickForgeResult([todo('One', 'in_progress')])])
    env.controller.update()
    const firstRing = env.ring()
    const firstToggle = env.toggle()
    expect(firstRing?.getAttribute('style')).toBe('--quickforge-todo-ring-offset: 56.55')

    env.setMessages([
      quickForgeResult([todo('One', 'in_progress')]),
      quickForgeResult([todo('One', 'completed')]),
    ])
    env.controller.update()

    expect(env.ring()).toBe(firstRing)
    expect(env.toggle()).toBe(firstToggle)
    expect(firstRing?.getAttribute('style')).toBe('--quickforge-todo-ring-offset: 0.00')
  })
})
