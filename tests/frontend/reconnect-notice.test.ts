// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReconnectNotice, unreachableStripOwns } from '../../src/components/chat/surface/ConnectionNotices'
import type { SseConnectionStatus } from '../../src/lib/server-agent'
import { appCss } from '../helpers/app-css'

/**
 * The inline reconnect row used to be a find-or-create controller
 * (`panel-decoration/reconnect-notice.ts`): it appended itself to the end of
 * `.qf-message-list`, kept its own interval for the countdown and had to
 * re-append after every list rebuild. React renders it inside the surface now,
 * so these cases drive the component with connection statuses and assert the
 * rendered row, exactly like the controller tests asserted the injected DOM.
 */

type MockStatus = SseConnectionStatus

const connectionState = vi.hoisted(() => ({
  current: null as unknown,
  listeners: new Set<(status: unknown) => void>(),
  retryNowCalls: 0,
}))

vi.mock('@/lib/server-agent', () => ({
  getSseConnectionState: () => connectionState.current,
  subscribeSseConnectionState: (handler: (status: unknown) => void) => {
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
      sseUnreachableTitle: "Can't reach the local service",
      sseUnreachableDetail: `Health check failed · retrying in ${params?.seconds}s`,
      sseUnreachableStripTitle: `Local service unreachable for ${params?.duration}`,
      sseUnreachableHelpToggle: 'How to recover',
      sseReconnectedLabel: 'Reconnected',
      sseReconnectedRestarted: 'Reconnected · server restarted',
      sseReconnectFailedLabel: `Connection failed after ${params?.maxAttempts} attempts`,
      sseReconnectRetryNow: 'Retry now',
    }
    return map[key] ?? key
  },
}))

// Source reads use cwd-relative paths: under jsdom `import.meta.url` is not a file URL.
const hostSource = readFileSync('src/components/chat/ChatPanelHost.tsx', 'utf8')
const surfaceSource = readFileSync('src/components/chat/surface/ChatSurface.tsx', 'utf8')
const noticesSource = readFileSync('src/components/chat/surface/ConnectionNotices.tsx', 'utf8')
const barrelSource = readFileSync('src/components/chat/panel-decoration.ts', 'utf8')
const agentSource = readFileSync('src/lib/global-agent-sse-client.ts', 'utf8')
const i18nSource = readFileSync('src/lib/i18n.ts', 'utf8')
const cssSource = appCss

describe('reconnect notice rendering', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    connectionState.current = null
    connectionState.listeners.clear()
    connectionState.retryNowCalls = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function render(status: MockStatus | null) {
    act(() => {
      root.render(createElement(ReconnectNotice, { status }))
    })
  }

  const notice = () => container.querySelector<HTMLElement>('.quickforge-reconnect')

  function reconnecting(overrides: Partial<Extract<MockStatus, { status: 'reconnecting' }>> = {}) {
    return {
      status: 'reconnecting' as const,
      attempt: 8,
      maxAttempts: 10,
      nextRetryAt: Date.now() + 4000,
      ...overrides,
    }
  }

  it('renders a centered reconnecting row with the attempt count and countdown', () => {
    render(reconnecting())

    expect(notice()).not.toBeNull()
    expect(notice()!.dataset.state).toBe('reconnecting')
    expect(notice()!.getAttribute('role')).toBe('status')
    expect(notice()!.querySelector('.quickforge-reconnect-count')!.textContent).toBe('8/10')
    expect(notice()!.querySelector('.quickforge-reconnect-countdown')!.textContent).toBe('Retrying in 4s')
  })

  it('ticks the countdown down each second and clears it at the deadline', () => {
    render(reconnecting({ attempt: 3, nextRetryAt: Date.now() + 5000 }))
    const countdown = () => notice()!.querySelector('.quickforge-reconnect-countdown')!.textContent
    expect(countdown()).toBe('Retrying in 5s')

    act(() => { vi.advanceTimersByTime(1000) })
    expect(countdown()).toBe('Retrying in 4s')

    act(() => { vi.advanceTimersByTime(4000) })
    expect(countdown()).toBe('')
  })

  it('updates the attempt count in place for subsequent attempts', () => {
    render(reconnecting({ attempt: 1, nextRetryAt: Date.now() }))
    const first = notice()

    render(reconnecting({ attempt: 2, nextRetryAt: Date.now() }))

    // Same node: the CSS enter animation must not restart per attempt.
    expect(notice()).toBe(first)
    expect(notice()!.querySelector('.quickforge-reconnect-count')!.textContent).toBe('2/10')
  })

  it('shows a transient reconnected row and auto-dismisses it', () => {
    render(reconnecting({ attempt: 2, nextRetryAt: Date.now() }))
    render({ status: 'connected', recovered: true })

    expect(notice()!.dataset.state).toBe('reconnected')
    expect(notice()!.querySelector('.quickforge-reconnect-count')).toBeNull()
    expect(notice()!.querySelector('.quickforge-reconnect-text')!.textContent).toBe('Reconnected')

    act(() => { vi.advanceTimersByTime(2200) })
    expect(notice()!.classList.contains('quickforge-reconnect-leaving')).toBe(true)

    act(() => { vi.advanceTimersByTime(340) })
    expect(notice()).toBeNull()
  })

  it('renders the unreachable state as a two-line notice with a working retry button', () => {
    render(reconnecting({
      attempt: 4,
      nextRetryAt: Date.now() + 3000,
      unreachable: true,
      unreachableSince: Date.now(),
    }))

    // Dedicated Tier-1 state: it must not reuse the plain reconnecting row.
    expect(notice()!.dataset.state).toBe('unreachable')
    expect(notice()!.getAttribute('role')).toBe('status')
    expect(notice()!.querySelector('.quickforge-reconnect-title')!.textContent).toBe("Can't reach the local service")
    expect(notice()!.querySelector('.quickforge-reconnect-sub')!.textContent).toBe('Health check failed · retrying in 3s')
    // No attempt counter and no spinner copy in this state.
    expect(notice()!.querySelector('.quickforge-reconnect-count')).toBeNull()
    expect(notice()!.querySelector('.quickforge-reconnect-text')).toBeNull()

    act(() => { notice()!.querySelector<HTMLButtonElement>('.quickforge-reconnect-retry')!.click() })
    expect(connectionState.retryNowCalls).toBe(1)
  })

  it('hides the inline unreachable row after 30s so the persistent strip takes over', () => {
    const since = Date.now()
    render(reconnecting({
      attempt: 2,
      nextRetryAt: Date.now() + 60000,
      unreachable: true,
      unreachableSince: since,
    }))
    expect(notice()).not.toBeNull()

    act(() => { vi.advanceTimersByTime(29000) })
    expect(notice()).not.toBeNull()

    // The 1s tick re-checks the threshold, so the hand-over needs no new event.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(notice()).toBeNull()

    // A later broadcast must not rebuild the inline row.
    render(reconnecting({
      attempt: 3,
      nextRetryAt: Date.now() + 30000,
      unreachable: true,
      unreachableSince: since,
    }))
    expect(notice()).toBeNull()
  })

  it('keeps the inline unreachable row when unreachableSince is missing', () => {
    // Defensive edge: without a start time the tier decision cannot be made.
    render(reconnecting({ attempt: 1, nextRetryAt: Date.now() + 60000, unreachable: true }))
    act(() => { vi.advanceTimersByTime(60000) })
    expect(notice()).not.toBeNull()
  })

  it('upgrades the recovery row to the restarted label and restarts the hold timer', () => {
    render(reconnecting({ attempt: 2, nextRetryAt: Date.now() }))
    render({ status: 'connected', recovered: true })
    expect(notice()!.querySelector('.quickforge-reconnect-text')!.textContent).toBe('Reconnected')

    act(() => { vi.advanceTimersByTime(1000) })
    render({ status: 'connected', recovered: true, restarted: true })
    expect(notice()!.querySelector('.quickforge-reconnect-text')!.textContent).toBe('Reconnected · server restarted')

    // The hold restarts at the upgrade and lasts 4s (the original 2.2s hold is
    // cancelled by the effect cleanup).
    act(() => { vi.advanceTimersByTime(3999) })
    expect(notice()!.classList.contains('quickforge-reconnect-leaving')).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(notice()!.classList.contains('quickforge-reconnect-leaving')).toBe(true)
  })

  it('ignores the restarted update after the row was dismissed', () => {
    render(reconnecting({ attempt: 2, nextRetryAt: Date.now() }))
    render({ status: 'connected', recovered: true })
    act(() => { vi.advanceTimersByTime(2200 + 340) })
    expect(notice()).toBeNull()

    // Acceptable edge: a late/replayed restarted upgrade cannot resurrect it.
    render({ status: 'connected', recovered: true, restarted: true })
    expect(notice()).toBeNull()
  })

  it('renders the failed state as an alert with a working retry button', () => {
    render({ status: 'failed', maxAttempts: 10 })

    expect(notice()!.dataset.state).toBe('failed')
    expect(notice()!.getAttribute('role')).toBe('alert')
    expect(notice()!.querySelector('.quickforge-reconnect-text')!.textContent)
      .toBe('Connection failed after 10 attempts')

    act(() => { notice()!.querySelector<HTMLButtonElement>('.quickforge-reconnect-retry')!.click() })
    expect(connectionState.retryNowCalls).toBe(1)
  })

  it('ignores a stale connected snapshot on mount', () => {
    render({ status: 'connected', recovered: true })

    expect(notice()).toBeNull()
  })

  it('renders nothing while connected and recovered=false', () => {
    render({ status: 'connected', recovered: false })
    expect(notice()).toBeNull()
  })
})

describe('reconnect notice source contracts', () => {
  it('the surface renders the row; the host no longer owns a controller', () => {
    expect(surfaceSource).toContain('<ReconnectNotice status={connectionStatus} />')
    expect(surfaceSource).toContain('enableConnectionNotices')
    expect(hostSource).not.toContain('createReconnectNoticeController')
    expect(hostSource).toContain('enableConnectionNotices={!sideChatMode}')
  })

  it('the barrel no longer exports the removed controller', () => {
    expect(barrelSource).not.toContain('reconnect-notice')
  })

  it('the surface subscribes to the shared connection state', () => {
    expect(noticesSource).toContain('subscribeSseConnectionState')
    expect(noticesSource).toContain('getSseConnectionState')
    expect(noticesSource).toContain('requestSseReconnectNow')
  })

  it('global SSE client exposes the connection-state API with a 10-attempt cap', () => {
    expect(agentSource).toContain('MAX_SSE_RECONNECT_ATTEMPTS = 10')
    expect(agentSource).toContain('SSE_HEALTH_PROBE_TIMEOUT_MS')
    expect(agentSource).toContain('subscribeConnectionState')
    expect(agentSource).toContain('retryNow()')
  })

  it('the row is JSX text, never raw HTML', () => {
    expect(noticesSource).not.toContain('dangerouslySetInnerHTML')
    expect(noticesSource).not.toContain('.innerHTML =')
  })

  it('i18n carries paired zh/en keys for all reconnect strings', () => {
    for (const key of [
      'sseReconnectingLabel',
      'sseReconnectNextRetry',
      'sseUnreachableTitle',
      'sseUnreachableDetail',
      'sseUnreachableStripTitle',
      'sseUnreachableHelpToggle',
      'sseUnreachableHelpCli',
      'sseUnreachableHelpDesktop',
      'sseUnreachableHelpRemote',
      'sseUnreachableHelpLogs',
      'sseReconnectedLabel',
      'sseReconnectedRestarted',
      'sseReconnectFailedLabel',
      'sseReconnectRetryNow',
    ]) {
      expect(i18nSource.match(new RegExp(`${key}: '`))).not.toBeNull()
    }
    // 旧 key 已被 sseUnreachable* 系列取代。
    expect(i18nSource).not.toContain('sseServerUnreachableLabel')
    expect((i18nSource.match(/sseReconnectingLabel: '/g) ?? []).length).toBe(2)
    expect((i18nSource.match(/sseUnreachableTitle: '/g) ?? []).length).toBe(2)
    // 精修删除的 HelpAuto key 不应残留。
    expect(i18nSource).not.toContain('sseUnreachableHelpAuto')
    expect((i18nSource.match(/sseReconnectedRestarted: '/g) ?? []).length).toBe(2)
    expect(i18nSource).toContain("sseReconnectingLabel: '重新连接中…'")
    expect(i18nSource).toContain("sseUnreachableTitle: '无法连接到本地服务'")
    expect(i18nSource).toContain("sseUnreachableDetail: '健康检查失败 · {seconds}s 后自动重试'")
    expect(i18nSource).toContain("sseUnreachableStripTitle: '本地服务已断开 {duration}'")
    expect(i18nSource).toContain("sseReconnectedRestarted: '已重新连接 · 服务已重启'")
    expect(i18nSource).toContain("sseReconnectFailedLabel: '连接失败，已重试 {maxAttempts} 次'")
  })

  it('styles cover the states, spinner, retry hover and reduced motion', () => {
    expect(cssSource).toContain('.quickforge-reconnect,\n.quickforge-model-retry {')
    expect(cssSource).toContain(".quickforge-reconnect[data-state='reconnecting'] .quickforge-reconnect-icon svg circle")
    expect(cssSource).toContain(".quickforge-reconnect[data-state='reconnected']")
    expect(cssSource).toContain(".quickforge-reconnect[data-state='failed']")
    expect(cssSource).toContain(".quickforge-reconnect[data-state='unreachable']")
    expect(cssSource).toContain('.quickforge-reconnect-retry:hover')
    const reconnectSlice = cssSource.slice(cssSource.indexOf('/* SSE reconnect notice'))
    expect(reconnectSlice).toContain('@media (prefers-reduced-motion: reduce)')
    // 重连样式段必须位于 TodoWrite 摘要注释之前（todo-write-renderer 无界切片契约）。
    expect(cssSource.indexOf('/* SSE reconnect notice')).toBeLessThan(cssSource.indexOf('/* TodoWrite task summary'))
  })
})

describe('unreachableStripOwns', () => {
  it('hands over exactly at the 30s threshold', () => {
    const since = 1_000_000
    const status = { status: 'reconnecting' as const, attempt: 1, maxAttempts: 10, nextRetryAt: since, unreachable: true, unreachableSince: since }

    expect(unreachableStripOwns(status, since + 29999)).toBe(false)
    expect(unreachableStripOwns(status, since + 30000)).toBe(true)
    expect(unreachableStripOwns(null, since)).toBe(false)
    expect(unreachableStripOwns({ status: 'failed', maxAttempts: 10 }, since)).toBe(false)
  })
})
