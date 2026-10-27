import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

// Deterministic t stub: keys are echoed verbatim.
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import {
  FORK_TITLE_PREFIX,
  generateForkTitle,
  generateTitle,
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
