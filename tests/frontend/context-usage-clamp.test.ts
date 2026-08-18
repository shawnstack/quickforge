import { describe, expect, it } from 'vitest'
import { clampReservedOutputTokens, getContextUsage } from '../../src/components/chat/chat-utils'
import type { MessageWithUsage } from '../../src/components/chat/chat-utils'

function assistantMessageWithUsage(usage: { input?: number; output?: number; totalTokens?: number }): MessageWithUsage {
  return { role: 'assistant', content: [{ type: 'text', text: 'answer' }], usage }
}

describe('context usage reserved output clamp', () => {
  it('clamps reserved output tokens to the remaining window when maxTokens exceeds it', () => {
    // 退化场景：maxTokens(120_000) ≥ contextWindow(100_000)，真实请求会被 pi-ai
    // clampMaxTokensToContext 收缩；本地统计口径同样按 min(maxTokens, 窗口-输入-4096) 收缩。
    // 前端 provider 输入优先取 usage.input（30_000）。
    const messages: MessageWithUsage[] = [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      assistantMessageWithUsage({ input: 30_000, output: 1_000, totalTokens: 31_000 }),
    ]

    const usage = getContextUsage('', messages, 100_000, [], 120_000)

    expect(usage.reservedOutputTokens).toBe(65_904)
    expect(usage.totalTokens).toBe(95_904)
    expect(usage.percent).toBeLessThan(100)
  })

  it('drops reserved output tokens to zero when the input already fills the context window', () => {
    const messages: MessageWithUsage[] = [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      assistantMessageWithUsage({ input: 97_000, output: 500, totalTokens: 97_500 }),
    ]

    const usage = getContextUsage('', messages, 100_000, [], 8_000)

    expect(usage.reservedOutputTokens).toBe(0)
    expect(usage.totalTokens).toBe(97_000)
    expect(usage.percent).toBeLessThan(100)
  })

  it('keeps the configured maxTokens when it fits the remaining window', () => {
    const messages: MessageWithUsage[] = [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      assistantMessageWithUsage({ input: 8_500, output: 500, totalTokens: 9_000 }),
    ]

    const usage = getContextUsage('', messages, 100_000, [], 4_000)

    expect(usage.reservedOutputTokens).toBe(4_000)
    expect(usage.totalTokens).toBe(12_500)
  })

  it('clampReservedOutputTokens returns the request unchanged without a positive window', () => {
    expect(clampReservedOutputTokens(8_000, 50_000, 0)).toBe(8_000)
    expect(clampReservedOutputTokens(120_000, 10_000, 100_000)).toBe(100_000 - 10_000 - 4_096)
    expect(clampReservedOutputTokens(undefined, 10_000, 100_000)).toBe(4_096)
    expect(clampReservedOutputTokens(120_000, 99_000, 100_000)).toBe(0)
  })
})
