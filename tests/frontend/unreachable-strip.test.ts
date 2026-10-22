// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  UnreachableStrip,
  formatUnreachableDuration,
  unreachableHelpRows,
} from '../../src/components/chat/surface/ConnectionNotices'
import type { SseConnectionStatus } from '../../src/lib/server-agent'

/**
 * The Tier-2 unreachable strip used to be a controller
 * (`panel-decoration/unreachable-strip.ts`) that built the row by hand, pinned
 * it before the composer dock and re-inserted it whenever a decoration pass
 * found it missing. React renders it now, so these cases drive the component
 * with connection statuses and assert the rendered strip.
 */

const connectionState = vi.hoisted(() => ({ retryNowCalls: 0 }))

const env = vi.hoisted(() => ({ desktopBodyClass: false, mobileShell: false, remoteClient: false }))

vi.mock('@/lib/server-agent', () => ({
  getSseConnectionState: () => null,
  subscribeSseConnectionState: () => () => {},
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

// Source reads use cwd-relative paths: under jsdom `import.meta.url` is not a file URL.
const hostSource = readFileSync('src/components/chat/ChatPanelHost.tsx', 'utf8')
const surfaceSource = readFileSync('src/components/chat/surface/ChatSurface.tsx', 'utf8')
const noticesSource = readFileSync('src/components/chat/surface/ConnectionNotices.tsx', 'utf8')
const barrelSource = readFileSync('src/components/chat/panel-decoration.ts', 'utf8')
const cssSource = readFileSync('src/index.css', 'utf8')

function reconnectingUnreachable(since: number, nextRetryInMs = 60000): SseConnectionStatus {
  return {
    status: 'reconnecting',
    attempt: 2,
    maxAttempts: 10,
    nextRetryAt: Date.now() + nextRetryInMs,
    unreachable: true,
    unreachableSince: since,
  }
}

describe('unreachable strip rendering', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    connectionState.retryNowCalls = 0
    env.desktopBodyClass = false
    env.mobileShell = false
    env.remoteClient = false
    if (typeof window !== 'undefined') {
      (window as Window & { __quickforgeDesktopApp?: boolean }).__quickforgeDesktopApp = false
    }
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function render(status: SseConnectionStatus | null) {
    act(() => {
      root.render(createElement(UnreachableStrip, { status }))
    })
  }

  const strip = () => container.querySelector<HTMLElement>('.quickforge-unreachable-strip')
  const title = () => container.querySelector<HTMLElement>('.quickforge-unreachable-strip-title')
  const sub = () => container.querySelector<HTMLElement>('.quickforge-unreachable-strip-sub')

  it('stays hidden while not unreachable (plain reconnecting / recovery)', () => {
    render({ status: 'reconnecting', attempt: 1, maxAttempts: 10, nextRetryAt: Date.now() + 4000 })
    expect(strip()).toBeNull()

    render({ status: 'connected', recovered: true })
    expect(strip()).toBeNull()

    render({ status: 'failed', maxAttempts: 10 })
    expect(strip()).toBeNull()
  })

  it('stays hidden below 30s and appears at the threshold without further broadcasts', () => {
    const since = Date.now()
    render(reconnectingUnreachable(since))
    expect(strip()).toBeNull()

    act(() => { vi.advanceTimersByTime(29999) })
    expect(strip()).toBeNull()

    // No new broadcast: the shared 1s tick crosses the threshold on its own.
    act(() => { vi.advanceTimersByTime(1) })
    expect(strip()).not.toBeNull()
    expect(strip()!.getAttribute('role')).toBe('alert')
  })

  it('formats the outage duration as 45s then 1m 05s', () => {
    render(reconnectingUnreachable(Date.now()))

    act(() => { vi.advanceTimersByTime(30000) })
    act(() => { vi.advanceTimersByTime(15000) })
    expect(title()!.textContent).toBe('Local service unreachable for 45s')
    expect(sub()!.textContent).toMatch(/Health check failed · retrying in \d+s/)

    act(() => { vi.advanceTimersByTime(20000) })
    expect(title()!.textContent).toBe('Local service unreachable for 1m 05s')
  })

  it('expands and collapses the recovery guide', () => {
    render(reconnectingUnreachable(Date.now()))
    act(() => { vi.advanceTimersByTime(30000) })

    const help = () => container.querySelector<HTMLElement>('.quickforge-unreachable-strip-help')!
    const toggle = () => container.querySelector<HTMLButtonElement>('.quickforge-unreachable-help-toggle')!
    expect(help().dataset.open).toBe('false')
    expect(container.querySelectorAll('.quickforge-unreachable-strip-help-row')).toHaveLength(2)

    act(() => { toggle().click() })
    expect(help().dataset.open).toBe('true')
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(toggle().textContent).toContain('⌃')

    // Re-render (a status tick) must not collapse the guide: the open flag is
    // component state, which is exactly what the controller had to restore by
    // hand after a list rebuild.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(help().dataset.open).toBe('true')

    act(() => { toggle().click() })
    expect(help().dataset.open).toBe('false')
    expect(toggle().textContent).toContain('⌄')
  })

  it('shows only the environment-specific action plus the logs row', () => {
    const rowTexts = () => Array.from(container.querySelectorAll('.quickforge-unreachable-strip-help-row'))
      .map((row) => row.textContent!.slice(2))
    const remount = () => {
      act(() => root.unmount())
      root = createRoot(container)
      render(reconnectingUnreachable(Date.now()))
      act(() => { vi.advanceTimersByTime(30000) })
    }

    render(reconnectingUnreachable(Date.now()))
    act(() => { vi.advanceTimersByTime(30000) })
    // Default (browser / CLI): CLI action + logs only, never all three.
    expect(rowTexts()).toEqual([
      'Run qf restart',
      'Server logs: ~/.quickforge/logs/',
    ])

    // Desktop app: the body class marks it (checked before the UA fallback).
    document.body.classList.add('quickforge-desktop-app')
    try {
      remount()
      expect(rowTexts()).toEqual([
        'Restart the QuickForge app',
        'Server logs: ~/.quickforge/logs/',
      ])
    } finally {
      document.body.classList.remove('quickforge-desktop-app')
    }

    // Mobile shell / remote client: the remote action row.
    env.mobileShell = true
    remount()
    expect(rowTexts()).toEqual([
      'Check the host and Tailscale connection',
      'Server logs: ~/.quickforge/logs/',
    ])
  })

  it('retry button calls requestSseReconnectNow', () => {
    render(reconnectingUnreachable(Date.now()))
    act(() => { vi.advanceTimersByTime(30000) })

    act(() => { container.querySelector<HTMLButtonElement>('.quickforge-reconnect-retry')!.click() })
    expect(connectionState.retryNowCalls).toBe(1)
  })

  it('unmounts the strip on recovery', () => {
    render(reconnectingUnreachable(Date.now()))
    act(() => { vi.advanceTimersByTime(30000) })
    expect(strip()).not.toBeNull()

    render({ status: 'connected', recovered: true, restarted: true })
    expect(strip()).toBeNull()

    // No pending interval survives the unmount.
    act(() => { vi.advanceTimersByTime(60000) })
    expect(strip()).toBeNull()
  })
})

describe('unreachable strip helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('formats durations under and over a minute', () => {
    expect(formatUnreachableDuration(45_000)).toBe('45s')
    expect(formatUnreachableDuration(65_000)).toBe('1m 05s')
    expect(formatUnreachableDuration(0)).toBe('0s')
    expect(formatUnreachableDuration(-500)).toBe('0s')
  })

  it('picks the help row for the detected environment', () => {
    expect(unreachableHelpRows()).toEqual(['cli', 'logs'])

    document.body.classList.add('quickforge-desktop-app')
    try {
      expect(unreachableHelpRows()).toEqual(['desktop', 'logs'])
    } finally {
      document.body.classList.remove('quickforge-desktop-app')
    }

    env.mobileShell = true
    expect(unreachableHelpRows()).toEqual(['remote', 'logs'])
    env.mobileShell = false
  })
})

describe('unreachable strip source contracts', () => {
  it('the surface renders the strip; the host no longer owns a controller', () => {
    expect(surfaceSource).toContain('<UnreachableStrip status={connectionStatus} />')
    expect(hostSource).not.toContain('createUnreachableStripController')
  })

  it('the barrel no longer exports the removed controller', () => {
    expect(barrelSource).not.toContain('unreachable-strip')
  })

  it('the tier threshold lives with the notices that use it', () => {
    expect(noticesSource).toContain('export const UNREACHABLE_STRIP_AFTER_MS = 30000')
  })

  it('the strip is JSX text, never raw HTML', () => {
    expect(noticesSource).not.toContain('dangerouslySetInnerHTML')
    expect(noticesSource).not.toContain('.innerHTML =')
  })

  it('styles define the strip, tier-1 unreachable state and reduced motion off', () => {
    expect(cssSource).toContain('.quickforge-unreachable-strip {')
    expect(cssSource).toContain(".quickforge-unreachable-strip-help[data-open='true']")
    expect(cssSource).toContain(".quickforge-reconnect[data-state='unreachable']")
    const slice = cssSource.slice(cssSource.indexOf('/* SSE reconnect notice'))
    expect(slice).toContain('.quickforge-unreachable-strip {\n    animation: none;')
  })
})
