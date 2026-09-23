import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// i18n / tool display settings 由调用方注入（与 process-folding.test.ts 同形状）。
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: 'compact', showContextUsage: false }),
}), { virtual: true })

import { decorateProcessThinkingBlocks, latestThinkingLine } from '../../src/components/chat/panel-decoration/process-folding'

/**
 * 思考头第四槽位「尾行提示」的行为护栏：流式且收起时显示最新一段思考文字（含
 * 进行中未换行的行），行身份（段行号）切换重触发淡入类，同一行内文本增长按
 * ~300ms 时间窗节流（窗口内零 DOM 写、窗口过后 text 追平且不重触发淡入），展开 /
 * 流式结束时淡出（类切换驱动 CSS 过渡），帧内容未变时零 DOM 写（幂等契约与
 * thinking-header-adoption.test.ts 同口径）。
 *
 * 延续仓库约定：node 环境手写最小 fake DOM，FakeNode 增设 domWrites 计数器
 * （setAttribute 调用、class 变更、textContent 重写），断言「未变帧零 DOM 写」。
 */

// ---------------------------------------------------------------------------
// Minimal fake DOM：children/dataset/classList/setAttribute/querySelector/
// closest/append/prepend + 写入计数（classList 与真实 DOM 同为无变化不落写）。
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
  /** 每次赋值 textContent 都视为销毁重建文本节点（真实 DOM 语义）。 */
  textIdentity: object | null = null
  /** append/prepend 对子级列表的写入次数。 */
  childListWrites = 0
  /** 装饰层产生的 DOM 写入次数（setAttribute 调用 / class 变更 / textContent 重写）。 */
  domWrites = 0

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
    this.textIdentity = {}
    this.domWrites += 1
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
    const writeClass = (next: string, changed: boolean) => {
      if (!changed) return
      this.attributes.class = next
      this.domWrites += 1
    }
    return {
      add: (...names: string[]) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean))
        const before = current.size
        names.forEach((name) => current.add(name))
        writeClass([...current].join(' '), current.size !== before)
      },
      remove: (...names: string[]) => {
        const removed = new Set(names)
        const next = this.className.split(/\s+/).filter((name) => name && !removed.has(name))
        writeClass(next.join(' '), next.length !== this.className.split(/\s+/).filter(Boolean).length)
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
    this.childListWrites += nodes.length
    nodes.forEach((node) => {
      node.parentNode?.detach(node)
      node.parentNode = this
      this.children.push(node)
    })
    return nodes[0] as FakeNode
  }

  prepend(...nodes: FakeNode[]): FakeNode {
    this.childListWrites += nodes.length
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
    this.domWrites += 1
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

/** AssistantMessage 的 DOM bridge 表面（.qf-assistant-message 根元素属性镜像）。 */
type AssistantBridge = FakeHTMLElement & {
  message?: { role?: string; content?: unknown }
  isStreaming?: boolean
}

type ReactThinkingTree = {
  panel: FakeNode
  group: FakeNode
  assistant: AssistantBridge
  blocks: FakeNode[]
  headers: FakeNode[]
  chevrons: FakeSvgElement[]
  labels: FakeNode[]
}

/**
 * React 真实形态（N 个思考块）：`.qf-chat-panel > .qf-message-list > .qf-assistant-message >
 * .px-4.flex.flex-col > .quickforge-process-group > .quickforge-process-body >
 * .qf-thinking-block.thinking-block > button.thinking-header > [svg, span]`。
 */
function reactThinkingTree(thinkingCount = 1, expanded = false): ReactThinkingTree {
  const panel = el('div', 'qf-chat-panel')
  const list = panel.append(el('div', 'qf-message-list'))
  const assistant = list.append(el('div', 'qf-assistant-message')) as AssistantBridge
  const content = assistant.append(el('div', 'px-4 flex flex-col'))
  const group = content.append(el('div', 'quickforge-process-group'))
  const body = group.append(el('div', 'quickforge-process-body'))
  const blocks: FakeNode[] = []
  const headers: FakeNode[] = []
  const chevrons: FakeSvgElement[] = []
  const labels: FakeNode[] = []
  for (let index = 0; index < thinkingCount; index += 1) {
    const thinkingBlock = body.append(el('div', 'qf-thinking-block thinking-block'))
    const header = thinkingBlock.append(el(
      'button',
      'thinking-header flex cursor-pointer select-none items-center gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground',
    ))
    const chevron = header.append(new FakeSvgElement(
      'svg',
      `inline-block size-4 transition-transform${expanded ? ' rotate-90' : ''}`,
    )) as FakeSvgElement
    const label = header.append(el('span', ''))
    blocks.push(thinkingBlock)
    headers.push(header)
    chevrons.push(chevron)
    labels.push(label)
  }
  return { panel, group, assistant, blocks, headers, chevrons, labels }
}

/** 模拟流式帧：bridge 上镜像最新的 message.content（thinking 累积文本）与 isStreaming。 */
function streamTo(
  tree: ReactThinkingTree,
  thinkingTexts: string[],
  streaming = true,
  extraContent: Array<Record<string, unknown>> = [],
) {
  tree.assistant.message = {
    role: 'assistant',
    content: [
      ...thinkingTexts.map((text) => ({ type: 'thinking', thinking: text })),
      ...extraContent,
    ],
  }
  tree.assistant.isStreaming = streaming
}

const HINT_CLASS = 'quickforge-process-thinking-hint'
const HINT_VISIBLE_CLASS = 'quickforge-process-thinking-hint-visible'
const HINT_IN_CLASS = 'quickforge-process-thinking-hint-in'

function hintOf(header: FakeNode): FakeNode {
  const hint = header.children.find((child) => child.dataset.quickforgeThinkingRole === 'hint')
  if (!hint) throw new Error('hint slot missing')
  return hint
}

describe('latestThinkingLine (取段规则：最后一个非空段，含进行中行)', () => {
  it('takes the last non-empty segment including the in-progress unterminated line', () => {
    expect(latestThinkingLine('first line\nsecond')).toBe('second')
    expect(latestThinkingLine('first line\nsecond line\n')).toBe('second line')
    expect(latestThinkingLine('a\n\n\nb\n\n')).toBe('b')
    expect(latestThinkingLine('only one partial line')).toBe('only one partial line')
    expect(latestThinkingLine('  \n \n')).toBe('')
  })

  it('caps the displayed line at the marquee-safe length without splitting surrogate pairs', () => {
    const long = `${'汉'.repeat(600)}\n`
    expect(Array.from(latestThinkingLine(long))).toHaveLength(500)
    // 进行中未换行的超长首行同样截断（无换行思考全程可见场景）。
    expect(Array.from(latestThinkingLine('汉'.repeat(600)))).toHaveLength(500)
  })
})

describe('process thinking hint (第四槽位尾行提示)', () => {
  it('adopts the hint as the fourth header slot, hidden without a streaming bridge', () => {
    const tree = reactThinkingTree()

    decorateProcessThinkingBlocks(tree.group)

    expect(tree.headers[0]?.children.map((child) => child.tagName)).toEqual(['SPAN', 'SPAN', 'SVG', 'QUICKFORGE-TOOL-MARQUEE'])
    const hint = hintOf(tree.headers[0] as FakeNode)
    expect(hint.className).toBe(HINT_CLASS)
    expect(hint.getAttribute('aria-hidden')).toBe('true')
    // 无 bridge / 非流式：整体隐藏（占位保留，淡出由 CSS 过渡承担）。
    // text 未写入（previousText '' === text '' 跳过），真实 DOM 语义等价空文本。
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(false)
    expect(hint.getAttribute('text') ?? '').toBe('')
    expect(hint.getAttribute('running')).toBe('false')
  })

  it('shows the latest thinking segment while streaming and collapsed', () => {
    const tree = reactThinkingTree()
    streamTo(tree, ['first line\nsecond line\n'])
    decorateProcessThinkingBlocks(tree.group)

    const hint = hintOf(tree.headers[0] as FakeNode)
    expect(hint.getAttribute('text')).toBe('second line')
    expect(hint.getAttribute('running')).toBe('true')
    // 首次出现：淡入由 visible 类的 enter 过渡承担，不叠加行切换动画类。
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)
    expect(hint.classList.contains(HINT_IN_CLASS)).toBe(false)
  })

  it('shows the in-progress line immediately when no newline has landed yet (进行中行立即可见)', () => {
    const tree = reactThinkingTree()
    streamTo(tree, ['thinking text without any newline yet'])
    decorateProcessThinkingBlocks(tree.group)

    const hint = hintOf(tree.headers[0] as FakeNode)
    expect(hint.getAttribute('text')).toBe('thinking text without any newline yet')
    expect(hint.getAttribute('running')).toBe('true')
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)
  })

  it('retriggers the fade-in class when a new line arrives (行切换淡入淡出类切换)', () => {
    const tree = reactThinkingTree()
    streamTo(tree, ['first line\nsecond line\n'])
    decorateProcessThinkingBlocks(tree.group)
    const hint = hintOf(tree.headers[0] as FakeNode)
    expect(hint.classList.contains(HINT_IN_CLASS)).toBe(false)

    streamTo(tree, ['first line\nsecond line\nthird line\n'])
    decorateProcessThinkingBlocks(tree.group)

    expect(hint.getAttribute('text')).toBe('third line')
    expect(hint.classList.contains(HINT_IN_CLASS)).toBe(true)
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)
  })

  it('retriggers the fade-in when a newline lands a new line mid-typing (换行产生新行淡入切换)', () => {
    const tree = reactThinkingTree()
    streamTo(tree, ['alpha'])
    decorateProcessThinkingBlocks(tree.group)
    const hint = hintOf(tree.headers[0] as FakeNode)
    expect(hint.getAttribute('text')).toBe('alpha')
    expect(hint.classList.contains(HINT_IN_CLASS)).toBe(false)

    streamTo(tree, ['alpha\nbeta'])
    decorateProcessThinkingBlocks(tree.group)

    expect(hint.getAttribute('text')).toBe('beta')
    expect(hint.classList.contains(HINT_IN_CLASS)).toBe(true)
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)
  })

  it('throttles same-line growth: zero writes in the window, catch-up after, no fade-in retrigger (同行增长节流)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const tree = reactThinkingTree()
      streamTo(tree, ['first line\nsecond'])
      decorateProcessThinkingBlocks(tree.group)
      const hint = hintOf(tree.headers[0] as FakeNode)
      expect(hint.getAttribute('text')).toBe('second')
      const hintWrites = hint.domWrites
      const headerChildListWrites = tree.headers[0]?.childListWrites ?? 0

      // 节流窗口内同行增长（流式高频帧）：零 DOM 写。
      streamTo(tree, ['first line\nsecond line still typin'])
      decorateProcessThinkingBlocks(tree.group)
      expect(hint.getAttribute('text')).toBe('second')
      expect(hint.domWrites).toBe(hintWrites)
      expect(tree.headers[0]?.childListWrites).toBe(headerChildListWrites)

      // 窗口边界前（299ms < 300ms）仍未放行。
      vi.setSystemTime(299)
      streamTo(tree, ['first line\nsecond line still typing'])
      decorateProcessThinkingBlocks(tree.group)
      expect(hint.getAttribute('text')).toBe('second')
      expect(hint.domWrites).toBe(hintWrites)

      // 窗口过后：text 追平，且不重触发淡入（同行增长只更新文本）。
      vi.setSystemTime(300)
      streamTo(tree, ['first line\nsecond line still typing along'])
      decorateProcessThinkingBlocks(tree.group)
      expect(hint.getAttribute('text')).toBe('second line still typing along')
      expect(hint.classList.contains(HINT_IN_CLASS)).toBe(false)
      expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)

      // 完全相同的下一帧同样零写。
      const afterWrites = hint.domWrites
      decorateProcessThinkingBlocks(tree.group)
      expect(hint.domWrites).toBe(afterWrites)
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks the change intent for the marquee: growth in place vs line switch roll', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const tree = reactThinkingTree()
      streamTo(tree, ['first line\nsecond'])
      decorateProcessThinkingBlocks(tree.group)
      const hint = hintOf(tree.headers[0] as FakeNode)
      // 首次出现无旧文本：就地更新（不叠整行滚入）。
      expect(hint.getAttribute('roll')).toBe('false')

      // 同一行内增长（窗口过后）：文本就地追平，roll 仍为 false、不重触发淡入。
      vi.setSystemTime(1000)
      streamTo(tree, ['first line\nsecond line grows'])
      decorateProcessThinkingBlocks(tree.group)
      expect(hint.getAttribute('text')).toBe('second line grows')
      expect(hint.getAttribute('roll')).toBe('false')
      expect(hint.classList.contains(HINT_IN_CLASS)).toBe(false)

      // 行切换：roll=true 交给跑马灯做整行滚入（配套淡入类重触发）。
      streamTo(tree, ['first line\nsecond line grows\nthird'])
      decorateProcessThinkingBlocks(tree.group)
      expect(hint.getAttribute('text')).toBe('third')
      expect(hint.getAttribute('roll')).toBe('true')
      expect(hint.classList.contains(HINT_IN_CLASS)).toBe(true)

      // 流式结束（text 清空）：同样带 roll 标记（默认滚入语义，无旧文本即就地清空）。
      vi.setSystemTime(2000)
      streamTo(tree, ['first line\nsecond line grows\nthird'], false)
      decorateProcessThinkingBlocks(tree.group)
      expect(hint.getAttribute('text')).toBe('')
      expect(hint.getAttribute('roll')).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides the hint when the thinking block is expanded and restores it on collapse', () => {
    const tree = reactThinkingTree()
    streamTo(tree, ['line one\nline two\n'])
    decorateProcessThinkingBlocks(tree.group)
    const hint = hintOf(tree.headers[0] as FakeNode)
    expect(hint.getAttribute('text')).toBe('line two')

    // React 重渲染展开：chevron class 被整体重写（rotate-90 回归），接管条件失效，
    // 走完整接管路径后按展开态隐藏。
    tree.chevrons[0]?.setAttribute('class', 'inline-block size-4 transition-transform rotate-90')
    decorateProcessThinkingBlocks(tree.group)

    expect(hint.getAttribute('text')).toBe('')
    expect(hint.getAttribute('running')).toBe('false')
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(false)
    expect(tree.chevrons[0]?.classList.contains('quickforge-process-thinking-chevron-expanded')).toBe(true)

    // 收起：React 再重写回去，重新接管后提示恢复显示。
    tree.chevrons[0]?.setAttribute('class', 'inline-block size-4 transition-transform')
    decorateProcessThinkingBlocks(tree.group)

    expect(hint.getAttribute('text')).toBe('line two')
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)
  })

  it('fades the hint out when streaming ends (思考结束淡出)', () => {
    const tree = reactThinkingTree()
    streamTo(tree, ['line one\nline two\n'])
    decorateProcessThinkingBlocks(tree.group)
    const hint = hintOf(tree.headers[0] as FakeNode)
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)

    streamTo(tree, ['line one\nline two\n'], false)
    decorateProcessThinkingBlocks(tree.group)

    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(false)
    expect(hint.getAttribute('text')).toBe('')
    expect(hint.getAttribute('running')).toBe('false')
  })

  it('fades the hint out as soon as thinking ends, before the rest of the message finishes (思考过程结束即收起)', () => {
    const tree = reactThinkingTree()
    streamTo(tree, ['line one\nline two'])
    decorateProcessThinkingBlocks(tree.group)
    const hint = hintOf(tree.headers[0] as FakeNode)
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)

    // 整轮仍在流式（正文/工具已经接上），思考段本身已经结束：右侧提示必须立刻淡出。
    streamTo(tree, ['line one\nline two'], true, [{ type: 'text', text: 'answer starts' }])
    decorateProcessThinkingBlocks(tree.group)
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(false)
    expect(hint.getAttribute('text')).toBe('')
    expect(hint.getAttribute('running')).toBe('false')

    // thinkingSignature 同样是块结束信号（即使它暂时仍是 content 末块）。
    streamTo(tree, ['line one\nline two'])
    tree.assistant.message = {
      role: 'assistant',
      content: [{ type: 'thinking', thinking: 'line one\nline two', thinkingSignature: 'sig' }],
    }
    tree.assistant.isStreaming = true
    decorateProcessThinkingBlocks(tree.group)
    expect(hint.classList.contains(HINT_VISIBLE_CLASS)).toBe(false)
    expect(hint.getAttribute('running')).toBe('false')
  })

  it('keeps only the still-growing thinking block hinted when several blocks stream', () => {
    const tree = reactThinkingTree(2)
    streamTo(tree, ['alpha one\nalpha two', 'beta one'])
    decorateProcessThinkingBlocks(tree.group)

    const [firstHint, secondHint] = [hintOf(tree.headers[0] as FakeNode), hintOf(tree.headers[1] as FakeNode)]
    expect(firstHint.classList.contains(HINT_VISIBLE_CLASS)).toBe(false)
    expect(firstHint.getAttribute('text') ?? '').toBe('')
    expect(secondHint.getAttribute('text')).toBe('beta one')
    expect(secondHint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)
  })

  it('maps each thinking block to its own thinking chunk by document order', () => {
    const tree = reactThinkingTree(2)
    streamTo(tree, ['alpha one\nalpha two\n', 'beta one\nbeta two\n'])
    decorateProcessThinkingBlocks(tree.group)

    const [firstHint, secondHint] = [hintOf(tree.headers[0] as FakeNode), hintOf(tree.headers[1] as FakeNode)]
    // 前一段思考已经结束（不再是 content 末块）：右侧提示立即收起。
    expect(firstHint.getAttribute('text') ?? '').toBe('')
    expect(firstHint.classList.contains(HINT_VISIBLE_CLASS)).toBe(false)
    // 仍在增长的后一段按文档序取自己的最新段，不会串到前一段。
    expect(secondHint.getAttribute('text')).toBe('beta two')
    expect(secondHint.classList.contains(HINT_VISIBLE_CLASS)).toBe(true)
  })
})

describe('thinking hint CSS motion contract (reduced-motion 降级)', () => {
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

  it('uses the motion duration tokens: enter base, exit faster, ease-out', () => {
    expect(css).toContain('animation: quickforge-thinking-hint-in var(--quickforge-dur-base) var(--quickforge-ease-out);')
    expect(css).toMatch(/\.quickforge-process-thinking-hint \{[^}]*opacity var\(--quickforge-dur-exit\) var\(--quickforge-ease-out\)/s)
    expect(css).toMatch(/\.quickforge-process-thinking-hint-visible \{[^}]*opacity var\(--quickforge-dur-base\) var\(--quickforge-ease-out\)/s)
  })

  it('animates opacity/visibility only (no layout-triggering properties)', () => {
    const match = css.match(/@keyframes quickforge-thinking-hint-in \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    const keyframes = match?.[0] ?? ''
    expect(keyframes).toContain('opacity: 0;')
    expect(keyframes).not.toContain('width')
    expect(keyframes).not.toContain('height')
    expect(keyframes).not.toContain('margin')
  })

  it('degrades fades to instant under prefers-reduced-motion', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.quickforge-process-thinking-hint,\s*\.quickforge-process-thinking-hint-visible,\s*\.quickforge-process-thinking-hint-in \{\s*animation: none;\s*transition: none;/,
    )
  })

  it('scopes the marquee view styles for overflow scrolling inside the hint', () => {
    expect(css).toContain('.quickforge-process-thinking-hint .quickforge-marquee-view {')
    expect(css).toContain('.quickforge-process-thinking-hint .quickforge-marquee-static {')
    expect(css).toContain('.quickforge-process-thinking-hint .quickforge-marquee-moving {')
  })
})
