import { describe, expect, it } from 'vitest'

import {
  shouldReleaseProcessGroups,
  type ProcessGroupReleaseGate,
} from '../../src/components/chat/surface/ChatSurface'
import { messageRenderKeys } from '../../src/components/chat/surface/content-parts'
import type {
  AgentMessage,
  AssistantMessage as AssistantMessageType,
  ToolResultMessage,
  Usage,
} from '../../src/components/chat/surface/ChatTypes'

function usage(): Usage {
  return {
    input: 10,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 30,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
  }
}

function assistantMessage(overrides: Partial<AssistantMessageType> = {}): AssistantMessageType {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'assistant reply body' }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 10,
    ...overrides,
  }
}

function toolResult(toolCallId: string, text: string): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'read_file',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: 11,
  }
}

function gate(messages: AgentMessage[], overrides: Partial<ProcessGroupReleaseGate> = {}): ProcessGroupReleaseGate {
  return { messages, ...overrides }
}

/** A live mid-turn list: user, assistant with a pending tool call, its toolResult row. */
function liveTurnMessages(): AgentMessage[] {
  return [
    { role: 'user', content: 'run the tool', timestamp: 1 },
    assistantMessage({ content: [{ type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } }] }),
    toolResult('call-1', 'partial output (tick 1)'),
  ]
}

describe('chat surface process-group release gate (structural row identities)', () => {
  it('errs on releasing when the gate or the messages identity is missing', () => {
    const messages = liveTurnMessages()
    expect(shouldReleaseProcessGroups(gate(messages), undefined)).toBe(true)
    expect(shouldReleaseProcessGroups(undefined, gate(messages))).toBe(true)
    expect(shouldReleaseProcessGroups(undefined, undefined)).toBe(true)
    // Defensive callers / untyped updates may hand a gate without messages.
    expect(shouldReleaseProcessGroups(gate(messages), {})).toBe(true)
    expect(shouldReleaseProcessGroups({}, gate(messages))).toBe(true)
  })

  it('keeps groups folded for a pure streaming frame (same gate identities)', () => {
    const messages = liveTurnMessages()
    const streaming = assistantMessage({ timestamp: 99 })

    expect(shouldReleaseProcessGroups(
      gate(messages, { isStreaming: true, streamingAssistant: streaming }),
      // Fresh gate object, same identities: the streaming partial gets a
      // per-event shallow copy, so only presence is comparable.
      gate(messages, { isStreaming: true, streamingAssistant: { ...streaming } }),
    )).toBe(false)
  })

  it('does not release for a fresh container with the same rows', () => {
    const messages = liveTurnMessages()

    expect(shouldReleaseProcessGroups(gate(messages), gate([...messages]))).toBe(false)
  })

  it('does not release when tool_execution_update re-upserts the same toolResult row', () => {
    const prev = liveTurnMessages()
    // The trace throttle (~150ms) upserts the same toolResult identity with a
    // fresh row object and fresh array; only the tool card output grows.
    const next: AgentMessage[] = [
      { ...prev[0] },
      { ...prev[1] },
      toolResult('call-1', 'partial output (tick 2, more text)'),
    ]

    expect(messageRenderKeys(prev)).toEqual(messageRenderKeys(next))
    expect(shouldReleaseProcessGroups(gate(prev), gate(next))).toBe(false)
  })

  it('releases when a row identity changes', () => {
    const prev = liveTurnMessages()
    const next: AgentMessage[] = [prev[0], assistantMessage({ timestamp: 12 }), prev[2]]

    expect(shouldReleaseProcessGroups(gate(prev), gate(next))).toBe(true)
  })

  it('releases when rows are appended, removed or reordered', () => {
    const messages = liveTurnMessages()

    const appended = [...messages, { role: 'user', content: 'follow up', timestamp: 2 }]
    expect(shouldReleaseProcessGroups(gate(messages), gate(appended))).toBe(true)
    expect(shouldReleaseProcessGroups(gate(appended), gate(messages))).toBe(true)

    const reordered = [messages[1], messages[0], messages[2]]
    expect(shouldReleaseProcessGroups(gate(messages), gate(reordered))).toBe(true)
  })

  it('keeps duplicate-identity occurrence suffixes stable across re-upserts', () => {
    const prev: AgentMessage[] = [
      assistantMessage({ timestamp: 10 }),
      assistantMessage({ timestamp: 10 }),
    ]
    expect(messageRenderKeys(prev)).toEqual(['assistant:10', 'assistant:10#1'])

    const next: AgentMessage[] = [
      assistantMessage({ timestamp: 10, content: [{ type: 'text', text: 'edited body' }] }),
      assistantMessage({ timestamp: 10 }),
    ]
    expect(shouldReleaseProcessGroups(gate(prev), gate(next))).toBe(false)
  })

  it('fingerprint-fallback rows keep the gate closed while the stable prefix is unchanged', () => {
    // Rows without a timestamp key by a bounded content-fingerprint prefix.
    const longText = `${'x'.repeat(64)}`
    const row = () => assistantMessage({ content: [{ type: 'text', text: longText }] })
    const prev: AgentMessage[] = [{ ...row(), timestamp: undefined }]
    const grown: AgentMessage[] = [{ ...row(), timestamp: undefined, content: [{ type: 'text', text: `${longText} appended tail` }] }]

    expect(shouldReleaseProcessGroups(gate(prev), gate(grown))).toBe(false)

    const changedPrefix: AgentMessage[] = [{ ...row(), timestamp: undefined, content: [{ type: 'text', text: `y${longText}` }] }]
    expect(shouldReleaseProcessGroups(gate(prev), gate(changedPrefix))).toBe(true)
  })

  it('still releases on streaming-terminal flips without message changes', () => {
    const messages = liveTurnMessages()
    const streaming = assistantMessage({ timestamp: 99 })

    expect(shouldReleaseProcessGroups(
      gate(messages, { isStreaming: true, streamingAssistant: streaming }),
      gate(messages, { isStreaming: false }),
    )).toBe(true)
    expect(shouldReleaseProcessGroups(
      gate(messages, { isStreaming: true, streamingAssistant: streaming }),
      gate(messages, { isStreaming: true }),
    )).toBe(true)
  })

  it('stays consistent across repeated and interleaved calls (key cache)', () => {
    const base = liveTurnMessages()
    const sameStructure: AgentMessage[] = [...base]
    const appended = [...base, { role: 'user', content: 'more', timestamp: 5 }]

    // Prime the cache for every array, then re-check in a different pairing.
    expect(shouldReleaseProcessGroups(gate(base), gate(sameStructure))).toBe(false)
    expect(shouldReleaseProcessGroups(gate(sameStructure), gate(appended))).toBe(true)
    expect(shouldReleaseProcessGroups(gate(base), gate(sameStructure))).toBe(false)
    expect(shouldReleaseProcessGroups(gate(appended), gate(sameStructure))).toBe(true)
  })
})
