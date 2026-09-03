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
  it('decorates the pi-web-ui error block with the translated message', () => {
    const source = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
    expect(source).toContain('function decorateAssistantErrorText')
    expect(source).toContain("querySelector<HTMLElement>('div.bg-destructive\\\\/10')")
    expect(source).toContain('const translated = translateErrorMessage(errorMessage)')
    expect(source).toContain('block.replaceChildren(strong, document.createTextNode(')
    // 重复 decorate 幂等：dataset 记录当前译文；未匹配规则（译文===原文）不改写 Lit 节点
    expect(source).toContain('block.dataset.quickforgeErrorText === translated')
    expect(source).toContain('translated === errorMessage')
    expect(source).toMatch(/decorateAssistantErrorText\(element, entry\.message\)/)
  })

  it('translates the subagent error reason card at render time', () => {
    const source = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
    expect(source).toContain("import { translateErrorMessage } from '@/lib/error-messages'")
    expect(source).toContain("translateErrorMessage(payload.errorMessage) || t('subagentErrorUnavailable')")
  })
})
