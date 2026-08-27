import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Fake DOM --------------------------------------------------------------

class FakeElement {
  tagName: string
  className = ''
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  textContent: string | null = null
  innerHTML = ''
  private listeners = new Map<string, Set<() => void>>()

  constructor(tag = 'div') {
    this.tagName = tag
  }

  get classList() {
    return {
      add: (token: string) => {
        const tokens = this.className ? this.className.split(/\s+/) : []
        if (!tokens.includes(token)) tokens.push(token)
        this.className = tokens.join(' ')
      },
      remove: (token: string) => {
        const tokens = this.className ? this.className.split(/\s+/) : []
        this.className = tokens.filter((item) => item !== token).join(' ')
      },
      contains: (token: string) => this.classListTokens().includes(token),
    }
  }

  classListTokens(): string[] {
    return this.className ? this.className.split(/\s+/) : []
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.remove()
      node.parentElement = this
      this.children.push(node)
    }
  }

  replaceChildren(...nodes: FakeElement[]) {
    for (const child of this.children) child.parentElement = null
    this.children = []
    this.append(...nodes)
  }

  remove() {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }

  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set<() => void>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  click() {
    for (const listener of this.listeners.get('click') ?? []) listener()
  }

  matches(selector: string): boolean {
    if (selector.startsWith('.')) return this.classListTokens().includes(selector.slice(1))
    return this.tagName === selector
  }

  querySelector(selector: string): FakeElement | null {
    if (this.matches(selector)) return this
    for (const child of this.children) {
      const match = child.querySelector(selector)
      if (match) return match
    }
    return null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = []
    if (this.matches(selector)) matches.push(this)
    for (const child of this.children) matches.push(...child.querySelectorAll(selector))
    return matches
  }
}

// --- Module mocks -----------------------------------------------------------

type MockStatus =
  | { status: 'reconnecting'; attempt: number; maxAttempts: number; nextRetryAt: number; unreachable?: boolean }
  | { status: 'connected'; recovered: boolean; restarted?: boolean }
  | { status: 'failed'; maxAttempts: number }

const connectionState = vi.hoisted(() => ({
  current: null as MockStatus | null,
  listeners: new Set<(status: MockStatus) => void>(),
  retryNowCalls: 0,
  emit(status: MockStatus) {
    this.current = status
    for (const listener of [...this.listeners]) listener(status)
  },
  reset() {
    this.current = null
    this.listeners.clear()
    this.retryNowCalls = 0
  },
}))

vi.mock('@/lib/server-agent', () => ({
  getSseConnectionState: () => connectionState.current,
  subscribeSseConnectionState: (handler: (status: MockStatus) => void) => {
    connectionState.listeners.add(handler)
    return () => connectionState.listeners.delete(handler)
  },
  requestSseReconnectNow: () => {
    connectionState.retryNowCalls += 1
  },
}))

vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      sseReconnectingLabel: 'Reconnecting…',
      sseReconnectNextRetry: `Retrying in ${params?.seconds}s`,
      sseServerUnreachableLabel: 'Backend unreachable (health check failed)',
      sseReconnectedLabel: 'Reconnected',
      sseReconnectedRestarted: 'Reconnected · server restarted',
      sseReconnectFailedLabel: `Connection failed after ${params?.maxAttempts} attempts`,
      sseReconnectRetryNow: 'Retry now',
    }
    return map[key] ?? key
  },
}))

// --- Source contracts -------------------------------------------------------

const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const noticeSource = readFileSync(new URL('../../src/components/chat/panel-decoration/reconnect-notice.ts', import.meta.url), 'utf8')
const barrelSource = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
const agentSource = readFileSync(new URL('../../src/lib/server-agent.ts', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

function buildPanel() {
  const panel = new FakeElement()
  const messageList = new FakeElement('message-list')
  panel.append(messageList)
  return { panel, messageList }
}

async function createController(panel: FakeElement) {
  const { createReconnectNoticeController } = await import('@/components/chat/panel-decoration/reconnect-notice')
  return createReconnectNoticeController({ panel: panel as unknown as HTMLElement })
}

describe('reconnect notice controller', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    connectionState.reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders a centered reconnecting row at the end of the message list', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 8, maxAttempts: 10, nextRetryAt: Date.now() + 4000 })

    const notice = messageList.querySelector('.quickforge-reconnect')
    expect(notice).not.toBeNull()
    expect(messageList.children.at(-1)).toBe(notice)
    expect(notice!.dataset.state).toBe('reconnecting')
    expect(notice!.getAttribute('role')).toBe('status')
    expect(notice!.querySelector('.quickforge-reconnect-count')!.textContent).toBe('8/10')
    expect(notice!.querySelector('.quickforge-reconnect-countdown')!.textContent).toBe('Retrying in 4s')

    controller.destroy()
  })

  it('ticks the countdown down each second and clears it at the deadline', async () => {
    vi.useFakeTimers()
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 3, maxAttempts: 10, nextRetryAt: Date.now() + 5000 })
    const countdown = () => messageList.querySelector('.quickforge-reconnect-countdown')!.textContent
    expect(countdown()).toBe('Retrying in 5s')

    vi.advanceTimersByTime(1000)
    expect(countdown()).toBe('Retrying in 4s')

    vi.advanceTimersByTime(4000)
    expect(countdown()).toBe('')

    controller.destroy()
  })

  it('updates the attempt count in place for subsequent attempts', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 1, maxAttempts: 10, nextRetryAt: Date.now() })
    const first = messageList.querySelector('.quickforge-reconnect')!
    connectionState.emit({ status: 'reconnecting', attempt: 2, maxAttempts: 10, nextRetryAt: Date.now() })

    const second = messageList.querySelector('.quickforge-reconnect')!
    expect(second).toBe(first)
    expect(second.querySelector('.quickforge-reconnect-count')!.textContent).toBe('2/10')

    controller.destroy()
  })

  it('shows a transient reconnected state and auto-dismisses it', async () => {
    vi.useFakeTimers()
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 2, maxAttempts: 10, nextRetryAt: Date.now() })
    connectionState.emit({ status: 'connected', recovered: true })

    const notice = messageList.querySelector('.quickforge-reconnect')!
    expect(notice.dataset.state).toBe('reconnected')
    expect(notice.querySelector('.quickforge-reconnect-count')).toBeNull()

    vi.advanceTimersByTime(2200)
    expect(notice.classList.contains('quickforge-reconnect-leaving')).toBe(true)

    vi.advanceTimersByTime(340)
    expect(messageList.querySelector('.quickforge-reconnect')).toBeNull()

    controller.destroy()
  })

  it('renders the unreachable label without the attempt count while the backend is down', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 4, maxAttempts: 10, nextRetryAt: Date.now() + 3000, unreachable: true })

    const notice = messageList.querySelector('.quickforge-reconnect')!
    expect(notice.dataset.state).toBe('reconnecting')
    expect(notice.querySelector('.quickforge-reconnect-text')!.textContent).toBe('Backend unreachable (health check failed)')
    expect(notice.querySelector('.quickforge-reconnect-count')).toBeNull()
    // 「Xs 后重试」倒计时保留。
    expect(notice.querySelector('.quickforge-reconnect-countdown')!.textContent).toBe('Retrying in 3s')

    controller.destroy()
  })

  it('upgrades the recovery notice to the restarted label and resets the fade timer', async () => {
    vi.useFakeTimers()
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 2, maxAttempts: 10, nextRetryAt: Date.now() })
    connectionState.emit({ status: 'connected', recovered: true })
    const notice = messageList.querySelector('.quickforge-reconnect')!
    expect(notice.querySelector('.quickforge-reconnect-text')!.textContent).toBe('Reconnected')

    vi.advanceTimersByTime(1000)
    connectionState.emit({ status: 'connected', recovered: true, restarted: true })
    expect(notice.querySelector('.quickforge-reconnect-text')!.textContent).toBe('Reconnected · server restarted')

    // 淡出计时器从 restarted 更新时刻重新起算（原计时器已于 1000ms 处作废）。
    vi.advanceTimersByTime(2199)
    expect(notice.classList.contains('quickforge-reconnect-leaving')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(notice.classList.contains('quickforge-reconnect-leaving')).toBe(true)

    controller.destroy()
  })

  it('ignores the restarted update after the notice was dismissed and removed', async () => {
    vi.useFakeTimers()
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 2, maxAttempts: 10, nextRetryAt: Date.now() })
    connectionState.emit({ status: 'connected', recovered: true })
    vi.advanceTimersByTime(2200 + 340)
    expect(messageList.querySelector('.quickforge-reconnect')).toBeNull()

    // 可接受边界：提示已被移除时迟到/滞后的 restarted 补播不再重建提示。
    connectionState.emit({ status: 'connected', recovered: true, restarted: true })
    expect(messageList.querySelector('.quickforge-reconnect')).toBeNull()

    controller.destroy()
  })

  it('renders the failed state as an alert with a working retry button', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'failed', maxAttempts: 10 })

    const notice = messageList.querySelector('.quickforge-reconnect')!
    expect(notice.dataset.state).toBe('failed')
    expect(notice.getAttribute('role')).toBe('alert')
    expect(notice.querySelector('.quickforge-reconnect-retry')).not.toBeNull()

    notice.querySelector('.quickforge-reconnect-retry')!.click()
    expect(connectionState.retryNowCalls).toBe(1)

    controller.destroy()
  })

  it('destroy unsubscribes and removes the notice', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 1, maxAttempts: 10, nextRetryAt: Date.now() })
    controller.destroy()

    expect(messageList.querySelector('.quickforge-reconnect')).toBeNull()
    const before = messageList.children.length
    connectionState.emit({ status: 'failed', maxAttempts: 10 })
    expect(messageList.children.length).toBe(before)
  })

  it('sync re-appends the notice after the message list is rebuilt', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 5, maxAttempts: 10, nextRetryAt: Date.now() })
    expect(messageList.querySelector('.quickforge-reconnect')).not.toBeNull()

    // Simulate a Lit rebuild: the old list (with the notice) is replaced.
    messageList.remove()
    const newList = new FakeElement('message-list')
    panel.append(newList)
    controller.sync()

    const notice = newList.querySelector('.quickforge-reconnect')
    expect(notice).not.toBeNull()
    expect(newList.children.at(-1)).toBe(notice)
    expect(notice!.querySelector('.quickforge-reconnect-count')!.textContent).toBe('5/10')

    controller.destroy()
  })

  it('ignores a stale connected snapshot on mount', async () => {
    const { panel, messageList } = buildPanel()
    connectionState.current = { status: 'connected', recovered: true }
    const controller = await createController(panel)

    expect(messageList.querySelector('.quickforge-reconnect')).toBeNull()
    controller.destroy()
  })
})

describe('reconnect notice source contracts', () => {
  it('ChatPanelHost wires the controller with side-chat isolation and cleanup', () => {
    expect(hostSource).toContain('createReconnectNoticeController')
    expect(hostSource).toContain('const reconnectNotice = sideChatMode ? null : createReconnectNoticeController({ panel })')
    expect(hostSource).toContain('reconnectNotice?.sync()')
    expect(hostSource).toContain('reconnectNotice?.destroy()')
  })

  it('barrel exports the controller; ChatPanelHost imports from the barrel', () => {
    expect(barrelSource).toContain("export { createReconnectNoticeController } from './panel-decoration/reconnect-notice'")
    expect(barrelSource).toContain("export type { ReconnectNoticeController } from './panel-decoration/reconnect-notice'")
    expect(hostSource).toContain('createReconnectNoticeController,\n')
  })

  it('server-agent exposes the connection-state API with a 10-attempt cap', () => {
    expect(agentSource).toContain('MAX_SSE_RECONNECT_ATTEMPTS = 10')
    expect(agentSource).toContain('SSE_HEALTH_PROBE_TIMEOUT_MS')
    expect(agentSource).toContain('subscribeConnectionState')
    expect(agentSource).toContain('retryNow()')
  })

  it('notice appends to the end of message-list and never uses innerHTML for text', () => {
    expect(noticeSource).toContain(`panel.querySelector<HTMLElement>('message-list')`)
    expect(noticeSource).toContain('messageList.append(notice)')
    // 文案一律走 textContent/createElement，innerHTML 仅限静态 SVG 常量。
    const innerHtmlLines = noticeSource.split('\n').filter((line) => line.includes('.innerHTML ='))
    expect(innerHtmlLines).toHaveLength(1)
    expect(innerHtmlLines[0].trim()).toBe('icon.innerHTML = svg')
  })

  it('i18n carries paired zh/en keys for all reconnect strings', () => {
    for (const key of [
      'sseReconnectingLabel',
      'sseReconnectNextRetry',
      'sseServerUnreachableLabel',
      'sseReconnectedLabel',
      'sseReconnectedRestarted',
      'sseReconnectFailedLabel',
      'sseReconnectRetryNow',
    ]) {
      expect(i18nSource.match(new RegExp(`${key}: '`))).not.toBeNull()
    }
    expect((i18nSource.match(/sseReconnectingLabel: '/g) ?? []).length).toBe(2)
    expect((i18nSource.match(/sseServerUnreachableLabel: '/g) ?? []).length).toBe(2)
    expect((i18nSource.match(/sseReconnectedRestarted: '/g) ?? []).length).toBe(2)
    expect(i18nSource).toContain("sseReconnectingLabel: '重新连接中…'")
    expect(i18nSource).toContain("sseServerUnreachableLabel: '后端服务不可达（健康检查失败）'")
    expect(i18nSource).toContain("sseReconnectedRestarted: '已重新连接 · 服务已重启'")
    expect(i18nSource).toContain("sseReconnectFailedLabel: '连接失败，已重试 {maxAttempts} 次'")
  })

  it('styles cover the three states, spinner, retry hover and reduced motion', () => {
    expect(cssSource).toContain('.quickforge-reconnect,\n.quickforge-model-retry {')
    expect(cssSource).toContain(".quickforge-reconnect[data-state='reconnecting'] .quickforge-reconnect-icon svg circle")
    expect(cssSource).toContain(".quickforge-reconnect[data-state='reconnected']")
    expect(cssSource).toContain(".quickforge-reconnect[data-state='failed']")
    expect(cssSource).toContain('.quickforge-reconnect-retry:hover')
    const reconnectSlice = cssSource.slice(cssSource.indexOf('/* SSE reconnect notice'))
    expect(reconnectSlice).toContain('@media (prefers-reduced-motion: reduce)')
    // 重连样式段必须位于 TodoWrite 摘要注释之前（todo-write-renderer 无界切片契约）。
    expect(cssSource.indexOf('/* SSE reconnect notice')).toBeLessThan(cssSource.indexOf('/* TodoWrite task summary'))
  })
})
