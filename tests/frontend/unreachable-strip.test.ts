import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Fake DOM（与 reconnect-notice 测试同模式，补 before/nextElementSibling） ---

class FakeElement {
  tagName: string
  className = ''
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  textContent: string | null = null
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

  before(node: FakeElement) {
    const parent = this.parentElement
    if (!parent) return
    node.remove()
    node.parentElement = parent
    parent.children.splice(parent.children.indexOf(this), 0, node)
  }

  get nextElementSibling(): FakeElement | null {
    if (!this.parentElement) return null
    const index = this.parentElement.children.indexOf(this)
    return this.parentElement.children[index + 1] ?? null
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
  | { status: 'reconnecting'; attempt: number; maxAttempts: number; nextRetryAt: number; unreachable?: boolean; unreachableSince?: number }
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

const env = vi.hoisted(() => ({ desktopBodyClass: false, mobileShell: false, remoteClient: false }))

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

vi.mock('@/lib/mobile-server', () => ({
  isMobileShell: () => env.mobileShell,
  isRemoteQuickForgeClient: () => env.remoteClient,
}))

vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      sseUnreachableTitle: "Can't reach the local service",
      sseUnreachableDetail: `Health check failed · retrying in ${params?.seconds}s`,
      sseUnreachableStripTitle: `Local service unreachable for ${params?.duration}`,
      sseUnreachableHelpToggle: 'How to recover',
      sseUnreachableHelpCli: 'Run qf restart',
      sseUnreachableHelpDesktop: 'Restart the QuickForge app',
      sseUnreachableHelpRemote: 'Check the host and Tailscale connection',
      sseUnreachableHelpLogs: 'Server logs: ~/.quickforge/logs/',
      sseReconnectRetryNow: 'Retry now',
    }
    return map[key] ?? key
  },
}))

// --- Source contracts -------------------------------------------------------

const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const stripSource = readFileSync(new URL('../../src/components/chat/panel-decoration/unreachable-strip.ts', import.meta.url), 'utf8')
const barrelSource = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
const noticeSource = readFileSync(new URL('../../src/components/chat/panel-decoration/reconnect-notice.ts', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

/** Composer 真实 DOM：panel > [message-list, dock > shell > message-editor]。 */
function buildPanel() {
  const panel = new FakeElement()
  const messageList = new FakeElement('message-list')
  const dock = new FakeElement('div')
  const shell = new FakeElement('div')
  const editor = new FakeElement('message-editor')
  panel.append(messageList, dock)
  dock.append(shell)
  shell.append(editor)
  return { panel, messageList, dock, shell, editor }
}

async function createController(panel: FakeElement) {
  const { createUnreachableStripController } = await import('@/components/chat/panel-decoration/unreachable-strip')
  return createUnreachableStripController({ panel: panel as unknown as HTMLElement })
}

function emitUnreachable(since: number, nextRetryInMs = 60000) {
  connectionState.emit({
    status: 'reconnecting',
    attempt: 2,
    maxAttempts: 10,
    nextRetryAt: Date.now() + nextRetryInMs,
    unreachable: true,
    unreachableSince: since,
  })
}

describe('unreachable strip controller', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { __quickforgeDesktopApp: false })
    vi.stubGlobal('document', {
      createElement: () => new FakeElement(),
      body: { classList: { contains: (token: string) => token === 'quickforge-desktop-app' && env.desktopBodyClass } },
    })
    connectionState.reset()
    env.desktopBodyClass = false
    env.mobileShell = false
    env.remoteClient = false
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stays hidden while not unreachable (plain reconnecting / recovery)', async () => {
    const { panel } = buildPanel()
    const controller = await createController(panel)

    connectionState.emit({ status: 'reconnecting', attempt: 1, maxAttempts: 10, nextRetryAt: Date.now() + 4000 })
    connectionState.emit({ status: 'connected', recovered: true })
    connectionState.emit({ status: 'failed', maxAttempts: 10 })

    expect(panel.querySelector('.quickforge-unreachable-strip')).toBeNull()
    controller.destroy()
  })

  it('stays hidden below 30s and appears at the threshold without further broadcasts', async () => {
    vi.useFakeTimers()
    const { panel } = buildPanel()
    const controller = await createController(panel)

    emitUnreachable(Date.now())
    expect(panel.querySelector('.quickforge-unreachable-strip')).toBeNull()

    vi.advanceTimersByTime(29999)
    expect(panel.querySelector('.quickforge-unreachable-strip')).toBeNull()

    // 无新广播：自持 1s tick 在 30s 到点时自动出现。
    vi.advanceTimersByTime(1)
    const strip = panel.querySelector('.quickforge-unreachable-strip')!
    expect(strip).not.toBeNull()
    expect(strip.getAttribute('role')).toBe('alert')

    // 插在 composer dock 之前（滚动容器外、任何滚动位置可见）。
    expect(strip.parentElement).toBe(panel)
    expect(strip.nextElementSibling?.querySelector('message-editor')).not.toBeNull()

    controller.destroy()
  })

  it('formats the outage duration as 45s then 1m 05s', async () => {
    vi.useFakeTimers()
    const { panel } = buildPanel()
    const controller = await createController(panel)

    emitUnreachable(Date.now())
    vi.advanceTimersByTime(30000)
    const title = () => panel.querySelector('.quickforge-unreachable-strip-title')!.textContent
    const sub = () => panel.querySelector('.quickforge-unreachable-strip-sub')!.textContent

    vi.advanceTimersByTime(15000)
    expect(title()).toBe('Local service unreachable for 45s')
    expect(sub()).toMatch(/Health check failed · retrying in \d+s/)

    vi.advanceTimersByTime(20000)
    expect(title()).toBe('Local service unreachable for 1m 05s')

    controller.destroy()
  })

  it('expands and collapses the recovery guide and keeps the state across sync remounts', async () => {
    vi.useFakeTimers()
    const { panel } = buildPanel()
    const controller = await createController(panel)

    emitUnreachable(Date.now())
    vi.advanceTimersByTime(30000)
    const strip = panel.querySelector('.quickforge-unreachable-strip')!
    const help = strip.querySelector('.quickforge-unreachable-strip-help')!
    const toggle = strip.querySelector('.quickforge-unreachable-help-toggle')!
    expect(help.getAttribute('data-open')).toBe('false')
    expect(strip.querySelectorAll('.quickforge-unreachable-strip-help-row')).toHaveLength(2)

    toggle.click()
    expect(help.getAttribute('data-open')).toBe('true')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    // 模拟 Lit 重建：条被移除后 decorate 周期 sync() 重新插回，展开状态保留。
    strip.remove()
    controller.sync()
    const rebuilt = panel.querySelector('.quickforge-unreachable-strip')!
    expect(rebuilt).not.toBe(strip)
    expect(rebuilt.querySelector('.quickforge-unreachable-strip-help')!.getAttribute('data-open')).toBe('true')

    rebuilt.querySelector('.quickforge-unreachable-help-toggle')!.click()
    expect(rebuilt.querySelector('.quickforge-unreachable-strip-help')!.getAttribute('data-open')).toBe('false')

    controller.destroy()
  })

  it('shows only the environment-specific action plus the logs row', async () => {
    vi.useFakeTimers()
    const rows = async (): Promise<string[]> => {
      const { panel } = buildPanel()
      const controller = await createController(panel)
      emitUnreachable(Date.now())
      vi.advanceTimersByTime(30000)
      const texts = panel.querySelector('.quickforge-unreachable-strip')!
        .querySelectorAll('.quickforge-unreachable-strip-help-row')
        .map((row) => row.textContent!.slice(2))
      controller.destroy()
      return texts
    }

    // 默认（浏览器/CLI）：仅 CLI 动作行 + 日志行，不整列其他环境。
    expect(await rows()).toEqual([
      'Run qf restart',
      'Server logs: ~/.quickforge/logs/',
    ])

    // 桌面应用（body class quickforge-desktop-app）：换为 Desktop 动作行。
    env.desktopBodyClass = true
    expect(await rows()).toEqual([
      'Restart the QuickForge app',
      'Server logs: ~/.quickforge/logs/',
    ])

    // 移动壳/远程客户端：换为 Remote 动作行。
    env.desktopBodyClass = false
    env.mobileShell = true
    expect(await rows()).toEqual([
      'Check the host and Tailscale connection',
      'Server logs: ~/.quickforge/logs/',
    ])
  })

  it('retry button calls requestSseReconnectNow', async () => {
    vi.useFakeTimers()
    const { panel } = buildPanel()
    const controller = await createController(panel)

    emitUnreachable(Date.now())
    vi.advanceTimersByTime(30000)
    const strip = panel.querySelector('.quickforge-unreachable-strip')!
    const retry = strip.querySelector('.quickforge-reconnect-retry')!
    expect(retry).not.toBeNull()
    retry.click()
    expect(connectionState.retryNowCalls).toBe(1)

    controller.destroy()
  })

  it('removes the strip on recovery and stops ticking', async () => {
    vi.useFakeTimers()
    const { panel } = buildPanel()
    const controller = await createController(panel)

    emitUnreachable(Date.now())
    vi.advanceTimersByTime(30000)
    expect(panel.querySelector('.quickforge-unreachable-strip')).not.toBeNull()

    connectionState.emit({ status: 'connected', recovered: true, restarted: true })
    expect(panel.querySelector('.quickforge-unreachable-strip')).toBeNull()

    // 恢复后 interval 清理，时间推进不再重建。
    vi.advanceTimersByTime(60000)
    expect(panel.querySelector('.quickforge-unreachable-strip')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    controller.destroy()
  })

  it('destroy unsubscribes, clears the interval and removes the strip', async () => {
    vi.useFakeTimers()
    const { panel } = buildPanel()
    const controller = await createController(panel)

    emitUnreachable(Date.now())
    vi.advanceTimersByTime(30000)
    expect(panel.querySelector('.quickforge-unreachable-strip')).not.toBeNull()

    controller.destroy()
    expect(panel.querySelector('.quickforge-unreachable-strip')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    // 后续广播不再生效。
    connectionState.emit({ status: 'reconnecting', attempt: 3, maxAttempts: 10, nextRetryAt: Date.now() + 1000, unreachable: true, unreachableSince: Date.now() - 60000 })
    vi.advanceTimersByTime(60000)
    expect(panel.querySelector('.quickforge-unreachable-strip')).toBeNull()
  })
})

describe('unreachable strip source contracts', () => {
  it('ChatPanelHost wires the strip with side-chat isolation, sync and cleanup', () => {
    expect(hostSource).toContain('createUnreachableStripController')
    expect(hostSource).toContain('const unreachableStrip = sideChatMode ? null : createUnreachableStripController({ panel })')
    expect(hostSource).toContain('unreachableStrip?.sync()')
    expect(hostSource).toContain('unreachableStrip?.destroy()')
  })

  it('barrel exports the controller; the threshold constant is shared with reconnect-notice', () => {
    expect(barrelSource).toContain("export type { UnreachableStripController } from './panel-decoration/unreachable-strip'")
    expect(barrelSource).toContain("export { createUnreachableStripController, UNREACHABLE_STRIP_AFTER_MS } from './panel-decoration/unreachable-strip'")
    expect(noticeSource).toContain("import { UNREACHABLE_STRIP_AFTER_MS } from './unreachable-strip'")
  })

  it('builds every node with createElement/textContent (no innerHTML except the static SVG)', () => {
    expect(stripSource).toContain('.before(strip)')
    const innerHtmlLines = stripSource.split('\n').filter((line) => line.includes('.innerHTML ='))
    expect(innerHtmlLines).toHaveLength(1)
    expect(innerHtmlLines[0].trim()).toBe('icon.innerHTML = WARN_SVG')
  })

  it('styles define the strip, tier-1 unreachable state and reduced motion off', () => {
    expect(cssSource).toContain('.quickforge-unreachable-strip {')
    expect(cssSource).toContain(".quickforge-unreachable-strip-help[data-open='true']")
    expect(cssSource).toContain(".quickforge-reconnect[data-state='unreachable']")
    const slice = cssSource.slice(cssSource.indexOf('/* SSE reconnect notice'))
    expect(slice).toContain('.quickforge-unreachable-strip {\n    animation: none;')
  })
})
