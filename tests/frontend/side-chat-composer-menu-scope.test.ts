import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../src/components/chat/panel-decoration/composer-plus-menu', () => ({
  hideNativeAttachmentControls: vi.fn(),
  removeComposerPlusPopover: vi.fn(),
  setupComposerPlusMenu: vi.fn(),
}))
vi.mock('../../src/components/chat/panel-decoration/opencode-config-menu', () => ({
  removeOpenCodeConfigMenu: vi.fn(),
  setupOpenCodeConfigMenu: vi.fn(),
}))
vi.mock('../../src/components/chat/panel-decoration/opencode-mode-menu', () => ({
  removeOpenCodeModeMenu: vi.fn(),
  setupOpenCodeModeMenu: vi.fn(),
}))

import { disableComposerControls } from '../../src/components/chat/panel-decoration'
import { removeAgentAccessMenu } from '../../src/components/chat/panel-decoration/agent-access-menu'
import type { MessageEditorElement } from '../../src/components/chat/chat-utils'

type Listener = (event: Event) => void

class FakeElement {
  className = ''
  disabled = false
  value = ''
  parentElement: FakeElement | null = null
  children: FakeElement[] = []
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  listeners = new Map<string, Listener[]>()
  __quickforgeDismissHandler?: Listener
  __quickforgeOwnerPanel?: HTMLElement
  __quickforgeOwnerTrigger?: HTMLButtonElement
  __quickforgeOwnerAnchor?: HTMLElement
  __quickforgeCleanup?: () => void

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

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parentElement?.removeChild(node)
      node.parentElement = this
      this.children.push(node)
    }
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

  querySelector<T = FakeElement>(selector: string): T | null {
    return collect(this, selector)[0] as T | null
  }

  querySelectorAll<T = FakeElement>(selector: string): T[] {
    return collect(this, selector) as T[]
  }

  removeEventListener() {}
}

function selectorClasses(selector: string) {
  return selector.split(',').map((part) => {
    const trimmed = part.trim()
    if (trimmed === 'input[type="file"]') return 'file-input'
    return trimmed.replace(/^\./, '')
  })
}

function collect(root: FakeElement, selector: string): FakeElement[] {
  const classes = selectorClasses(selector)
  const matches: FakeElement[] = []
  const visit = (element: FakeElement) => {
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
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('window', { removeEventListener: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function panelWithControls() {
  const panel = new FakeElement()
  const plus = new FakeElement(); plus.className = 'quickforge-plus-inline'
  const model = new FakeElement(); model.className = 'quickforge-model-trigger'
  const access = new FakeElement(); access.className = 'quickforge-agent-access-inline'
  const plan = new FakeElement(); plan.className = 'quickforge-plan-inline'
  panel.append(plus, model, access, plan)
  const editor = new FakeElement()
  const fileInput = new FakeElement(); fileInput.className = 'file-input'; fileInput.value = 'selected'
  editor.append(fileInput)
  panel.append(editor)
  return { panel, editor, plus, model, access, plan, fileInput }
}

describe('Side Chat scoped composer menu cleanup', () => {
  it('does not remove main panel access/model menus while disabling side controls', () => {
    const mainPanel = new FakeElement()
    const mainAccess = new FakeElement(); mainAccess.className = 'quickforge-agent-access-inline'; mainAccess.setAttribute('aria-expanded', 'true')
    const mainModel = new FakeElement(); mainModel.className = 'quickforge-model-trigger'; mainModel.setAttribute('aria-expanded', 'true')
    mainPanel.append(mainAccess, mainModel)

    const mainAccessMenu = new FakeElement()
    mainAccessMenu.className = 'quickforge-agent-access-menu'
    mainAccessMenu.__quickforgeOwnerPanel = mainPanel as unknown as HTMLElement
    mainAccessMenu.__quickforgeOwnerTrigger = mainAccess as unknown as HTMLButtonElement
    const mainModelMenu = new FakeElement()
    mainModelMenu.className = 'quickforge-model-menu'
    mainModelMenu.__quickforgeOwnerAnchor = mainModel as unknown as HTMLElement
    body.append(mainAccessMenu, mainModelMenu)

    const side = panelWithControls()
    disableComposerControls(side.panel as unknown as HTMLElement, side.editor as unknown as MessageEditorElement)

    expect(body.querySelector('.quickforge-agent-access-menu')).toBe(mainAccessMenu)
    expect(body.querySelector('.quickforge-model-menu')).toBe(mainModelMenu)
    expect(mainAccess.getAttribute('aria-expanded')).toBe('true')
    expect(mainModel.getAttribute('aria-expanded')).toBe('true')
    expect(side.plus.disabled).toBe(true)
    expect(side.model.disabled).toBe(true)
    expect(side.access.disabled).toBe(true)
    expect(side.plan.disabled).toBe(true)
    expect(side.fileInput.disabled).toBe(true)
    expect(side.fileInput.value).toBe('')
  })

  it('removes a menu owned by the same panel and resets its trigger', () => {
    const side = panelWithControls()
    side.access.setAttribute('aria-expanded', 'true')
    const sideMenu = new FakeElement()
    sideMenu.className = 'quickforge-agent-access-menu'
    sideMenu.__quickforgeOwnerPanel = side.panel as unknown as HTMLElement
    sideMenu.__quickforgeOwnerTrigger = side.access as unknown as HTMLButtonElement
    body.append(sideMenu)

    removeAgentAccessMenu(side.panel as unknown as HTMLElement, true)

    expect(body.querySelector('.quickforge-agent-access-menu')).toBeFalsy()
    expect(side.access.getAttribute('aria-expanded')).toBe('false')
  })
})
