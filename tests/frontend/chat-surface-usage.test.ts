import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentMessage, AssistantMessage as AssistantMessageType, Usage } from '../../src/components/chat/surface/ChatTypes'
import { aggregateUsage, formatUsage, UsageBar } from '../../src/components/chat/surface/UsageBar'

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 10,
    output: 20,
    cacheRead: 100,
    cacheWrite: 5,
    totalTokens: 135,
    cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    ...overrides,
  }
}

function assistantMessage(usageValue?: Usage): AssistantMessageType {
  return {
    role: 'assistant',
    content: [],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: usageValue ?? usage(),
    stopReason: 'stop',
    timestamp: 1,
  }
}

describe('chat surface usage aggregation', () => {
  it('sums usage across all assistant messages only', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'hi', timestamp: 1 },
      assistantMessage(usage({ input: 10, output: 20, cacheRead: 100, cacheWrite: 5 })),
      assistantMessage(usage({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 })),
      { role: 'toolResult', toolCallId: 'c1', toolName: 'read_file', content: [], isError: false, timestamp: 2 },
    ]

    const totals = aggregateUsage(messages)

    expect(totals.input).toBe(11)
    expect(totals.output).toBe(22)
    expect(totals.cacheRead).toBe(100)
    expect(totals.cacheWrite).toBe(5)
    expect(totals.cost.total).toBeCloseTo(0.006)
  })

  it('ignores assistant messages without usage', () => {
    const messages: AgentMessage[] = [assistantMessage(undefined)]
    // Simulate an assistant message missing usage (streaming partial).
    const partial = { ...assistantMessage(), usage: undefined } as unknown as AssistantMessageType
    messages.push(partial)

    const totals = aggregateUsage([partial])
    expect(totals.input).toBe(0)
    expect(totals.cost.total).toBe(0)
  })

  it('formats usage like the package (tokens + cost)', () => {
    expect(formatUsage(usage())).toBe('↑10 ↓20 R100 W5 $0.0030')
    expect(formatUsage(usage({ cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }))).toBe('↑10 ↓20')
    expect(formatUsage(usage({ input: 1500, output: 25000 }))).toBe('↑1.5k ↓25k R100 W5 $0.0030')
  })
})

describe('chat surface UsageBar rendering', () => {
  it('renders aggregated totals from the messages', () => {
    const markup = renderToStaticMarkup(
      createElement(UsageBar, { messages: [assistantMessage(usage()), assistantMessage(usage())] }),
    )

    expect(markup).toContain('qf-usage-bar')
    expect(markup).toContain('↑20 ↓40 R200 W10')
    expect(markup).toContain('$0.0060')
  })

  it('renders nothing numeric without assistant usage', () => {
    const markup = renderToStaticMarkup(
      createElement(UsageBar, { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }),
    )

    expect(markup).toContain('qf-usage-bar')
    expect(markup).not.toContain('↑')
    expect(markup).not.toContain('$')
  })

  it('renders a clickable total when onCostClick is provided', () => {
    const markup = renderToStaticMarkup(
      createElement(UsageBar, { messages: [assistantMessage()], onCostClick: () => {} }),
    )

    expect(markup).toContain('<button')
    expect(markup).toContain('↑10 ↓20')
  })
})
