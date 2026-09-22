import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerToolRenderer, type ToolRenderer } from '../../src/lib/tool-renderer-registry'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { applyToolDisplaySettingsValue } from '../../src/lib/tool-display-settings'
import { ToolMessage } from '../../src/components/chat/surface/ToolMessage'
import type { ToolCall, ToolResultMessage } from '../../src/components/chat/surface/ChatTypes'

// Surface copy comes from i18n (language falls back to navigator.language).
// 工具展示设置每例回到默认（细节默认收起）。
beforeEach(() => {
  applyAppLanguageFromSnapshot('en')
  applyToolDisplaySettingsValue(undefined)
})

const toolCall = (name: string): ToolCall => ({ type: 'toolCall', id: `call-${name}`, name, arguments: { path: 'a.ts' } })
const toolResult = (text: string): ToolResultMessage => ({
  role: 'toolResult', toolCallId: 'call-x', toolName: 'read_file',
  content: [{ type: 'text', text }], isError: false, timestamp: 1,
})

describe('chat surface ToolMessage registry consumption', () => {
  it('renders ReactNode content from a custom renderer without the card wrapper', () => {
    const renderer: ToolRenderer = {
      render: () => ({ content: createElement('div', { className: 'custom-tool' }, 'custom tool body'), isCustom: true }),
    }
    registerToolRenderer('react_custom', renderer)
    const markup = renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('react_custom') }))
    expect(markup).toContain('custom tool body')
    expect(markup).toContain('qf-tool-message')
    expect(markup).not.toContain('bg-card')
  })

  it('wraps ReactNode card content in the default card classes', () => {
    registerToolRenderer('react_card', {
      render: () => ({ content: createElement('span', null, 'card tool body'), isCustom: false }),
    })
    const markup = renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('react_card') }))
    expect(markup).toContain('card tool body')
    expect(markup).toContain('bg-card')
    expect(markup).toContain('border-border')
  })

  it('allows an intentionally empty custom renderer', () => {
    registerToolRenderer('react_empty', { render: () => ({ content: null, isCustom: true }) })
    expect(renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('react_empty') })))
      .toBe('<div class="qf-tool-message"></div>')
  })

  it('renders the default card with params/output folded into ToolDetails (collapsed by default)', () => {
    const markup = renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('unknown_tool'), result: toolResult('tool ran fine') }))
    expect(markup).toContain('Tool Call')
    // header 保留一行工具名摘要；params/output 细节收进 <details>，默认收起
    // （React 对 open={false} 省略 open 属性）。
    expect(markup).toContain('<details')
    expect(markup).not.toContain('open=')
    expect(markup).toMatch(/<details[^>]*>[\s\S]*tool ran fine[\s\S]*<\/details>/)
    expect(markup).toContain('a.ts')
  })

  it('keeps the default card details collapsed regardless of tool display settings', () => {
    // 细节固定默认收起，不随任何设置变化（detailed 模式 / expandProcessStageByDefault 均不影响）。
    applyToolDisplaySettingsValue({ toolDisplayMode: 'detailed', expandProcessStageByDefault: true })
    try {
      const markup = renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('unknown_tool'), result: toolResult('tool ran fine') }))
      expect(markup).not.toContain('open=')
    } finally {
      applyToolDisplaySettingsValue(undefined)
    }
  })

  it('treats an aborted call without a result as an error result', () => {
    const markup = renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('unknown_tool'), aborted: true }))
    expect(markup).toContain('text-destructive')
    expect(markup).toContain('(no output)')
  })

  it('renders the default tool card copy in the active language', () => {
    applyAppLanguageFromSnapshot('zh')
    const markup = renderToStaticMarkup(
      createElement(ToolMessage, { toolCall: toolCall('unknown_tool'), result: toolResult('') }),
    )
    expect(markup).toContain('工具调用')
    expect(markup).toContain('输入')
    expect(markup).toContain('（无输出）')
  })
})

describe('chat surface ToolMessage memoization', () => {
  it('is wrapped in React.memo so stable props skip re-renders while one message streams', () => {
    // A behavioural bail-out assertion needs a reconciler (no DOM in these
    // suites), so this asserts the memo wrapper itself — the same coverage
    // level as AssistantMessage/UserMessage, whose prop-identity stability is
    // what actually makes the memo effective (R1 F1a snapshot identity reuse).
    expect((ToolMessage as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
  })
})
