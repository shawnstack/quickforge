import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../src/components/chat/panel-decoration/composer-plus-menu', () => ({
  hideNativeAttachmentControls: vi.fn(),
  removeComposerPlusPopover: vi.fn(),
  setupComposerPlusMenu: vi.fn(),
}))

import { disableComposerControls } from '../../src/components/chat/panel-decoration'
import {
  removeThinkingLevelControl,
  removeThinkingLevelMenu,
} from '../../src/components/chat/panel-decoration/thinking-level-controls'
import { decorateModelButtonLabel } from '../../src/components/chat/panel-decoration/model-controls'

// Two chat panels can be mounted at the same time (the main chat plus the
// side-chat). Every composer popover is appended to `document.body` so it can
// escape the panel's clipping context, which means ownership can only be
// derived from an explicit marker. These cases pin the panel scope of the
// thinking/model controls: a decorate pass in one panel must never touch the
// other panel's menu or trigger.
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

// `decorateModelButtonLabel` locates the model trigger with a tag selector
// carrying `:not(...)` exclusions, so the fake has to understand that shape.
function matchesButtonSelector(element: FakeNode, selector: string) {
  if (!selector.startsWith('button')) return false
  if (element.tagName !== 'BUTTON') return false
  const excluded = [...selector.matchAll(/:not\(\.([^)]+)\)/g)].map((match) => match[1])
  const classes = element.className.split(/\s+/).filter(Boolean)
  return excluded.every((name) => !classes.includes(name))
}

function collect(root: FakeNode, selector: string): FakeNode[] {
  const classes = selectorClasses(selector)
  const matches: FakeNode[] = []
  const visit = (element: FakeNode) => {
    if (classes.some((className) => element.className.split(/\s+/).includes(className))
      || matchesButtonSelector(element, selector)) matches.push(element)
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

function createPanel(thinking = true) {
  const panel = new FakeElement()
  panel.className = 'qf-chat-panel'
  const rightControls = new FakeElement()
  rightControls.className = 'quickforge-composer-right'
  const model = new FakeElement()
  model.className = 'quickforge-model-trigger'
  model.tagName = 'BUTTON'
  model.textContent = 'model-1'
  rightControls.append(model)
  if (thinking) {
    const trigger = new FakeElement()
    trigger.className = 'quickforge-thinking-inline'
    rightControls.append(trigger)
    body.append(panel)
    panel.append(rightControls)
    return { panel, rightControls, model, trigger }
  }
  body.append(panel)
  panel.append(rightControls)
  return { panel, rightControls, model, trigger: null }
}

function mountMenu(panel: FakeElement, trigger: FakeElement) {
  const menu = new FakeElement()
  menu.className = 'quickforge-thinking-menu'
  menu.__quickforgeOwnerPanel = panel as unknown as HTMLElement
  menu.__quickforgeOwnerTrigger = trigger as unknown as HTMLButtonElement
  body.append(menu)
  trigger.setAttribute('aria-expanded', 'true')
  return menu
}

describe('per-panel composer popover scope', () => {
  it('removes only the thinking menu owned by the targeted panel', () => {
    const main = createPanel()
    const side = createPanel()
    const mainMenu = mountMenu(main.panel, main.trigger!)
    const sideMenu = mountMenu(side.panel, side.trigger!)

    removeThinkingLevelMenu(side.panel as unknown as HTMLElement)

    expect(body.querySelectorAll('.quickforge-thinking-menu')).toEqual([mainMenu])
    expect(mainMenu.isConnected).toBeUndefined()
    expect(main.trigger!.getAttribute('aria-expanded')).toBe('true')
    expect(side.trigger!.getAttribute('aria-expanded')).toBe('false')
    expect(sideMenu.parentElement).toBeNull()
  })

  it('closes every thinking menu when no panel is given', () => {
    const main = createPanel()
    const side = createPanel()
    mountMenu(main.panel, main.trigger!)
    mountMenu(side.panel, side.trigger!)

    removeThinkingLevelMenu()

    expect(body.querySelectorAll('.quickforge-thinking-menu')).toEqual([])
    expect(main.trigger!.getAttribute('aria-expanded')).toBe('false')
    expect(side.trigger!.getAttribute('aria-expanded')).toBe('false')
  })

  it('removes only the targeted panel trigger', () => {
    const main = createPanel()
    const side = createPanel()

    removeThinkingLevelControl(side.panel as unknown as HTMLElement)

    expect(main.rightControls.querySelectorAll('.quickforge-thinking-inline')).toHaveLength(1)
    expect(side.rightControls.querySelectorAll('.quickforge-thinking-inline')).toHaveLength(0)
  })

  it('resets aria-expanded only for the panel that owns no open menu', () => {
    const main = createPanel()
    const side = createPanel(false)
    mountMenu(main.panel, main.trigger!)

    const sideModel = side.model
    decorateModelButtonLabel(
      { currentModel: { id: 'model-1' } } as never,
      side.rightControls as unknown as HTMLElement,
    )

    expect(sideModel.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps unrelated panels untouched while disabling composer controls', () => {
    const main = createPanel()
    const side = createPanel()
    const mainMenu = mountMenu(main.panel, main.trigger!)

    disableComposerControls(
      side.panel as unknown as HTMLElement,
      null,
    )

    expect(body.querySelectorAll('.quickforge-thinking-menu')).toEqual([mainMenu])
    expect(main.trigger!.getAttribute('aria-expanded')).toBe('true')
    expect(side.model.disabled).toBe(true)
  })
})
