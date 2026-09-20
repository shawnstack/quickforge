import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// i18n / tool display settings 由调用方注入（与 process-folding.test.ts 同形状）。
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: 'compact', showContextUsage: false }),
}), { virtual: true })

import { decorateProcessBlocks } from '../../src/components/chat/panel-decoration/process-folding'

/**
 * full 路径的增量收尾护栏：组仍存活、结构变化只是「时间线末尾追加连续工具行」
 * 时，不得整组释放重建（把每个已有行节点再搬一次会重启行内 CSS keyframes，
 * 如 pending 工具行的 animate-spin）；已有行节点必须原 DOM 位置不动，只有新行
 * 被搬进既有工具组。非纯后缀追加的结构变化仍走全量重建兜底；R13 的
 * 「结构不变不重建」（skip/update）语义不受影响。
 *
 * 项目 vitest 跑在 node 环境（无 jsdom），按仓库既有约定
 * （thinking-header-adoption.test.ts / process-folding-ownership.test.ts）手写
 * 最小 fake DOM。fake 的 querySelectorAll 支持 `:scope` / `>` / 逗号列表 /
 * 后代组合器（装饰层大量使用这些形态）；摘要行的 label/chevron <span> 来自
 * innerHTML 字符串（fake 不解析），updateProcessGroup 因此在 label 刷新前提前
 * return——本轮断言的是节点搬动/身份，不依赖 label。
 */

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

  set innerHTML(value: string) {
    this.attributes['data-inner-html'] = value
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

  /** 真实 DOM 语义：restoreGroupedProcessNode 依赖 nextSibling 定位还原位置。 */
  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null
    const siblings = this.parentNode.children
    const index = siblings.indexOf(this)
    return index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null
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

  insertBefore(node: FakeNode, reference: FakeNode | null) {
    if (reference && reference.parentNode !== this) {
      throw new Error('NotFoundError: The node before which the new node is to be inserted is not a child of this node.')
    }
    node.parentNode?.detach(node)
    node.parentNode = this
    const index = reference ? this.children.indexOf(reference) : this.children.length
    this.children.splice(index < 0 ? this.children.length : index, 0, node)
    return node
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

  contains(node: FakeNode | null): boolean {
    let current = node?.parentNode ?? null
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
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

  getAttribute(name: string) {
    return this.attributes[name] ?? null
  }

  hasAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
  }

  removeAttribute(name: string) {
    delete this.attributes[name]
  }
}

const globals = globalThis as unknown as { document?: unknown }

beforeAll(() => {
  globals.document = { createElement: (tagName: string) => new FakeNode(tagName) }
})

afterAll(() => {
  delete globals.document
})

const el = (tagName: string, className = '') => new FakeNode(tagName, className)

/** 一条已渲染的工具行（React `ToolMessage` 形态：div.qf-tool-message + toolCall 属性）。 */
function toolRow(id: string) {
  const node = el('div', 'qf-tool-message')
  Object.assign(node, { toolCall: { id, name: 'run_command', arguments: {} } })
  return node
}

type TurnTree = {
  panel: FakeNode
  list: FakeNode
  assistant: FakeNode
  content: FakeNode
  tool1: FakeNode
  tool2: FakeNode
}

/** 一个回合：assistant 内容容器里两条未折叠的工具行（React 刚渲染完的形态）。 */
function turnTree(): TurnTree {
  const panel = el('div', 'qf-chat-panel')
  panel.connectedRoot = true
  const list = panel.append(el('div', 'qf-message-list'))
  const assistant = list.append(el('div', 'qf-assistant-message'))
  const content = assistant.append(el('div', 'px-4 flex flex-col'))
  const tool1 = content.append(toolRow('cmd-1'))
  const tool2 = content.append(toolRow('cmd-2'))
  return { panel, list, assistant, content, tool1, tool2 }
}

function groupOf(tree: TurnTree) {
  return tree.content.querySelector('.quickforge-process-group')
}

describe('process folding incremental suffix fold (full path, surviving group)', () => {
  it('appends new tool rows into the existing tools group without moving the rows it owns', () => {
    const tree = turnTree()
    decorateProcessBlocks(tree.panel, [tree.assistant], true)
    const group = groupOf(tree)
    const toolsBody = group?.querySelector('.quickforge-process-tools-body') as FakeNode
    const fingerprint = group?.dataset.quickforgeProcessFp
    expect(group?.parentNode).toBe(tree.content)
    expect(toolsBody.children).toEqual([tree.tool1, tree.tool2])

    // 结构变化但没有释放（React 只在消息列表层追加了一条新 assistant 行）：
    // 新回合消息带来第三条工具行。
    const assistant2 = tree.list.append(el('div', 'qf-assistant-message'))
    const content2 = assistant2.append(el('div', 'px-4 flex flex-col'))
    const tool3 = content2.append(toolRow('cmd-3'))

    decorateProcessBlocks(tree.panel, [tree.assistant, assistant2], true)

    // 同一个组、同一个工具组容器：已有行节点一次都没有被搬动（搬动会重启
    // 行内 CSS keyframes），只有新行被增量插入。
    expect(group?.parentNode).toBe(tree.content)
    expect(tree.tool1.parentNode).toBe(toolsBody)
    expect(tree.tool2.parentNode).toBe(toolsBody)
    expect(tool3.parentNode).toBe(toolsBody)
    expect(toolsBody.children).toEqual([tree.tool1, tree.tool2, tool3])
    expect(tool3.hasAttribute('data-quickforge-process-folded')).toBe(true)
    expect(group?.dataset.quickforgeProcessFp).not.toBe(fingerprint)

    // R13 门控未回退：结构不再变化时（纯文本/标签 tick）走 update 快路径，
    // 任何节点都不再被搬动。
    decorateProcessBlocks(tree.panel, [tree.assistant, assistant2], true)
    expect(group?.parentNode).toBe(tree.content)
    expect(tree.tool1.parentNode).toBe(toolsBody)
    expect(tree.tool2.parentNode).toBe(toolsBody)
    expect(tool3.parentNode).toBe(toolsBody)
  })

  it('falls back to the full rebuild when the change is not a tool suffix append', () => {
    const tree = turnTree()
    decorateProcessBlocks(tree.panel, [tree.assistant], true)
    const group = groupOf(tree)
    const toolsBody = group?.querySelector('.quickforge-process-tools-body') as FakeNode
    expect(toolsBody.children).toEqual([tree.tool1, tree.tool2])

    // 末尾新增的不是工具行而是思考块：纯后缀追加无法表达，必须全量重建。
    const assistant2 = tree.list.append(el('div', 'qf-assistant-message'))
    assistant2.append(el('div', 'px-4 flex flex-col')).append(el('div', 'qf-thinking-block thinking-block'))

    decorateProcessBlocks(tree.panel, [tree.assistant, assistant2], true)

    expect(group?.parentNode).toBeNull()
    const rebuilt = groupOf(tree)
    expect(rebuilt).not.toBe(group)
    const rebuiltBody = rebuilt?.querySelector('.quickforge-process-tools-body') as FakeNode
    expect(rebuiltBody).not.toBe(toolsBody)
    expect(rebuiltBody.children).toEqual([tree.tool1, tree.tool2])
    // 思考块作为 detail 段与工具组同处重建后的组内。
    expect(rebuilt?.querySelector('.qf-thinking-block')?.closest('.quickforge-process-group')).toBe(rebuilt)
  })

  it('falls back to the full rebuild when a grouped row disappears', () => {
    const tree = turnTree()
    decorateProcessBlocks(tree.panel, [tree.assistant], true)

    const assistant2 = tree.list.append(el('div', 'qf-assistant-message'))
    const content2 = assistant2.append(el('div', 'px-4 flex flex-col'))
    const tool3 = content2.append(toolRow('cmd-3'))
    decorateProcessBlocks(tree.panel, [tree.assistant, assistant2], true)
    const group = groupOf(tree)
    const toolsBody = group?.querySelector('.quickforge-process-tools-body') as FakeNode
    expect(toolsBody.children).toEqual([tree.tool1, tree.tool2, tool3])

    // 尾部整条消息（连同其工具行）被移除：当前序列短于前次序列，
    // 增量路径拒绝，回到全量重建。
    assistant2.remove()
    decorateProcessBlocks(tree.panel, [tree.assistant], true)

    expect(group?.parentNode).toBeNull()
    const rebuilt = groupOf(tree)
    expect(rebuilt).not.toBe(group)
    const rebuiltBody = rebuilt?.querySelector('.quickforge-process-tools-body') as FakeNode
    expect(rebuiltBody.children).toEqual([tree.tool1, tree.tool2])
    expect(tool3.isConnected).toBe(false)
  })
})
