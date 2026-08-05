import { describe, expect, it } from 'vitest'
import { buildConversationTurns, shouldShowTurnNavigation, TURN_NAVIGATION_MIN_TURNS } from '../../src/components/chat/turn-navigation-data'

function user(content: unknown, role = 'user') {
  return { role, content, timestamp: 0 }
}

function assistant(text: string) {
  return { role: 'assistant', content: [{ type: 'text', text }], timestamp: 0 }
}

describe('conversation turn navigation', () => {
  it('only shows the rail from the fifth turn', () => {
    expect(TURN_NAVIGATION_MIN_TURNS).toBe(5)
    expect(shouldShowTurnNavigation(4)).toBe(false)
    expect(shouldShowTurnNavigation(5)).toBe(true)
  })

  it('pairs each user message with the final assistant message before the next turn', () => {
    const turns = buildConversationTurns([
      user('first question'),
      assistant('tool preface'),
      { role: 'toolResult', toolCallId: 'call-1', content: 'result', timestamp: 0 },
      assistant('first final answer'),
      user('second question'),
      assistant('second final answer'),
    ] as never[], false)

    expect(turns).toEqual([
      { messageIndex: 0, userText: 'first question', finalAnswerText: 'first final answer', isGenerating: false },
      { messageIndex: 4, userText: 'second question', finalAnswerText: 'second final answer', isGenerating: false },
    ])
  })

  it('supports attachment user messages and keeps an empty preview for attachment-only turns', () => {
    const turns = buildConversationTurns([
      user([{ type: 'image', data: 'example' }], 'user-with-attachments'),
      assistant('answer'),
    ] as never[], false)

    expect(turns[0]).toMatchObject({ userText: '', finalAnswerText: 'answer' })
  })

  it('marks only the latest turn as generating while streaming', () => {
    const turns = buildConversationTurns([
      user('done'),
      assistant('done answer'),
      user('active'),
      assistant('intermediate tool text'),
    ] as never[], true)

    expect(turns[0].isGenerating).toBe(false)
    expect(turns[1]).toMatchObject({ finalAnswerText: 'intermediate tool text', isGenerating: true })
  })

  it('keeps turns without an assistant answer', () => {
    expect(buildConversationTurns([user('unanswered')] as never[], false)).toEqual([
      { messageIndex: 0, userText: 'unanswered', finalAnswerText: '', isGenerating: false },
    ])
  })
})
