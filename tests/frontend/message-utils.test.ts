import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

// Deterministic t stub: keys are echoed verbatim.
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import {
  FORK_TITLE_PREFIX,
  generateForkTitle,
  generateTitle,
  rollbackStartIndexFromMessage,
  turnEndedWithError,
} from '../../src/lib/message-utils'

function message(role: string, extra: Record<string, unknown> = {}) {
  return { role, content: '', ...extra } as unknown as AgentMessage
}

describe('turnEndedWithError', () => {
  it('detects an error turn that ran tools', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'toolUse' }),
      message('toolResult', { toolCallId: 'call-1' }),
      message('assistant', { stopReason: 'error', errorMessage: 'upstream failed' }),
    ]

    expect(turnEndedWithError(messages, 0)).toBe(true)
  })

  it('detects a plain text error turn without tools', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'error', errorMessage: 'upstream failed' }),
    ]

    expect(turnEndedWithError(messages, 0)).toBe(true)
  })

  it('returns false for a successful turn with tool results', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'toolUse' }),
      message('toolResult', { toolCallId: 'call-1' }),
      message('assistant', { stopReason: 'endTurn' }),
    ]

    expect(turnEndedWithError(messages, 0)).toBe(false)
  })

  it('ignores errors from earlier turns', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'error', errorMessage: 'upstream failed' }),
      message('user'),
      message('assistant', { stopReason: 'endTurn' }),
    ]

    expect(turnEndedWithError(messages, 2)).toBe(false)
  })

  it('stops scanning at the next user message', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'endTurn' }),
      message('user'),
      message('assistant', { stopReason: 'error', errorMessage: 'upstream failed' }),
    ]

    expect(turnEndedWithError(messages, 0)).toBe(false)
  })

  it('returns false for aborted assistant messages', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'aborted' }),
      message('user'),
      message('assistant', { stopReason: 'aborted', errorMessage: 'Request aborted' }),
    ]

    expect(turnEndedWithError(messages, 0)).toBe(false)
    expect(turnEndedWithError(messages, 2)).toBe(false)
  })
})

describe('rollbackStartIndexFromMessage', () => {
  it('anchors on the clicked user message', () => {
    const messages = [
      message('user'),
      message('assistant'),
      message('user'),
      message('assistant'),
    ]

    expect(rollbackStartIndexFromMessage(messages, 0)).toBe(0)
    expect(rollbackStartIndexFromMessage(messages, 2)).toBe(2)
  })

  it('falls back to the turn-leading user message for an assistant message', () => {
    const messages = [
      message('user'),
      message('assistant'),
      message('user'),
      message('assistant'),
    ]

    expect(rollbackStartIndexFromMessage(messages, 1)).toBe(0)
    expect(rollbackStartIndexFromMessage(messages, 3)).toBe(2)
  })

  it('anchors on an orphan assistant turn instead of refusing to roll back', () => {
    const messages = [
      message('assistant', { stopReason: 'error', errorMessage: 'failed before user persisted' }),
      message('user'),
      message('assistant'),
    ]

    expect(rollbackStartIndexFromMessage(messages, 0)).toBe(0)
  })

  it('rolls a toolResult index back to its turn-leading user message', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'toolUse' }),
      message('toolResult', { toolCallId: 'call-1' }),
      message('assistant', { stopReason: 'endTurn' }),
    ]

    expect(rollbackStartIndexFromMessage(messages, 2)).toBe(0)
  })

  it('clamps a drifted index into range instead of refusing', () => {
    const messages = [
      message('user'),
      message('assistant'),
      message('user'),
      message('assistant', { stopReason: 'endTurn' }),
    ]

    // UI 窗口数组与权威数组瞬时错位：越界索引收敛到末尾轮的 user。
    expect(rollbackStartIndexFromMessage(messages, 99)).toBe(2)
    expect(rollbackStartIndexFromMessage(messages, -7)).toBe(0)
    expect(rollbackStartIndexFromMessage(messages, 1.9)).toBe(0)
  })

  it('returns -1 (no-op) only for empty conversations or non-finite input', () => {
    expect(rollbackStartIndexFromMessage([], 0)).toBe(-1)
    expect(rollbackStartIndexFromMessage([message('user')], Number.NaN)).toBe(-1)
    expect(rollbackStartIndexFromMessage([message('user')], 'x' as unknown as number)).toBe(-1)
  })
})

describe('fork title', () => {
  it('prefixes the fork marker without eating the message budget', () => {
    const longText = 'a'.repeat(80)
    const title = generateForkTitle([message('user', { content: longText })])

    expect(title.startsWith(FORK_TITLE_PREFIX)).toBe(true)
    // The 46-char budget applies to the message text only.
    expect(title.slice(FORK_TITLE_PREFIX.length)).toBe(`${'a'.repeat(43)}...`)
  })

  it('keeps short prompts intact behind the marker', () => {
    expect(generateForkTitle([message('user', { content: '  帮我  看看这个  ' })])).toBe('[fork] 帮我 看看这个')
  })

  it('marks an empty fork as a new chat instead of dropping the marker', () => {
    expect(generateForkTitle([message('assistant')])).toBe('[fork] New chat')
  })

  it('leaves non-fork titles unprefixed', () => {
    expect(generateTitle([message('user', { content: '普通对话' })])).toBe('普通对话')
  })
})
