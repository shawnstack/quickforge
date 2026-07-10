import { describe, expect, it } from 'vitest'
import { markLatestAssistantProcessFinished } from '../../server/agent-manager.mjs'

describe('agent process timing', () => {
  it('marks only the latest assistant message with the run completion time', () => {
    const messages = [
      { role: 'user', timestamp: 1_000 },
      { role: 'assistant', timestamp: 2_000 },
      { role: 'toolResult', timestamp: 3_000 },
      { role: 'assistant', timestamp: 4_000 },
    ]

    const latestAssistant = messages[3]
    expect(markLatestAssistantProcessFinished(messages, 6_000)).toBe(true)
    expect(messages[1].details?.quickforgeProcessFinishedAt).toBeUndefined()
    expect(messages[3].details.quickforgeProcessFinishedAt).toBe(6_000)
    expect(messages[3]).not.toBe(latestAssistant)
  })

  it('does not replace an existing persisted completion time', () => {
    const messages = [
      { role: 'assistant', timestamp: 2_000, details: { quickforgeProcessFinishedAt: 5_000 } },
    ]

    expect(markLatestAssistantProcessFinished(messages, 8_000)).toBe(false)
    expect(messages[0].details.quickforgeProcessFinishedAt).toBe(5_000)
  })
})
