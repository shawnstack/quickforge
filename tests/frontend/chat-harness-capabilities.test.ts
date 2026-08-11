import { describe, expect, it } from 'vitest'
import {
  applyChatPagePolicy,
  resolveChatHarnessCapabilities,
  shouldSendComposerInput,
} from '../../src/lib/chat-harness-capabilities'

describe('chat Harness capabilities', () => {
  it('keeps QuickForge enabled and applies the OpenCode P0 boundary', () => {
    const quickforge = resolveChatHarnessCapabilities('quickforge')
    // QuickForge has no whole-session fork or runtime harness config entry.
    expect(quickforge).toMatchObject({
      modelSelection: true,
      thinkingSelection: true,
      rollback: true,
      retry: true,
      forkFromMessage: true,
      forkSession: false,
      harnessConfig: false,
      attachments: true,
    })
    expect(resolveChatHarnessCapabilities('opencode')).toMatchObject({
      modelSelection: false,
      clientApiKeyCheck: false,
      planMode: false,
      accessMode: false,
      commands: false,
      capabilitySuggestions: false,
      contextUsage: false,
      compaction: false,
      rollback: false,
      retry: false,
      forkFromMessage: false,
      attachments: true,
    })
  })

  it('opens the OpenCode P1 whole-session fork and harness config capabilities', () => {
    const openCode = resolveChatHarnessCapabilities('opencode')
    expect(openCode).toMatchObject({
      forkSession: true,
      harnessConfig: true,
      rollback: false,
      retry: false,
      forkFromMessage: false,
    })
  })

  it('disables the OpenCode P1 capabilities under the shared read-only policy', () => {
    const openCode = resolveChatHarnessCapabilities('opencode')
    const resolved = applyChatPagePolicy(openCode, { readOnly: true, disableFork: true })
    expect(resolved).toMatchObject({
      forkSession: false,
      harnessConfig: false,
      rollback: false,
      retry: false,
      forkFromMessage: false,
      attachments: false,
    })
    // The base table stays untouched for the owning client.
    expect(openCode.forkSession).toBe(true)
    expect(openCode.harnessConfig).toBe(true)
  })

  it('stacks shared/read-only page policy without changing the default table', () => {
    const base = resolveChatHarnessCapabilities('quickforge')
    const resolved = applyChatPagePolicy(base, { readOnly: true, disableFork: true })
    expect(resolved).toMatchObject({ rollback: false, retry: false, forkFromMessage: false, attachments: false })
    expect(base.attachments).toBe(true)
  })

  it('keeps OpenCode attachments enabled but applies the shared read-only policy', () => {
    const base = resolveChatHarnessCapabilities('opencode')
    const resolved = applyChatPagePolicy(base, { readOnly: true, disableFork: true })
    expect(base.attachments).toBe(true)
    expect(resolved).toMatchObject({ rollback: false, retry: false, forkFromMessage: false, attachments: false })
  })

  it('guards attachment-only and mixed attachment sends when attachments are disabled', () => {
    expect(shouldSendComposerInput({ attachments: false }, '', [{}])).toBe(false)
    expect(shouldSendComposerInput({ attachments: false }, 'text', [{}])).toBe(false)
    expect(shouldSendComposerInput({ attachments: false }, 'text', [])).toBe(true)
    expect(shouldSendComposerInput({ attachments: true }, '', [{}])).toBe(true)
  })
})
