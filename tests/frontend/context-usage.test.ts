import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { contextUsageBreakdownRows, createContextUsageIndicator, isSameContextUsageDisplayInfo, normalizeServerContextUsage, type ContextUsageDisplayInfo } from '../../src/components/chat/context-usage'

vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}), { virtual: true })

const contextUsageSource = readFileSync(new URL('../../src/components/chat/context-usage.ts', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

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
  serverUsage,
  isCompacted,
  onDisplayChange,
}: {
  serverUsage?: () => Record<string, unknown> | null
  isCompacted?: () => boolean
  onDisplayChange?: (info: ContextUsageDisplayInfo) => void
}) {
  return createContextUsageIndicator({
    panel: createPanel(),
    getContextWindow: () => 100_000,
    getServerContextUsage: serverUsage,
    getIsCompacted: isCompacted,
    renderInline: false,
    renderModelRing: false,
    onDisplayChange,
  })
}

describe('context usage indicator', () => {
  it('keeps the compact ring visual at 14px inside a dedicated slot before the model button', () => {
    expect(contextUsageSource).toContain("const existingSlot = panel.querySelector<HTMLElement>('.quickforge-context-usage-slot')")
    expect(contextUsageSource).toContain("slot.className = 'quickforge-context-usage-slot'")
    expect(contextUsageSource).toContain("modelControls.insertBefore(slot, modelButton)")
    expect(contextUsageSource).toContain("if (icon.parentElement !== slot) slot.append(icon)")
    expect(contextUsageSource).toContain("'width: 14px'")
    expect(contextUsageSource).toContain("'height: 14px'")
  })

  it('preserves the compacted tooltip when older server usage omits isCompacted', () => {
    const onDisplayChange = vi.fn()
    const indicator = createIndicator({
      serverUsage: () => ({
        contextWindow: 100_000,
        inputTokens: 20_000,
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

  it('appends Skills and MCP after the existing three breakdown rows', () => {
    expect(contextUsageBreakdownRows({
      systemPromptTokens: 100,
      toolsTokens: 200,
      messagesTokens: 300,
      skillsTokens: 40,
      mcpTokens: 50,
    })).toEqual([
      ['contextUsageSystemPromptLabel', '100'],
      ['contextUsageToolsSchemaLabel', '200'],
      ['contextUsageMessagesLabel', '300'],
      ['contextUsageSkillsLabel', '40'],
      ['contextUsageMcpLabel', '50'],
    ])
  })

  it('hides Skills and MCP rows when their fields are missing or zero', () => {
    expect(contextUsageBreakdownRows({
      systemPromptTokens: 100,
      toolsTokens: 200,
      messagesTokens: 300,
      skillsTokens: 0,
    })).toEqual([
      ['contextUsageSystemPromptLabel', '100'],
      ['contextUsageToolsSchemaLabel', '200'],
      ['contextUsageMessagesLabel', '300'],
    ])
  })
})

describe('context usage indicator without local estimation', () => {
  it('keeps showing the last server-reported usage when the latest report is unavailable', () => {
    const onDisplayChange = vi.fn()
    let current: Record<string, unknown> | null = {
      contextWindow: 100_000,
      inputTokens: 30_000,
      inputTokenSource: 'provider',
    }
    const indicator = createIndicator({
      serverUsage: () => current,
      onDisplayChange,
    })

    indicator.update()
    current = {
      contextWindow: 100_000,
      inputTokens: 0,
      inputTokenSource: 'unavailable',
    }
    indicator.update()

    expect(onDisplayChange).toHaveBeenCalledTimes(2)
    expect(onDisplayChange).toHaveBeenLastCalledWith(expect.objectContaining({
      context: expect.objectContaining({ percent: 30 }),
    }))
    const title = onDisplayChange.mock.calls.at(-1)?.[0]?.context?.title as string
    expect(title).toContain('contextUsageStaleNote')
    // 沿用的数值来自提供商上报，只能标注时效，不能改口叫本地估算
    expect(title).toContain('contextUsageSourceProvider')
  })

  it('does not invent a percentage when the server never reported usage', () => {
    const onDisplayChange = vi.fn()
    const indicator = createIndicator({
      serverUsage: () => ({
        contextWindow: 100_000,
        inputTokens: 0,
        inputTokenSource: 'unavailable',
      }),
      onDisplayChange,
    })

    indicator.update()

    const info = onDisplayChange.mock.calls.at(-1)?.[0]
    expect(info?.context).toBeUndefined()
  })

  it('treats a legacy payload without inputTokenSource as provider-reported usage', () => {
    const onDisplayChange = vi.fn()
    const indicator = createIndicator({
      serverUsage: () => ({ contextWindow: 100_000, inputTokens: 42_000 }),
      onDisplayChange,
    })

    indicator.update()

    const display = onDisplayChange.mock.calls.at(-1)?.[0] as ContextUsageDisplayInfo
    expect(display.context?.percent).toBe(42)
    // 缺 source 字段时按提供商上报处理，不能显示成「上一次请求（尚未更新）」
    expect(display.context?.title).not.toContain('contextUsageStaleNote')
  })

  it('zeroes tokens and percentage when the payload is marked unavailable', () => {
    // 「来源未知」和「有数值」不能同时成立：否则环上是 0%，tooltip 里却挂着正数。
    // 服务端目前不会给出这种组合，这条守的是将来某次改动别把判定条件拆成两半。
    const usage = normalizeServerContextUsage({
      contextWindow: 100_000,
      inputTokens: 42_000,
      inputTokenSource: 'unavailable',
      percent: 42,
    }, 100_000)

    expect(usage.inputTokenSource).toBe('unavailable')
    expect(usage.inputTokens).toBe(0)
    expect(usage.percent).toBe(0)
  })

  it('recomputes the stale percentage against the current model window', () => {
    // 切换模型后窗口变了，但上一次上报的 token 数还是旧模型下的，必须按新窗口重算，
    // 否则会把 4 万 token 显示成旧窗口的 40%。
    const onDisplayChange = vi.fn()
    let windowSize = 100_000
    let current: Record<string, unknown> | null = { contextWindow: 100_000, inputTokens: 40_000, inputTokenSource: 'provider' }
    const indicator = createContextUsageIndicator({
      panel: createPanel(),
      getContextWindow: () => windowSize,
      getServerContextUsage: () => current,
      renderInline: false,
      renderModelRing: false,
      onDisplayChange,
    })

    indicator.update()
    expect(onDisplayChange.mock.calls.at(-1)?.[0]?.context?.percent).toBe(40)

    windowSize = 200_000
    current = { contextWindow: 100_000, inputTokens: 0, inputTokenSource: 'unavailable' }
    indicator.update()

    const display = onDisplayChange.mock.calls.at(-1)?.[0] as ContextUsageDisplayInfo
    expect(display.context?.percent).toBe(20)
  })

  it('lists only the local estimate breakdown in the tooltip title', () => {
    const onDisplayChange = vi.fn()
    const indicator = createIndicator({
      serverUsage: () => ({
        contextWindow: 100_000,
        inputTokens: 30_000,
        inputTokenSource: 'provider',
        breakdown: {
          providerUsageTokens: 25_000,
          trailingTokens: 5_000,
          systemPromptTokens: 100,
          toolsTokens: 200,
          messagesTokens: 300,
        },
      }),
      onDisplayChange,
    })

    indicator.update()

    const title = onDisplayChange.mock.calls.at(-1)?.[0]?.context?.title as string
    const lines = title.split('\n')
    const lineOf = (key: string) => lines.findIndex((line) => line.startsWith(key))
    // 提供商用量基线、基线后的消息两行已从展示里去掉，title 里也不能再出现。
    expect(title).not.toContain('contextUsageProviderBaseline')
    expect(title).not.toContain('contextUsageTrailingMessages')
    expect(lineOf('contextUsageLocalBreakdownTitle')).toBeGreaterThan(-1)
    expect(lineOf('contextUsageLocalBreakdownTitle')).toBeLessThan(lineOf('contextUsageSystemPrompt'))
    expect(lineOf('contextUsageSystemPrompt')).toBeLessThan(lineOf('contextUsageToolsSchema'))
    expect(lineOf('contextUsageToolsSchema')).toBeLessThan(lineOf('contextUsageMessages'))
  })

  it('drops the dead local-estimate i18n keys', () => {
    expect(i18nSource).not.toContain('contextUsageSourceLocalShort')
    expect(i18nSource).not.toContain('contextUsageSourceMixed')
    expect(i18nSource).not.toContain('contextUsageSourceEstimated')
    // 来源固定为提供商上报后，“服务端计算”分支与“未知来源”旧键都不再有引用
    expect(i18nSource).not.toContain('contextUsageServerCalculated')
    expect(i18nSource).not.toContain('contextUsageSourceServerShort')
    expect(i18nSource).not.toContain('contextUsageSourceUnavailable')
    // 展示里不再有「提供商用量基线 / 基线后的消息」两行，对应文案也不该留着。
    expect(i18nSource).not.toContain('contextUsageProviderBaseline')
    expect(i18nSource).not.toContain('contextUsageTrailingMessages')
  })
})
