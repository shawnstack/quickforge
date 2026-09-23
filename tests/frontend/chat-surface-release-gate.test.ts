import { describe, expect, it } from 'vitest'

import {
  shouldReleaseProcessGroups,
  type ProcessGroupReleaseGate,
} from '../../src/components/chat/surface/ChatSurface'
import { isRenderableMessage, messageRenderKeys } from '../../src/components/chat/surface/content-parts'
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

  it('keeps groups folded for a pure streaming frame (fresh partial object, same row sequence)', () => {
    const messages = liveTurnMessages()
    const streaming = assistantMessage({ timestamp: 99 })

    // The rendered sequence carries the streaming partial as its last row; a
    // streaming tick shallow-copies the partial, so only the row *content*
    // changes — the identity sequence, and the gate, stay unchanged.
    expect(shouldReleaseProcessGroups(
      gate([...messages, streaming]),
      gate([...messages, { ...streaming }]),
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

  it('does not release when a fresh toolResult lands without a new renderable row', () => {
    // `toolResult` bodies inline into the paired assistant's tool card — they
    // never render a standalone row — so their arrival must not dissolve the
    // folded groups. The old full-key-sequence gate released here, and the
    // rebuild re-parented every grouped node mid-turn: with a thinking block
    // left expanded that replayed the "re-expanding" feel on every tool cycle.
    const prev = liveTurnMessages()
    const next: AgentMessage[] = [...prev, toolResult('call-2', 'fresh result body')]

    // toolResult rows are lookup-only (inlined into the paired assistant's
    // tool card) — the gate sequence mirrors the renderable rows only.
    expect(next.some((message) => !isRenderableMessage(message))).toBe(true)
    expect(shouldReleaseProcessGroups(gate(prev), gate(next))).toBe(false)
    // A renderable row appended after the toolResult is a pure tail append —
    // no release (React only appends the row at the list tail).
    const withNewRow: AgentMessage[] = [...next, assistantMessage({ timestamp: 42 })]
    expect(shouldReleaseProcessGroups(gate(next), gate(withNewRow))).toBe(false)
  })

  it('releases when a row identity changes', () => {
    const prev = liveTurnMessages()
    const next: AgentMessage[] = [prev[0], assistantMessage({ timestamp: 12 }), prev[2]]

    expect(shouldReleaseProcessGroups(gate(prev), gate(next))).toBe(true)
  })

  it('releases on removal or reorder; a tail append alone does not release', () => {
    const messages = liveTurnMessages()

    // Tail append is safe (React appends the row; see the dedicated test).
    const appended = [...messages, { role: 'user', content: 'follow up', timestamp: 2 }]
    expect(shouldReleaseProcessGroups(gate(messages), gate(appended))).toBe(false)
    // Removal hands nodes back before React removes them.
    expect(shouldReleaseProcessGroups(gate(appended), gate(messages))).toBe(true)

    const reordered = [messages[1], messages[0], messages[2]]
    expect(shouldReleaseProcessGroups(gate(messages), gate(reordered))).toBe(true)
  })

  it('does not release for a pure tail append: the next streaming assistant round', () => {
    // The frame where the next round's streaming row appears: React only
    // appends a row at the list tail (existing rows bail at their memos), so
    // the folded groups keep their nodes untouched. Releasing here rebuilt
    // the group from scratch every tool-loop round — with a stage left
    // expanded that replayed the layout shift ("re-expanding" feel).
    const committed = liveTurnMessages()
    const nextStreaming = assistantMessage({ timestamp: 42 })

    expect(shouldReleaseProcessGroups(
      gate(committed),
      gate([...committed, nextStreaming]),
    )).toBe(false)
    // Identity change in an existing row still releases (remount risk).
    expect(shouldReleaseProcessGroups(
      gate(committed),
      gate([committed[0], assistantMessage({ timestamp: 77 }), committed[2], nextStreaming]),
    )).toBe(true)
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

  it('does not release when message_end commits the streaming row under the same identity', () => {
    const messages = liveTurnMessages()
    const streaming = assistantMessage({ timestamp: 99 })

    // `message_end` moves the partial into `messages` under the identity the
    // streaming row already used, so the rendered row sequence — and the fold
    // — survive the hand-off: no node moves, no restarted animations.
    expect(shouldReleaseProcessGroups(
      gate([...messages, streaming]),
      gate([...messages, { ...streaming, usage: usage() }]),
    )).toBe(false)
  })

  it('still releases when the streaming partial is dropped without committing', () => {
    const messages = liveTurnMessages()
    const streaming = assistantMessage({ timestamp: 99 })

    // Abort/error paths clear the partial without upserting it: the sequence
    // shortens by one row, so the groups must be handed back before React
    // removes the nodes they hold.
    expect(shouldReleaseProcessGroups(
      gate([...messages, streaming]),
      gate(messages),
    )).toBe(true)
  })

  it('stays consistent across repeated and interleaved calls (key cache)', () => {
    const base = liveTurnMessages()
    const sameStructure: AgentMessage[] = [...base]
    const appended = [...base, { role: 'user', content: 'more', timestamp: 5 }]

    // Prime the cache for every array, then re-check in a different pairing.
    expect(shouldReleaseProcessGroups(gate(base), gate(sameStructure))).toBe(false)
    expect(shouldReleaseProcessGroups(gate(sameStructure), gate(appended))).toBe(false)
    expect(shouldReleaseProcessGroups(gate(base), gate(sameStructure))).toBe(false)
    expect(shouldReleaseProcessGroups(gate(appended), gate(sameStructure))).toBe(true)
  })
})
