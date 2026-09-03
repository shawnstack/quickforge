import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assistantActionDisplayIndexes } from '../../src/components/chat/panel-decoration/message-action-visibility'
import { decorateMessages, decorateUserContextChips } from '../../src/components/chat/panel-decoration/message-actions'
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
  parentElement: FakeNode | null
  onclick?: ((event: { stopPropagation(): void }) => void) | null
  append: (...items: FakeNode[]) => void
  appendChild: (item: FakeNode) => FakeNode
  prepend: (item: FakeNode) => void
  replaceChildren: (...items: FakeNode[]) => void
  remove: () => void
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
  if (trimmed.startsWith('.')) return hasClass(node, trimmed.slice(1))
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
    querySelector(selector: string) {
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

  it('does not apply content visibility to message hosts containing rollback popovers', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

    expect(css).not.toMatch(
      /message-list\s+(?:user-message|assistant-message)[^{}]*\{[^{}]*content-visibility\s*:/s,
    )
  })
})

describe('error message continue action', () => {
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

  function errorMessageFixture() {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      errorMessage: 'AI stream idle timeout after 60000ms',
      timestamp: 1_750_000_000_000,
    }
  }

  function buildPanel(elements: FakeNode[]) {
    const messageList = createFakeElement('message-list')
    messageList.append(...elements)
    const panel = createFakeElement('div')
    panel.append(messageList)
    return { panel, messageList }
  }

  function decorateErrorPanel(
    elements: FakeNode[],
    messages: Record<string, unknown>[],
    options: Partial<Parameters<typeof decorateMessages>[0]> = {},
  ) {
    const { panel } = buildPanel(elements)
    decorateMessages({
      panel: panel as unknown as HTMLElement,
      getMessages: () => messages as never,
      isStreaming: () => false,
      onCopyAnswer: vi.fn(),
      onRollbackFromMessage: vi.fn(),
      onRetryFromMessage: vi.fn(),
      onForkFromMessage: vi.fn(),
      disableFork: false,
      onContinueAfterError: vi.fn(),
      ...options,
    })
    return panel
  }

  it('shows an always-visible continue button on the terminal error message and reports the error entry on click', () => {
    const onContinueAfterError = vi.fn()
    const user = createUserMessageElement().element
    const errorElement = createFakeElement('assistant-message')
    const messages = [{ role: 'user', content: 'question' }, errorMessageFixture()]
    decorateErrorPanel([user, errorElement], messages, { onContinueAfterError })

    const row = errorElement.querySelector('.quickforge-message-actions')
    expect(row).not.toBeNull()
    expect(row?.className).not.toContain('opacity-0')
    expect(row?.querySelector('.quickforge-message-time')).not.toBeNull()
    expect(row?.querySelector('button[data-quickforge-action="copy"]')).toBeNull()

    const continueButton = row?.querySelector('button[data-quickforge-action="continue"]')
    expect(continueButton).not.toBeNull()
    expect(continueButton?.disabled).toBe(false)
    expect(continueButton?.getAttribute('aria-label')).toBe('errorContinueAction')

    continueButton?.onclick?.({ stopPropagation() {} })
    expect(onContinueAfterError).toHaveBeenCalledWith(messages.at(-1))
  })

  it('keeps the continue row across re-decoration and disables it for restricted history actions', () => {
    const user = createUserMessageElement().element
    const errorElement = createFakeElement('assistant-message')
    const messages = [{ role: 'user', content: 'question' }, errorMessageFixture()]
    const decorate = () => decorateErrorPanel([user, errorElement], messages, { historyActionsDisabled: true })

    decorate()
    const firstRow = errorElement.querySelector('.quickforge-message-actions')
    expect(firstRow?.querySelector('button[data-quickforge-action="continue"]')?.disabled).toBe(true)

    decorate()
    const secondRow = errorElement.querySelector('.quickforge-message-actions')
    expect(secondRow).toBe(firstRow)
    expect(secondRow?.querySelectorAll('button[data-quickforge-action="continue"]')).toHaveLength(1)
    expect(secondRow?.querySelector('button[data-quickforge-action="continue"]')?.disabled).toBe(true)
  })

  it('does not create a row for historical error messages', () => {
    const user = createUserMessageElement().element
    const errorElement = createFakeElement('assistant-message')
    const trailingUser = createUserMessageElement().element
    decorateErrorPanel([user, errorElement, trailingUser], [
      { role: 'user', content: 'question' },
      errorMessageFixture(),
      { role: 'user', content: 'next' },
    ])

    expect(errorElement.querySelector('.quickforge-message-actions')).toBeNull()
    expect(errorElement.querySelector('button[data-quickforge-action="continue"]')).toBeNull()
  })

  it('removes the stale error row once the error is no longer the terminal message', () => {
    const user = createUserMessageElement().element
    const errorElement = createFakeElement('assistant-message')
    const elements = [user, errorElement]
    const messages = [{ role: 'user', content: 'question' }, errorMessageFixture()]
    decorateErrorPanel(elements, messages)
    expect(errorElement.querySelector('.quickforge-message-actions')).not.toBeNull()

    const trailingUser = createUserMessageElement().element
    elements.push(trailingUser)
    decorateErrorPanel(elements, [...messages, { role: 'user', content: 'next' }])
    expect(errorElement.querySelector('.quickforge-message-actions')).toBeNull()
  })

  it.each([
    ['retry capability unavailable', { allowRetry: false }],
    ['read-only viewer', { readOnly: true }],
    ['streaming', { isStreaming: () => true }],
    ['no continue handler', { onContinueAfterError: undefined }],
  ])('hides the continue row when %s', (_name, options) => {
    const user = createUserMessageElement().element
    const errorElement = createFakeElement('assistant-message')
    decorateErrorPanel([user, errorElement], [{ role: 'user', content: 'question' }, errorMessageFixture()], options)

    expect(errorElement.querySelector('.quickforge-message-actions')).toBeNull()
  })

  it('wires onContinueAfterError to retryFailedPrompt with a continue-message fallback in ChatPanelHost', () => {
    const source = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
    expect(source).toContain('onContinueAfterError:')
    expect(source).toContain('retryFailedPrompt')
    expect(source).toContain("t('errorContinueMessage')")
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
  // harness 为纯逻辑 + 源码断言；此处沿用：前缀解析/剥前缀计划已提为纯函数单测，
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
