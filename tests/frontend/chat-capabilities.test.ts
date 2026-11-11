import { describe, expect, it } from 'vitest'
import {
  applyChatPagePolicy,
  BOT_CHAT_CAPABILITIES,
  QUICKFORGE_CHAT_CAPABILITIES,
  SIDE_CHAT_UI_CAPABILITIES,
  shouldSendComposerInput,
} from '../../src/lib/chat-capabilities'

describe('chat capabilities', () => {
  it('keeps the QuickForge chat surface fully enabled', () => {
    expect(QUICKFORGE_CHAT_CAPABILITIES).toMatchObject({
      modelSelection: true,
      thinkingSelection: true,
      clientApiKeyCheck: true,
      planMode: true,
      accessMode: true,
      commands: true,
      capabilitySuggestions: true,
      contextUsage: true,
      compaction: true,
      rollback: true,
      retry: true,
      forkFromMessage: true,
      attachments: true,
      messageSteering: true,
    })
  })

  it('keeps Side Chat executable capabilities disabled', () => {
    expect(SIDE_CHAT_UI_CAPABILITIES).toEqual(Object.fromEntries(
      Object.keys(QUICKFORGE_CHAT_CAPABILITIES).map((key) => [key, false]),
    ))
  })

  it('narrows bot sessions to "history is memory": no fork, rollback or retry', () => {
    expect(BOT_CHAT_CAPABILITIES).toMatchObject({
      forkFromMessage: false,
      rollback: false,
      retry: false,
    })
    // 它自己要压上下文，压缩必须留着。
    expect(BOT_CHAT_CAPABILITIES.compaction).toBe(true)
    // 除了这三项，其余与主会话一致：bot 只是不能剪历史，不是只读页面。
    const narrowed = Object.keys(QUICKFORGE_CHAT_CAPABILITIES)
      .filter((key) => BOT_CHAT_CAPABILITIES[key] !== QUICKFORGE_CHAT_CAPABILITIES[key])
      .sort()
    expect(narrowed).toEqual(['forkFromMessage', 'retry', 'rollback'])
  })

  it('stacks shared/read-only page policy without changing the default table', () => {
    const base = QUICKFORGE_CHAT_CAPABILITIES
    const resolved = applyChatPagePolicy(base, { readOnly: true, disableFork: true })
    expect(resolved).toMatchObject({
      rollback: false,
      retry: false,
      forkFromMessage: false,
      attachments: false,
      planMode: false,
      accessMode: false,
      commands: false,
      capabilitySuggestions: false,
    })
    // The default table stays untouched for the owning client.
    expect(base.attachments).toBe(true)
    expect(base.rollback).toBe(true)
  })

  it('returns the same capabilities when no page policy narrows them', () => {
    expect(applyChatPagePolicy(QUICKFORGE_CHAT_CAPABILITIES, {})).toBe(QUICKFORGE_CHAT_CAPABILITIES)
  })

  it('guards attachment-only and mixed attachment sends when attachments are disabled', () => {
    expect(shouldSendComposerInput({ attachments: false }, '', [{}])).toBe(false)
    expect(shouldSendComposerInput({ attachments: false }, 'text', [{}])).toBe(false)
    expect(shouldSendComposerInput({ attachments: false }, 'text', [])).toBe(true)
    expect(shouldSendComposerInput({ attachments: true }, '', [{}])).toBe(true)
  })
})
