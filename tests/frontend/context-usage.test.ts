import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createContextUsageIndicator, isSameContextUsageDisplayInfo, type ContextUsageDisplayInfo } from '../../src/components/chat/context-usage'
import { getContextUsage, type MessageWithUsage } from '../../src/components/chat/chat-utils'

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}), { virtual: true })

const originalDocument = globalThis.document
const originalWindow = globalThis.window

beforeAll(() => {
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

afterAll(() => {
  vi.stubGlobal('document', originalDocument)
  vi.stubGlobal('window', originalWindow)
})

function createPanel() {
  return {
    querySelector: () => null,
  } as unknown as HTMLElement
}

function createIndicator({
  messages = [],
  effectiveMessages,
  serverUsage,
  isCompacted,
  onDisplayChange,
}: {
  messages?: MessageWithUsage[]
  effectiveMessages?: () => MessageWithUsage[]
  serverUsage?: () => Record<string, unknown> | null
  isCompacted?: () => boolean
  onDisplayChange?: (info: ContextUsageDisplayInfo) => void
}) {
  return createContextUsageIndicator({
    panel: createPanel(),
    getSystemPrompt: () => '',
    getMessages: () => messages,
    getEffectiveMessages: effectiveMessages,
    getContextWindow: () => 100_000,
    getServerContextUsage: serverUsage,
    getIsCompacted: isCompacted,
    renderInline: false,
    renderModelRing: false,
    onDisplayChange,
  })
}

describe('context usage indicator', () => {
  it('skips effective message construction when server usage is available', () => {
    const getEffectiveMessages = vi.fn(() => {
      throw new Error('effective messages should not be constructed')
    })
    const onDisplayChange = vi.fn()
    const indicator = createIndicator({
      effectiveMessages: getEffectiveMessages,
      serverUsage: () => ({
        contextWindow: 100_000,
        inputTokens: 20_000,
        estimatedInputTokens: 20_000,
        percent: 20,
        color: 'hsl(100 72% 45%)',
      }),
      onDisplayChange,
    })

    indicator.update()

    expect(getEffectiveMessages).not.toHaveBeenCalled()
    expect(onDisplayChange).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ percent: 20 }),
    }))
  })

  it('keeps using effective messages for the local fallback', () => {
    const effectiveMessages: MessageWithUsage[] = []
    const getEffectiveMessages = vi.fn(() => effectiveMessages)
    const getIsCompacted = vi.fn(() => true)
    const indicator = createIndicator({
      effectiveMessages: getEffectiveMessages,
      serverUsage: () => null,
      isCompacted: getIsCompacted,
    })

    indicator.update()

    expect(getEffectiveMessages).toHaveBeenCalledTimes(1)
    expect(getIsCompacted).not.toHaveBeenCalled()
  })

  it('preserves the compacted tooltip when older server usage omits isCompacted', () => {
    const onDisplayChange = vi.fn()
    const indicator = createIndicator({
      effectiveMessages: vi.fn(() => {
        throw new Error('effective messages should not be constructed')
      }),
      serverUsage: () => ({
        contextWindow: 100_000,
        inputTokens: 20_000,
        estimatedInputTokens: 20_000,
        percent: 20,
      }),
      isCompacted: () => true,
      onDisplayChange,
    })

    indicator.update()

    const display = onDisplayChange.mock.calls[0]?.[0] as ContextUsageDisplayInfo
    expect(display.context?.title).toContain('contextUsageScopeCompacted')
  })

  it('does not notify again when display information is unchanged', () => {
    const onDisplayChange = vi.fn()
    const indicator = createIndicator({
      serverUsage: () => ({
        contextWindow: 100_000,
        inputTokens: 20_000,
        estimatedInputTokens: 20_000,
        percent: 20,
      }),
      onDisplayChange,
    })

    indicator.update()
    indicator.update()

    expect(onDisplayChange).toHaveBeenCalledTimes(1)
  })

  it('compares all display fields', () => {
    const info: ContextUsageDisplayInfo = {
      gitBranch: 'main',
      context: { percent: 25, color: 'green', label: '25%', title: 'Context usage' },
    }
    expect(isSameContextUsageDisplayInfo(info, { ...info, context: { ...info.context! } })).toBe(true)
    expect(isSameContextUsageDisplayInfo(info, { ...info, gitBranch: 'feature' })).toBe(false)
    expect(isSameContextUsageDisplayInfo(info, { ...info, context: { ...info.context!, percent: 26 } })).toBe(false)
  })
})

describe('getContextUsage pure input metrics', () => {
  function assistantMessageWithUsage(usage: { input?: number; output?: number; totalTokens?: number }): MessageWithUsage {
    return { role: 'assistant', content: [{ type: 'text', text: 'answer' }], usage }
  }

  it('computes percent from provider input tokens only and aligns totalTokens with inputTokens', () => {
    // 纯输入口径：占用 = inputTokens / contextWindow，不再叠加预留输出 token。
    const messages: MessageWithUsage[] = [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      assistantMessageWithUsage({ input: 30_000, output: 1_000, totalTokens: 31_000 }),
    ]

    const usage = getContextUsage('', messages, 100_000, [])

    expect(usage.inputTokens).toBe(30_000)
    expect(usage.totalTokens).toBe(30_000)
    expect(usage.percent).toBe(30)
    expect('reservedOutputTokens' in usage).toBe(false)
  })

  it('keeps percent below 100 when the input nearly fills the context window', () => {
    const messages: MessageWithUsage[] = [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      assistantMessageWithUsage({ input: 97_000, output: 500, totalTokens: 97_500 }),
    ]

    const usage = getContextUsage('', messages, 100_000, [])

    expect(usage.percent).toBe(97)
  })

  it('falls back to the local estimate and returns zero percent without a positive window', () => {
    const messages: MessageWithUsage[] = [
      { role: 'user', content: [{ type: 'text', text: 'question '.repeat(2000) }] },
    ]

    const estimated = getContextUsage('system prompt', messages, 100_000, [])
    expect(estimated.inputTokenSource).toBe('estimated')
    expect(estimated.percent).toBeGreaterThan(0)
    expect(estimated.totalTokens).toBe(estimated.inputTokens)

    expect(getContextUsage('', messages, 0, []).percent).toBe(0)
  })
})
