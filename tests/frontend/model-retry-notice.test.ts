import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- Fake DOM（与 todo-write-summary / reconnect-notice 测试同模式） ----------

class FakeElement {
  tagName: string
  className = ''
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  attributes = new Map<string, string>()
  textContent: string | null = null
  innerHTML = ''

  constructor(tag = 'div') {
    this.tagName = tag
  }

  classListTokens(): string[] {
    return this.className ? this.className.split(/\s+/) : []
  }

  get classList() {
    return {
      add: (token: string) => {
        const tokens = this.classListTokens()
        if (!tokens.includes(token)) tokens.push(token)
        this.className = tokens.join(' ')
      },
      remove: (token: string) => {
        this.className = this.classListTokens().filter((item) => item !== token).join(' ')
      },
      contains: (token: string) => this.classListTokens().includes(token),
    }
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
}

// --- i18n mock --------------------------------------------------------------

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = {
      modelStreamRetryingLabel: '模型连接重试中…',
    }
    return map[key] ?? key
  },
}))

// --- Source contracts --------------------------------------------------------

const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const noticeSource = readFileSync(new URL('../../src/components/chat/panel-decoration/model-retry-notice.ts', import.meta.url), 'utf8')
const barrelSource = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
const agentClientSource = readFileSync(new URL('../../src/lib/server-agent.ts', import.meta.url), 'utf8')
const agentManagerSource = readFileSync(new URL('../../server/agent-manager.mjs', import.meta.url), 'utf8')
const aiHttpLoggerSource = readFileSync(new URL('../../server/ai-http-logger.mjs', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

function buildPanel() {
  const panel = new FakeElement()
  const messageList = new FakeElement('message-list')
  panel.append(messageList)
  return { panel, messageList }
}

async function createController(panel: FakeElement) {
  const { createModelRetryNoticeController } = await import('@/components/chat/panel-decoration/model-retry-notice')
  return createModelRetryNoticeController({ panel: panel as unknown as HTMLElement })
}

describe('model retry notice controller', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders a centered retry row with the attempt count', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    controller.show(8, 10)
    const notice = messageList.querySelector('.quickforge-model-retry')
    expect(notice).not.toBeNull()
    expect(messageList.children.at(-1)).toBe(notice)
    expect(notice!.getAttribute('role')).toBe('status')
    expect(notice!.querySelector('.quickforge-reconnect-count')!.textContent).toBe('8/10')
    expect(notice!.querySelector('.quickforge-reconnect-icon')).not.toBeNull()

    controller.destroy()
  })

  it('updates the count in place on subsequent attempts', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    controller.show(1, 10)
    const first = messageList.querySelector('.quickforge-model-retry')!
    controller.show(9, 10)
    const second = messageList.querySelector('.quickforge-model-retry')!
    expect(second).toBe(first)
    expect(second.querySelector('.quickforge-reconnect-count')!.textContent).toBe('9/10')

    controller.destroy()
  })

  it('hide plays the leave animation then removes the notice', async () => {
    vi.useFakeTimers()
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    controller.show(2, 10)
    controller.hide()
    const notice = messageList.querySelector('.quickforge-model-retry')!
    expect(notice.classList.contains('quickforge-model-retry-leaving')).toBe(true)

    vi.advanceTimersByTime(340)
    expect(messageList.querySelector('.quickforge-model-retry')).toBeNull()

    controller.destroy()
  })

  it('sync re-appends the notice after the message list is rebuilt', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    controller.show(5, 10)
    messageList.remove()
    const newList = new FakeElement('message-list')
    panel.append(newList)
    controller.sync()

    const notice = newList.querySelector('.quickforge-model-retry')
    expect(notice).not.toBeNull()
    expect(notice!.querySelector('.quickforge-reconnect-count')!.textContent).toBe('5/10')

    controller.destroy()
  })

  it('destroy removes the notice immediately', async () => {
    const { panel, messageList } = buildPanel()
    const controller = await createController(panel)

    controller.show(3, 10)
    controller.destroy()
    expect(messageList.querySelector('.quickforge-model-retry')).toBeNull()
  })
})

describe('model retry notice source contracts', () => {
  it('ChatPanelHost wires show/hide/sync/destroy with side-chat isolation', () => {
    expect(hostSource).toContain('createModelRetryNoticeController({ panel })')
    expect(hostSource).toContain("const modelRetryNotice = sideChatMode ? null : createModelRetryNoticeController({ panel })")
    expect(hostSource).toContain("eventType === 'model_stream_retry'")
    expect(hostSource).toContain('modelRetryNotice?.show(retryEvent.attempt, retryEvent.maxAttempts)')
    expect(hostSource).toContain('modelRetryNotice?.hide()')
    expect(hostSource).toContain('modelRetryNotice?.sync()')
    expect(hostSource).toContain('modelRetryNotice?.destroy()')
  })

  it('barrel exports the controller; server client listens for the SSE event', () => {
    expect(barrelSource).toContain("export { createModelRetryNoticeController } from './panel-decoration/model-retry-notice'")
    expect(agentClientSource).toContain("'persist_degraded', 'model_stream_retry',")
  })

  it('agent-manager injects onStreamRetry into both Agent streamFn sites', () => {
    expect(agentManagerSource).toContain("emitSessionEvent(session, { type: 'model_stream_retry', ...info })")
    expect(agentManagerSource).toContain("emitSessionEvent(parentSession, { type: 'model_stream_retry', ...info })")
    expect(agentManagerSource.match(/onStreamRetry/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('ai-http-logger retries any idle timeout up to 10 and reports recovery', () => {
    expect(aiHttpLoggerSource).toContain('export const MAX_STREAM_RETRIES = 10')
    expect(aiHttpLoggerSource).toContain('if (streamRetries < maxStreamRetries && !parentSignal?.aborted) {')
    expect(aiHttpLoggerSource).toContain('recovered: true')
  })

  it('notice appends to the end of message-list and never uses innerHTML for text', () => {
    expect(noticeSource).toContain(`panel.querySelector<HTMLElement>('message-list')`)
    expect(noticeSource).toContain('messageList.append(notice)')
    const innerHtmlLines = noticeSource.split('\n').filter((line) => line.includes('.innerHTML ='))
    expect(innerHtmlLines).toHaveLength(1)
    expect(innerHtmlLines[0].trim()).toBe('icon.innerHTML = SPINNER_SVG')
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
