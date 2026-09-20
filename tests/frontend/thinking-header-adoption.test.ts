import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// i18n / tool display settings 由调用方注入（与 process-folding.test.ts 同形状）。
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: 'compact', showContextUsage: false }),
}), { virtual: true })

import { decorateProcessThinkingBlocks } from '../../src/components/chat/panel-decoration/process-folding'

/**
 * 思考头接管契约的真实 DOM 形态护栏（R12）。
 *
 * 项目 vitest 跑在 node 环境（无 jsdom），这里按仓库既有约定手写最小 fake DOM，
 * 但刻意复刻真实 DOM 里最关键的一条语义：**SVGElement 不是 HTMLElement**
 * （`new SVGElement() instanceof HTMLElement === false`）。React `ThinkingBlock` 渲染的
 * header 子级是 `[svg(ChevronRight), span(label)]`，旧的 `child instanceof HTMLElement`
 * 过滤会把 chevron 这个 <svg> 直接滤掉（`querySelector('svg')` 也匹配不到自身），
 * 接管因此提前 return，header 永远拿不到 `quickforge-process-thinking-header`，
 * 再叠加面板级 `display: none` 就把整块思考永久隐藏——本文件钉死这条路径。
 */

// ---------------------------------------------------------------------------
// Minimal fake DOM：只实现接管路径用到的表面（children/dataset/classList/
// setAttribute/querySelector/closest/append/prepend/remove）。
// ---------------------------------------------------------------------------

const hasClass = (node: FakeNode, name: string) => node.className.split(/\s+/).filter(Boolean).includes(name)

type SelectorStep = { combinator: ' ' | '>'; compound: string }

function parseSteps(part: string): SelectorStep[] {
  const tokens = part.replace(/>/g, ' > ').split(/\s+/).filter(Boolean)
  const steps: SelectorStep[] = []
  let combinator: ' ' | '>' = ' '
  for (const token of tokens) {
    if (token === '>') {
      combinator = '>'
      continue
    }
    steps.push({ combinator, compound: token })
    combinator = ' '
  }
  return steps
}

function matchesCompound(node: FakeNode, compound: string, scope: FakeNode | null): boolean {
  let rest = compound
  if (rest.startsWith(':scope')) {
    if (node !== scope) return false
    rest = rest.slice(':scope'.length)
  }
  const tokens = rest.match(/\.[\w-]+|^[\w-]+/g) ?? []
  for (const token of tokens) {
    if (token.startsWith('.')) {
      if (!hasClass(node, token.slice(1))) return false
    } else if (node.tagName !== token.toUpperCase()) {
      return false
    }
  }
  return true
}

function matchesSteps(node: FakeNode, steps: SelectorStep[], scope: FakeNode | null): boolean {
  if (steps.length === 0) return false
  if (!matchesCompound(node, steps[steps.length - 1].compound, scope)) return false

  let current: FakeNode | null = node
  for (let index = steps.length - 2; index >= 0; index -= 1) {
    if (steps[index + 1].combinator === '>') {
      current = current.parentNode
      if (!current || !matchesCompound(current, steps[index].compound, scope)) return false
      continue
    }
    let ancestor = current.parentNode
    while (ancestor && !matchesCompound(ancestor, steps[index].compound, scope)) ancestor = ancestor.parentNode
    if (!ancestor) return false
    current = ancestor
  }
  return true
}

function matchesSelector(node: FakeNode, selector: string, scope: FakeNode | null): boolean {
  return selector.split(',').some((part) => matchesSteps(node, parseSteps(part.trim()), scope))
}

class FakeNode {
  readonly tagName: string
  readonly attributes: Record<string, string> = {}
  readonly dataset: Record<string, string> = {}
  parentNode: FakeNode | null = null
  children: FakeNode[] = []
  connectedRoot = false
  private html = ''
  private text = ''

  constructor(tagName: string, className = '') {
    this.tagName = tagName.toUpperCase()
    if (className) this.attributes.class = className
  }

  get className(): string {
    return this.attributes.class ?? ''
  }

  set className(value: string) {
    this.attributes.class = value
  }

  get innerHTML(): string {
    return this.html
  }

  set innerHTML(value: string) {
    this.html = value
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.text = value
  }

  get parentElement(): FakeNode | null {
    return this.parentNode
  }

  get isConnected(): boolean {
    if (this.connectedRoot) return true
    let current = this.parentNode
    while (current) {
      if (current.connectedRoot) return true
      current = current.parentNode
    }
    return false
  }

  get classList() {
    return {
      add: (...names: string[]) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean))
        names.forEach((name) => current.add(name))
        this.attributes.class = [...current].join(' ')
      },
      remove: (...names: string[]) => {
        const removed = new Set(names)
        this.attributes.class = this.className.split(/\s+/).filter((name) => name && !removed.has(name)).join(' ')
      },
      toggle: (name: string, force?: boolean) => {
        const enable = force ?? !hasClass(this, name)
        if (enable) this.classList.add(name)
        else this.classList.remove(name)
        return enable
      },
      contains: (name: string) => hasClass(this, name),
    }
  }

  append(...nodes: FakeNode[]): FakeNode {
    nodes.forEach((node) => {
      node.parentNode?.detach(node)
      node.parentNode = this
      this.children.push(node)
    })
    return nodes[0] as FakeNode
  }

  prepend(...nodes: FakeNode[]): FakeNode {
    nodes.reverse().forEach((node) => {
      node.parentNode?.detach(node)
      node.parentNode = this
      this.children.unshift(node)
    })
    return nodes[0] as FakeNode
  }

  detach(node: FakeNode) {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    if (node.parentNode === this) node.parentNode = null
  }

  remove() {
    this.parentNode?.detach(this)
    this.parentNode = null
  }

  closest(selector: string): FakeNode | null {
    if (matchesSelector(this, selector, null)) return this
    return this.parentNode?.closest(selector) ?? null
  }

  querySelectorAll(selector: string): FakeNode[] {
    const found: FakeNode[] = []
    const walk = (parent: FakeNode) => {
      parent.children.forEach((child) => {
        if (matchesSelector(child, selector, this)) found.push(child)
        walk(child)
      })
    }
    walk(this)
    return found
  }

  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }

  hasAttribute(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
  }

  removeAttribute(name: string) {
    delete this.attributes[name]
  }
}

/** 真实 DOM 语义：SVGElement 与 HTMLElement 是兄弟类，互不 instanceof。 */
class FakeHTMLElement extends FakeNode {}
class FakeSvgElement extends FakeNode {}

const globals = globalThis as unknown as {
  HTMLElement?: unknown
  SVGElement?: unknown
  document?: unknown
}

beforeAll(() => {
  globals.HTMLElement = FakeHTMLElement
  globals.SVGElement = FakeSvgElement
  globals.document = { createElement: (tagName: string) => new FakeHTMLElement(tagName) }
})

afterAll(() => {
  delete globals.HTMLElement
  delete globals.SVGElement
  delete globals.document
})

const el = (tagName: string, className = '') => new FakeHTMLElement(tagName, className)

type ReactThinkingTree = {
  panel: FakeNode
  group: FakeNode
  body: FakeNode
  thinkingBlock: FakeNode
  header: FakeNode
  chevron: FakeNode
  label: FakeNode
}

/**
 * React 真实形态：`.qf-chat-panel > .qf-message-list > .qf-assistant-message >
 * .px-4.flex.flex-col > .quickforge-process-group > .quickforge-process-body >
 * .qf-thinking-block.thinking-block > button.thinking-header > [svg(ChevronRight), span]`。
 */
function reactThinkingTree({ expanded = false } = {}): ReactThinkingTree {
  const panel = el('div', 'qf-chat-panel')
  const list = panel.append(el('div', 'qf-message-list'))
  const assistant = list.append(el('div', 'qf-assistant-message'))
  const content = assistant.append(el('div', 'px-4 flex flex-col'))
  const group = content.append(el('div', 'quickforge-process-group'))
  const body = group.append(el('div', 'quickforge-process-body'))
  const thinkingBlock = body.append(el('div', 'qf-thinking-block thinking-block'))
  const header = thinkingBlock.append(el(
    'button',
    'thinking-header flex cursor-pointer select-none items-center gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground',
  ))
  const chevron = header.append(new FakeSvgElement(
    'svg',
    `inline-block size-4 transition-transform${expanded ? ' rotate-90' : ''}`,
  ))
  const label = header.append(el('span', ''))
  return { panel, group, body, thinkingBlock, header, chevron, label }
}

/** 旧 thinking-block 自定义元素形态：chevron 外包一层 span，svg 在更深处。 */
function legacyThinkingTree() {
  const group = el('div', 'quickforge-process-group')
  const body = group.append(el('div', 'quickforge-process-body'))
  const thinkingBlock = body.append(el('div', 'qf-thinking-block thinking-block'))
  const header = thinkingBlock.append(el('button', 'thinking-header'))
  const chevron = header.append(el('span', 'chevron-wrapper'))
  chevron.append(new FakeSvgElement('svg', ''))
  const label = header.append(el('span', 'label-wrapper'))
  return { group, thinkingBlock, header, chevron, label }
}

describe('thinking header adoption (React DOM shape)', () => {
  it('fails the guard on a header whose chevron is the <svg> itself', () => {
    const tree = reactThinkingTree()

    // 前提：装饰层只接管已被搬进过程组（进而 .quickforge-process-body）的块。
    expect(tree.thinkingBlock.closest('.quickforge-process-group')).toBe(tree.group)
    expect(tree.chevron instanceof FakeHTMLElement).toBe(false)

    decorateProcessThinkingBlocks(tree.group)

    expect(tree.header.className).toBe('thinking-header quickforge-process-thinking-header')
  })

  it('orders the adopted header as [icon, label, chevron] with the native svg as chevron', () => {
    const tree = reactThinkingTree()

    decorateProcessThinkingBlocks(tree.group)

    expect(tree.header.children.map((child) => child.tagName)).toEqual(['SPAN', 'SPAN', 'SVG'])
    const [icon, label, chevron] = tree.header.children
    expect(icon?.dataset.quickforgeThinkingRole).toBe('icon')
    expect(icon?.classList.contains('quickforge-process-thinking-icon')).toBe(true)
    expect(label?.dataset.quickforgeThinkingRole).toBe('label')
    expect(label?.className).toBe('quickforge-process-thinking-label')
    expect(label?.textContent).toBe('processThinking')
    expect(chevron).toBe(tree.chevron)
    expect(chevron?.dataset.quickforgeThinkingRole).toBe('chevron')
    expect(chevron?.getAttribute('class')).toBe('quickforge-process-thinking-chevron')
  })

  it('carries the native rotate-90 state over to the adopted chevron', () => {
    const tree = reactThinkingTree({ expanded: true })

    decorateProcessThinkingBlocks(tree.group)

    // 真实 DOM 里 SVGElement.className 是只读的 SVGAnimatedString：接管必须走
    // setAttribute，而不是把 rotate-90 留在 className 上或直接赋值 className。
    expect(tree.chevron.getAttribute('class')).toBe(
      'quickforge-process-thinking-chevron quickforge-process-thinking-chevron-expanded',
    )
    expect(tree.chevron.className).not.toContain('rotate-90')
  })

  it('stays idempotent when React re-renders and the decoration runs again', () => {
    const tree = reactThinkingTree({ expanded: true })

    decorateProcessThinkingBlocks(tree.group)
    const adopted = [...tree.header.children]
    decorateProcessThinkingBlocks(tree.group)

    expect(tree.header.children).toHaveLength(3)
    adopted.forEach((child, index) => {
      expect(tree.header.children[index]).toBe(child)
    })
    expect(tree.header.children.filter((child) => child.dataset.quickforgeThinkingRole === 'icon')).toHaveLength(1)
    expect(tree.header.className).toBe('thinking-header quickforge-process-thinking-header')
  })

  it('still adopts the legacy shape where the chevron svg sits inside a wrapper', () => {
    const tree = legacyThinkingTree()

    decorateProcessThinkingBlocks(tree.group)

    expect(tree.header.className).toBe('thinking-header quickforge-process-thinking-header')
    expect(tree.chevron.dataset.quickforgeThinkingRole).toBe('chevron')
    expect(tree.chevron.className).toBe('quickforge-process-thinking-chevron')
    expect(tree.label.dataset.quickforgeThinkingRole).toBe('label')
  })

  it('leaves a thinking block outside the group untouched', () => {
    const tree = reactThinkingTree()
    const other = el('div', 'quickforge-process-group')
    other.append(el('div', 'quickforge-process-body'))

    decorateProcessThinkingBlocks(other)

    expect(tree.header.className).not.toContain('quickforge-process-thinking-header')
    expect(tree.header.children.map((child) => child.tagName)).toEqual(['SVG', 'SPAN'])
  })
})
