import { describe, expect, it, vi } from 'vitest'

// i18n / tool display settings 由调用方注入：这里用与真实模块相同形状的 stub
// （与 process-folding.test.ts 一致），让本用例只覆盖所有权释放路径。
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: 'compact', showContextUsage: false }),
}), { virtual: true })

import {
  releaseProcessGroups,
  shouldRestoreGroupedProcessNode,
} from '../../src/components/chat/panel-decoration/process-folding'
import { ProcessGroupReleaseBoundary, shouldReleaseProcessGroups } from '../../src/components/chat/surface/ChatSurface'
import type { AgentMessage, AssistantMessage as AssistantMessageType } from '../../src/components/chat/surface/ChatTypes'

/**
 * R6：装饰层（process folding）把 React 渲染的消息节点搬进
 * `.quickforge-process-group`，而 React 仍认为这些节点是它渲染的容器的直接子节点。
 * 本文件用结构 fake DOM 覆盖所有权交还路径：流式组、已完成非流式组、运行详情组、
 * 卸载/切换会话（节点被 React 移除或重新创建）时不残留、不抛错、且幂等。
 *
 * fake DOM 刻意实现真实语义中最关键的两条：
 * - `insertBefore` 在参照节点不是直接子节点时抛错（正是 React 会踩到的
 *   NotFoundError）。
 * - 节点被 React 移出时（isConnected=false / 不再属于组）释放必须放弃该节点，
 *   不能复活或搬动它。
 */

function hasClass(node: FakeElement, name: string) {
  return node.className.split(/\s+/).filter(Boolean).includes(name)
}

function matchesCompound(node: FakeElement, compound: string): boolean {
  const attribute = /\[([^=\]]+)(?:="([^"]*)")?\]/.exec(compound)
  const base = compound.replace(/\[[^\]]*\]/g, '')
  if (base.startsWith('.')) {
    if (!hasClass(node, base.slice(1))) return false
  } else if (base && node.tagName !== base.toUpperCase()) {
    return false
  }
  if (!attribute) return true
  const value = attribute[1] === 'data-streaming'
    ? node.dataset.streaming
    : node.getAttribute(attribute[1]) ?? undefined
  return attribute[2] === undefined ? value !== undefined : value === attribute[2]
}

function matchesSelector(node: FakeElement, selector: string): boolean {
  return selector.split(',').some((part) => {
    const steps = part.trim().split(/\s+/).filter(Boolean)
    const last = steps[steps.length - 1]
    if (!last || !matchesCompound(node, last)) return false
    let ancestor = node.parentNode
    for (let index = steps.length - 2; index >= 0; index -= 1) {
      while (ancestor && !matchesCompound(ancestor, steps[index])) ancestor = ancestor.parentNode
      if (!ancestor) return false
      ancestor = ancestor.parentNode
    }
    return true
  })
}

class FakeElement {
  readonly tagName: string
  className: string
  readonly dataset: Record<string, string> = {}
  readonly attributes: Record<string, string> = {}
  parentNode: FakeElement | null = null
  children: FakeElement[] = []
  /** 把该节点标记为文档根：其子树 isConnected 为 true。 */
  connectedRoot = false

  constructor(tagName: string, className = '') {
    this.tagName = tagName.toUpperCase()
    this.className = className
  }

  get isConnected() {
    if (this.connectedRoot) return true
    let current = this.parentNode
    while (current) {
      if (current.connectedRoot) return true
      current = current.parentNode
    }
    return false
  }

  get parentElement() {
    return this.parentNode
  }

  get classList() {
    return {
      add: (...names: string[]) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean))
        names.forEach((name) => current.add(name))
        this.className = [...current].join(' ')
      },
      remove: (...names: string[]) => {
        const removed = new Set(names)
        this.className = this.className.split(/\s+/).filter((name) => name && !removed.has(name)).join(' ')
      },
      contains: (name: string) => hasClass(this, name),
    }
  }

  append(...nodes: FakeElement[]) {
    nodes.forEach((node) => {
      node.parentNode?.detach(node)
      node.parentNode = this
      this.children.push(node)
    })
    return nodes[0] as FakeElement
  }

  insertBefore(node: FakeElement, reference: FakeElement | null) {
    if (reference && reference.parentNode !== this) {
      // 真实 DOM（以及 React）在这里抛 NotFoundError。
      throw new Error('NotFoundError: The node before which the new node is to be inserted is not a child of this node.')
    }
    node.parentNode?.detach(node)
    node.parentNode = this
    const index = reference ? this.children.indexOf(reference) : this.children.length
    this.children.splice(index < 0 ? this.children.length : index, 0, node)
    return node
  }

  detach(node: FakeElement) {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    if (node.parentNode === this) node.parentNode = null
  }

  remove() {
    this.parentNode?.detach(this)
    this.parentNode = null
  }

  contains(node: FakeElement | null): boolean {
    let current = node?.parentNode ?? null
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }

  closest(selector: string): FakeElement | null {
    if (matchesSelector(this, selector)) return this
    return this.parentNode?.closest(selector) ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = []
    const walk = (parent: FakeElement) => {
      parent.children.forEach((child) => {
        if (matchesSelector(child, selector)) found.push(child)
        walk(child)
      })
    }
    walk(this)
    return found
  }

  querySelector(selector: string): FakeElement | null {
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

const asElement = (node: FakeElement) => node as unknown as HTMLElement

function documentRoot(): FakeElement {
  const root = new FakeElement('#document')
  root.connectedRoot = true
  return root
}

type MovedTree = {
  root: FakeElement
  list: FakeElement
  assistant: FakeElement
  content: FakeElement
  group: FakeElement
  body: FakeElement
  thinking: FakeElement
  tool: FakeElement
}

/**
 * 一个回合的对话 DOM：assistant 内容容器里有一个装饰层自建的过程组，
 * 组内是被搬移的 React 节点（thinking / tool）。
 */
function chatTurnTree({ streaming, root = documentRoot() }: { streaming: boolean; root?: FakeElement }): MovedTree {
  const list = root.append(new FakeElement('div', 'qf-message-list'))
  const assistant = list.append(new FakeElement('div', 'qf-assistant-message quickforge-process-source-empty'))
  const content = assistant.append(new FakeElement('div', 'px-4 flex flex-col'))
  const group = content.append(new FakeElement('div', 'quickforge-process-group'))
  group.dataset.streaming = String(streaming)
  const body = group.append(new FakeElement('div', 'quickforge-process-body'))
  const thinking = body.append(new FakeElement('div', 'qf-thinking-block thinking-block'))
  const tool = body.append(new FakeElement('div', 'qf-tool-message'))
  return { root, list, assistant, content, group, body, thinking, tool }
}

/**
 * React 卸载子树时对渲染容器调 removeChild(child)：child 不是直接子节点时
 * 真实 DOM 抛 NotFoundError——正是折叠搬走节点后卸载流式容器会踩的错误。
 */
function reactRemoveChild(parent: FakeElement, child: FakeElement) {
  if (child.parentNode !== parent) {
    throw new Error('NotFoundError: The node to be removed is not a child of this node.')
  }
  parent.detach(child)
}

describe('process folding ownership release', () => {
  it('hands streaming nodes back to their React container and dissolves the group', () => {
    const tree = chatTurnTree({ streaming: true })

    const stats = releaseProcessGroups(asElement(tree.root), true)

    expect(stats).toEqual({ groups: 1, restored: 2, dropped: 0 })
    expect(tree.group.parentNode).toBeNull()
    expect(tree.content.children).toEqual([tree.thinking, tree.tool])
    expect(tree.thinking.isConnected).toBe(true)
    expect(tree.assistant.classList.contains('quickforge-process-source-empty')).toBe(false)
  })

  it('releases completed (non-streaming) groups as well, not just streaming ones', () => {
    const tree = chatTurnTree({ streaming: false })

    // 旧行为（streamingOnly）会跳过已完成组；调用方必须能全量释放。
    expect(releaseProcessGroups(asElement(tree.root), true)).toEqual({ groups: 0, restored: 0, dropped: 0 })
    expect(tree.group.parentNode).toBe(tree.content)

    expect(releaseProcessGroups(asElement(tree.root))).toEqual({ groups: 1, restored: 2, dropped: 0 })
    expect(tree.content.children).toEqual([tree.thinking, tree.tool])
  })

  it('is idempotent: a second release finds nothing and never moves nodes again', () => {
    const tree = chatTurnTree({ streaming: true })

    releaseProcessGroups(asElement(tree.root))
    const second = releaseProcessGroups(asElement(tree.root))

    expect(second).toEqual({ groups: 0, restored: 0, dropped: 0 })
    expect(tree.content.children).toEqual([tree.thinking, tree.tool])
  })

  it('releases every group of a session switch without leaving residue', () => {
    const root = documentRoot()
    const first = chatTurnTree({ streaming: false, root })
    const second = chatTurnTree({ streaming: true, root })

    const stats = releaseProcessGroups(asElement(root))

    expect(stats).toEqual({ groups: 2, restored: 4, dropped: 0 })
    expect(root.querySelectorAll('.quickforge-process-group')).toEqual([])
    expect(first.content.children).toEqual([first.thinking, first.tool])
    expect(second.content.children).toEqual([second.thinking, second.tool])
    expect(releaseProcessGroups(asElement(root))).toEqual({ groups: 0, restored: 0, dropped: 0 })
  })

  it('releases a run-detail (subagent trace) group through the trace root', () => {
    const root = documentRoot()
    const trace = root.append(new FakeElement('div', 'quickforge-subagent-trace'))
    const tree = chatTurnTree({ streaming: false, root: trace })

    // SubagentTrace 用 trace 根释放：运行中的 trace 也带非流式（已完成）组。
    expect(releaseProcessGroups(asElement(trace))).toEqual({ groups: 1, restored: 2, dropped: 0 })
    expect(trace.querySelectorAll('.quickforge-process-group')).toEqual([])
    expect(tree.content.children).toEqual([tree.thinking, tree.tool])
  })

  it('drops nodes React already re-rendered in place instead of moving them', () => {
    const tree = chatTurnTree({ streaming: true })
    tree.thinking.setAttribute('data-quickforge-process-folded', 'true')
    // 模拟 React 自己把节点重新渲染回容器：节点仍在，但已不属于该组。
    tree.group.contains = () => false

    const stats = releaseProcessGroups(asElement(tree.root))

    expect(stats).toEqual({ groups: 1, restored: 0, dropped: 2 })
    expect(tree.thinking.parentNode).toBe(tree.body)
    expect(tree.thinking.hasAttribute('data-quickforge-process-folded')).toBe(false)
  })

  it('never resurrects a node React unmounted', () => {
    const tree = chatTurnTree({ streaming: true })
    const insertBefore = vi.spyOn(tree.content, 'insertBefore')
    // 模拟 React 已卸载该节点：不再 connected，释放必须放弃它。
    Object.defineProperty(tree.thinking, 'isConnected', { get: () => false })

    const stats = releaseProcessGroups(asElement(tree.root))

    expect(stats).toEqual({ groups: 1, restored: 1, dropped: 1 })
    expect(insertBefore).toHaveBeenCalledTimes(1)
    expect(insertBefore).toHaveBeenCalledWith(tree.tool, tree.group)
    expect(tree.content.children).toEqual([tree.tool])
  })

  it('keeps the release decision pure and explicit', () => {
    expect(shouldRestoreGroupedProcessNode(true, true)).toBe(true)
    expect(shouldRestoreGroupedProcessNode(false, true)).toBe(false)
    expect(shouldRestoreGroupedProcessNode(true, false)).toBe(false)
  })
})

describe('ProcessGroupReleaseBoundary', () => {
  it('releases the decorated subtree before a commit (getSnapshotBeforeUpdate)', () => {
    const tree = chatTurnTree({ streaming: true })
    const boundary = new ProcessGroupReleaseBoundary({ getReleaseRoot: () => asElement(tree.root) })

    boundary.getSnapshotBeforeUpdate()

    expect(tree.root.querySelectorAll('.quickforge-process-group')).toEqual([])
    expect(tree.content.children).toEqual([tree.thinking, tree.tool])
  })

  it('skips the release when the message-list identity is unchanged (pure streaming commit)', () => {
    const messages: readonly AgentMessage[] = []
    const tree = chatTurnTree({ streaming: false })
    const onReleased = vi.fn()
    const boundary = new ProcessGroupReleaseBoundary({ messages, getReleaseRoot: () => asElement(tree.root), onReleased })

    boundary.getSnapshotBeforeUpdate({ messages })

    expect(tree.root.querySelectorAll('.quickforge-process-group')).toEqual([tree.group])
    expect(tree.content.children).toEqual([tree.group])
    expect(onReleased).not.toHaveBeenCalled()
  })

  it('releases when a structural commit swapped the message list', () => {
    // 结构变化 = 行渲染身份序列变化（新增/删除/重排/换身份），不是数组引用变化。
    const prevMessages: readonly AgentMessage[] = []
    const nextMessages: readonly AgentMessage[] = [{ role: 'user', content: 'next turn', timestamp: 2 }]
    const tree = chatTurnTree({ streaming: false })
    const onReleased = vi.fn()
    const boundary = new ProcessGroupReleaseBoundary({ messages: nextMessages, getReleaseRoot: () => asElement(tree.root), onReleased })

    boundary.getSnapshotBeforeUpdate({ messages: prevMessages })

    expect(tree.root.querySelectorAll('.quickforge-process-group')).toEqual([])
    expect(tree.content.children).toEqual([tree.thinking, tree.tool])
    expect(onReleased).toHaveBeenCalledTimes(1)
  })

  it('keeps the release decision structural (row render identities, not array identity)', () => {
    const messages: readonly AgentMessage[] = [{ role: 'user', content: 'hi', timestamp: 1 }]
    const gate = { messages }
    expect(shouldReleaseProcessGroups(gate, gate)).toBe(false)
    // 引用变化但行身份序列不变（如 tool_execution_update 原位重插同一 toolResult
    // 行）：不释放，否则每次 trace 节流帧都解散存活折叠组并重启其 CSS 动画。
    expect(shouldReleaseProcessGroups(gate, { messages: [...messages] })).toBe(false)
    expect(shouldReleaseProcessGroups(
      { messages },
      { messages: [...messages, { role: 'user', content: 'again', timestamp: 2 }] },
    )).toBe(true)
    expect(shouldReleaseProcessGroups(undefined, gate)).toBe(true)
    expect(shouldReleaseProcessGroups(gate, undefined)).toBe(true)
    expect(shouldReleaseProcessGroups(undefined, undefined)).toBe(true)
    // 终态翻转：isStreaming 或流式行 presence 变化，列表身份不变也释放。
    expect(shouldReleaseProcessGroups({ messages, isStreaming: true }, { messages, isStreaming: false })).toBe(true)
    expect(
      shouldReleaseProcessGroups({ messages, isStreaming: true, streamingAssistant: {} as AssistantMessageType }, { messages, isStreaming: true }),
    ).toBe(true)
    expect(shouldReleaseProcessGroups({ messages }, { messages, isStreaming: true, streamingAssistant: {} as AssistantMessageType })).toBe(true)
    // 纯流式帧：partial 每帧浅拷贝出新对象，presence 不变 → 跳过。
    expect(
      shouldReleaseProcessGroups(
        { messages, isStreaming: true, streamingAssistant: {} as AssistantMessageType },
        { messages, isStreaming: true, streamingAssistant: {} as AssistantMessageType },
      ),
    ).toBe(false)
  })

  it('releases when isStreaming flips with the message list unchanged (terminal event)', () => {
    const messages: readonly AgentMessage[] = []
    const streamingAssistant = {} as AssistantMessageType
    const tree = chatTurnTree({ streaming: true })
    const onReleased = vi.fn()
    const boundary = new ProcessGroupReleaseBoundary({
      messages,
      isStreaming: true,
      streamingAssistant,
      getReleaseRoot: () => asElement(tree.root),
      onReleased,
    })

    // bug 现场：组持有 thinking，React 对渲染容器 removeChild 会抛 NotFoundError。
    expect(() => reactRemoveChild(tree.content, tree.thinking)).toThrow(/NotFoundError/)

    // agent_end / turn_end / abort / 404 轮询：只翻转 isStreaming，已提交列表身份不变。
    boundary.getSnapshotBeforeUpdate({ messages, isStreaming: false })

    expect(tree.group.parentNode).toBeNull()
    expect(tree.content.children).toEqual([tree.thinking, tree.tool])
    expect(onReleased).toHaveBeenCalledTimes(1)
    // 释放后 React 卸载流式容器子树不再抛 removeChild 错误。
    expect(() => reactRemoveChild(tree.content, tree.thinking)).not.toThrow()
    expect(() => reactRemoveChild(tree.content, tree.tool)).not.toThrow()
  })

  it('releases when the streaming partial is cleared without a message-list swap', () => {
    const messages: readonly AgentMessage[] = []
    const streamingAssistant = {} as AssistantMessageType
    const tree = chatTurnTree({ streaming: true })
    const onReleased = vi.fn()
    const boundary = new ProcessGroupReleaseBoundary({
      messages,
      isStreaming: true,
      streamingAssistant,
      getReleaseRoot: () => asElement(tree.root),
      onReleased,
    })

    // message_end 之后流式行清空、isStreaming 仍为 true：流式行卸载同样要释放。
    boundary.getSnapshotBeforeUpdate({ messages, isStreaming: true })

    expect(tree.group.parentNode).toBeNull()
    expect(tree.content.children).toEqual([tree.thinking, tree.tool])
    expect(onReleased).toHaveBeenCalledTimes(1)
    expect(() => reactRemoveChild(tree.content, tree.thinking)).not.toThrow()
  })

  it('keeps pure streaming frames skipped: partial identity churn alone never releases', () => {
    const messages: readonly AgentMessage[] = []
    const tree = chatTurnTree({ streaming: true })
    const onReleased = vi.fn()
    const boundary = new ProcessGroupReleaseBoundary({
      messages,
      isStreaming: true,
      streamingAssistant: {} as AssistantMessageType,
      getReleaseRoot: () => asElement(tree.root),
      onReleased,
    })

    // 流式 partial 每帧浅拷贝出新对象（readAgentSnapshot），presence 不变 → 跳过释放。
    boundary.getSnapshotBeforeUpdate({ messages, isStreaming: true, streamingAssistant: {} as AssistantMessageType })

    expect(tree.group.parentNode).toBe(tree.content)
    expect(tree.root.querySelectorAll('.quickforge-process-group')).toEqual([tree.group])
    expect(onReleased).not.toHaveBeenCalled()
  })

  it('asks the host for a re-fold only when a group was actually handed back', () => {
    const onReleased = vi.fn()
    const tree = chatTurnTree({ streaming: true })
    const boundary = new ProcessGroupReleaseBoundary({ getReleaseRoot: () => asElement(tree.root), onReleased })

    boundary.getSnapshotBeforeUpdate()
    expect(onReleased).toHaveBeenCalledTimes(1)

    // 已经释放过（例如输入框打字触发的后续 commit）就不再请求装饰。
    boundary.getSnapshotBeforeUpdate()
    expect(onReleased).toHaveBeenCalledTimes(1)
    expect(onReleased).toHaveBeenCalledWith()
  })

  it('releases on unmount so no decoration state outlives the subtree', () => {
    const tree = chatTurnTree({ streaming: false })
    const boundary = new ProcessGroupReleaseBoundary({ getReleaseRoot: () => asElement(tree.root) })

    boundary.componentWillUnmount()

    expect(tree.group.parentNode).toBeNull()
    expect(tree.content.children).toEqual([tree.thinking, tree.tool])
  })

  it('is a no-op before the root exists and renders children as-is', () => {
    const children = null
    const boundary = new ProcessGroupReleaseBoundary({ children, getReleaseRoot: () => null })

    expect(() => boundary.getSnapshotBeforeUpdate()).not.toThrow()
    expect(() => boundary.componentWillUnmount()).not.toThrow()
    expect(boundary.render()).toBe(children)
  })
})
