import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import { disableComposerControls } from '../../src/components/chat/panel-decoration'

/**
 * Two chat panels can be mounted at the same time (the main chat plus the
 * side-chat). Every composer popover is appended to `document.body` so it can
 * escape the panel's clipping context, which means ownership can only be
 * derived from an explicit marker.
 *
 * These cases pin the panel scope of the remaining decoration-owned composer
 * controls (agent access, model menu). The "+" menu and the thinking selector
 * are React-rendered inside each surface now, so they cannot leak across panels
 * at all — that class of bug is structurally gone rather than tested.
 */
type FakeNode = FakeElement

class FakeElement {
  className = ''
  textContent = ''
  title = ''
  disabled = false
  value = ''
  tagName = 'DIV'
  parentElement: FakeNode | null = null
  children: FakeNode[] = []
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  __quickforgeDismissHandler?: (event: Event) => void
  __quickforgeOwnerPanel?: HTMLElement
  __quickforgeOwnerTrigger?: HTMLButtonElement
  __quickforgeOwnerAnchor?: HTMLElement

  classList = {
    add: (...names: string[]) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean))
      names.forEach((name) => classes.add(name))
      this.className = [...classes].join(' ')
    },
    remove: (...names: string[]) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean))
      names.forEach((name) => classes.delete(name))
      this.className = [...classes].join(' ')
    },
    contains: (name: string) => this.className.split(/\s+/).includes(name),
  }

  append(...nodes: FakeNode[]) {
    for (const node of nodes) {
      node.parentElement?.removeChild(node)
      node.parentElement = this
      this.children.push(node)
    }
  }

  removeChild(node: FakeNode) {
    this.children = this.children.filter((child) => child !== node)
    node.parentElement = null
  }

  remove() {
    this.parentElement?.removeChild(this)
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  addEventListener() {}

  removeEventListener() {}

  querySelector<T = FakeElement>(selector: string): T | null {
    return collect(this, selector)[0] as T | null
  }

  querySelectorAll<T = FakeElement>(selector: string): T[] {
    return collect(this, selector) as T[]
  }

  closest<T = FakeElement>(selector: string): T | null {
    const classes = selectorClasses(selector)
    const matches = (element: FakeElement) => classes.some((className) => element.className.split(/\s+/).includes(className))
    if (matches(this)) return this as unknown as T
    return this.parentElement?.closest<T>(selector) ?? null
  }
}

function selectorClasses(selector: string) {
  return selector.split(',').map((part) => part.trim().replace(/^\./, ''))
}

function collect(root: FakeNode, selector: string): FakeNode[] {
  const classes = selectorClasses(selector)
  const matches: FakeNode[] = []
  const visit = (element: FakeNode) => {
    if (classes.some((className) => element.className.split(/\s+/).includes(className))) matches.push(element)
    for (const child of element.children) visit(child)
  }
  for (const child of root.children) visit(child)
  return matches
}

let body: FakeElement

beforeEach(() => {
  body = new FakeElement()
  vi.stubGlobal('document', {
    body,
    querySelector: (selector: string) => collect(body, selector)[0] ?? null,
    querySelectorAll: (selector: string) => collect(body, selector),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('window', {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function createPanel() {
  const panel = new FakeElement()
  panel.className = 'qf-chat-panel'
  const rightControls = new FakeElement()
  rightControls.className = 'quickforge-composer-right'
  const model = new FakeElement()
  model.className = 'quickforge-model-trigger'
  model.tagName = 'BUTTON'
  model.textContent = 'model-1'
  rightControls.append(model)
  const access = new FakeElement()
  access.className = 'quickforge-agent-access-inline'
  rightControls.append(access)
  body.append(panel)
  panel.append(rightControls)
  return { panel, rightControls, model, access }
}

describe('per-panel composer popover scope', () => {
  it('resets aria-expanded only for the disable path it owns', () => {
    const main = createPanel()
    const side = createPanel()
    main.model.setAttribute('aria-expanded', 'true')

    disableComposerControls(side.panel as unknown as HTMLElement, null)

    // The model trigger is React-rendered, but `disableComposerControls` still
    // resets the mirrored attribute for the panel it was called on.
    expect(side.model.getAttribute('aria-expanded')).toBe('false')
    expect(side.model.disabled).toBe(true)
    expect(side.access.disabled).toBe(true)
  })

  it('leaves the other panel untouched while disabling one panel', () => {
    const main = createPanel()
    const side = createPanel()
    main.model.setAttribute('aria-expanded', 'true')

    disableComposerControls(side.panel as unknown as HTMLElement, null)

    expect(main.model.getAttribute('aria-expanded')).toBe('true')
    expect(main.model.disabled).toBe(false)
    expect(main.access.disabled).toBe(false)
  })
})
