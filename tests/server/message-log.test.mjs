import { describe, expect, it } from 'vitest'
import {
  SESSION_TAIL_LIMIT,
  bumpMessageLogVersion,
  createConnectionProjector,
  goalIterationMarkers,
  messageIdentity,
  messageLogVersion,
  projectSessionSnapshot,
  sessionMessagesChanged,
  tailWindow,
} from '../../server/message-log.mjs'

function messagesOf(count, prefix = 'm') {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${prefix}${index}`,
    timestamp: 1000 + index,
  }))
}

describe('tailWindow', () => {
  it('keeps the last N messages and reports the absolute start', () => {
    const window = tailWindow(messagesOf(5), 2)
    expect(window.total).toBe(5)
    expect(window.messagesAfter).toBe(3)
    expect(window.messages.map((message) => message.content)).toEqual(['m3', 'm4'])
  })

  it('returns everything (start 0) when the list fits the window', () => {
    const window = tailWindow(messagesOf(3), 200)
    expect(window.messagesAfter).toBe(0)
    expect(window.messages).toHaveLength(3)
  })

  it('handles empty and invalid input without throwing', () => {
    expect(tailWindow(null, 10)).toEqual({ messages: [], messagesAfter: 0, total: 0 })
    expect(tailWindow(messagesOf(2), 0).messagesAfter).toBe(0)
    expect(SESSION_TAIL_LIMIT).toBe(200)
  })
})

describe('message log version', () => {
  it('defaults to 0 and increments monotonically', () => {
    const session = {}
    expect(messageLogVersion(session)).toBe(0)
    expect(bumpMessageLogVersion(session)).toBe(1)
    expect(bumpMessageLogVersion(session)).toBe(2)
    expect(messageLogVersion(session)).toBe(2)
  })

  it('ignores non-integer values', () => {
    expect(messageLogVersion({ messageLogVersion: -1 })).toBe(0)
    expect(messageLogVersion({ messageLogVersion: 'x' })).toBe(0)
  })
})

describe('sessionMessagesChanged', () => {
  it('detects append, truncate and tail replacement', () => {
    const base = messagesOf(3)
    expect(sessionMessagesChanged(base, messagesOf(4))).toBe(true)
    expect(sessionMessagesChanged(base, messagesOf(2))).toBe(true)
    expect(sessionMessagesChanged(base, [...base.slice(0, 2), { role: 'assistant', timestamp: 99 }])).toBe(true)
  })

  it('treats an in-place identical array as unchanged', () => {
    const base = messagesOf(3)
    expect(sessionMessagesChanged(base, base)).toBe(false)
    expect(sessionMessagesChanged(base, messagesOf(3))).toBe(false)
  })
})

describe('messageIdentity', () => {
  it('prefers stable id, then toolCallId, then role+timestamp', () => {
    expect(messageIdentity({ id: 'a1' })).toBe('id:a1')
    expect(messageIdentity({ toolCallId: 't1' })).toBe('tool:t1')
    expect(messageIdentity({ role: 'user', timestamp: 5 })).toBe('user:5')
    expect(messageIdentity(null)).toBe('')
  })
})

describe('projectSessionSnapshot', () => {
  it('ships a tail window with an absolute start instead of dropping messages', () => {
    const state = { stateVersion: 7, logVersion: 3, messages: messagesOf(5, 'PRIVATE-') }
    const snapshot = projectSessionSnapshot(state, { limit: 2 })
    expect(snapshot.messagesAfter).toBe(3)
    expect(snapshot.logVersion).toBe(3)
    expect(snapshot.messagesSummary).toEqual({ count: 5, logVersion: 3 })
    expect(snapshot.messages.map((message) => message.content)).toEqual(['PRIVATE-3', 'PRIVATE-4'])
    // 前缀仍然不离开进程：窗口之外的历史不能被序列化出去。
    expect(JSON.stringify(snapshot.messages)).not.toContain('PRIVATE-0')
  })

  it('keeps goal markers on absolute seq, not window-relative index', () => {
    const marker = { goalId: 'g1', iteration: 1, outcome: 'completed' }
    const messages = [
      { role: 'user', timestamp: 1, content: 'u0' },
      { role: 'user', timestamp: 2, content: 'u1' },
      { id: 'a2', role: 'assistant', timestamp: 3, content: 'a2', details: { quickforgeGoalIteration: marker } },
    ]
    const snapshot = projectSessionSnapshot({ messages }, { limit: 1 })
    expect(snapshot.messagesAfter).toBe(2)
    expect(snapshot.goalIterationMarkers).toEqual([
      { seq: 2, index: 2, id: 'a2', role: 'assistant', timestamp: 3, quickforgeGoalIteration: marker },
    ])
  })

  it('tolerates states without messages', () => {
    expect(projectSessionSnapshot(null)).toBe(null)
    const bare = projectSessionSnapshot({ title: 'x' })
    expect(bare.messages).toEqual([])
    expect(bare.messagesAfter).toBe(0)
  })

  it('goalIterationMarkers applies a base seq', () => {
    const marker = { goalId: 'g' }
    const markers = goalIterationMarkers([{ role: 'assistant', details: { quickforgeGoalIteration: marker } }], 5)
    expect(markers).toHaveLength(1)
    expect(markers[0].seq).toBe(5)
  })
})

describe('createConnectionProjector', () => {
  const frame = (count, extra = {}) => ({
    type: 'agent_end',
    messages: messagesOf(count),
    ...extra,
  })

  it('gives every connection its own cursor (the old session-level cursor bug)', () => {
    const projectorA = createConnectionProjector({ limit: 10 })
    const projectorB = createConnectionProjector({ limit: 10 })

    // A 已经收到 4 条，B 刚刚连上、什么都没收到。
    projectorA.seed('s1', 4, 1)

    const next = frame(5)
    const forA = projectorA.project('s1', next)
    const forB = projectorB.project('s1', next)

    // A 只补新增的第 5 条；B 拿到完整尾部窗口。
    expect(forA.messages.map((message) => message.content)).toEqual(['m4'])
    expect(forA.messagesAfter).toBe(4)
    expect(forB.messages).toHaveLength(5)
    expect(forB.messagesAfter).toBe(0)
  })

  it('omits the message body when nothing new arrived', () => {
    const projector = createConnectionProjector({ limit: 10 })
    projector.seed('s1', 3, 1)
    const projected = projector.project('s1', frame(3, { logVersion: 1 }))
    expect(projected.messages).toBeUndefined()
    expect(projected.messagesSummary).toEqual({ count: 3, logVersion: 1 })
  })

  it('starts a fresh connection at the tail window floor', () => {
    const projector = createConnectionProjector({ limit: 2 })
    const projected = projector.project('s1', frame(5))
    expect(projected.messagesAfter).toBe(3)
    expect(projected.messages.map((message) => message.content)).toEqual(['m3', 'm4'])
    expect(projected.messagesIncremental).toBe(true)
  })

  it('keeps overlap when a burst exceeds the window', () => {
    const projector = createConnectionProjector({ limit: 2 })
    projector.seed('s1', 1, 1)
    const projected = projector.project('s1', frame(5))
    // 已见 1 条，窗口下界 3 → 从 3 开始，仍带绝对起点 3。
    expect(projected.messagesAfter).toBe(3)
    expect(projected.messages).toHaveLength(2)
  })

  it('passes streaming frames through untouched and does not advance the cursor', () => {
    const projector = createConnectionProjector({ limit: 2 })
    projector.seed('s1', 5, 1)
    const update = { type: 'message_update', message: { role: 'assistant' }, messages: messagesOf(5) }
    expect(projector.project('s1', update)).toBe(update)
    expect(projector.cursor('s1')).toEqual({ logVersion: 1, deliveredSeq: 5 })
  })

  it('re-sends the tail after a rollback shrinks the list', () => {
    const projector = createConnectionProjector({ limit: 2 })
    projector.seed('s1', 5, 1)
    const rolledBack = projector.project('s1', { type: 'messages_replaced', messages: messagesOf(2), logVersion: 2 })
    expect(rolledBack.messagesAfter).toBe(0)
    expect(rolledBack.messages).toHaveLength(2)
    expect(projector.cursor('s1')).toEqual({ logVersion: 2, deliveredSeq: 2 })
  })

  it('forgets a session cursor on demand', () => {
    const projector = createConnectionProjector({ limit: 10 })
    projector.seed('s1', 3, 1)
    projector.forget('s1')
    expect(projector.cursor('s1')).toBe(null)
    expect(projector.project('s1', frame(3)).messagesAfter).toBe(0)
  })
})
