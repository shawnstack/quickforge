import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildConversationTurns, shouldShowTurnNavigation, TURN_NAVIGATION_MIN_TURNS } from '../../src/components/chat/turn-navigation-data'
import { createTurnNavigation } from '../../src/components/chat/turn-navigation'

function user(content: unknown, role = 'user') {
  return { role, content, timestamp: 0 }
}

function assistant(text: string) {
  return { role: 'assistant', content: [{ type: 'text', text }], timestamp: 0 }
}

describe('conversation turn navigation', () => {
  it('hides the rail and its tooltip while another session is loading', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

    expect(css).toContain('.quickforge-conversation-loading ~ * .quickforge-turn-navigation')
    expect(css).toContain('body:has(.quickforge-conversation-loading) .quickforge-turn-navigation-tooltip')
  })

  it('only shows the rail from the fifth turn', () => {
    expect(TURN_NAVIGATION_MIN_TURNS).toBe(5)
    expect(shouldShowTurnNavigation(4)).toBe(false)
    expect(shouldShowTurnNavigation(5)).toBe(true)
  })

  it('pairs each user message with the final assistant message before the next turn', () => {
    const turns = buildConversationTurns([
      user('first question'),
      assistant('tool preface'),
      { role: 'toolResult', toolCallId: 'call-1', content: 'result', timestamp: 0 },
      assistant('first final answer'),
      user('second question'),
      assistant('second final answer'),
    ] as never[], false)

    expect(turns).toEqual([
      { messageIndex: 0, userText: 'first question', finalAnswerText: 'first final answer', isGenerating: false },
      { messageIndex: 4, userText: 'second question', finalAnswerText: 'second final answer', isGenerating: false },
    ])
  })

  it('supports attachment user messages and keeps an empty preview for attachment-only turns', () => {
    const turns = buildConversationTurns([
      user([{ type: 'image', data: 'example' }], 'user-with-attachments'),
      assistant('answer'),
    ] as never[], false)

    expect(turns[0]).toMatchObject({ userText: '', finalAnswerText: 'answer' })
  })

  it('marks only the latest turn as generating while streaming', () => {
    const turns = buildConversationTurns([
      user('done'),
      assistant('done answer'),
      user('active'),
      assistant('intermediate tool text'),
    ] as never[], true)

    expect(turns[0].isGenerating).toBe(false)
    expect(turns[1]).toMatchObject({ finalAnswerText: 'intermediate tool text', isGenerating: true })
  })

  it('keeps turns without an assistant answer', () => {
    expect(buildConversationTurns([user('unanswered')] as never[], false)).toEqual([
      { messageIndex: 0, userText: 'unanswered', finalAnswerText: '', isGenerating: false },
    ])
  })
})

// ---------------------------------------------------------------------------
// 滚动测量（updateActiveFromScroll）：rAF 合帧 + 输入缓存（P1-A）
// ---------------------------------------------------------------------------

type FakeElement = {
  tagName: string
  className: string
  dataset: Record<string, string>
  attributes: Record<string, string>
  title: string
  type: string
  hidden: boolean
  clientHeight: number
  clientRects: unknown[]
  scrollTop: number
  scrollTo?: (options: { top: number }) => void
  children: FakeElement[]
  parentElement: FakeElement | null
  listeners: Record<string, Array<(event?: unknown) => void>>
  getBoundingClientRect: () => { top: number }
  getClientRects: () => unknown[]
  append: (...items: FakeElement[]) => void
  remove: () => void
  replaceChildren: (...items: FakeElement[]) => void
  addEventListener: (type: string, listener: (event?: unknown) => void, options?: unknown) => void
  removeEventListener: (type: string, listener: (event?: unknown) => void) => void
  querySelector: (selector: string) => FakeElement | null
  querySelectorAll: (selector: string) => FakeElement[]
  closest: (selector: string) => FakeElement | null
  setAttribute: (name: string, value: string) => void
  getAttribute: (name: string) => string | null
  removeAttribute: (name: string) => void
  classList: {
    add: (...names: string[]) => void
    toggle: (name: string, force?: boolean) => boolean
  }
}

function hasClass(node: FakeElement, name: string) {
  return node.className.split(/\s+/).includes(name)
}

function matchesSelector(node: FakeElement, selector: string) {
  const trimmed = selector.trim()
  if (trimmed.startsWith('.')) return hasClass(node, trimmed.slice(1))
  return node.tagName === trimmed.toUpperCase()
}

function descendants(node: FakeElement, selector: string) {
  const result: FakeElement[] = []
  for (const child of node.children) {
    if (matchesSelector(child, selector)) result.push(child)
    result.push(...descendants(child, selector))
  }
  return result
}

function createFakeElement(tagName = 'div'): FakeElement {
  const children: FakeElement[] = []
  const node = {
    tagName: tagName.toUpperCase(),
    className: '',
    dataset: {},
    attributes: {},
    title: '',
    type: '',
    hidden: false,
    clientHeight: 0,
    clientRects: [{}] as unknown[],
    scrollTop: 0,
    children,
    parentElement: null as FakeElement | null,
    listeners: {},
    getBoundingClientRect: () => ({ top: 0 }),
    getClientRects() {
      return node.clientRects
    },
    append(...items: FakeElement[]) {
      for (const item of items) {
        item.remove()
        item.parentElement = node
        children.push(item)
      }
    },
    remove() {
      const parent = node.parentElement
      if (parent) {
        const index = parent.children.indexOf(node)
        if (index >= 0) parent.children.splice(index, 1)
      }
      node.parentElement = null
    },
    replaceChildren(...items: FakeElement[]) {
      for (const child of [...children]) child.remove()
      node.append(...items)
    },
    addEventListener(type: string, listener: (event?: unknown) => void) {
      const registered = node.listeners[type] ?? (node.listeners[type] = [])
      registered.push(listener)
    },
    removeEventListener(type: string, listener: (event?: unknown) => void) {
      node.listeners[type] = (node.listeners[type] ?? []).filter((candidate) => candidate !== listener)
    },
    querySelector(selector: string) {
      return descendants(node, selector)[0] ?? null
    },
    querySelectorAll(selector: string) {
      return descendants(node, selector)
    },
    closest(selector: string) {
      let current: FakeElement | null = node
      while (current) {
        if (matchesSelector(current, selector)) return current
        current = current.parentElement
      }
      return null
    },
    setAttribute(name: string, value: string) {
      node.attributes[name] = value
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        node.dataset[key] = value
      }
    },
    getAttribute(name: string) {
      return node.attributes[name] ?? null
    },
    removeAttribute(name: string) {
      delete node.attributes[name]
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        delete node.dataset[key]
      }
    },
    classList: {
      add(...names: string[]) {
        const classes = new Set(node.className.split(/\s+/).filter(Boolean))
        names.forEach((name) => classes.add(name))
        node.className = [...classes].join(' ')
      },
      toggle(name: string, force?: boolean) {
        const classes = new Set(node.className.split(/\s+/).filter(Boolean))
        const enabled = force ?? !classes.has(name)
        if (enabled) classes.add(name)
        else classes.delete(name)
        node.className = [...classes].join(' ')
        return enabled
      },
    },
  }
  return node
}

/**
 * 5 个完整回合（达到 TURN_NAVIGATION_MIN_TURNS，渲染 5 个节点）。
 *
 * 每行都带 `data-message-index`（`MessageList` 的 `useLayoutEffect` 在提交后写入），
 * 锚点解析走这个绝对下标，不再按 `.qf-user-message` 的序号算术。
 * `hiddenUserTurns` 里的轮次模拟 `display: none` 的 user 行（goal 续跑提示 /
 * 后台命令通知）：没有布局盒，rect 读出来是全 0。
 */
function createScrollEnv(hiddenUserTurns: number[] = []) {
  const messages: Array<Record<string, unknown>> = []
  const userRows: FakeElement[] = []
  const answerRows: FakeElement[] = []
  // 可视性判定（`getClientRects`）只在缓存失效时逐行发生，正好可以用来观察
  // 「锚点解析是否重扫」。缓存命中时滚动只读 `getBoundingClientRect`。
  let layoutProbes = 0
  const list = createFakeElement('div')
  list.className = 'qf-message-list'
  list.dataset.windowStart = '0'

  for (let turn = 0; turn < 5; turn++) {
    const userIndex = turn * 2
    messages.push({ role: 'user', content: `question ${turn}`, timestamp: turn + 1 })
    messages.push({ role: 'assistant', content: [{ type: 'text', text: `answer ${turn}` }], timestamp: turn + 1.5 })
    const row = createFakeElement('div')
    row.className = 'qf-user-message'
    row.dataset.messageIndex = String(userIndex)
    // `display: none` 的行没有布局盒，rect 读出来是全 0（这正是隐藏行被误当
    // 锚点时的行为）。
    if (hiddenUserTurns.includes(turn)) {
      row.clientRects = []
      row.getBoundingClientRect = () => ({ top: 0 })
    } else {
      row.getBoundingClientRect = () => ({ top: turn * 10 })
    }
    row.getClientRects = () => {
      layoutProbes += 1
      return row.clientRects
    }
    userRows.push(row)
    list.append(row)
    const answerRow = createFakeElement('div')
    answerRow.className = 'qf-assistant-message'
    answerRow.dataset.messageIndex = String(userIndex + 1)
    answerRow.getBoundingClientRect = () => ({ top: turn * 10 + 5 })
    answerRow.getClientRects = () => {
      layoutProbes += 1
      return answerRow.clientRects
    }
    answerRows.push(answerRow)
    list.append(answerRow)
  }
  const container = createFakeElement('div')
  container.className = 'qf-scroll-container'
  container.clientHeight = 100
  container.getBoundingClientRect = () => ({ top: 0 })
  container.append(list)
  const panel = createFakeElement('div')
  panel.append(container)
  const host = createFakeElement('div')

  const rafQueue = new Map<number, () => void>()
  let rafId = 0
  const requestAnimationFrame = vi.fn((callback: () => void) => {
    rafId += 1
    rafQueue.set(rafId, callback)
    return rafId
  })
  const cancelAnimationFrame = vi.fn((handle: number) => {
    rafQueue.delete(handle)
  })
  const flushRaf = () => {
    const callbacks = [...rafQueue.values()]
    rafQueue.clear()
    callbacks.forEach((callback) => callback())
  }

  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestAnimationFrame,
    cancelAnimationFrame,
  })

  let currentMessages: unknown[] = messages
  const navigation = createTurnNavigation({
    host: host as unknown as HTMLElement,
    panel: panel as unknown as HTMLElement,
    getMessages: () => currentMessages as never,
    isStreaming: () => false,
    beginProgrammaticScroll: () => () => {},
    onWindowChanged: () => {},
  })
  const dispatchScroll = () => {
    for (const listener of container.listeners.scroll ?? []) listener()
  }
  const trackNodes = () => descendants(descendants(host, '.quickforge-turn-navigation')[0], '.quickforge-turn-navigation-node')
  const activeOrdinals = () => {
    const nodes = trackNodes()
    return nodes.map((node, index) => (hasClass(node, 'is-active') ? index : -1)).filter((index) => index >= 0)
  }

  return {
    navigation,
    host,
    panel,
    container,
    messages,
    userRows,
    answerRows,
    dispatchScroll,
    flushRaf,
    rafQueue,
    requestAnimationFrame,
    cancelAnimationFrame,
    getLayoutProbes: () => layoutProbes,
    replaceMessages: (next: unknown[]) => {
      currentMessages = next
    },
    trackNodes,
    activeOrdinals,
  }
}

describe('turn navigation scroll measurement', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: createFakeElement,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('coalesces scroll bursts into a single rAF measurement and marks the visible turn active', () => {
    const env = createScrollEnv()
    env.navigation.update()
    const baseline = env.getLayoutProbes()
    const rafCallsBefore = env.requestAnimationFrame.mock.calls.length
    // update() 同步测量一次后，活动节点已按可见窗口标注。
    // 阈值 = 容器顶 + min(120, clientHeight * 0.2) = 20；行顶 0/10/20 <= 20。
    expect(env.activeOrdinals()).toEqual([2])

    // 第三个 user 行移出阈值（帧执行时按最新几何信息计算，活动节点应前移）。
    env.userRows[2].getBoundingClientRect = () => ({ top: 100 })
    env.dispatchScroll()
    env.dispatchScroll()
    env.dispatchScroll()
    // 同帧多次 scroll 事件只排队一个 rAF 回调。
    expect(env.requestAnimationFrame.mock.calls.length).toBe(rafCallsBefore + 1)
    expect(env.rafQueue.size).toBe(1)
    env.flushRaf()

    // 布局无关输入未变（缓存命中）：合帧测量复用锚点解析，只重读几何信息。
    expect(env.activeOrdinals()).toEqual([1])
    expect(env.getLayoutProbes()).toBe(baseline)
    env.navigation.cleanup()
  })

  it('reuses the anchor resolution while the rendered messages reference is unchanged', () => {
    const env = createScrollEnv()
    env.navigation.update()
    const baseline = env.getLayoutProbes()

    // 输入未变（messages 引用 / windowStart / turns 均稳定）→ 缓存命中，不重扫 DOM。
    env.dispatchScroll()
    env.flushRaf()
    expect(env.getLayoutProbes()).toBe(baseline)

    // messages 数组引用变化（React 表面重建窗口）→ 缓存失效，重新解析锚点。
    env.replaceMessages(Array.from({ length: 10 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}`, timestamp: index })))
    env.dispatchScroll()
    env.flushRaf()
    expect(env.getLayoutProbes()).toBeGreaterThan(baseline)
    env.navigation.cleanup()
  })

  it('never marks a display:none user row as the active turn', () => {
    // 第 3 轮是 goal 续跑/后台通知这类被 CSS 隐藏的 user 行（rect 恒为 0）。
    // 旧实现用 "第 n 个 .qf-user-message" 的序号算术，隐藏行 `0 <= 阈值`
    // 恒成立，会把活动节点推进到它身上。
    const env = createScrollEnv([2])
    env.navigation.update()

    // 视口停在第 2 轮，第 3 轮隐藏、第 4 轮在阈值之下。
    env.userRows[0].getBoundingClientRect = () => ({ top: -100 })
    env.userRows[1].getBoundingClientRect = () => ({ top: -50 })
    env.userRows[3].getBoundingClientRect = () => ({ top: 40 })
    env.userRows[4].getBoundingClientRect = () => ({ top: 80 })
    env.dispatchScroll()
    env.flushRaf()

    // 隐藏轮次不得被选中：可见轮次是第 2 轮（ordinal 1）。
    expect(env.activeOrdinals()).toEqual([1])
    env.navigation.cleanup()
  })

  it('jumps a hidden turn to the next visible row instead of scrolling to 0', () => {
    const env = createScrollEnv([2])
    env.navigation.update()

    // 记录 scrollTo 的目标：定位必须来自真实可见行，不能是隐藏行的 0 几何。
    const scrollTargets: number[] = []
    env.container.scrollTo = (options) => { scrollTargets.push(options.top) }
    env.container.scrollTop = 100

    // 第 3 轮（ordinal 2）的 user 行被隐藏，紧随其后的 assistant 行可见。
    env.answerRows[2].getBoundingClientRect = () => ({ top: 60 })
    env.trackNodes()[2].listeners.click[0]()
    env.flushRaf()

    expect(scrollTargets).toHaveLength(1)
    // 100 (scrollTop) + 60 (紧随可见行顶相对容器) - 0 (容器顶) - 24 (留白) = 136
    // 旧实现会选中隐藏行，算出 100 + 0 - 0 - 24 = 76（与内容无关）。
    expect(scrollTargets[0]).toBe(136)
    env.navigation.cleanup()
  })

  it('cancels the pending rAF measurement on cleanup', () => {
    const env = createScrollEnv()
    env.navigation.update()
    const baseline = env.getLayoutProbes()

    env.dispatchScroll()
    expect(env.rafQueue.size).toBe(1)
    env.navigation.cleanup()
    expect(env.cancelAnimationFrame).toHaveBeenCalled()
    // 已取消的帧不再执行测量。
    env.flushRaf()
    expect(env.getLayoutProbes()).toBe(baseline)
  })
})
