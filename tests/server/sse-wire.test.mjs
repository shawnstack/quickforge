import { describe, expect, it } from 'vitest'
import { toSseWireEvent } from '../../server/utils/sse-wire.mjs'

describe('toSseWireEvent', () => {
  it('keeps only one accumulated message on streaming frames', () => {
    const message = { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
    const wire = toSseWireEvent({
      type: 'message_update',
      sessionId: 'session-1',
      stateVersion: 7,
      message,
      assistantMessageEvent: { type: 'text_delta', delta: 'hello', partial: message },
    })

    expect(wire).toEqual({
      type: 'message_update',
      sessionId: 'session-1',
      stateVersion: 7,
      message,
    })
    expect(wire).not.toHaveProperty('assistantMessageEvent')
  })

  it('passes every other event through unchanged', () => {
    const event = { type: 'message_end', sessionId: 'session-1', message: { role: 'assistant' } }
    expect(toSseWireEvent(event)).toBe(event)
  })

  it('is a no-op for malformed payloads', () => {
    expect(toSseWireEvent(null)).toBe(null)
    expect(toSseWireEvent({})).toEqual({})
  })
})
