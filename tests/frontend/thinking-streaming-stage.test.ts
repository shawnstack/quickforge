import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// i18n 由调用方注入（与 process-folding.test.ts 同形状）。tool-display-settings
// 刻意不 mock：本文件用真实模块的 applyToolDisplaySettingsValue 驱动
// expandProcessStageByDefault（完整形状，避免 mock 缺字段造成的假绿）。
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })

import { decorateProcessBlocks, releaseProcessGroups } from '../../src/components/chat/panel-decoration/process-folding'
import { applyToolDisplaySettingsValue, DEFAULT_TOOL_DISPLAY_SETTINGS } from '../../src/lib/tool-display-settings'

/**
 * 流式思考行与内层 stage 折叠的可见性护栏（全 decorateProcessBlocks 路径）。
 *
 * 背景（thinking-tail-hint 真机不生效的根因）：Agent 模式下 thinking 与 tool 交替
 * 时，splitProcessStageSections 把同段过程项（thinking + tool）归入一个内层
 * stage（processSectionNeedsStage：段内含任一 tool-message 即建 stage），正在
 * 流式的 thinking 块被 populateProcessGroup 搬进 stage body；当设置
 * expandProcessStageByDefault=false 时 stage 默认收起（data-expanded=false →
 * index.css `.quickforge-process-stage[data-expanded="false"] > …-stage-body {
 * visibility:hidden }`）——思考行连同尾行提示 hint 一起不可见。纯 thinking 段
 * （无 tool）不建 stage、直挂顶层组 body，不受影响。
 *
 * 兜底规则已从「含流式思考的 stage 强制展开」改为「流式思考行不进 stage、挂顶层组
 * body」（见 process-folding.ts 的 isStreamingThinkingItem）：强制展开会让每轮工具
 * 调用结束（组全量重建 → stage 回落设置默认收起）与下一轮流式思考往复开合，观感就是
 * 用户反馈的「新的一轮消息来了之后展开又收缩反复」。现在 stage 始终跟随设置默认，
 * 流式思考行（含 hint）在组 body 上照样可见，本轮结束后随重建收进 stage。
 *
 * 项目 vitest 跑在 node 环境（无 jsdom），按仓库既有约定
 * （process-folding-incremental.test.ts）手写最小 fake DOM 并 import 真实
 * decorateProcessBlocks 跑全流程。与 incremental 版 fake 的两处差异：
 * ① 补 prepend（思考头接管 [icon, label, chevron, hint] 需要）；
 * ② innerHTML 解析「空 <span class="…"></span>」形态——组/阶段摘要头的 label
 * span 来自 innerHTML 字符串，label 查询不到会让 updateProcessGroup /
 * updateProcessStageGroups 在 expanded 解析前提前 return，本轮断言依赖它。
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
    // 只解析「空 <span class="…"></span>」形态（组/阶段摘要头的 label span）；
    // chevron span 内含 svg，不解析（本轮断言不依赖）。
    for (const match of value.matchAll(/<span ([^>]*)><\/span>/g)) {
      const classMatch = match[1]?.match(/class="([^"]*)"/)
      this.append(new FakeNode('span', classMatch?.[1] ?? ''))
    }
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

  prepend(...nodes: FakeNode[]): FakeNode {
    nodes.slice().reverse().forEach((node) => {
      node.parentNode?.detach(node)
      node.parentNode = this
      this.children.unshift(node)
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

afterEach(() => {
  // 真实模块缓存是模块级共享：每个用例结束回归默认设置，避免跨用例泄漏。
  applyToolDisplaySettingsValue(DEFAULT_TOOL_DISPLAY_SETTINGS)
})

const el = (tagName: string, className = '') => new FakeNode(tagName, className)

/** 一条已渲染的工具行（React `ToolMessage` 形态：div.qf-tool-message + toolCall 属性）。 */
function toolRow(id: string) {
  const node = el('div', 'qf-tool-message')
  Object.assign(node, { toolCall: { id, name: 'run_command', arguments: {} } })
  return node
}

/** React `ThinkingBlock` 形态：.qf-thinking-block.thinking-block > button.thinking-header > [svg, span]。 */
function thinkingRow() {
  const block = el('div', 'qf-thinking-block thinking-block')
  const header = block.append(el(
    'button',
    'thinking-header flex cursor-pointer select-none items-center gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground',
  ))
  const chevron = header.append(el('svg', 'inline-block size-4 transition-transform'))
  const label = header.append(el('span', ''))
  return { block, header, chevron, label }
}

type StreamingTurn = {
  panel: FakeNode
  list: FakeNode
  assistant: FakeNode
  content: FakeNode
  thinking: ReturnType<typeof thinkingRow>
}

/**
 * 一个正在流式的回合：assistant bridge `isStreaming=true`、message.content 含
 * thinking 文本（hint 取段链路的数据源），content 下先挂 thinking 行，可选再挂
 * 工具行（thinking 在前，Agent 模式交替的典型序）。
 */
function streamingThinkingTurn(thinkingText: string, { withTool = false } = {}): StreamingTurn {
  const panel = el('div', 'qf-chat-panel')
  panel.connectedRoot = true
  const list = panel.append(el('div', 'qf-message-list'))
  const assistant = list.append(el('div', 'qf-assistant-message'))
  Object.assign(assistant, {
    isStreaming: true,
    message: { timestamp: 1, content: [{ type: 'thinking', thinking: thinkingText }] },
  })
  const content = assistant.append(el('div', 'px-4 flex flex-col'))
  const thinking = thinkingRow()
  content.append(thinking.block)
  if (withTool) content.append(toolRow('cmd-1'))
  return { panel, list, assistant, content, thinking }
}

function groupOf(turn: StreamingTurn) {
  return turn.content.querySelector('.quickforge-process-group')
}

function stageOf(group: FakeNode | null | undefined) {
  return group?.querySelector('.quickforge-process-stage')
}

function stageBodyOf(stage: FakeNode | null | undefined) {
  return stage?.querySelector('.quickforge-process-stage-body')
}

function hintOf(header: FakeNode) {
  return header.children.find((child) => child.dataset.quickforgeThinkingRole === 'hint')
}

function crossAssistantStreamingTurn() {
  const panel = el('div', 'qf-chat-panel')
  panel.connectedRoot = true
  const list = panel.append(el('div', 'qf-message-list'))

  const historical = list.append(el('div', 'qf-assistant-message'))
  Object.assign(historical, {
    isStreaming: false,
    message: { timestamp: 1, content: [{ type: 'thinking', thinking: '历史思考' }] },
  })
  const historicalContent = historical.append(el('div', 'px-4 flex flex-col'))
  const historicalThinking = thinkingRow()
  historicalContent.append(historicalThinking.block)

  const streaming = list.append(el('div', 'qf-assistant-message'))
  Object.assign(streaming, {
    isStreaming: true,
    // 空白 thinking chunk 不会渲染 thinking block；非空段序号必须仍然从 0 连续绑定。
    message: {
      timestamp: 2,
      content: [
        { type: 'thinking', thinking: '   ' },
        { type: 'thinking', thinking: '第一段\n' },
        { type: 'thinking', thinking: '第二段' },
      ],
    },
  })
  const streamingContent = streaming.append(el('div', 'px-4 flex flex-col'))
  const firstStreamingThinking = thinkingRow()
  const secondStreamingThinking = thinkingRow()
  streamingContent.append(firstStreamingThinking.block, secondStreamingThinking.block, toolRow('cmd-cross'))

  return {
    panel,
    historical,
    historicalContent,
    historicalThinking,
    streaming,
    streamingContent,
    firstStreamingThinking,
    secondStreamingThinking,
  }
}

describe('thinking streaming stage visibility (full decorateProcessBlocks path)', () => {
  it('S1: streaming thinking-only turn keeps the thinking row on the group body with a running hint', () => {
    applyToolDisplaySettingsValue({ ...DEFAULT_TOOL_DISPLAY_SETTINGS, expandProcessStageByDefault: false })
    const turn = streamingThinkingTurn('正在分析问题…')

    decorateProcessBlocks(turn.panel, [turn.assistant], true)

    // 正向对照：纯思考段（无 tool）不建 stage，思考块直挂组 body 的 step；
    // 流式回合组默认展开，hint 链路（接管 + 取段 + running 标记）本身是通的。
    const group = groupOf(turn)
    expect(group).toBeTruthy()
    expect(group?.querySelector('.quickforge-process-stage')).toBeNull()
    expect(turn.thinking.block.closest('.quickforge-process-group')).toBe(group)
    expect(group?.dataset.expanded).toBe('true')

    const hint = hintOf(turn.thinking.header)
    expect(hint).toBeTruthy()
    expect(hint?.getAttribute('running')).toBe('true')
    expect(hint?.getAttribute('text')).toBe('正在分析问题…')
    expect(hint?.classList.contains('quickforge-process-thinking-hint-visible')).toBe(true)
  })

  it('S2: keeps the stage collapsed and the streaming thinking row on the group body when expandProcessStageByDefault=false', () => {
    applyToolDisplaySettingsValue({ ...DEFAULT_TOOL_DISPLAY_SETTINGS, expandProcessStageByDefault: false })
    const turn = streamingThinkingTurn('先思考一下…', { withTool: true })

    decorateProcessBlocks(turn.panel, [turn.assistant], true)

    // 设置默认收起：stage 不因内含流式思考行而强制展开。流式思考行改挂顶层组 body 层
    // （组在流式期间默认展开），所以思考行与尾行提示照样可见，stage 保持设置默认。
    const group = groupOf(turn)
    const stage = stageOf(group)
    expect(stage).toBeTruthy()
    expect(stage?.dataset.expanded).toBe('false')
    expect(turn.thinking.block.closest('.quickforge-process-stage-body')).toBeNull()
    expect(turn.thinking.block.closest('.quickforge-process-group')).toBe(group)
    expect(turn.thinking.block.closest('.quickforge-process-body')).toBe(group?.querySelector(':scope > .quickforge-process-body'))
    expect(hintOf(turn.thinking.header)?.getAttribute('running')).toBe('true')
    expect(hintOf(turn.thinking.header)?.getAttribute('text')).toBe('先思考一下…')
  })

  it('S3: the same mixed section expands the stage when expandProcessStageByDefault=true', () => {
    applyToolDisplaySettingsValue({ ...DEFAULT_TOOL_DISPLAY_SETTINGS, expandProcessStageByDefault: true })
    const turn = streamingThinkingTurn('先思考一下…', { withTool: true })

    decorateProcessBlocks(turn.panel, [turn.assistant], true)

    // 证明开关就是变量：同一 DOM，设置默认展开时 stage 展开、思考行可见。
    const group = groupOf(turn)
    const stage = stageOf(group)
    expect(stage).toBeTruthy()
    expect(turn.thinking.block.closest('.quickforge-process-stage-body')).toBe(stageBodyOf(stage))
    expect(stage?.dataset.expanded).toBe('true')
  })

  it('folds the streaming thinking row into the (still collapsed) stage once streaming ends', () => {
    applyToolDisplaySettingsValue({ ...DEFAULT_TOOL_DISPLAY_SETTINGS, expandProcessStageByDefault: false })
    const turn = streamingThinkingTurn('先思考一下…', { withTool: true })
    decorateProcessBlocks(turn.panel, [turn.assistant], true)
    const streamingGroup = groupOf(turn)
    expect(streamingGroup).toBeTruthy()
    // 流式期间：stage 保持设置默认（收起），流式思考行挂在组 body 上照样可见。
    expect(stageOf(streamingGroup)?.dataset.expanded).toBe('false')
    expect(turn.thinking.block.closest('.quickforge-process-stage-body')).toBeNull()

    // 流式结束：真实流程是 ProcessGroupReleaseBoundary 在结构提交前释放全部
    // 折叠组（getSnapshotBeforeUpdate），同一提交内重折叠——此时思考行不再是
    // 「流式思考行」，随重建收进 stage；stage 仍跟随设置默认（收起），全程没有
    // 自动展开，因此不存在「展开→收缩」的开合动作。
    turn.assistant.isStreaming = false
    releaseProcessGroups(turn.panel)
    decorateProcessBlocks(turn.panel, [turn.assistant], false)

    const rebuiltGroup = groupOf(turn)
    expect(rebuiltGroup).toBeTruthy()
    expect(rebuiltGroup).not.toBe(streamingGroup)
    const stage = stageOf(rebuiltGroup)
    expect(stage).toBeTruthy()
    expect(turn.thinking.block.closest('.quickforge-process-stage-body')).toBe(stageBodyOf(stage))
    expect(stage?.dataset.expanded).toBe('false')
    // 流式结束后 hint 淡出（running=false），保持既有尾行提示语义。
    expect(hintOf(turn.thinking.header)?.getAttribute('running')).toBe('false')
  })

  it('keeps the stage collapsed across tool rounds when expandProcessStageByDefault=false (no expand/collapse loop)', () => {
    applyToolDisplaySettingsValue({ ...DEFAULT_TOOL_DISPLAY_SETTINGS, expandProcessStageByDefault: false })
    // 第一轮：思考行 + 工具行（工具行到达时该轮思考已结束，message_end 后 bridge isStreaming=false）。
    const turn = streamingThinkingTurn('第一轮思考…', { withTool: true })
    decorateProcessBlocks(turn.panel, [turn.assistant], true)
    const firstGroup = groupOf(turn)
    const firstStage = stageOf(firstGroup)
    expect(firstStage?.dataset.expanded).toBe('false')

    // 第二轮：同一回合追加一条新的流式 assistant（含新的流式思考行）——这正是用户反馈里
    // 「新的一轮消息来了之后展开又收缩」的触发帧：结构变化走全量重建，旧实现会在此把
    // 「含流式思考」的 stage 强制展开，本轮工具调用结束又收起，逐轮往复。
    turn.assistant.isStreaming = false
    const secondAssistant = turn.list.append(el('div', 'qf-assistant-message'))
    Object.assign(secondAssistant, {
      isStreaming: true,
      message: { timestamp: 2, content: [{ type: 'thinking', thinking: '第二轮思考…' }] },
    })
    const secondContent = secondAssistant.append(el('div', 'px-4 flex flex-col'))
    const secondThinking = thinkingRow()
    secondContent.append(secondThinking.block)

    releaseProcessGroups(turn.panel)
    decorateProcessBlocks(turn.panel, [turn.assistant, secondAssistant], true)

    const rebuiltGroup = groupOf(turn)
    expect(rebuiltGroup).toBeTruthy()
    expect(rebuiltGroup).not.toBe(firstGroup)
    const streamingStage = stageOf(rebuiltGroup)
    // stage 保持收起；第二轮流式思考行挂在组 body 上（不被收起态藏住）。
    expect(streamingStage?.dataset.expanded).toBe('false')
    expect(secondThinking.block.closest('.quickforge-process-stage-body')).toBeNull()
    expect(secondThinking.block.closest('.quickforge-process-group')).toBe(rebuiltGroup)
    expect(hintOf(secondThinking.header)?.getAttribute('running')).toBe('true')
    expect(hintOf(secondThinking.header)?.getAttribute('text')).toBe('第二轮思考…')
    // 第一轮（已结束）的思考行仍在 stage 里。
    expect(turn.thinking.block.closest('.quickforge-process-stage-body')).toBe(stageBodyOf(streamingStage))

    // 第二轮结束（message_end + 该轮工具行出现）：stage 依旧是设置默认（收起），
    // 流式思考行随重建收进 stage——整个过程没有任何开合动画帧。
    secondAssistant.isStreaming = false
    secondContent.append(toolRow('cmd-2'))
    releaseProcessGroups(turn.panel)
    decorateProcessBlocks(turn.panel, [turn.assistant, secondAssistant], true)
    const finalStage = stageOf(groupOf(turn))
    expect(finalStage?.dataset.expanded).toBe('false')
    expect(secondThinking.block.closest('.quickforge-process-stage-body')).toBe(stageBodyOf(finalStage))
  })

  it('keeps historical thinking owned by its source assistant while a sibling streams', () => {
    applyToolDisplaySettingsValue({ ...DEFAULT_TOOL_DISPLAY_SETTINGS, expandProcessStageByDefault: false })
    const turn = crossAssistantStreamingTurn()

    decorateProcessBlocks(turn.panel, [turn.historical, turn.streaming], true)

    const group = turn.historicalContent.querySelector('.quickforge-process-group')
    expect(group).toBeTruthy()
    expect(turn.historicalThinking.block.closest('.qf-assistant-message')).toBe(turn.historical)
    expect(turn.historicalThinking.block.closest('.quickforge-process-group')).toBe(group)
    // The moved nodes physically live under the historical anchor assistant; source
    // ownership is asserted through hint/stage behavior, not by the post-move DOM host.
    expect(hintOf(turn.historicalThinking.header)?.getAttribute('text') ?? '').toBe('')
    expect(hintOf(turn.historicalThinking.header)?.getAttribute('running')).toBe('false')
    // 同一条流式消息里前一段思考已经结束：右侧提示只留在仍是 content 末块的那一段。
    expect(hintOf(turn.firstStreamingThinking.header)?.getAttribute('text') ?? '').toBe('')
    expect(hintOf(turn.firstStreamingThinking.header)?.getAttribute('running')).toBe('false')
    expect(hintOf(turn.secondStreamingThinking.header)?.getAttribute('text')).toBe('第二段')
    // 设置默认收起：stage 不因内含流式思考行而强制展开（本段最后一项是工具行，段尾没有
    // 可抽出的流式思考行，思考行仍在 stage 内 → 收起态下不可见，与设置语义一致）。
    expect(stageOf(group)?.dataset.expanded).toBe('false')

    const stage = stageOf(group)
    const stageSummary = stage?.querySelector(':scope > .quickforge-process-stage-summary') as
      (FakeNode & { onclick?: (event: { preventDefault(): void; stopPropagation(): void }) => void }) | null
    stageSummary?.onclick?.({ preventDefault() {}, stopPropagation() {} })
    // 用户手动展开 = saved state（按回合记忆）。
    expect(stage?.dataset.expanded).toBe('true')

    const nextNow = Date.now() + 1000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nextNow)
    turn.streaming.message = {
      timestamp: 2,
      content: [
        { type: 'thinking', thinking: '   ' },
        { type: 'thinking', thinking: '第一段\n' },
        { type: 'thinking', thinking: '第二段更新' },
      ],
    }
    decorateProcessBlocks(turn.panel, [turn.historical, turn.streaming], true)
    expect(hintOf(turn.secondStreamingThinking.header)?.getAttribute('text')).toBe('第二段更新')
    expect(stage?.dataset.expanded).toBe('true')
    nowSpy.mockRestore()

    // 真实消息结构变化由 ProcessGroupReleaseBoundary 先释放旧组，再由 React 在
    // 来源 assistant 容器末尾追加新的 thinking；重建时不能把它当成宿主
    // assistant 的序号。
    releaseProcessGroups(turn.panel)
    const thirdStreamingThinking = thinkingRow()
    turn.streamingContent.append(thirdStreamingThinking.block)
    turn.streaming.message.content.push({ type: 'thinking', thinking: '第三段' })
    decorateProcessBlocks(turn.panel, [turn.historical, turn.streaming], true)
    const rebuiltDuringStreaming = turn.historicalContent.querySelector('.quickforge-process-group')
    expect(rebuiltDuringStreaming).toBeTruthy()
    expect(rebuiltDuringStreaming).not.toBe(group)
    expect(hintOf(thirdStreamingThinking.header)?.getAttribute('text')).toBe('第三段')
    // 手动展开的 saved state 在重建后仍优先（同一 stage key）。
    expect(stageOf(rebuiltDuringStreaming)?.dataset.expanded).toBe('true')

    turn.streaming.isStreaming = false
    releaseProcessGroups(turn.panel)
    expect(turn.historicalThinking.block.parentNode).toBe(turn.historicalContent)
    expect(turn.firstStreamingThinking.block.parentNode).toBe(turn.streamingContent)
    expect(turn.secondStreamingThinking.block.parentNode).toBe(turn.streamingContent)
    expect(thirdStreamingThinking.block.parentNode).toBe(turn.streamingContent)
    decorateProcessBlocks(turn.panel, [turn.historical, turn.streaming], false)
    expect(turn.historicalContent.querySelector('.quickforge-process-group')).toBeTruthy()
    expect(hintOf(turn.historicalThinking.header)?.getAttribute('running')).toBe('false')
    expect(hintOf(turn.firstStreamingThinking.header)?.getAttribute('running')).toBe('false')
    expect(hintOf(turn.secondStreamingThinking.header)?.getAttribute('running')).toBe('false')
  })

  it('keeps a stage the user manually collapsed collapsed while streaming continues', () => {
    // 设置默认展开时 stage 初始展开；用户手动收起后 saved state 优先，流式继续不再弹开。
    applyToolDisplaySettingsValue({ ...DEFAULT_TOOL_DISPLAY_SETTINGS, expandProcessStageByDefault: true })
    const turn = streamingThinkingTurn('先思考一下…', { withTool: true })
    decorateProcessBlocks(turn.panel, [turn.assistant], true)
    const stage = stageOf(groupOf(turn))
    expect(stage?.dataset.expanded).toBe('true')

    // 用户手动收起（点击阶段摘要头）：saved state 优先于设置默认值。
    const stageSummary = stage?.querySelector(':scope > .quickforge-process-stage-summary') as
      (FakeNode & { onclick?: (event: { preventDefault(): void; stopPropagation(): void }) => void }) | null
    stageSummary?.onclick?.({ preventDefault() {}, stopPropagation() {} })
    expect(stage?.dataset.expanded).toBe('false')

    // 流式继续（同一结构，update 快路径）：stage 保持用户收起，不被设置默认翻回。
    decorateProcessBlocks(turn.panel, [turn.assistant], true)
    expect(stage?.dataset.expanded).toBe('false')
    // hint 链路不依赖 stage 开合：流式中仍 running。
    expect(hintOf(turn.thinking.header)?.getAttribute('running')).toBe('true')
  })

  it('signals reading intent when the user toggles a stage (detaches tail-following)', () => {
    const turn = streamingThinkingTurn('先思考一下…', { withTool: true })
    decorateProcessBlocks(turn.panel, [turn.assistant], true)
    const stage = stageOf(groupOf(turn))

    const captured: Event[] = []
    const stageSummary = stage?.querySelector(':scope > .quickforge-process-stage-summary') as
      (FakeNode & {
        onclick?: (event: { preventDefault(): void; stopPropagation(): void }) => void
        dispatchEvent?: (event: Event) => boolean
      }) | null
    if (stageSummary) stageSummary.dispatchEvent = (event: Event) => { captured.push(event); return true }

    stageSummary?.onclick?.({ preventDefault() {}, stopPropagation() {} })

    // 手动开合 stage = 阅读意图：READING_INTENT_EVENT 必须从摘要头冒泡出去，
    // 由 scroll-sync 解除贴底跟随——否则展开内容在下一帧就被跟随滚动拉出
    // 视口（「展开后滚动跳/重新展开感」的滚动侧根因）。
    expect(captured.map((event) => (event as CustomEvent).type)).toEqual(['quickforge:reading-intent'])
    expect((captured[0] as CustomEvent).bubbles).toBe(true)
    // 事件不应替代开关语义：展开状态照常翻转。
    expect(stage?.dataset.expanded).toBe('false')
  })

  it('signals reading intent when the user toggles the process group summary', () => {
    const turn = streamingThinkingTurn('先思考一下…', { withTool: true })
    decorateProcessBlocks(turn.panel, [turn.assistant], true)
    const group = groupOf(turn)

    const captured: Event[] = []
    const summary = group?.querySelector('.quickforge-process-summary') as
      (FakeNode & {
        onpointerdown?: (event: { button?: number; isPrimary?: boolean }) => void
        onclick?: (event: { detail?: number; preventDefault(): void; stopPropagation(): void }) => void
        dispatchEvent?: (event: Event) => boolean
      }) | null
    if (summary) summary.dispatchEvent = (event: Event) => { captured.push(event); return true }

    // 流式期间 group 摘要走 pointerdown 切换（shouldToggleProcessSummary）。
    summary?.onpointerdown?.({ button: 0, isPrimary: true, stopPropagation() {} })

    expect(captured.map((event) => (event as CustomEvent).type)).toEqual(['quickforge:reading-intent'])
    expect((captured[0] as CustomEvent).bubbles).toBe(true)
  })
})
