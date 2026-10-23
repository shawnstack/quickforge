// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelRetryNotice } from '../../src/components/chat/surface/ConnectionNotices'
import { appCss } from '../helpers/app-css'

/**
 * The model stream retry row used to be a find-or-create controller
 * (`panel-decoration/model-retry-notice.ts`) that pinned itself to the end of
 * `.qf-message-list` and re-appended after every list rebuild. React renders it
 * inside the surface now, so the DOM cases below assert the rendered contract
 * and the source cases assert that the host owns the visibility state instead
 * of a controller.
 */

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = {
      modelStreamRetryingLabel: '模型连接重试中…',
    }
    return map[key] ?? key
  },
}))

// Source reads use cwd-relative paths: this file runs under jsdom, where
// `import.meta.url` is an http(s) URL and `readFileSync(new URL(...))` rejects it.
const hostSource = readFileSync('src/components/chat/ChatPanelHost.tsx', 'utf8')
const surfaceSource = readFileSync('src/components/chat/surface/ChatSurface.tsx', 'utf8')
const noticesSource = readFileSync('src/components/chat/surface/ConnectionNotices.tsx', 'utf8')
const barrelSource = readFileSync('src/components/chat/panel-decoration.ts', 'utf8')
const agentClientSource = readFileSync('src/lib/global-agent-sse-client.ts', 'utf8')
const agentManagerSource = readFileSync('server/agent-manager.mjs', 'utf8')
const aiHttpLoggerSource = readFileSync('server/ai-http-logger.mjs', 'utf8')
const i18nSource = readFileSync('src/lib/i18n.ts', 'utf8')
const cssSource = appCss

describe('model retry notice rendering', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function render(info: { attempt: number; maxAttempts: number } | null) {
    act(() => {
      root.render(createElement(ModelRetryNotice, { info }))
    })
  }

  const notice = () => container.querySelector<HTMLElement>('.quickforge-model-retry')

  it('renders a centered retry row with the attempt count', () => {
    render({ attempt: 1, maxAttempts: 2 })

    expect(notice()).not.toBeNull()
    expect(notice()!.getAttribute('role')).toBe('status')
    expect(notice()!.querySelector('.quickforge-reconnect-count')!.textContent).toBe('1/2')
    expect(notice()!.querySelector('.quickforge-reconnect-icon')).not.toBeNull()
  })

  it('updates the count in place on subsequent attempts', () => {
    render({ attempt: 1, maxAttempts: 2 })
    const first = notice()

    render({ attempt: 2, maxAttempts: 2 })

    // Same node: the CSS enter animation must not restart on every attempt.
    expect(notice()).toBe(first)
    expect(notice()!.querySelector('.quickforge-reconnect-count')!.textContent).toBe('2/2')
  })

  it('plays the leave animation then unmounts the row', () => {
    vi.useFakeTimers()
    render({ attempt: 2, maxAttempts: 2 })
    expect(notice()).not.toBeNull()

    act(() => {
      root.render(createElement(ModelRetryNotice, { info: null }))
    })
    // The text must survive the fade, so the row stays mounted while leaving.
    expect(notice()).not.toBeNull()
    expect(notice()!.classList.contains('quickforge-model-retry-leaving')).toBe(true)
    expect(notice()!.querySelector('.quickforge-reconnect-count')!.textContent).toBe('2/2')

    act(() => { vi.advanceTimersByTime(340) })
    expect(notice()).toBeNull()
  })

  it('renders nothing without retry info', () => {
    render(null)
    expect(notice()).toBeNull()
  })
})

describe('model retry notice source contracts', () => {
  it('the host owns the retry state and passes it to the surface', () => {
    expect(hostSource).toContain("eventType === 'model_stream_retry'")
    expect(hostSource).toContain('setModelRetryInfo({ attempt: retryEvent.attempt, maxAttempts: retryEvent.maxAttempts })')
    expect(hostSource).toContain('setModelRetryInfo(null)')
    expect(hostSource).toContain('modelRetryInfo={modelRetryInfo}')
    // No decoration controller left to sync/destroy.
    expect(hostSource).not.toContain('createModelRetryNoticeController')
    expect(surfaceSource).toContain('<ModelRetryNotice info={modelRetryInfo} />')
  })

  it('the barrel no longer exports the removed controller', () => {
    expect(barrelSource).not.toContain('model-retry-notice')
  })

  it('server client listens for the SSE event', () => {
    expect(agentClientSource).toContain("'persist_degraded', 'model_stream_retry',")
  })

  it('agent-manager injects onStreamRetry into both Agent streamFn sites', () => {
    // 主 Agent streamFn 仍在 agent-manager.mjs；subagent streamFn 已随 runSubagent
    // 逐字符迁至 agent-subagent-runner.mjs（模块拆分，行为不变），两处注入都在。
    expect(agentManagerSource).toContain("emitSessionEvent(session, { type: 'model_stream_retry', ...info })")
    const subagentRunnerSource = readFileSync('server/agent-subagent-runner.mjs', 'utf8')
    expect(subagentRunnerSource).toContain("emitSessionEvent(parentSession, { type: 'model_stream_retry', ...info })")
    expect(agentManagerSource.match(/onStreamRetry/g)?.length).toBeGreaterThanOrEqual(1)
    expect(subagentRunnerSource.match(/onStreamRetry/g)?.length).toBeGreaterThanOrEqual(1)
  })

  it('ai-http-logger retries only before substantive output, up to 2 attempts, and reports recovery', () => {
    expect(aiHttpLoggerSource).toContain('export const MAX_STREAM_RETRIES = 2')
    expect(aiHttpLoggerSource).toContain('if (!hasSubstantiveEvent && streamRetries < maxStreamRetries && !parentSignal?.aborted) {')
    expect(aiHttpLoggerSource).toContain('recovered: true')
  })

  it('the row is rendered as JSX text, never through innerHTML', () => {
    // React escapes interpolated text, so the old `innerHTML = SPINNER_SVG`
    // constraint is replaced by "no raw HTML assignment at all for the label".
    expect(noticesSource).toContain('modelStreamRetryingLabel')
    expect(noticesSource).not.toContain('dangerouslySetInnerHTML')
  })

  it('i18n carries paired zh/en keys', () => {
    expect((i18nSource.match(/modelStreamRetryingLabel: '/g) ?? []).length).toBe(2)
    expect(i18nSource).toContain("modelStreamRetryingLabel: '模型连接重试中…'")
  })

  it('css shares the reconnect row vocabulary with reduced-motion off', () => {
    expect(cssSource).toContain('.quickforge-reconnect,\n.quickforge-model-retry {')
    expect(cssSource).toContain('.quickforge-model-retry .quickforge-reconnect-icon svg circle')
    const slice = cssSource.slice(cssSource.indexOf('/* SSE reconnect notice'))
    expect(slice).toContain('.quickforge-model-retry {\n    animation: none;\n  }')
  })
})
