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

describe('conversation compaction prompt', () => {
  const longBody = 'A'.repeat(40_000)

  it('uses an English system prompt and an English transcript instruction', async () => {
    const { COMPACT_SYSTEM_PROMPT } = await import('../../server/conversation-compaction.mjs')
    const logger = await import('../../server/ai-http-logger.mjs')

    // The prompt must be English so it does not fight the model when the chat
    // itself is in another language; only the *output* language follows the
    // conversation.
    expect(COMPACT_SYSTEM_PROMPT).toContain('conversation compactor')
    expect(COMPACT_SYSTEM_PROMPT).not.toMatch(/[\u4e00-\u9fff]/)
    expect(COMPACT_SYSTEM_PROMPT).toContain('# Compact Conversation Summary')
    // Still asks the model to answer in the conversation's language.
    expect(COMPACT_SYSTEM_PROMPT).toContain('same language as the majority of the original conversation')

    await (await import('../../server/conversation-compaction.mjs')).compactConversation({
      messages: [textMessage('user', 'u1'), textMessage('assistant', 'a1')],
      model: { provider: 'mock', id: 'mock-model' },
      minSourceChars: 0,
    })

    const [, llmContext] = logger.streamSimpleWithAiHttpLogging.mock.calls.at(-1)
    expect(llmContext.messages[0].content).toContain('Below is the conversation history')
    expect(llmContext.messages[0].content).toContain('<conversation_to_compact>')
    expect(llmContext.messages[0].content).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('sends long message bodies in full instead of truncating the middle', async () => {
    const logger = await import('../../server/ai-http-logger.mjs')

    await (await import('../../server/conversation-compaction.mjs')).compactConversation({
      messages: [
        textMessage('user', longBody),
        textMessage('assistant', 'ack'),
        textMessage('user', 'follow-up'),
        textMessage('assistant', 'done'),
      ],
      model: { provider: 'mock', id: 'mock-model', contextWindow: 128_000 },
      minSourceChars: 0,
    })

    const [, llmContext] = logger.streamSimpleWithAiHttpLogging.mock.calls.at(-1)
    const prompt = llmContext.messages[0].content
    // The 40k-char body exceeds the old 10k per-message cap and the old
    // 160k transcript cap is high enough to matter too — neither may cut it.
    expect(prompt).toContain(longBody)
    expect(prompt).not.toContain('[truncated')
  })

  it('sends large tool-call arguments in full', async () => {
    const logger = await import('../../server/ai-http-logger.mjs')
    const bigArgs = { path: 'src/app.ts', content: 'B'.repeat(5000) }

    await (await import('../../server/conversation-compaction.mjs')).compactConversation({
      messages: [
        { role: 'assistant', content: [{ type: 'toolCall', name: 'write_file', arguments: bigArgs }] },
        { role: 'toolResult', toolCallId: 'call-1', toolName: 'write_file', content: [{ type: 'text', text: 'ok' }] },
        textMessage('user', 'next'),
        textMessage('assistant', 'ok'),
      ],
      model: { provider: 'mock', id: 'mock-model' },
      minSourceChars: 0,
    })

    const [, llmContext] = logger.streamSimpleWithAiHttpLogging.mock.calls.at(-1)
    const prompt = llmContext.messages[0].content
    // 5000 chars exceeded the old 2000-char argument cap.
    expect(prompt).toContain('B'.repeat(5000))
    expect(prompt).not.toContain('[truncated')
  })

  it('still redacts secrets while not truncating', async () => {
    const logger = await import('../../server/ai-http-logger.mjs')

    await (await import('../../server/conversation-compaction.mjs')).compactConversation({
      messages: [
        // Bare key (no `key =` prefix, which would be collapsed into
        // `key=[REDACTED]` by the assignment rule instead).
        textMessage('user', `use sk-abcdefghijklmnopqrstuvwxyz012345 then ${'C'.repeat(20_000)}`),
        textMessage('assistant', 'ok'),
        textMessage('user', 'next'),
        textMessage('assistant', 'done'),
      ],
      model: { provider: 'mock', id: 'mock-model' },
      minSourceChars: 0,
    })

    const [, llmContext] = logger.streamSimpleWithAiHttpLogging.mock.calls.at(-1)
    const prompt = llmContext.messages[0].content
    expect(prompt).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345')
    expect(prompt).toContain('sk-[REDACTED]')
    // Redaction is a targeted replace, not a length cap.
    expect(prompt).toContain('C'.repeat(20_000))
  })

  it('collapses key assignments into a redacted form', async () => {
    const logger = await import('../../server/ai-http-logger.mjs')

    await (await import('../../server/conversation-compaction.mjs')).compactConversation({
      messages: [
        textMessage('user', 'token = sk-abcdefghijklmnopqrstuvwxyz012345'),
        textMessage('assistant', 'ok'),
        textMessage('user', 'next'),
        textMessage('assistant', 'done'),
      ],
      model: { provider: 'mock', id: 'mock-model' },
      minSourceChars: 0,
    })

    const [, llmContext] = logger.streamSimpleWithAiHttpLogging.mock.calls.at(-1)
    const prompt = llmContext.messages[0].content
    // The assignment rule wins over the provider-prefix rule; either way the
    // secret itself must be gone.
    expect(prompt).not.toContain('abcdefghijklmnopqrstuvwxyz012345')
    expect(prompt).toContain('[REDACTED]')
  })
})
