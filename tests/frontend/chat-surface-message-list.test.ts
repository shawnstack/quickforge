import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import type {
  AgentMessage,
  AssistantMessage as AssistantMessageType,
  ToolResultMessage,
  Usage,
} from '../../src/components/chat/surface/ChatTypes'
import { collectToolResultsById, MessageList } from '../../src/components/chat/surface/MessageList'
import { assistantContentParts, messageRenderIdentity, messageRenderKeys } from '../../src/components/chat/surface/content-parts'

// Surface copy comes from i18n (language falls back to navigator.language).
beforeEach(() => applyAppLanguageFromSnapshot('en'))

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 10,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 30,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
    ...overrides,
  }
}

function assistantMessage(overrides: Partial<AssistantMessageType> = {}): AssistantMessageType {
  return {
    role: 'assistant',
    content: [],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 1,
    ...overrides,
  }
}

function toolResult(toolCallId: string, text: string, isError = false): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'read_file',
    content: [{ type: 'text', text }],
    isError,
    timestamp: 2,
  }
}

describe('chat surface MessageList build rules', () => {
  it('skips artifact messages entirely', () => {
    const messages: AgentMessage[] = [
      { role: 'artifact', action: 'create', filename: 'artifact-target.html', timestamp: '1' },
      { role: 'user', content: 'hello', timestamp: 1 },
    ]

    const markup = renderToStaticMarkup(createElement(MessageList, { messages }))

    expect(markup).toContain('hello')
    expect(markup).not.toContain('artifact-target.html')
  })

  it('does not render standalone toolResult bodies and inlines results into the paired assistant tool call', () => {
    const messages: AgentMessage[] = [
      assistantMessage({
        content: [{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }],
      }),
      toolResult('call-1', 'file output body'),
    ]

    const markup = renderToStaticMarkup(createElement(MessageList, { messages }))

    // Inlined once via the tool card output — not duplicated as a standalone body.
    expect(markup).toContain('file output body')
    expect(markup.split('file output body')).toHaveLength(2)
  })

  it('renders user and user-with-attachments messages', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'plain question', timestamp: 1 },
      {
        role: 'user-with-attachments',
        content: 'with attachment',
        timestamp: 2,
        attachments: [
          {
            id: 'att-1',
            type: 'image',
            fileName: 'shot.png',
            mimeType: 'image/png',
            size: 8,
            content: 'aGk=',
            preview: 'aGk=',
          },
        ],
      },
    ]

    const markup = renderToStaticMarkup(createElement(MessageList, { messages }))

    expect(markup).toContain('plain question')
    expect(markup).toContain('with attachment')
    expect(markup).toContain('shot.png')
    expect(markup).toContain('data:image/png;base64,aGk=')
  })

  it('renders assistant content chunks in source order (text → thinking → toolCall)', () => {
    const messages: AgentMessage[] = [
      assistantMessage({
        content: [
          { type: 'text', text: 'first text chunk' },
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'toolCall', id: 'call-2', name: 'read_file', arguments: {} },
          { type: 'text', text: 'trailing text chunk' },
        ],
      }),
    ]

    const markup = renderToStaticMarkup(createElement(MessageList, { messages }))

    const textIndex = markup.indexOf('first text chunk')
    const thinkingIndex = markup.indexOf('Thinking...')
    const toolIndex = markup.indexOf('Tool Call')
    const trailingIndex = markup.indexOf('trailing text chunk')

    expect(textIndex).toBeGreaterThanOrEqual(0)
    expect(thinkingIndex).toBeGreaterThan(textIndex)
    expect(toolIndex).toBeGreaterThan(thinkingIndex)
    expect(trailingIndex).toBeGreaterThan(toolIndex)
  })

  it('keeps pending tool calls rendered in the list (no streaming-container migration)', () => {
    const assistant = assistantMessage({
      content: [
        { type: 'toolCall', id: 'pending-call', name: 'read_file', arguments: {} },
        { type: 'toolCall', id: 'done-call', name: 'read_file', arguments: {} },
      ],
    })
    const messages: AgentMessage[] = [assistant, toolResult('done-call', 'done output')]

    // MessageList owns pending tool rows before, during and after `message_end`:
    // it no longer hides them behind a streaming flag (the separate streaming
    // container hides its own copy instead), so a long-running call's DOM node
    // — and its `animate-spin` spinner — never migrates between subtrees.
    const markup = renderToStaticMarkup(
      createElement(MessageList, { messages, pendingToolCalls: new Set(['pending-call']) }),
    )
    expect(markup.split('qf-tool-message')).toHaveLength(3)
    expect(markup).toContain('done output')
  })

  it('renders the usage footer, error and aborted hints', () => {
    const okMarkup = renderToStaticMarkup(
      createElement(MessageList, { messages: [assistantMessage()] }),
    )
    expect(okMarkup).toContain('↑10 ↓20 $0.0100')

    const errorMarkup = renderToStaticMarkup(
      createElement(
        MessageList,
        { messages: [assistantMessage({ stopReason: 'error', errorMessage: 'provider exploded' })] },
      ),
    )
    expect(errorMarkup).toContain('Error:')
    expect(errorMarkup).toContain('provider exploded')

    const abortedMarkup = renderToStaticMarkup(
      createElement(MessageList, { messages: [assistantMessage({ stopReason: 'aborted' })] }),
    )
    expect(abortedMarkup).toContain('Request aborted')
  })

  it('localizes the thinking label, error prefix and aborted hint', () => {
    applyAppLanguageFromSnapshot('zh')
    const markup = renderToStaticMarkup(createElement(MessageList, {
      messages: [
        assistantMessage({ content: [{ type: 'thinking', thinking: 'internal reasoning' }] }),
        assistantMessage({ stopReason: 'error', errorMessage: 'provider exploded' }),
        assistantMessage({ stopReason: 'aborted' }),
      ],
    }))

    expect(markup).toContain('正在思考...')
    expect(markup).toContain('错误：')
    expect(markup).toContain('请求已中止')
  })

  it('collectToolResultsById maps toolCallId to the toolResult message', () => {
    const resultA = toolResult('call-a', 'a')
    const resultB = toolResult('call-b', 'b')
    const map = collectToolResultsById([
      assistantMessage({ content: [] }),
      resultA,
      resultB,
    ] as AgentMessage[])

    expect(map.get('call-a')).toBe(resultA)
    expect(map.get('call-b')).toBe(resultB)
    expect(map.size).toBe(2)
  })
})

/**
 * Row/part React keys are the flicker contract: index-based keys re-key every
 * row to a different message when a sliding window drops its leading entry, and
 * `text-<ordinal>` part keys shift whenever an earlier (filtered) chunk appears,
 * unmounting every later Markdown/Thinking/Code block.
 */
describe('chat surface render keys', () => {
  it('keeps the key of a message that survives a sliding window', () => {
    const first = assistantMessage({ content: [{ type: 'text', text: 'one' }], timestamp: 1 })
    const second = assistantMessage({ content: [{ type: 'text', text: 'two' }], timestamp: 2 })
    const third = assistantMessage({ content: [{ type: 'text', text: 'three' }], timestamp: 3 })

    const before = messageRenderKeys([first, second])
    const after = messageRenderKeys([second, third])

    expect(after[0]).toBe(before[1])
    expect(after[1]).not.toBe(before[0])
    // Identity is role + timestamp, not the array position.
    expect(before[0]).toContain('assistant:1')
  })

  it('disambiguates repeated identities without breaking the first occurrence', () => {
    const duplicateA = { role: 'user', content: 'hi', timestamp: 7 } as AgentMessage
    const duplicateB = { role: 'user', content: 'hi again', timestamp: 7 } as AgentMessage

    const keys = messageRenderKeys([duplicateA, duplicateB, duplicateA])

    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe(keys[2].replace(/#\d+$/, ''))
  })

  it('uses the tool-call id for tool results', () => {
    expect(messageRenderKeys([toolResult('call-a', 'a') as AgentMessage])).toEqual(['toolResult:call-a'])
  })

  it('keys timestamp-less messages by content fingerprint, not array position', () => {
    const partial = { role: 'assistant', content: [{ type: 'text', text: 'Fix the spinner flicker' }] } as unknown as AgentMessage
    const question = { role: 'user', content: 'run the long task' } as unknown as AgentMessage

    // Front insertion (session merge / messages_replaced) and the server-side
    // `slice(-N)` trace window shift every array position; surviving rows must
    // keep their keys or React remounts them (restarting CSS animations).
    const before = messageRenderKeys([partial, question])
    const after = messageRenderKeys([{ role: 'user', content: 'merged history' } as AgentMessage, partial, question])

    expect(after[1]).toBe(before[0])
    expect(after[2]).toBe(before[1])
    expect(before[0]).toMatch(/^assistant:fp:/)
  })

  it('keeps a streaming partial\'s identity while its trailing content grows', () => {
    // Prefix longer than the fingerprint bound: later growth (longer text,
    // appended tool calls) must not re-key the row on every trace tick.
    const seed = 'A'.repeat(80)
    const early = { role: 'assistant', content: [{ type: 'text', text: seed }] } as unknown as AgentMessage
    const grown = {
      role: 'assistant',
      content: [
        { type: 'text', text: `${seed} plus a much longer tail` },
        { type: 'toolCall', id: 'run-subagent-1', name: 'run_subagent', arguments: {} },
      ],
    } as unknown as AgentMessage

    expect(messageRenderIdentity(grown)).toBe(messageRenderIdentity(early))
  })

  it('distinguishes timestamp-less messages with different content', () => {
    const first = { role: 'user', content: 'first prompt' } as unknown as AgentMessage
    const second = { role: 'user', content: 'second prompt' } as unknown as AgentMessage

    expect(messageRenderIdentity(second)).not.toBe(messageRenderIdentity(first))
  })

  it('keeps duplicate timestamp-less rows unique within one render pass', () => {
    const echo = { role: 'user', content: 'again' } as unknown as AgentMessage

    const keys = messageRenderKeys([echo, echo])

    expect(new Set(keys).size).toBe(2)
    expect(keys[0]).toBe(keys[1].replace(/#\d+$/, ''))
  })

  it('keys assistant parts by their source content index', () => {
    const withEmptyThinking = assistantMessage({
      content: [
        { type: 'text', text: 'first' },
        { type: 'thinking', thinking: '   ' },
        { type: 'text', text: 'second' },
      ],
    })
    const withFilledThinking = assistantMessage({
      content: [
        { type: 'text', text: 'first' },
        { type: 'thinking', thinking: 'now rendered' },
        { type: 'text', text: 'second' },
      ],
    })

    // The trailing text keeps its key: the filtered chunk no longer shifts it.
    expect(assistantContentParts(withEmptyThinking).map((part) => part.key)).toEqual(['text:0', 'text:2'])
    expect(assistantContentParts(withFilledThinking).map((part) => part.key)).toEqual(['text:0', 'thinking:1', 'text:2'])
  })

  it('keys tool calls by their call id and keeps pending handling in the projection', () => {
    const message = assistantMessage({
      content: [
        { type: 'toolCall', id: 'pending-call', name: 'read_file', arguments: {} },
        { type: 'toolCall', id: 'done-call', name: 'read_file', arguments: {} },
      ],
    })
    const options = {
      pendingToolCalls: new Set(['pending-call']),
      toolResultsById: new Map([['done-call', toolResult('done-call', 'done')]]),
    }

    expect(assistantContentParts(message, options).map((part) => part.key)).toEqual(['tool:pending-call', 'tool:done-call'])
    expect(assistantContentParts(message, { ...options, hidePendingToolCalls: true }).map((part) => part.key))
      .toEqual(['tool:done-call'])
  })

  it('falls back to the source index for tool calls that carry no id', () => {
    // A raw (untyped) trace payload can omit the tool-call id; keying those by
    // `tool:undefined` would make every such part collide in one render pass.
    const raw = {
      role: 'assistant',
      content: [
        { type: 'toolCall', name: 'read_file', arguments: {} },
        { type: 'toolCall', id: '', name: 'read_file', arguments: {} },
        { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} },
      ],
    } as unknown as AssistantMessageType

    expect(assistantContentParts(raw).map((part) => part.key)).toEqual(['tool#0', 'tool#1', 'tool:call-1'])
  })

  it('keeps a numeric tool-call id from colliding with the no-id fallback', () => {
    // A tool call whose id is literally `1` keys as `tool:1`; the no-id fallback
    // at source index 1 must therefore use a different `tool#` separator.
    const raw = {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: '1', name: 'read_file', arguments: {} },
        { type: 'toolCall', name: 'read_file', arguments: {} },
      ],
    } as unknown as AssistantMessageType

    const keys = assistantContentParts(raw).map((part) => part.key)
    expect(keys).toEqual(['tool:1', 'tool#1'])
    expect(new Set(keys).size).toBe(keys.length)
  })
})
