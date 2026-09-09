import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// t 的真实实现依赖 pi-web-ui 浏览器 DOM；这里用确定性桩同时校验 key 与插值参数。
vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    (params ? `${key} ${JSON.stringify(params)}` : key),
}))

import { translateErrorMessage } from '../../src/lib/error-messages'

describe('translateErrorMessage', () => {
  it.each([
    ['Request was aborted', 'errorRequestAborted'],
    ['Request was aborted.', 'errorRequestAborted'],
    ['request was aborted', 'errorRequestAborted'],
    ['AI stream idle timeout after 60000ms', 'errorAiStreamIdleTimeout {"ms":"60000"}'],
    ['AI stream total timeout after 1200000ms.', 'errorAiStreamTotalTimeout {"ms":"1200000"}'],
    ['Anthropic stream ended before message_stop', 'errorAnthropicStreamEnded'],
    ['Stream ended without finish_reason', 'errorStreamNoFinishReason'],
    ['fetch failed', 'errorFetchFailed'],
    ['Failed to send prompt: HTTP 502', 'errorSendPromptHttp {"status":"502"}'],
    ['  AI stream idle timeout after 90000ms  ', 'errorAiStreamIdleTimeout {"ms":"90000"}'],
  ])('translates known exception %j', (input, expected) => {
    expect(translateErrorMessage(input)).toBe(expected)
  })

  it('passes dynamic provider errors through unchanged', () => {
    expect(translateErrorMessage('Anthropic error: credit balance too low')).toBe('Anthropic error: credit balance too low')
    expect(translateErrorMessage('Subagent general timed out after 120 minutes. Progress before timeout: 3 tool calls')).toBe(
      'Subagent general timed out after 120 minutes. Progress before timeout: 3 tool calls',
    )
  })

  it('returns empty string for missing values and empty text', () => {
    expect(translateErrorMessage(undefined)).toBe('')
    expect(translateErrorMessage(null)).toBe('')
    expect(translateErrorMessage('')).toBe('')
    expect(translateErrorMessage('   ')).toBe('   ')
  })
})

describe('known error translation wiring contracts', () => {
  it('rewrites the pi-web-ui error block into the one-line error row with the translated message', () => {
    const source = readFileSync(new URL('../../src/components/chat/panel-decoration/turn-error-row.ts', import.meta.url), 'utf8')
    expect(source).toContain("querySelector<HTMLElement>('.bg-destructive\\\\/10')")
    expect(source).toContain('const translated = translateErrorMessage(raw)')
    // 数据层 errorMessage 原文不动：行内展示译文（命中规则时），详情折叠区收原文。
    expect(source).toMatch(/details\.querySelector\('pre'\)/)
    // 幂等：呈现签名不变则跳过；语言切换（译文变化）签名变化触发重建。
    expect(source).toContain('row.dataset.quickforgeErrorSignature !== signature')
    // 旧红块改写（message-actions 不再保留独立的错误文本翻译装饰器）。
    const actionsSource = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
    expect(actionsSource).not.toContain('function decorateAssistantErrorText')
    expect(actionsSource).toMatch(/decorateTurnErrorRow\(element, \{/)
  })

  it('translates the subagent error reason card at render time', () => {
    const source = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
    expect(source).toContain("import { translateErrorMessage } from '@/lib/error-messages'")
    expect(source).toContain("translateErrorMessage(payload.errorMessage) || t('subagentErrorUnavailable')")
  })
})
