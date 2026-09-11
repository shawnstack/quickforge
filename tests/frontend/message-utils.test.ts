import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

// The real i18n module pulls in pi-web-ui, which needs a browser DOM.
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import { hasToolResultsAfter } from '../../src/lib/message-utils'

function message(role: string, extra: Record<string, unknown> = {}) {
  return { role, content: '', ...extra } as unknown as AgentMessage
}

describe('hasToolResultsAfter', () => {
  it('detects tool results produced by the failed turn', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'toolUse' }),
      message('toolResult', { toolCallId: 'call-1' }),
      message('assistant', { stopReason: 'error' }),
    ]

    expect(hasToolResultsAfter(messages, 0)).toBe(true)
  })

  it('ignores tool results that belong to earlier turns', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'toolUse' }),
      message('toolResult', { toolCallId: 'call-1' }),
      message('user'),
      message('assistant', { stopReason: 'error' }),
    ]

    expect(hasToolResultsAfter(messages, 3)).toBe(false)
  })

  it('returns false for a plain text failure', () => {
    const messages = [
      message('user'),
      message('assistant', { stopReason: 'error', errorMessage: 'upstream failed' }),
    ]

    expect(hasToolResultsAfter(messages, 0)).toBe(false)
  })
})
