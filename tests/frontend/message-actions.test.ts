import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assistantActionDisplayIndexes } from '../../src/components/chat/panel-decoration/message-action-visibility'
import { decorateProcessBlocks } from '../../src/components/chat/panel-decoration/process-folding'
import { decorateMessages, decorateUserContextChips } from '../../src/components/chat/panel-decoration/message-actions'
import { createTurnErrorTracker } from '../../src/components/chat/panel-decoration/turn-error-state'
import { parseSlashInvocationPrefix, planSlashChipText } from '../../src/components/chat/slash-invocation-chip'

// The real i18n module pulls in pi-web-ui which requires a browser DOM;
// slash-invocation-chip only needs t() for the chip aria-label.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

vi.mock('../../src/components/chat/chat-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/chat/chat-utils')>()
  return { ...actual, replaceSvg: vi.fn() }
})

vi.mock('@/lib/input-clamp', () => ({
  decorateUserMessageInputClamp: vi.fn(),
}))

vi.mock('../../src/components/chat/panel-decoration/code-blocks', () => ({
  closeSvgCodeBlockMenus: vi.fn(),
  decorateMarkdownCommandBlocks: vi.fn(),
  decorateMarkdownMermaidCodeBlocks: vi.fn(),
  decorateMarkdownSvgCodeBlocks: vi.fn(),
}))

vi.mock('../../src/components/chat/panel-decoration/process-folding', () => ({
  decorateProcessBlocks: vi.fn(),
}))

vi.mock('../../src/components/chat/panel-decoration/local-file-path-links', () => ({
  decorateLocalFilePathLinks: vi.fn(),
}))

type FakeNode = {
  tagName: string
  className: string
  dataset: Record<string, string>
  attributes: Record<string, string>
  title: string
  textContent: string
  innerHTML: string
  type: string
  disabled: boolean
  style: Record<string, string>
  children: FakeNode[]
  readonly lastElementChild: FakeNode | null
  parentElement: FakeNode | null
  onclick?: ((event: { stopPropagation(): void }) => void) | null
  append: (...items: FakeNode[]) => void
  appendChild: (item: FakeNode) => FakeNode
  prepend: (item: FakeNode) => void
  replaceChildren: (...items: FakeNode[]) => void
  remove: () => void
  listeners: Record<string, Array<(event: unknown) => void>>
  addEventListener: (type: string, listener: (event: unknown) => void) => void
  removeEventListener: (type: string, listener: (event: unknown) => void) => void
  querySelector: (selector: string) => FakeNode | null
  querySelectorAll: (selector: string) => FakeNode[]
  closest: (selector: string) => FakeNode | null
  setAttribute: (name: string, value: string) => void
  getAttribute: (name: string) => string | null
  focus: () => void
  classList: {
    add: (...names: string[]) => void
    toggle: (name: string, force?: boolean) => boolean
  }
}

function hasClass(node: FakeNode, name: string) {
  return node.className.split(/\s+/).includes(name)
}

function matchesSelector(node: FakeNode, selector: string) {
  const trimmed = selector.trim()
  // CSS 类名含 "/"（如 Tailwind 的 bg-destructive/10）在选择器里写作 \/；
  // 真实 querySelector 会解码转义，这里对齐（去掉转义反斜杠）。
  if (trimmed.startsWith('.')) return hasClass(node, trimmed.slice(1).replace(/\\/g, ''))
  const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(trimmed)
  if (attribute) {
    const value = node.getAttribute(attribute[1])
    return attribute[2] === undefined ? value !== null : value === attribute[2]
  }
  const tagAndAttribute = /^([\w-]+)(?:\[([^=\]]+)="([^"]*)"\])?$/.exec(trimmed)
  if (!tagAndAttribute || node.tagName !== tagAndAttribute[1].toUpperCase()) return false
  return !tagAndAttribute[2] || node.getAttribute(tagAndAttribute[2]) === tagAndAttribute[3]
}

function descendants(node: FakeNode, selector: string) {
  const result: FakeNode[] = []
  for (const child of node.children) {
    if (matchesSelector(child, selector)) result.push(child)
    result.push(...descendants(child, selector))
  }
  return result
}

function createFakeElement(tagName = 'div'): FakeNode {
  const children: FakeNode[] = []
  const node = {
    tagName: tagName.toUpperCase(),
    className: '',
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    title: '',
    textContent: '',
    innerHTML: '',
    type: '',
    disabled: false,
    style: {} as Record<string, string>,
    children,
    get lastElementChild() { return children.at(-1) ?? null },
    parentElement: null as FakeNode | null,
    onclick: null as ((event: { stopPropagation(): void }) => void) | null,
    append(...items: FakeNode[]) {
      for (const item of items) {
        item.remove()
        item.parentElement = node
        children.push(item)
      }
    },
    appendChild(item: FakeNode) {
      node.append(item)
      return item
    },
    prepend(item: FakeNode) {
      item.remove()
      item.parentElement = node
      children.unshift(item)
    },
    replaceChildren(...items: FakeNode[]) {
      for (const child of [...children]) child.remove()
      node.append(...items)
    },
    remove() {
      const parent = node.parentElement
      if (parent) {
        const index = parent.children.indexOf(node)
        if (index >= 0) parent.children.splice(index, 1)
      }
      node.parentElement = null
    },
    listeners: {} as Record<string, Array<(event: unknown) => void>>,
    addEventListener(type: string, listener: (event: unknown) => void) {
      const registered = node.listeners[type] ?? (node.listeners[type] = [])
      registered.push(listener)
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      node.listeners[type] = (node.listeners[type] ?? []).filter((candidate) => candidate !== listener)
    },
    querySelector(selector: string) {
      if (selector.startsWith(':scope > ')) {
        return children.find((child) => matchesSelector(child, selector.slice(':scope > '.length))) ?? null
      }
      const alternatives = selector.split(',').map((part) => part.trim())
      for (const alternative of alternatives) {
        const found = descendants(node, alternative)[0]
        if (found) return found
      }
      return null
    },
    querySelectorAll(selector: string) {
      // 真实 DOM 的 querySelectorAll 按文档顺序返回；逐 child 对全部选择器
      // 匹配（而非按选择器分组拼接），否则 user/assistant 交错的元素序列会
      // 与消息 index 错位配对。
      const alternatives = selector.split(',').map((part) => part.trim())
      const result: FakeNode[] = []
      const walk = (current: FakeNode) => {
        for (const child of current.children) {
          if (alternatives.some((alternative) => matchesSelector(child, alternative))) result.push(child)
          walk(child)
        }
      }
      walk(node)
      return result
    },
    closest(selector: string) {
      let current: FakeNode | null = node
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
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        if (key in node.dataset) return node.dataset[key]
      }
      return node.attributes[name] ?? null
    },
    focus() {},
    classList: {
      add(...names: string[]) {
        const classes = new Set(node.className.split(/\s+/).filter(Boolean))
        names.forEach((name) => classes.add(name))
        node.className = [...classes].join(' ')
      },
      remove(...names: string[]) {
        const classes = new Set(node.className.split(/\s+/).filter(Boolean))
        names.forEach((name) => classes.delete(name))
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

function createUserMessageElement() {
  const element = createFakeElement('user-message')
  const container = createFakeElement('div')
  container.className = 'user-message-container'
  element.append(container)
  return { element, container }
}

function decorateOptions(
  element: FakeNode,
  message: Record<string, unknown>,
  onCopyAnswer = vi.fn(),
  historyActionsDisabled = false,
) {
  const messageList = createFakeElement('message-list')
  messageList.append(element)
  const panel = createFakeElement('div')
  panel.append(messageList)
  decorateMessages({
    panel: panel as unknown as HTMLElement,
    getMessages: () => [message] as never,
    isStreaming: () => false,
    onCopyAnswer,
    onRollbackFromMessage: vi.fn(),
    onRetryFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
    disableFork: false,
    historyActionsDisabled,
  })
  return { panel, messageList }
}

describe('assistant message actions', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: createFakeElement,
      createElementNS: (_namespace: string, tagName: string) => createFakeElement(tagName),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['assistant', 'user'])('syncs a completed planning task into an existing %s host without rebuilding messages', (role) => {
    const host = role === 'user' ? createUserMessageElement().element : createFakeElement('assistant-message')
    const messageList = createFakeElement('message-list')
    messageList.append(host)
    const panel = createFakeElement('div')
    panel.append(messageList)
    const message: Record<string, unknown> = {
      role, content: role === 'user' ? 'internal planning' : [{ type: 'text', text: 'Plan' }],
      ...(role === 'user' ? { metadata: { quickforgeGoalRun: 'planning' } } : {}),
    }
    const decorate = () => decorateMessages({
      panel: panel as unknown as HTMLElement, getMessages: () => [message] as never,
      isStreaming: () => false, onCopyAnswer: vi.fn(), onRollbackFromMessage: vi.fn(),
      onForkFromMessage: vi.fn(), onRetryFromMessage: vi.fn(),
    })
    decorate()
    expect(host.querySelector('.quickforge-goal-iteration-divider')).toBeNull()
    message.details = JSON.parse(JSON.stringify({ quickforgeGoalIteration: {
      goalId: 'old-goal', kind: 'planning', iteration: 0, outcome: 'running',
    } }))
    decorate() // Immediate sync after task completion, no message-list reconstruction.
    const divider = host.querySelector('.quickforge-goal-iteration-divider')!
    expect(divider?.querySelector('span')?.textContent).toBe('goalPlanningLabel · goalPlanningReady')
    host.append(createFakeElement())
    decorate()
    decorate()
    expect(messageList.children).toEqual([host])
    expect(host.querySelectorAll('.quickforge-goal-iteration-divider')).toEqual([divider])
    expect(host.lastElementChild).toBe(divider)
    if (role === 'user') {
      expect(host.className).toContain('quickforge-goal-internal-user-message')
      expect(host.querySelector('.quickforge-message-actions')).toBeNull()
    }
    message.details = {}
    decorate()
    expect(host.querySelector('.quickforge-goal-iteration-divider')).toBeNull()
  })

  it('keeps internal user hosts and original offsets, removes actions, and reverses on DOM reuse', () => {
    const internal = createUserMessageElement().element
    const user = createUserMessageElement().element
    const assistant = createFakeElement('assistant-message')
    const messageList = createFakeElement('message-list')
    messageList.append(internal, user, assistant)
    const panel = createFakeElement('div')
    panel.append(messageList)
    const onRollbackFromMessage = vi.fn()
    const onForkFromMessage = vi.fn()
    const onCopyAnswer = vi.fn()
    const messages = [
      { role: 'user', content: '继续执行目标（第 2/8 轮）', metadata: { quickforgeGoalRun: 'execution' } },
      { role: 'user', content: '继续执行目标（第 2/8 轮）' },
      { role: 'assistant', content: [{ type: 'text', text: 'substantive answer' }] },
    ]
    const decorate = () => decorateMessages({
      panel: panel as unknown as HTMLElement, getMessages: () => messages as never,
      messageIndexOffset: 10, isStreaming: () => false, onCopyAnswer,
      onRollbackFromMessage, onForkFromMessage, onRetryFromMessage: vi.fn(),
    })
    decorate()
    decorate()
    expect(messageList.children).toEqual([internal, user, assistant])
    expect(vi.mocked(decorateProcessBlocks).mock.calls.at(-1)?.[1]).toEqual([internal, user, assistant])
    expect(internal.className).toContain('quickforge-goal-internal-user-message')
    expect(internal.querySelector('.quickforge-message-actions')).toBeNull()
    expect(user.className).not.toContain('quickforge-goal-internal-user-message')
    user.querySelector('button[data-quickforge-action="copy"]')?.onclick?.({ stopPropagation() {} })
    expect(onCopyAnswer).toHaveBeenCalledWith(messages[1].content)
    assistant.querySelector('button[data-quickforge-action="fork"]')?.onclick?.({ stopPropagation() {} })
    expect(onForkFromMessage).toHaveBeenCalledWith(12)
    delete messages[0].metadata
    decorate()
    expect(internal.className).not.toContain('quickforge-goal-internal-user-message')
    expect(internal.querySelector('.quickforge-message-actions')).not.toBeNull()
    messages[0].metadata = { quickforgeGoalRun: 'planning' }
    decorate()
    expect(internal.querySelector('.quickforge-message-actions')).toBeNull()
  })

  it('only shows actions on the final assistant message of each completed turn', () => {
    const indexes = assistantActionDisplayIndexes([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
      { role: 'user-with-attachments' },
      { role: 'assistant' },
    ], false)

    expect([...indexes]).toEqual([2, 4])
  })

  it('hides actions for every assistant message in the active streaming turn', () => {
    const indexes = assistantActionDisplayIndexes([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
    ], true)

    expect([...indexes]).toEqual([1])
  })

  it('shows the final assistant actions after streaming completes', () => {
    const messages = [
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
    ]

    expect([...assistantActionDisplayIndexes(messages, true)]).toEqual([])
    expect([...assistantActionDisplayIndexes(messages, false)]).toEqual([2])
  })

  it('does not create assistant action targets before an assistant response exists', () => {
    expect([...assistantActionDisplayIndexes([], false)]).toEqual([])
    expect([...assistantActionDisplayIndexes([{ role: 'user' }], true)]).toEqual([])
  })

  it('keeps copy enabled while rendering rollback, retry, and fork disabled', () => {
    const user = createFakeElement('user-message')
    const userContainer = createFakeElement('div')
    userContainer.className = 'user-message-container'
    user.append(userContainer)
    const assistant = createFakeElement('assistant-message')
    const messageList = createFakeElement('message-list')
    messageList.append(user, assistant)
    const panel = createFakeElement('div')
    panel.append(messageList)

    decorateMessages({
      panel: panel as unknown as HTMLElement,
      getMessages: () => [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
      ] as never,
      isStreaming: () => false,
      onCopyAnswer: vi.fn(),
      onRollbackFromMessage: vi.fn(),
      onRetryFromMessage: vi.fn(),
      onForkFromMessage: vi.fn(),
      disableFork: true,
      allowRollback: false,
      allowRetry: false,
      historyActionsDisabled: true,
    })

    expect(user.querySelector('button[data-quickforge-action="copy"]')?.disabled).toBe(false)
    expect(user.querySelector('button[data-quickforge-action="rollback"]')?.disabled).toBe(true)
    expect(user.querySelector('button[data-quickforge-action="retry"]')?.disabled).toBe(true)
    expect(assistant.querySelector('button[data-quickforge-action="copy"]')?.disabled).toBe(false)
    expect(assistant.querySelector('button[data-quickforge-action="fork"]')?.disabled).toBe(true)
  })

  it('hides the retry button on the last user message when the turn was stopped by the user', () => {
    const user = createUserMessageElement().element
    const assistant = createFakeElement('assistant-message')
    const messageList = createFakeElement('message-list')
    messageList.append(user, assistant)
    const panel = createFakeElement('div')
    panel.append(messageList)
    const decorateWithTurn = (stopReason?: string) => decorateMessages({
      panel: panel as unknown as HTMLElement,
      getMessages: () => [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: [{ type: 'text', text: 'partial answer' }], ...(stopReason ? { stopReason } : {}) },
      ] as never,
      isStreaming: () => false,
      onCopyAnswer: vi.fn(),
      onRollbackFromMessage: vi.fn(),
      onRetryFromMessage: vi.fn(),
      onForkFromMessage: vi.fn(),
      disableFork: false,
      allowRollback: true,
      allowRetry: true,
    })

    decorateWithTurn('aborted')
    expect(user.querySelector('button[data-quickforge-action="retry"]')).toBeNull()
    // 回滚不受停止影响，仍可用
    expect(user.querySelector('button[data-quickforge-action="rollback"]')).not.toBeNull()

    // 同一会话重新装饰为正常完成的回合后，重试按钮恢复
    decorateWithTurn()
    expect(user.querySelector('button[data-quickforge-action="retry"]')).not.toBeNull()
  })

  it('does not apply content visibility to message hosts containing rollback popovers', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

    expect(css).not.toMatch(
      /message-list\s+(?:user-message|assistant-message)[^{}]*\{[^{}]*content-visibility\s*:/s,
    )
  })
})

describe('turn error row', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: createFakeElement,
      createTextNode: (text: string) => {
        const node = createFakeElement('#text')
        node.textContent = text
        return node
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function errorMessageFixture(overrides: Record<string, unknown> = {}) {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      errorMessage: 'AI stream idle timeout after 60000ms',
      timestamp: 1_750_000_000_000,
      ...overrides,
    }
  }

  // 镜像 pi-web-ui AssistantMessage 渲染根：assistant-message > div > 红块
  // （Messages.js：div.bg-destructive/10 + <strong>Error:</strong> + 文本）。
  function createErrorElement() {
    const element = createFakeElement('assistant-message')
    const root = createFakeElement('div')
    const block = createFakeElement('div')
    block.className = 'mx-4 mt-3 p-3 bg-destructive/10 text-destructive rounded-lg text-sm overflow-hidden'
    root.append(block)
    element.append(root)
    return { element, root, block }
  }

  function buildPanel(elements: FakeNode[]) {
    const messageList = createFakeElement('message-list')
    messageList.append(...elements)
    const panel = createFakeElement('div')
    panel.append(messageList)
    return panel
  }

  function decorateErrorPanel(
    elements: FakeNode[],
    messages: Record<string, unknown>[],
    options: Partial<Parameters<typeof decorateMessages>[0]> = {},
  ) {
    const panel = buildPanel(elements)
    decorateMessages({
      panel: panel as unknown as HTMLElement,
      getMessages: () => messages as never,
      isStreaming: () => false,
      onCopyAnswer: vi.fn(),
      onRollbackFromMessage: vi.fn(),
      onRetryFromMessage: vi.fn(),
      onForkFromMessage: vi.fn(),
      disableFork: false,
      onRetryAfterError: vi.fn(),
      turnErrorTracker: createTurnErrorTracker(),
      ...options,
    })
    return panel
  }

  it('rewrites the red block into the one-line error row with in-place retry and details', () => {
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    decorateErrorPanel([user, element], [{ role: 'user', content: 'question' }, errorMessageFixture()])

    expect(block.className).toBe('quickforge-error-line')
    // t 被模拟为返回 key：译文 key 拼进行文本（真实运行是本地化文案）。
    expect(block.querySelector('.quickforge-error-text')?.textContent).toBe('errorLinePrefix · errorAiStreamIdleTimeout')
    const retry = block.querySelector('button[data-quickforge-action="error-retry"]')
    expect(retry?.getAttribute('aria-label')).toBe('retry')
    expect(retry?.disabled).toBe(false)
    expect(block.querySelector('button[data-quickforge-action="error-details"]')).not.toBeNull()

    const details = element.querySelector('.quickforge-error-details')
    expect(details?.querySelector('pre')?.textContent).toBe('AI stream idle timeout after 60000ms')
    expect(element.querySelector('.quickforge-error-escalate')).toBeNull()
    // 旧「继续生成」icon 按钮与常显操作行不再生成。
    expect(element.querySelector('button[data-quickforge-action="continue"]')).toBeNull()
    expect(element.querySelector('.quickforge-message-actions')).toBeNull()
  })

  it('retry click swaps to the retrying presentation and reports the entry with a regenerate fallback', () => {
    const onRetryAfterError = vi.fn()
    const onRetryFromMessage = vi.fn()
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    const messages = [{ role: 'user', content: 'question' }, errorMessageFixture()]
    decorateErrorPanel([user, element], messages, { onRetryAfterError, onRetryFromMessage })

    block.querySelector('button[data-quickforge-action="error-retry"]')?.onclick?.({ stopPropagation() {} })

    expect(block.className).toContain('quickforge-error-retrying')
    expect(block.querySelector('.quickforge-error-text')?.textContent).toBe('errorRetryingLabel')
    expect(onRetryAfterError).toHaveBeenCalledTimes(1)
    const [errorEntry, fallbackRetry] = onRetryAfterError.mock.calls[0] as [unknown, () => void]
    expect(errorEntry).toBe(messages.at(-1))
    expect(typeof fallbackRetry).toBe('function')
    fallbackRetry()
    expect(onRetryFromMessage).toHaveBeenCalledWith(0)
  })

  it('escalates after a retried error reappears and wires the switch-model link', () => {
    const onSwitchModel = vi.fn()
    const tracker = createTurnErrorTracker()
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    const decorate = (errorMessage: Record<string, unknown>) => decorateErrorPanel(
      [user, element],
      [{ role: 'user', content: 'question' }, errorMessage],
      { turnErrorTracker: tracker, onSwitchModel },
    )

    decorate(errorMessageFixture())
    block.querySelector('button[data-quickforge-action="error-retry"]')?.onclick?.({ stopPropagation() {} })
    // 重试失败：新错误（不同 timestamp）→ 错误行恢复 + 琥珀升级提示。
    decorate(errorMessageFixture({ timestamp: 1_750_000_100_000 }))

    expect(block.className).not.toContain('quickforge-error-retrying')
    const escalate = element.querySelector('.quickforge-error-escalate')
    expect(escalate).not.toBeNull()
    // fake DOM 的 textContent 不聚合子文本节点，dataset 记录了当前展示文案。
    expect(escalate?.dataset.quickforgeEscalateText).toContain('errorRetryEscalate')
    escalate?.querySelector('button[data-quickforge-action="error-switch-model"]')?.onclick?.({ stopPropagation() {} })
    expect(onSwitchModel).toHaveBeenCalledTimes(1)
  })

  it('keeps the row idempotent across repeated decoration cycles', () => {
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    const decorate = () => decorateErrorPanel([user, element], [
      { role: 'user', content: 'question' },
      errorMessageFixture(),
    ])

    decorate()
    const firstChildren = [...block.children]
    decorate()
    expect(block.children).toHaveLength(firstChildren.length)
    expect(block.querySelector('button[data-quickforge-action="error-retry"]')).not.toBeNull()
  })

  it('clears companions once the element no longer renders an error message', () => {
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    decorateErrorPanel([user, element], [{ role: 'user', content: 'question' }, errorMessageFixture()])
    expect(element.querySelector('.quickforge-error-details')).not.toBeNull()

    // Lit 重渲染移除红块后，消息变为普通 assistant：伴随元素全部清理。
    block.remove()
    decorateErrorPanel([user, element], [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ])
    expect(element.querySelector('.quickforge-error-details')).toBeNull()
    expect(element.querySelector('.quickforge-error-escalate')).toBeNull()
  })

  it('rewrites historical errors without action buttons', () => {
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    const trailingUser = createUserMessageElement().element
    decorateErrorPanel([user, element, trailingUser], [
      { role: 'user', content: 'question' },
      errorMessageFixture(),
      { role: 'user', content: 'next' },
    ])

    expect(block.className).toBe('quickforge-error-line')
    expect(block.querySelector('.quickforge-error-text')).not.toBeNull()
    expect(block.querySelector('button[data-quickforge-action="error-retry"]')).toBeNull()
    expect(block.querySelector('button[data-quickforge-action="error-details"]')).toBeNull()
    expect(element.querySelector('.quickforge-error-details')).toBeNull()
  })

  it('shows the raw message inline without a details toggle when no translation rule matches', () => {
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    decorateErrorPanel([user, element], [
      { role: 'user', content: 'question' },
      errorMessageFixture({ errorMessage: 'Something unexpected happened' }),
    ])

    expect(block.querySelector('.quickforge-error-text')?.textContent).toBe('errorLinePrefix · Something unexpected happened')
    expect(block.querySelector('button[data-quickforge-action="error-details"]')).toBeNull()
    expect(element.querySelector('.quickforge-error-details')).toBeNull()
  })

  it('toggles the details block open and closed in place', () => {
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    decorateErrorPanel([user, element], [{ role: 'user', content: 'question' }, errorMessageFixture()])

    const toggle = block.querySelector('button[data-quickforge-action="error-details"]')
    toggle?.onclick?.({ stopPropagation() {} })
    const details = element.querySelector('.quickforge-error-details')
    expect(details?.className).toContain('quickforge-error-details-open')
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')

    toggle?.onclick?.({ stopPropagation() {} })
    expect(details?.className).not.toContain('quickforge-error-details-open')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    ['retry capability unavailable', { allowRetry: false }],
    ['read-only viewer', { readOnly: true }],
    ['no retry handler', { onRetryAfterError: undefined }],
  ])('hides the retry button when %s', (_name, options) => {
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    decorateErrorPanel([user, element], [
      { role: 'user', content: 'question' },
      errorMessageFixture(),
    ], options)

    expect(block.querySelector('button[data-quickforge-action="error-retry"]')).toBeNull()
  })

  it.each([
    ['streaming', { isStreaming: () => true }],
    ['restricted history actions', { historyActionsDisabled: true }],
  ])('disables the retry button while %s', (_name, options) => {
    const user = createUserMessageElement().element
    const { element, block } = createErrorElement()
    decorateErrorPanel([user, element], [
      { role: 'user', content: 'question' },
      errorMessageFixture(),
    ], options)

    expect(block.querySelector('button[data-quickforge-action="error-retry"]')?.disabled).toBe(true)
  })

  it('ships the turn-error rewrite contract across wiring, copy, and styles', () => {
    const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
    expect(hostSource).toContain('onRetryAfterError:')
    expect(hostSource).toContain('retryFailedPrompt')
    expect(hostSource).toContain('fallbackRetry()')
    expect(hostSource).toContain('turnErrorTracker')

    const actionsSource = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
    expect(actionsSource).not.toContain('errorContinueAction')
    expect(actionsSource).toMatch(/decorateTurnErrorRow\(element, \{/)

    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
    for (const selector of [
      '.quickforge-error-line',
      '.quickforge-error-retry',
      '.quickforge-error-details-toggle',
      '.quickforge-error-escalate',
      '.quickforge-error-switch-model',
      '.quickforge-error-details',
      '.quickforge-error-retrying',
    ]) {
      expect(css).toContain(selector)
    }

    const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
    expect(i18nSource).toContain("errorLinePrefix: 'Generation failed'")
    expect(i18nSource).toContain("errorLinePrefix: '生成失败'")
    expect(i18nSource).not.toContain('errorContinueAction')
  })
})

describe('assistant stopped label decoration', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: createFakeElement,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stoppedMessageFixture(stopReason?: string) {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: '部分回答' }],
      ...(stopReason ? { stopReason } : {}),
      timestamp: 1_750_000_000_000,
    }
  }

  // 镜像 pi-web-ui AssistantMessage 渲染根：<assistant-message> > div > …
  function createAssistantMessageElement() {
    const element = createFakeElement('assistant-message')
    const root = createFakeElement('div')
    element.append(root)
    return { element, root }
  }

  function decorateStoppedPanel(
    elements: FakeNode[],
    messages: Record<string, unknown>[],
  ) {
    const messageList = createFakeElement('message-list')
    messageList.append(...elements)
    const panel = createFakeElement('div')
    panel.append(messageList)
    decorateMessages({
      panel: panel as unknown as HTMLElement,
      getMessages: () => messages as never,
      isStreaming: () => false,
      onCopyAnswer: vi.fn(),
      onRollbackFromMessage: vi.fn(),
      onRetryFromMessage: vi.fn(),
      onForkFromMessage: vi.fn(),
      disableFork: false,
    })
  }

  it('rewrites the marked status span to the localized stopped label and stays idempotent', () => {
    const user = createUserMessageElement().element
    const { element, root } = createAssistantMessageElement()
    const span = createFakeElement('span')
    span.className = 'quickforge-message-stopped-label'
    span.textContent = 'Stopped (old locale)'
    span.dataset.quickforgeStoppedLabel = 'Stopped (old locale)'
    root.append(span)
    const messages = [{ role: 'user', content: 'question' }, stoppedMessageFixture('aborted')]

    decorateStoppedPanel([user, element], messages)
    expect(span.textContent).toBe('messageStoppedLabel')
    expect(span.dataset.quickforgeStoppedLabel).toBe('messageStoppedLabel')

    decorateStoppedPanel([user, element], messages)
    expect(span.textContent).toBe('messageStoppedLabel')
  })

  it('leaves the status span untouched when the message was not manually stopped', () => {
    const user = createUserMessageElement().element
    const { element, root } = createAssistantMessageElement()
    const span = createFakeElement('span')
    span.className = 'quickforge-message-stopped-label'
    span.textContent = 'Stopped (old locale)'
    span.dataset.quickforgeStoppedLabel = 'Stopped (old locale)'
    root.append(span)

    decorateStoppedPanel([user, element], [{ role: 'user', content: 'question' }, stoppedMessageFixture()])
    expect(span.textContent).toBe('Stopped (old locale)')
  })

  it('ships the stopped-label rewrite contract: scoped discovery, class swap, and styling', () => {
    const source = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
    // 发现路径限定 assistant 渲染根的直接子级，避免误伤 tool 卡内同款 aborted 标签
    expect(source).toContain("querySelectorAll<HTMLElement>('span.text-sm.text-destructive.italic')")
    expect(source).toContain('candidate.parentElement?.parentElement === element')
    expect(source).toContain("classList.remove('text-destructive', 'italic')")
    expect(source).toContain('span.dataset.quickforgeStoppedLabel === label')
    expect(source).toMatch(/decorateAssistantStoppedText\(element, entry\.message\)/)

    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
    expect(css).toContain('.quickforge-message-stopped-label')
    expect(css).toMatch(/\.quickforge-message-stopped-label \{[\s\S]*?padding: 0 1rem;/)
    expect(css).toMatch(/\.quickforge-message-stopped-label \{[\s\S]*?color: var\(--muted-foreground\)/)
  })
})

describe('user message context chip decoration', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: createFakeElement,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('executes mixed DOM decoration with plugins before files, no history remove button, and idempotent replacement', () => {
    const { element, container } = createUserMessageElement()
    const message = {
      role: 'user',
      content: 'original body',
      details: {
        selectedCapabilities: [{ type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' }],
        contextReferences: [{ type: 'file', projectId: 'project-1', path: 'src/app.ts' }],
      },
    } as never

    decorateUserContextChips(element as unknown as HTMLElement, message)
    const row = container.querySelector('.quickforge-message-context-references')
    expect(row?.getAttribute('aria-label')).toBe('selectedPluginsAndFiles')
    expect(row?.children.map((child) => child.className)).toEqual([
      'quickforge-context-chip quickforge-capability-chip',
      'quickforge-context-chip quickforge-file-reference-chip',
    ])
    expect(row?.querySelector('.quickforge-context-chip-remove')).toBeNull()

    const firstChildren = [...(row?.children ?? [])]
    decorateUserContextChips(element as unknown as HTMLElement, message)
    const repeated = container.querySelector('.quickforge-message-context-references')
    expect(repeated).toBe(row)
    expect(repeated?.children).toHaveLength(2)
    expect(repeated?.children).not.toEqual(firstChildren)
  })

  it.each([
    ['plugin only', {
      selectedCapabilities: [{ type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' }],
    }, 'selectedCapabilities'],
    ['file only', {
      contextReferences: [{ type: 'file', projectId: 'project-1', path: 'src/app.ts' }],
    }, 'fileReferences'],
    ['mixed', {
      selectedCapabilities: [{ type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' }],
      contextReferences: [{ type: 'file', projectId: 'project-1', path: 'src/app.ts' }],
    }, 'selectedPluginsAndFiles'],
  ])('sets the %s aria label', (_name, details, label) => {
    const { element, container } = createUserMessageElement()
    decorateUserContextChips(element as unknown as HTMLElement, { role: 'user', content: 'body', details } as never)
    expect(container.querySelector('.quickforge-message-context-references')?.getAttribute('aria-label')).toBe(label)
  })

  it('removes the shared row when mixed history changes to empty', () => {
    const { element, container } = createUserMessageElement()
    decorateUserContextChips(element as unknown as HTMLElement, {
      role: 'user',
      content: 'body',
      details: {
        selectedCapabilities: [{ type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' }],
        contextReferences: [{ type: 'file', projectId: 'project-1', path: 'src/app.ts' }],
      },
    } as never)
    expect(container.querySelector('.quickforge-message-context-references')).not.toBeNull()

    decorateUserContextChips(element as unknown as HTMLElement, { role: 'user', content: 'body', details: {} } as never)
    expect(container.querySelector('.quickforge-message-context-references')).toBeNull()
  })

  it('copies the original user body after real decorateMessages adds context chips', async () => {
    const { element } = createUserMessageElement()
    const onCopyAnswer = vi.fn()
    decorateOptions(element, {
      role: 'user-with-attachments',
      content: 'original body',
      details: {
        selectedCapabilities: [{ type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' }],
        contextReferences: [{ type: 'file', projectId: 'project-1', path: 'src/app.ts' }],
      },
    }, onCopyAnswer)

    const copyButton = element.querySelector('button[data-quickforge-action="copy"]')
    expect(copyButton).not.toBeNull()
    copyButton?.onclick?.({ stopPropagation() {} })
    await vi.waitFor(() => expect(onCopyAnswer).toHaveBeenCalledWith('original body'))
  })

  it('reads plugins and files only from details while keeping copy text on the original message', () => {
    const source = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
    expect(source).toContain('contextReferencesFromMessage')
    expect(source).toContain("(details as Record<string, unknown>).contextReferences")
    expect(source).toContain('selectedCapabilitiesFromDetails(message.details)')
    expect(source).toMatch(/decorateUserContextChips\(element,\s*entry\.message\)/)
    expect(source).not.toMatch(/metadata\s*\.\s*(?:contextReferences|selectedCapabilities)/)
    expect(source).toMatch(/const text = draftTextFromUserMessage\(entry\.message/)
  })

  it('renders plugin chips before file references with shared aria semantics and idempotent clearing', () => {
    const source = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/capabilities\.length === 0 && references\.length === 0[\s\S]*existing\?\.remove\(\)/)
    expect(source).toMatch(/chips\.replaceChildren\([\s\S]*capabilities\.map[\s\S]*references\.map/)
    expect(source).toContain("createCapabilityChip(capability)")
    expect(source).toContain("createFileReferenceChip(reference)")
    expect(source).toContain("t('selectedPluginsAndFiles')")
    expect(source).toContain("t('selectedCapabilities')")
    expect(source).toContain("t('fileReferences')")
  })
})

describe('user message slash invocation chip decoration', () => {
  // 消息流 DOM 断言依赖浏览器渲染（markdown-block light DOM + 文本节点），现有
  // 测试为纯逻辑 + 源码断言；此处沿用：前缀解析/剥前缀计划已提为纯函数单测，
  // 装饰器本身做最小源码断言（幂等还原按 chip 自带前缀，复制走原文不受影响）。

  it('parses message prefixes for the chip decoration', () => {
    expect(parseSlashInvocationPrefix('/agent explore ship the release')).toEqual({
      kind: 'agent',
      name: 'explore',
      cmd: '/agent explore',
    })
    expect(parseSlashInvocationPrefix('/skill patch-release run the checks')).toEqual({
      kind: 'skill',
      name: 'patch-release',
      cmd: '/skill patch-release',
    })
    expect(parseSlashInvocationPrefix('帮我把发布流程梳理一遍')).toBeNull()
    expect(parseSlashInvocationPrefix('/init the project')).toBeNull()
  })

  it('plans the first text node strip (prefix includes exactly one trailing space)', () => {
    expect(planSlashChipText('/agent explore ship it')).toEqual({
      invocation: { kind: 'agent', name: 'explore', cmd: '/agent explore' },
      prefix: '/agent explore ',
      rest: 'ship it',
    })
    expect(planSlashChipText('/agent explore')).toEqual({
      invocation: { kind: 'agent', name: 'explore', cmd: '/agent explore' },
      prefix: '/agent explore',
      rest: '',
    })
    expect(planSlashChipText('plain task')).toBeNull()
  })

  it('decorates user messages via decorateUserSlashInvocationChip with per-chip restore', () => {
    const source = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')

    // 只在 user 分支调用（与 decorateUserMessageInputClamp 相邻）。
    expect(source).toContain('decorateUserMessageInputClamp(element, inputClampLabels)')
    expect(source).toMatch(/decorateUserSlashInvocationChip\(element,\s*entry\.message/)
    // 幂等还原：chip 自带被剥掉的前缀（data 属性），重装饰先还原再应用。
    expect(source).toContain("'data-quickforge-slash-chip-el'")
    expect(source).toContain('quickforgeSlashChipPrefix')
    expect(source).toContain('findFirstContentTextNode')
    // 复制行为不动：copy 仍走 draftTextFromUserMessage 原文。
    expect(source).toMatch(/const text = draftTextFromUserMessage\(entry\.message/)
  })

  it('ships the shared slash chip styles for the overlay and the message flow', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

    for (const selector of [
      '.quickforge-slash-overlay',
      '.quickforge-slash-ghost',
      '.quickforge-slash-source-text',
      '.quickforge-slash-spacer',
      '.quickforge-slash-chip',
      '.quickforge-slash-chip-skill',
      '.quickforge-slash-chip-agent',
      'html.dark .quickforge-slash-chip-skill',
      'html.dark .quickforge-slash-chip-agent',
      '.quickforge-slash-chip-in-message',
    ]) {
      expect(css).toContain(`${selector} {`)
    }
    // 覆盖层不拦截指针，激活时原文透明但光标可见。
    expect(css).toMatch(/\.quickforge-slash-overlay \{[^}]*pointer-events: none/s)
    expect(css).toMatch(/\.quickforge-slash-source-text \{[^}]*color: transparent[^}]*caret-color: var\(--foreground\)/s)
  })
})

describe('text attachment tile decoration', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: createFakeElement,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function createUserMessageWithTiles(tileCount: number) {
    const { element } = createUserMessageElement()
    const tiles = Array.from({ length: tileCount }, () => {
      const tile = createFakeElement('attachment-tile')
      element.append(tile)
      return tile
    })
    return { element, tiles }
  }

  function decorateAttachmentPanel(element: FakeNode, message: Record<string, unknown>, onOpenLocalFilePath: ReturnType<typeof vi.fn>) {
    const messageList = createFakeElement('message-list')
    messageList.append(element)
    const panel = createFakeElement('div')
    panel.append(messageList)
    decorateMessages({
      panel: panel as unknown as HTMLElement,
      getMessages: () => [message] as never,
      isStreaming: () => false,
      onCopyAnswer: vi.fn(),
      onRollbackFromMessage: vi.fn(),
      onRetryFromMessage: vi.fn(),
      onForkFromMessage: vi.fn(),
      disableFork: false,
      historyActionsDisabled: false,
      onOpenLocalFilePath,
    })
  }

  function clickTile(tile: FakeNode) {
    for (const listener of [...(tile.listeners.click ?? [])]) {
      listener({ stopPropagation: vi.fn() })
    }
  }

  it('binds the open handler to the matching tile with the path only in the hover title', () => {
    const onOpenLocalFilePath = vi.fn()
    const attachmentPath = 'C:\\Users\\demo\\.quickforge\\cache\\global\\tmp\\conversations\\s1\\pasted-content.txt'
    const { element, tiles } = createUserMessageWithTiles(1)

    decorateAttachmentPanel(element, {
      role: 'user-with-attachments',
      content: 'see attachment',
      attachments: [{ path: attachmentPath }],
    }, onOpenLocalFilePath)

    // 消息内不展示路径文字行，完整路径只在 tile 的 hover 提示里。
    expect(element.querySelectorAll('.quickforge-text-attachment-path')).toHaveLength(0)
    expect(tiles[0].getAttribute('title')).toBe(`点击在系统文件管理器中打开：${attachmentPath}`)

    clickTile(tiles[0])
    expect(onOpenLocalFilePath).toHaveBeenCalledTimes(1)
    expect(onOpenLocalFilePath).toHaveBeenCalledWith(attachmentPath)
  })

  it('is idempotent across repeated decoration cycles, keeps clicks working, and removes stale path rows', () => {
    const onOpenLocalFilePath = vi.fn()
    const attachmentPath = 'C:\\qf\\cache\\global\\tmp\\conversations\\s2\\pasted-content.txt'
    const { element, tiles } = createUserMessageWithTiles(1)
    const message = { role: 'user-with-attachments', content: '', attachments: [{ path: attachmentPath }] }
    // 旧版本装饰遗留的路径行要被清掉。
    const staleRow = createFakeElement('div')
    staleRow.className = 'quickforge-text-attachment-path'
    staleRow.textContent = attachmentPath
    element.append(staleRow)

    decorateAttachmentPanel(element, message, onOpenLocalFilePath)
    decorateAttachmentPanel(element, message, onOpenLocalFilePath)

    expect(element.querySelectorAll('.quickforge-text-attachment-path')).toHaveLength(0)

    clickTile(tiles[0])
    expect(onOpenLocalFilePath).toHaveBeenCalledTimes(1)
    clickTile(tiles[0])
    expect(onOpenLocalFilePath).toHaveBeenCalledTimes(2)
  })

  it('aligns multiple attachments to their own tiles and follows path changes', () => {
    const onOpenLocalFilePath = vi.fn()
    const { element, tiles } = createUserMessageWithTiles(2)
    const firstPath = 'C:\\tmp\\a.txt'
    const secondPath = 'C:\\tmp\\b.txt'

    decorateAttachmentPanel(element, {
      role: 'user-with-attachments',
      content: '',
      attachments: [{ path: firstPath }, { path: secondPath }],
    }, onOpenLocalFilePath)

    clickTile(tiles[0])
    expect(onOpenLocalFilePath).toHaveBeenLastCalledWith(firstPath)
    clickTile(tiles[1])
    expect(onOpenLocalFilePath).toHaveBeenLastCalledWith(secondPath)

    const changedPath = 'C:\\tmp\\c.txt'
    decorateAttachmentPanel(element, {
      role: 'user-with-attachments',
      content: '',
      attachments: [{ path: firstPath }, { path: changedPath }],
    }, onOpenLocalFilePath)

    clickTile(tiles[1])
    expect(onOpenLocalFilePath).toHaveBeenLastCalledWith(changedPath)
    expect(onOpenLocalFilePath).toHaveBeenCalledTimes(3)
    clickTile(tiles[0])
    expect(onOpenLocalFilePath).toHaveBeenLastCalledWith(firstPath)
    expect(onOpenLocalFilePath).toHaveBeenCalledTimes(4)
  })
})
