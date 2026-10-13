import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

// 显示模式按用例切换（渲染器经 tool-renderers/shared 的 toolDisplayDetailed 读取）；
// 下拉明细区不依赖 detailed 设置，恒随展开呈现。
const toolDisplay = vi.hoisted(() => ({ mode: 'default' as 'default' | 'detailed' }))
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: toolDisplay.mode }),
}))

import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import { ContextEvictionToolRenderer } from '../../src/lib/tool-renderers/context-eviction-tool-renderer'

applyAppLanguageFromSnapshot('en')

type EvictionToolName = 'context_forget' | 'context_recall' | 'context_report'

function render(toolName: EvictionToolName, params: unknown, output: unknown, streaming = false, detailed = false) {
  toolDisplay.mode = detailed ? 'detailed' : 'default'
  const rendered = new ContextEvictionToolRenderer(toolName).render(
    params as Record<string, unknown> | undefined,
    output as Parameters<ContextEvictionToolRenderer['render']>[1],
    streaming,
  )
  return { rendered, markup: renderToStaticMarkup(rendered.content as ReactElement) }
}

const forgetDetails = (overrides: Record<string, unknown> = {}) => ({
  type: 'context_forget_result',
  forgotten: 2,
  tokensFreed: 1200,
  forgottenNow: [
    { id: '11111111-aaaa-bbbb-cccc-dddddddddddd', kind: 'toolResult', toolName: 'read_file', tokens: 700 },
    { id: '22222222-aaaa-bbbb-cccc-dddddddddddd', kind: 'assistantText', toolName: '', tokens: 500 },
  ],
  alreadyForgotten: 0,
  alreadyForgottenNow: [],
  skipped: [],
  ...overrides,
})

describe('ContextEvictionToolRenderer · context_forget', () => {
  it('summary counts new items and the dropdown body lists per-item details by default', () => {
    const { markup } = render('context_forget', { reason: 'stale reads' }, { details: forgetDetails(), content: [] })
    expect(markup).toContain(t('contextForgetToolSummary', { count: 2, tokens: 1200 }))
    expect(markup).toContain('stale reads')
    expect(markup).toContain(t('contextForgetDetailsTitle'))
    expect(markup).toContain('read_file')
    expect(markup).toContain(t('contextEvictionItemReply'))
    expect(markup).toContain('~700 tokens')
    expect(markup).toContain('#11111111')
  })

  it('distinguishes repeated-forget outcomes from a no-match call', () => {
    const all = render('context_forget', {}, { details: forgetDetails({ forgotten: 0, tokensFreed: 0, forgottenNow: [], alreadyForgotten: 2, alreadyForgottenNow: [] }), content: [] }).markup
    expect(all).toContain(t('contextForgetToolAllForgotten', { count: 2 }))

    const none = render('context_forget', {}, { details: forgetDetails({ forgotten: 0, tokensFreed: 0, forgottenNow: [] }), content: [] }).markup
    expect(none).toContain(t('contextForgetToolNone'))

    const mixed = render('context_forget', {}, { details: forgetDetails({ alreadyForgotten: 3, alreadyForgottenNow: [] }), content: [] }).markup
    expect(mixed).toContain(t('contextForgetToolSummary', { count: 2, tokens: 1200 }))
    expect(mixed).toContain(t('contextForgetToolAlreadySuffix', { count: 3 }))
  })

  it('running state keeps the progressive label without a details block', () => {
    const { markup } = render('context_forget', {}, undefined, true)
    expect(markup).toContain(t('contextForgetToolRunning'))
    expect(markup).not.toContain(t('contextForgetDetailsTitle'))
  })

  it('malformed details fall back to the no-match summary without throwing', () => {
    const { markup } = render('context_forget', {}, { details: { type: 'context_forget_result', forgotten: 'x', forgottenNow: 'nope' }, content: [] })
    expect(markup).toContain(t('contextForgetToolNone'))
  })
})

describe('ContextEvictionToolRenderer · context_recall / context_report', () => {
  it('recall dropdown lists recalled items with tool names', () => {
    const { markup } = render('context_recall', {}, {
      details: {
        type: 'context_recall_result',
        recalled: 1,
        recalledNow: ['11111111-aaaa-bbbb-cccc-dddddddddddd'],
        recalledItems: [{ id: '11111111-aaaa-bbbb-cccc-dddddddddddd', kind: 'toolResult', toolName: 'run_command' }],
        notFound: [],
      },
      content: [],
    })
    expect(markup).toContain(t('contextRecallToolSummary', { count: 1 }))
    expect(markup).toContain(t('contextRecallDetailsTitle'))
    expect(markup).toContain('run_command')
  })

  it('report dropdown shows the full report text by default', () => {
    const { markup } = render('context_report', {}, {
      details: { type: 'context_report_result', percent: 60, forgottenCount: 1 },
      content: [{ type: 'text', text: 'Context usage: 60% of 100000 tokens (60000 tokens).' }],
    })
    expect(markup).toContain(t('contextReportToolSummary', { percent: 60, count: 1 }))
    expect(markup).toContain('Context usage: 60% of 100000 tokens')
  })

  it('detailed mode additionally renders input/details JSON sections', () => {
    const { markup } = render('context_forget', { rule: { kind: 'toolResult' } }, { details: forgetDetails(), content: [] }, false, true)
    expect(markup).toContain(t('input'))
    expect(markup).toContain(t('details'))
    expect(markup).toContain('context_forget_result')
  })
})
