import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Api, Model } from '@earendil-works/pi-ai'

vi.mock('@earendil-works/pi-ai', () => ({
  modelsAreEqual: (left: Model<Api> | null, right: Model<Api> | null) => (
    left?.provider === right?.provider && left?.id === right?.id
  ),
}))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import { openCustomOnlyModelSelector, closeComposerModelMenu } from '../../src/lib/custom-model-selector'

const customModelSelectorSource = readFileSync(new URL('../../src/lib/custom-model-selector.ts', import.meta.url), 'utf8')

type Listener = (event: unknown) => void

class FakeElement {
  className = ''
  textContent = ''
  type = ''
  title = ''
  disabled = false
  parentElement: FakeElement | null = null
  children: FakeElement[] = []
  attributes = new Map<string, string>()
  listeners = new Map<string, Listener[]>()
  style: Record<string, string> = {}
  onpointerdown?: Listener
  onpointerenter?: Listener
  offsetHeight = 320
  __quickforgeCleanup?: () => void
  __quickforgeOwnerAnchor?: HTMLElement

  classList = {
    toggle: (name: string, enabled: boolean) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean))
      if (enabled) classes.add(name)
      else classes.delete(name)
      this.className = [...classes].join(' ')
    },
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parentElement?.removeChild(node)
      node.parentElement = this
      this.children.push(node)
    }
  }

  replaceChildren(...nodes: FakeElement[]) {
    for (const child of this.children) child.parentElement = null
    this.children = []
    this.append(...nodes)
  }

  removeChild(node: FakeElement) {
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

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  click() {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), target: this }
    for (const listener of this.listeners.get('click') ?? []) listener(event)
  }

  contains(target: unknown): boolean {
    return target === this || this.children.some((child) => child.contains(target))
  }

  querySelector<T = FakeElement>(selector: string): T | null {
    return findFirst(this, selector) as T | null
  }

  getBoundingClientRect() {
    return { left: 300, right: 500, top: 400, bottom: 432 }
  }
}

function hasClass(element: FakeElement, className: string) {
  return element.className.split(/\s+/).includes(className)
}

function selectorClasses(selector: string) {
  return selector.split(',').map((part) => part.trim().replace(/^\./, ''))
}

function collect(root: FakeElement, selector: string): FakeElement[] {
  const classes = selectorClasses(selector)
  const matches: FakeElement[] = []
  const visit = (element: FakeElement) => {
    if (classes.some((className) => hasClass(element, className))) matches.push(element)
    for (const child of element.children) visit(child)
  }
  for (const child of root.children) visit(child)
  return matches
}

function findFirst(root: FakeElement, selector: string) {
  return collect(root, selector)[0] ?? null
}

function model(id = 'model-1') {
  return { id, provider: 'provider', reasoning: true } as Model<Api>
}

let body: FakeElement
let anchor: FakeElement
let windowListeners: Map<string, Listener[]>

beforeEach(() => {
  body = new FakeElement()
  anchor = new FakeElement()
  windowListeners = new Map()

  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('Node', FakeElement)
  vi.stubGlobal('document', {
    body,
    createElement: () => new FakeElement(),
    querySelector: (selector: string) => findFirst(body, selector),
    querySelectorAll: (selector: string) => collect(body, selector),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('window', {
    innerWidth: 1024,
    innerHeight: 800,
    addEventListener: (type: string, listener: Listener) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener])
    },
    removeEventListener: (type: string, listener: Listener) => {
      windowListeners.set(type, (windowListeners.get(type) ?? []).filter((item) => item !== listener))
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('custom model selector settings entry', () => {
  it.each([
    ['desktop', 1024, '.quickforge-model-menu'],
    ['mobile', 500, '.quickforge-model-sheet'],
  ])('renders the %s entry only with a callback and closes before navigation', (_name, width, selector) => {
    window.innerWidth = width as number
    const order: string[] = []
    const onOpenModelSettings = vi.fn(() => {
      order.push(document.querySelector(selector as string) ? 'open' : 'closed')
    })

    openCustomOnlyModelSelector(model(), [model()], vi.fn(), undefined, {
      anchor: anchor as unknown as HTMLElement,
      onOpenModelSettings,
    })

    const settingsButton = document.querySelector<FakeElement>('.quickforge-model-settings-link')
    expect(settingsButton?.textContent).toBe('modelSelectorCustomModelSettings')
    expect(settingsButton?.getAttribute('aria-label')).toBe('modelSelectorCustomModelSettingsAriaLabel')

    settingsButton?.click()

    expect(order).toEqual(['closed'])
    expect(onOpenModelSettings).toHaveBeenCalledTimes(1)
    expect(anchor.getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    ['desktop', 1024],
    ['mobile', 500],
  ])('does not render the %s entry without the optional callback', (_name, width) => {
    window.innerWidth = width as number

    openCustomOnlyModelSelector(model(), [model()], vi.fn(), undefined, {
      anchor: anchor as unknown as HTMLElement,
    })

    expect(document.querySelector('.quickforge-model-settings-link')).toBeNull()
  })

  it('scoped close only removes menus owned by the provided anchor', () => {
    const sideAnchor = new FakeElement()
    openCustomOnlyModelSelector(model(), [model()], vi.fn(), undefined, {
      anchor: anchor as unknown as HTMLElement,
    })
    const mainMenu = document.querySelector<FakeElement>('.quickforge-model-menu')
    expect(mainMenu).not.toBeNull()

    closeComposerModelMenu(sideAnchor as unknown as HTMLElement, true)
    expect(document.querySelector('.quickforge-model-menu')).toBe(mainMenu)

    closeComposerModelMenu(anchor as unknown as HTMLElement, true)
    expect(document.querySelector('.quickforge-model-menu')).toBeNull()
    expect(anchor.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the mobile footer outside the scrollable model list and uses low-emphasis feedback', () => {
    const css = readFileSync('src/index.css', 'utf8')

    expect(css).toMatch(/\.quickforge-model-sheet-model-list\s*\{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s)
    expect(css).toMatch(/\.quickforge-model-settings-footer\s*\{[^}]*flex:\s*0 0 auto[^}]*border-top:/s)
    expect(css).toMatch(/\.quickforge-model-settings-link\s*\{[^}]*background:\s*transparent[^}]*muted-foreground/s)
    expect(css).toMatch(/\.quickforge-model-settings-link:hover,\s*\.quickforge-model-settings-link:focus-visible\s*\{[^}]*background:[^}]*color:\s*var\(--foreground\)/s)
  })

  it('uses the same SVG check icon and left check slot as the thinking-level menu', () => {
    const css = readFileSync('src/index.css', 'utf8')

    expect(customModelSelectorSource).toContain("import { agentAccessCheckIcon } from '@/components/chat/panel-decoration/icons'")
    expect(customModelSelectorSource).toContain("checkSlot.className = 'quickforge-model-menu-item-check-slot'")
    expect(customModelSelectorSource).toContain('checkSlot.innerHTML = options.selected ? agentAccessCheckIcon : \'\'')
    expect(customModelSelectorSource).toContain('item.append(checkSlot, label)')
    expect(css).toMatch(/\.quickforge-model-menu-item\s*\{[^}]*grid-template-columns:\s*1rem\s+minmax\(0,\s*1fr\)/s)
    expect(css).toMatch(/\.quickforge-model-menu-item-check-slot\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*color:\s*color-mix\(in oklab,\s*var\(--foreground\)\s+88%,\s*transparent\)/s)
  })

  it('keeps desktop model selection behavior unchanged', () => {
    const onSelect = vi.fn()
    const selectedModel = model('next')

    openCustomOnlyModelSelector(model(), [selectedModel], onSelect, undefined, {
      anchor: anchor as unknown as HTMLElement,
      onOpenModelSettings: vi.fn(),
    })

    const modelEntry = collect(body, '.quickforge-model-menu-item').find((item) => (
      item.children.some((child) => child.textContent === 'provider / model-1')
    ))
    modelEntry?.onpointerenter?.({})
    const modelMenuItem = collect(body, '.quickforge-model-menu-item').find((item) => (
      item.children.some((child) => child.textContent === 'provider / next')
    ))
    modelMenuItem?.onpointerdown?.({ preventDefault: vi.fn(), stopPropagation: vi.fn() })

    expect(onSelect).toHaveBeenCalledWith(selectedModel)
    expect(document.querySelector('.quickforge-model-menu')).toBeNull()
  })
})
