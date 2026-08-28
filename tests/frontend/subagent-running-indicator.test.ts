import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubagentRunPayload, SubagentRunStatus } from '../../src/lib/subagent-run-detail'
import { SubagentRunStore } from '../../src/lib/subagent-run-detail'

vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    const values: Record<string, string> = {
      subagentRunningIndicatorTriggerLabel: 'Running',
      subagentRunningIndicatorTriggerAria: `${params?.count} subagents running`,
      subagentRunningIndicatorMenuTitle: `Running subagents · ${params?.count}`,
      subagentRunningIndicatorMenuAria: 'Running subagents',
      subagentRunningIndicatorItemAria: `Open ${params?.name}: ${params?.task}`,
      subagentRunningIndicatorElapsed: `${params?.seconds}s`,
    }
    return values[key] ?? key
  },
}))

class FakeElement {
  tagName: string
  className = ''
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  textContent: string | null = null
  type = ''
  offsetHeight = 160
  onclick: ((event: FakeEvent) => void) | null = null
  onpointerdown: ((event: FakeEvent) => void) | null = null
  onkeydown: ((event: FakeKeyboardEvent) => void) | null = null
  private listeners = new Map<string, Set<(event: FakeEvent) => void>>()

  constructor(tag = 'div') {
    this.tagName = tag
  }

  get nextSibling(): FakeElement | null {
    if (!this.parentElement) return null
    const index = this.parentElement.children.indexOf(this)
    return this.parentElement.children[index + 1] ?? null
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.remove()
      node.parentElement = this
      this.children.push(node)
    }
  }

  insertBefore(node: FakeElement, reference: FakeElement | null) {
    if (node === reference) return node
    node.remove()
    const index = reference ? this.children.indexOf(reference) : -1
    node.parentElement = this
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

  contains(target: unknown): boolean {
    if (target === this) return true
    return this.children.some((child) => child.contains(target))
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  matches(selector: string): boolean {
    if (!selector.startsWith('.')) return this.tagName === selector
    return this.className.split(/\s+/).includes(selector.slice(1))
  }

  querySelector(selector: string): FakeElement | null {
    if (this.matches(selector)) return this
    for (const child of this.children) {
      const found = child.querySelector(selector)
      if (found) return found
    }
    return null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = []
    if (this.matches(selector)) matches.push(this)
    for (const child of this.children) matches.push(...child.querySelectorAll(selector))
    return matches
  }

  getBoundingClientRect() {
    return { left: 100, top: 500, width: 100, height: 32, right: 200, bottom: 532 }
  }
}

class FakeEvent {
  target: unknown
  defaultPrevented = false

  constructor(target?: unknown) {
    this.target = target
  }

  preventDefault() { this.defaultPrevented = true }
  stopPropagation() {}
}

class FakeKeyboardEvent extends FakeEvent {
  key: string

  constructor(key: string, target?: unknown) {
    super(target)
    this.key = key
  }
}

class FakeCustomEvent<T = unknown> {
  type: string
  detail: T

  constructor(type: string, init: { detail: T }) {
    this.type = type
    this.detail = init.detail
  }
}

function payload(runId: string, status: SubagentRunStatus, overrides: Partial<SubagentRunPayload> = {}): SubagentRunPayload {
  return {
    runId,
    canonicalToolCallId: runId,
    name: 'explore',
    label: 'Explore',
    task: `Task ${runId}`,
    context: '',
    expectedOutput: '',
    status,
    statusLabel: status,
    timing: { startedAt: Date.now() - 5000 },
    allowedTools: [],
    traceMessages: [],
    tools: [],
    pendingToolCalls: [],
    input: '',
    details: '',
    output: '',
    errorMessage: '',
    detailed: false,
    fingerprint: `${runId}:${status}`,
    ...overrides,
  }
}

function buildDom() {
  const body = new FakeElement('body')
  const panel = new FakeElement('pi-chat-panel')
  const leftControls = new FakeElement()
  const access = new FakeElement('button')
  access.className = 'quickforge-agent-access-inline'
  const plan = new FakeElement('button')
  plan.className = 'quickforge-plan-inline'
  leftControls.append(access, plan)
  panel.append(leftControls)
  body.append(panel)

  const documentListeners = new Map<string, Set<(event: FakeEvent) => void>>()
  const windowListeners = new Map<string, Set<(event: FakeCustomEvent) => void>>()
  const document = {
    body,
    createElement: (tag: string) => new FakeElement(tag),
    querySelector: (selector: string) => body.querySelector(selector),
    addEventListener: (type: string, listener: (event: FakeEvent) => void) => {
      const listeners = documentListeners.get(type) ?? new Set()
      listeners.add(listener)
      documentListeners.set(type, listeners)
    },
    removeEventListener: (type: string, listener: (event: FakeEvent) => void) => {
      documentListeners.get(type)?.delete(listener)
    },
  }
  const windowObject = {
    innerWidth: 1200,
    innerHeight: 800,
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    addEventListener: (type: string, listener: (event: FakeCustomEvent) => void) => {
      const listeners = windowListeners.get(type) ?? new Set()
      listeners.add(listener)
      windowListeners.set(type, listeners)
    },
    removeEventListener: (type: string, listener: (event: FakeCustomEvent) => void) => {
      windowListeners.get(type)?.delete(listener)
    },
    dispatchEvent: (event: FakeCustomEvent) => {
      for (const listener of windowListeners.get(event.type) ?? []) listener(event)
      return true
    },
  }
  return { body, panel, leftControls, access, plan, document, windowObject, windowListeners }
}

async function loadModule() {
  return import('../../src/components/chat/panel-decoration/subagent-running-indicator')
}

const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const decorationSource = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
const indicatorSource = readFileSync(new URL('../../src/components/chat/panel-decoration/subagent-running-indicator.ts', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('CustomEvent', FakeCustomEvent)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('getRunningSubagentRuns', () => {
  it('only returns running snapshots referenced by the current session pending ids', async () => {
    const { getRunningSubagentRuns } = await loadModule()
    const store = new SubagentRunStore()
    store.publish(payload('current-running', 'running'))
    store.publish(payload('current-done', 'done'))
    store.publish(payload('other-session', 'running'))

    expect(getRunningSubagentRuns(['current-done', 'current-running', 'missing'], store).map((run) => run.runId))
      .toEqual(['current-running'])
  })
})

describe('subagent running Composer indicator', () => {
  it('renders nothing for zero running items', async () => {
    const dom = buildDom()
    vi.stubGlobal('document', dom.document)
    vi.stubGlobal('window', dom.windowObject)
    const { setupSubagentRunningIndicator } = await loadModule()

    setupSubagentRunningIndicator({
      panel: dom.panel as unknown as HTMLElement,
      leftControls: dom.leftControls as unknown as HTMLElement,
      enabled: true,
      getPendingToolCalls: () => [],
      dismissComposerMenus: vi.fn(),
      store: new SubagentRunStore(),
    })

    expect(dom.panel.querySelector('.quickforge-subagent-running-trigger')).toBeNull()
  })

  it('renders multiple runs after access and before plan', async () => {
    const dom = buildDom()
    vi.stubGlobal('document', dom.document)
    vi.stubGlobal('window', dom.windowObject)
    const store = new SubagentRunStore()
    store.publish(payload('run-1', 'running'))
    store.publish(payload('run-2', 'running'))
    const { setupSubagentRunningIndicator } = await loadModule()

    setupSubagentRunningIndicator({
      panel: dom.panel as unknown as HTMLElement,
      leftControls: dom.leftControls as unknown as HTMLElement,
      enabled: true,
      getPendingToolCalls: () => new Set(['run-1', 'run-2']),
      dismissComposerMenus: vi.fn(),
      store,
    })

    const trigger = dom.panel.querySelector('.quickforge-subagent-running-trigger')!
    expect(dom.leftControls.children).toEqual([dom.access, trigger, dom.plan])
    expect(trigger.querySelector('.quickforge-subagent-running-count')!.textContent).toBe('2')
    expect(trigger.querySelector('.quickforge-subagent-running-trigger-label')!.textContent).toBe('Running')

    const spinner = trigger.querySelector('.quickforge-subagent-running-spinner')
    setupSubagentRunningIndicator({
      panel: dom.panel as unknown as HTMLElement,
      leftControls: dom.leftControls as unknown as HTMLElement,
      enabled: true,
      getPendingToolCalls: () => new Set(['run-1']),
      dismissComposerMenus: vi.fn(),
      store,
    })
    expect(trigger.querySelector('.quickforge-subagent-running-spinner')).toBe(spinner)
    expect(trigger.querySelector('.quickforge-subagent-running-count')!.textContent).toBe('1')
  })

  it('opens the body-level menu and dispatches the latest payload on item click', async () => {
    const dom = buildDom()
    vi.stubGlobal('document', dom.document)
    vi.stubGlobal('window', dom.windowObject)
    const store = new SubagentRunStore()
    const initial = payload('run-1', 'running', { label: 'Explore old' })
    store.publish(initial)
    const dismissComposerMenus = vi.fn()
    const { OPEN_SUBAGENT_RUN_EVENT } = await import('../../src/lib/subagent-run-detail')
    const { setupSubagentRunningIndicator } = await loadModule()
    let opened: { payload: SubagentRunPayload } | undefined
    dom.windowObject.addEventListener(OPEN_SUBAGENT_RUN_EVENT, (event) => {
      opened = event.detail as { payload: SubagentRunPayload }
    })

    setupSubagentRunningIndicator({
      panel: dom.panel as unknown as HTMLElement,
      leftControls: dom.leftControls as unknown as HTMLElement,
      enabled: true,
      getPendingToolCalls: () => ['run-1'],
      dismissComposerMenus,
      store,
    })
    const trigger = dom.panel.querySelector('.quickforge-subagent-running-trigger')!
    trigger.onpointerdown!(new FakeEvent(trigger))

    expect(dismissComposerMenus).toHaveBeenCalledOnce()
    const menu = dom.body.querySelector('.quickforge-subagent-running-menu')!
    expect(menu.parentElement).toBe(dom.body)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const latest = payload('run-1', 'running', { label: 'Explore latest', fingerprint: 'latest' })
    store.publish(latest)
    menu.querySelector('.quickforge-subagent-running-item')!.onclick!(new FakeEvent())

    expect(opened?.payload).toBe(latest)
    expect(dom.body.querySelector('.quickforge-subagent-running-menu')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('removes a terminal run and closes the menu when no running items remain', async () => {
    const dom = buildDom()
    vi.stubGlobal('document', dom.document)
    vi.stubGlobal('window', dom.windowObject)
    const store = new SubagentRunStore()
    store.publish(payload('run-1', 'running'))
    const { setupSubagentRunningIndicator } = await loadModule()
    const options = {
      panel: dom.panel as unknown as HTMLElement,
      leftControls: dom.leftControls as unknown as HTMLElement,
      enabled: true,
      getPendingToolCalls: () => ['run-1'],
      dismissComposerMenus: vi.fn(),
      store,
    }

    setupSubagentRunningIndicator(options)
    dom.panel.querySelector('.quickforge-subagent-running-trigger')!.onpointerdown!(new FakeEvent())
    expect(dom.body.querySelector('.quickforge-subagent-running-menu')).not.toBeNull()

    store.publish(payload('run-1', 'done', { fingerprint: 'terminal' }))
    setupSubagentRunningIndicator(options)

    expect(dom.panel.querySelector('.quickforge-subagent-running-trigger')).toBeNull()
    expect(dom.body.querySelector('.quickforge-subagent-running-menu')).toBeNull()
  })
})

describe('subagent running indicator source contracts', () => {
  it('wires main-chat state sync, menu mutual exclusion, event sync, and cleanup', () => {
    expect(hostSource).toContain('subagentRunningIndicatorEnabled: !sideChatMode && !props.readOnly')
    expect(hostSource).toContain('getPendingToolCalls: () => agent.state.pendingToolCalls')
    expect(hostSource).toMatch(/tool_execution_start[\s\S]*scheduleDecorateRef\.current\?\.\(\)/)
    expect(hostSource).toContain('removeSubagentRunningIndicator(panel)')
    expect(decorationSource).toContain('removeSubagentRunningIndicatorMenu(panel)')
    expect(indicatorSource).toContain("document.addEventListener('pointerdown', dismiss, true)")
    expect(indicatorSource).toContain("document.addEventListener('keydown', dismiss, true)")
    expect(indicatorSource).toContain("window.addEventListener('resize', dismiss, true)")
    expect(indicatorSource).toContain("window.addEventListener('scroll', dismiss, true)")
  })

  it('contains bilingual copy and compact/mobile visual rules', () => {
    for (const key of [
      'subagentRunningIndicatorTriggerLabel',
      'subagentRunningIndicatorTriggerAria',
      'subagentRunningIndicatorMenuTitle',
      'subagentRunningIndicatorMenuAria',
      'subagentRunningIndicatorItemAria',
      'subagentRunningIndicatorElapsed',
    ]) {
      expect(i18nSource.match(new RegExp(`${key}:`, 'g'))).toHaveLength(2)
    }
    expect(cssSource).toContain('.quickforge-subagent-running-trigger')
    expect(cssSource).toContain('.quickforge-subagent-running-menu')
    expect(cssSource).toContain('max-height: min(420px, calc(100vh - 24px))')
    expect(cssSource).toContain('.quickforge-chat-panel-host.quickforge-chat-compact .quickforge-composer .quickforge-subagent-running-trigger-label')
    expect(cssSource).toMatch(/@media \(max-width: 768px\)[\s\S]*quickforge-subagent-running-trigger-label/)
  })
})
