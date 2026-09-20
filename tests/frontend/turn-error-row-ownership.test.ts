import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// i18n / svg 注入与 message-actions.test.ts 同形：本用例只覆盖 DOM 所有权边界。
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../src/components/chat/chat-utils', () => ({ replaceSvg: vi.fn() }))

import { decorateTurnErrorRow } from '../../src/components/chat/panel-decoration/turn-error-row'

/**
 * R：装饰层（turn error row）曾把 React 渲染的错误红块（`div.bg-destructive/10`）
 * 当作自己的行复用，`replaceChildren()` 删掉 React 的子节点、覆盖 className，导致
 * React 重渲染 / 卸载时对已不存在的子节点执行 `removeChild` 抛 NotFoundError。
 *
 * 本文件用结构 fake DOM 锁定修复后的所有权边界：
 * - React 红块的子节点与 className 装饰后保持不变（未被删除 / 覆盖）；
 * - 红块只被内联样式隐藏，仍留在 React 容器里；
 * - 行 / 重试 / 详情 / 升级提示都是装饰层自建节点，幂等复用、可被清理；
 * - 点击重试只改装饰层自建节点，不触碰 React 子节点。
 */

function hasClass(node: FakeNode, name: string) {
  return node.className.split(/\s+/).filter(Boolean).includes(name)
}

function attributeValue(node: FakeNode, name: string): string | undefined {
  if (name.startsWith('data-')) {
    const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    if (key in node.dataset) return node.dataset[key]
  }
  return node.attributes[name]
}

/** 支持 `.class`、`tag`、`[attr]`、`[attr="v"]`、`tag[attr="v"]`（单复合选择器）。 */
function matchesCompound(node: FakeNode, compound: string): boolean {
  const attributePattern = /\[([^=\]]+)(?:="([^"]*)")?\]/g
  let match: RegExpExecArray | null
  while ((match = attributePattern.exec(compound))) {
    const value = attributeValue(node, match[1])
    if (value === undefined) return false
    if (match[2] !== undefined && value !== match[2]) return false
  }
  const base = compound.replace(/\[[^\]]*\]/g, '')
  if (base.startsWith('.')) return hasClass(node, base.slice(1).replace(/\\/g, ''))
  if (!base) return true
  return node.tagName === base.toUpperCase()
}

function matchesSelector(node: FakeNode, selector: string): boolean {
  return selector.split(',').some((part) => matchesCompound(node, part.trim()))
}

class FakeNode {
  readonly tagName: string
  className: string
  readonly dataset: Record<string, string> = {}
  readonly attributes: Record<string, string> = {}
  readonly style: Record<string, string> = {}
  textContent = ''
  title = ''
  type = ''
  disabled = false
  parentElement: FakeNode | null = null
  readonly children: FakeNode[] = []
  onclick: ((event: { stopPropagation(): void }) => void) | null = null

  constructor(tagName: string, className = '') {
    this.tagName = tagName.toUpperCase()
    this.className = className
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
      toggle: (name: string, force?: boolean) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean))
        const enabled = force ?? !current.has(name)
        if (enabled) current.add(name)
        else current.delete(name)
        this.className = [...current].join(' ')
        return enabled
      },
      contains: (name: string) => hasClass(this, name),
    }
  }

  append(...nodes: FakeNode[]) {
    nodes.forEach((node) => {
      if (node.parentElement) node.parentElement.detach(node)
      node.parentElement = this
      this.children.push(node)
    })
    return nodes[0] as FakeNode
  }

  replaceChildren(...nodes: FakeNode[]) {
    [...this.children].forEach((child) => this.detach(child))
    this.append(...nodes)
  }

  detach(node: FakeNode) {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    if (node.parentElement === this) node.parentElement = null
  }

  remove() {
    this.parentElement?.detach(this)
    this.parentElement = null
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }

  getAttribute(name: string) {
    return attributeValue(this, name) ?? null
  }

  closest(selector: string): FakeNode | null {
    if (matchesSelector(this, selector)) return this
    return this.parentElement?.closest(selector) ?? null
  }

  querySelectorAll(selector: string): FakeNode[] {
    const found: FakeNode[] = []
    const walk = (parent: FakeNode) => {
      parent.children.forEach((child) => {
        if (matchesSelector(child, selector)) found.push(child)
        walk(child)
      })
    }
    walk(this)
    return found
  }

  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null
  }
}

const asElement = (node: FakeNode) => node as unknown as HTMLElement

const ERROR_MESSAGE = 'AI stream idle timeout after 60000ms'

type ErrorMessage = { role: string; content: unknown[]; stopReason?: string; errorMessage?: string; timestamp?: number }

function errorMessage(overrides: Partial<ErrorMessage> = {}): ErrorMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    stopReason: 'error',
    errorMessage: ERROR_MESSAGE,
    timestamp: 1_750_000_000_000,
    ...overrides,
  }
}

/** 镜像 React AssistantMessage：div.qf-assistant-message > 红块（strong + 原文）。 */
function createTurn(className = 'qf-assistant-message') {
  const host = new FakeNode('div', className)
  const block = new FakeNode(
    'div',
    'mx-4 mt-3 overflow-hidden rounded-lg bg-destructive/10 p-3 text-sm text-destructive',
  )
  const strong = new FakeNode('strong')
  strong.textContent = 'Error:'
  const text = new FakeNode('#text')
  text.textContent = ERROR_MESSAGE
  block.append(strong, text)
  host.append(block)
  return { host, block, strong, text, reactClassName: block.className, reactChildren: [...block.children] }
}

function decorate(host: FakeNode, overrides: Record<string, unknown> = {}) {
  const options = {
    message: errorMessage(),
    terminal: true,
    disabled: false,
    view: { retrying: false, escalated: false, retryCount: 0 },
    onRetry: null,
    ...overrides,
  }
  decorateTurnErrorRow(asElement(host), options as never)
  return options
}

describe('turn error row ownership', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tagName: string) => new FakeNode(tagName),
      createTextNode: (text: string) => {
        const node = new FakeNode('#text')
        node.textContent = text
        return node
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves the React red block children and className untouched and only hides it inline', () => {
    const { host, block, strong, text, reactClassName, reactChildren } = createTurn()

    decorate(host)

    expect(block.className).toBe(reactClassName)
    expect(block.children).toEqual(reactChildren)
    expect(block.children[0]).toBe(strong)
    expect(block.children[1]).toBe(text)
    expect(block.parentElement).toBe(host)
    expect(block.style.display).toBe('none')
  })

  it('creates the decoration-owned line once and reuses it across decorate cycles', () => {
    const { host, block, reactClassName, reactChildren } = createTurn()

    decorate(host)
    const row = host.querySelector('.quickforge-error-line')
    expect(row).not.toBeNull()
    const rowChildren = row ? [...row.children] : []

    decorate(host)

    expect(host.querySelectorAll('.quickforge-error-line')).toEqual([row])
    expect(row?.children).toEqual(rowChildren)
    expect(row?.parentElement).toBe(host)
    // 幂等周期同样不触碰 React 红块。
    expect(block.className).toBe(reactClassName)
    expect(block.children).toEqual(reactChildren)
  })

  it('keeps the retry click working while never deleting React children', () => {
    const { host, block, reactClassName, reactChildren } = createTurn()
    const onRetry = vi.fn()
    decorate(host, { onRetry })

    const row = host.querySelector('.quickforge-error-line')
    row?.querySelector('button[data-quickforge-action="error-retry"]')?.onclick?.({ stopPropagation() {} })

    expect(onRetry).toHaveBeenCalledTimes(1)
    // 同步切换到「正在重试…」只改装饰层自建行。
    expect(row?.className).toContain('quickforge-error-retrying')
    expect(row?.querySelector('.quickforge-error-text')?.textContent).toBe('errorRetryingLabel')
    expect(block.className).toBe(reactClassName)
    expect(block.children).toEqual(reactChildren)
  })

  it('attaches escalate and details to the assistant host as decoration-owned siblings', () => {
    const { host, block } = createTurn()
    decorate(host)
    decorate(host, {
      terminal: true,
      view: { retrying: false, escalated: true, retryCount: 2 },
    })

    const escalate = host.querySelector('.quickforge-error-escalate')
    const details = host.querySelector('.quickforge-error-details')
    expect(escalate?.parentElement).toBe(host)
    expect(details?.parentElement).toBe(host)
    // 伴随元素绝不落在 React 红块里。
    expect(block.querySelector('.quickforge-error-escalate')).toBeNull()
    expect(block.querySelector('.quickforge-error-details')).toBeNull()
  })

  it('clears the decoration-owned row and companions once the error is gone', () => {
    const { host } = createTurn()
    decorate(host)
    expect(host.querySelector('.quickforge-error-line')).not.toBeNull()
    expect(host.querySelector('.quickforge-error-details')).not.toBeNull()

    decorate(host, { message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } })

    expect(host.querySelector('.quickforge-error-line')).toBeNull()
    expect(host.querySelector('.quickforge-error-details')).toBeNull()
    expect(host.querySelector('.quickforge-error-escalate')).toBeNull()
  })

  it('renders historical (non-terminal) errors without action buttons', () => {
    const { host, block, reactClassName } = createTurn()
    decorate(host, { terminal: false })

    const row = host.querySelector('.quickforge-error-line')
    expect(row?.querySelector('.quickforge-error-text')).not.toBeNull()
    expect(row?.querySelector('button[data-quickforge-action="error-retry"]')).toBeNull()
    expect(row?.querySelector('button[data-quickforge-action="error-details"]')).toBeNull()
    expect(block.className).toBe(reactClassName)
  })
})
