import { describe, expect, it, vi } from 'vitest'
import {
  resolveBlankDeferredSessionForNewChat,
  shouldReplaceBlankDeferredSessionHarness,
} from '../../src/lib/deferred-session-harness'

const blankGlobalDeferred = {
  isDeferredSession: true,
  isStreaming: false,
  messageCount: 0,
  currentScope: 'global' as const,
  targetScope: 'global' as const,
  currentHarness: 'quickforge' as const,
}

describe('deferred session Harness selection', () => {
  it('replaces a blank deferred session when the default Harness changes', () => {
    expect(shouldReplaceBlankDeferredSessionHarness({
      ...blankGlobalDeferred,
      defaultHarness: 'opencode',
    })).toBe(true)
  })

  it('does not replace when the Harness is unchanged', () => {
    expect(shouldReplaceBlankDeferredSessionHarness({
      ...blankGlobalDeferred,
      defaultHarness: 'quickforge',
    })).toBe(false)
  })

  it('does not replace non-empty or real sessions', () => {
    expect(shouldReplaceBlankDeferredSessionHarness({
      ...blankGlobalDeferred,
      messageCount: 1,
      defaultHarness: 'opencode',
    })).toBe(false)
    expect(shouldReplaceBlankDeferredSessionHarness({
      ...blankGlobalDeferred,
      isDeferredSession: false,
      defaultHarness: 'opencode',
    })).toBe(false)
  })

  it('checks the latest default Harness before reusing the new-chat branch', async () => {
    const loadDefaultHarness = vi.fn(async () => 'opencode' as const)

    await expect(resolveBlankDeferredSessionForNewChat(
      blankGlobalDeferred,
      loadDefaultHarness,
    )).resolves.toEqual({ action: 'replace', defaultHarness: 'opencode' })
    expect(loadDefaultHarness).toHaveBeenCalledOnce()
  })
})
