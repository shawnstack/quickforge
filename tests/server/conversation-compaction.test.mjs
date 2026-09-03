import { describe, expect, it, vi } from 'vitest'

vi.mock('../../server/ai-http-logger.mjs', () => ({
  streamSimpleWithAiHttpLogging: vi.fn(() => ({
    result: vi.fn(async () => textMessage('assistant', 'generated summary')),
  })),
}))
import {
  compactionMessageDetails,
  extractCompactSummaryText,
  isCompactSummaryMessage,
  isCompactionNoticeMessage,
  splitMessagesForCompaction,
} from '../../server/conversation-compaction.mjs'

function textMessage(role, text, details) {
  return {
    role,
    content: [{ type: 'text', text }],
    ...(details ? { details } : {}),
  }
}

const legacySummaryText = [
  'The previous conversation has been compacted. Treat the following summary as the authoritative replacement for earlier history.',
  '',
  '<compact_summary>',
  'Earlier goal and decisions.',
  '</compact_summary>',
].join('\n')

const legacyNoticeText = [
  '已基于当前对话创建压缩后的新对话：原 10 条消息 → 4 条消息。',
  '当前原对话已完整保留，保留最近 2 个用户回合原文，估算新对话上下文减少约 60%。',
  '压缩前历史已保存到本地备份。',
].join('\n')

describe('conversation compaction message handling', () => {
  it('allows a short single user turn when the manual character gate is disabled', async () => {
    const result = await (await import('../../server/conversation-compaction.mjs')).compactConversation({
      messages: [textMessage('user', 'u1'), textMessage('assistant', 'a1')],
      model: { provider: 'mock', id: 'mock-model' },
      minSourceChars: 0,
    })

    expect(result.skipped).toBe(false)
    expect(result.compactedCount).toBe(2)
    expect(result.recentTail).toEqual([])
  })

  it('does not count a compact summary as a real user turn and removes its notice from the next summary source', () => {
    const summary = textMessage('user', legacySummaryText, compactionMessageDetails('summary'))
    const notice = textMessage('assistant', legacyNoticeText, compactionMessageDetails('notice'))
    const user1 = textMessage('user', 'first real turn')
    const assistant1 = textMessage('assistant', 'first answer')
    const user2 = textMessage('user', 'second real turn')
    const assistant2 = textMessage('assistant', 'second answer')
    const user3 = textMessage('user', 'third real turn')
    const assistant3 = textMessage('assistant', 'third answer')

    const result = splitMessagesForCompaction([
      summary,
      notice,
      user1,
      assistant1,
      user2,
      assistant2,
      user3,
      assistant3,
    ], { keepTurns: 2 })

    expect(result.tailStart).toBe(4)
    expect(result.recentTail).toEqual([user2, assistant2, user3, assistant3])
    expect(result.compactRange).toEqual([summary, user1, assistant1])
  })

  it('recognizes and filters legacy compaction messages without details markers', () => {
    const summary = textMessage('user', legacySummaryText)
    const notice = textMessage('assistant', legacyNoticeText)
    const user1 = textMessage('user', 'first real turn')
    const assistant1 = textMessage('assistant', 'first answer')
    const user2 = textMessage('user', 'second real turn')
    const assistant2 = textMessage('assistant', 'second answer')

    expect(isCompactSummaryMessage(summary)).toBe(true)
    expect(isCompactionNoticeMessage(notice)).toBe(true)

    const result = splitMessagesForCompaction([
      summary,
      notice,
      user1,
      assistant1,
      user2,
      assistant2,
    ], { keepTurns: 1 })

    expect(result.tailStart).toBe(4)
    expect(result.compactRange).toEqual([summary, user1, assistant1])
  })

  it('does not treat an ordinary user message mentioning compact_summary as a generated summary', () => {
    const user1 = textMessage('user', 'first real turn')
    const assistant1 = textMessage('assistant', 'first answer')
    const user2 = textMessage('user', 'Please explain <compact_summary> and </compact_summary>.')
    const assistant2 = textMessage('assistant', 'second answer')
    const user3 = textMessage('user', 'third real turn')

    expect(isCompactSummaryMessage(user2)).toBe(false)
    expect(splitMessagesForCompaction([
      user1,
      assistant1,
      user2,
      assistant2,
      user3,
    ], { keepTurns: 2 }).tailStart).toBe(2)
  })

  it('extracts through the last closing tag so embedded tag text does not truncate the summary', () => {
    const message = textMessage('user', [
      'The previous conversation has been compacted.',
      '<compact_summary>',
      'Keep this literal example: </compact_summary>',
      'And keep this trailing detail.',
      '</compact_summary>',
    ].join('\n'))

    expect(extractCompactSummaryText(message)).toBe([
      'Keep this literal example: </compact_summary>',
      'And keep this trailing detail.',
    ].join('\n'))
  })

  it('falls back to the complete text when summary tags are incomplete', () => {
    const text = 'The previous conversation has been compacted.\n<compact_summary>\nIncomplete summary'
    expect(extractCompactSummaryText(textMessage('user', text))).toBe(text)
  })
})
