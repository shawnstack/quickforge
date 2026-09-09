import { describe, expect, it } from 'vitest'
import {
  applyChatPagePolicy,
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
