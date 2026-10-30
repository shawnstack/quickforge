import { describe, expect, it } from 'vitest'
import { createEventLog } from '../../server/event-log.mjs'

describe('event log ring', () => {
  it('assigns a monotonically increasing global seq', () => {
    const log = createEventLog({ capacity: 10 })
    expect(log.publish('s1', { type: 'agent_end' })).toBe(1)
    expect(log.publish('s2', { type: 'message_end' })).toBe(2)
    expect(log.floorSeq()).toBe(1)
    expect(log.topSeq()).toBe(2)
  })

  it('keeps only lightweight replay fields', () => {
    const log = createEventLog({ capacity: 10 })
    log.publish('s1', {
      type: 'agent_end',
      messages: [{ role: 'user', content: 'PRIVATE BODY' }],
      logVersion: 4,
      messagesAfter: 2,
      messagesSummary: { count: 3, logVersion: 4 },
      unrelated: 'drop me',
    })
    const { frames } = log.since(0)
    expect(frames).toHaveLength(1)
    const frame = frames[0].frame
    expect(frame.messages).toBeUndefined()
    expect(frame.unrelated).toBeUndefined()
    expect(frame.sessionId).toBe('s1')
    expect(frame.logVersion).toBe(4)
    expect(frame.messagesAfter).toBe(2)
    expect(frame.replayed).toBe(true)
    expect(JSON.stringify(frame)).not.toContain('PRIVATE BODY')
  })

  it('does not retain streaming deltas for replay', () => {
    const log = createEventLog({ capacity: 10 })
    const seq = log.publish('s1', { type: 'message_update', message: { role: 'assistant' } })
    expect(seq).toBe(1)
    expect(log.since(0).frames).toHaveLength(0)
  })

  it('replays everything after the given seq', () => {
    const log = createEventLog({ capacity: 10 })
    log.publish('s1', { type: 'agent_end', logVersion: 1 })
    log.publish('s2', { type: 'message_end', logVersion: 2 })
    log.publish('s1', { type: 'state', logVersion: 3 })

    const { frames, gap } = log.since(1)
    expect(gap).toBe(false)
    expect(frames.map((entry) => entry.seq)).toEqual([2, 3])
  })

  it('reports a gap when the cursor fell out of the ring', () => {
    const log = createEventLog({ capacity: 2 })
    log.publish('s1', { type: 'agent_end', logVersion: 1 })
    log.publish('s1', { type: 'agent_end', logVersion: 2 })
    log.publish('s1', { type: 'agent_end', logVersion: 3 })

    expect(log.floorSeq()).toBe(2)
    const { gap } = log.since(0)
    expect(gap).toBe(true)
  })

  it('treats a first connection (no cursor) as gap-free', () => {
    const log = createEventLog({ capacity: 2 })
    log.publish('s1', { type: 'agent_end', logVersion: 1 })
    expect(log.since(0).gap).toBe(false)
  })
})
