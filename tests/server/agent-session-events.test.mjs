import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { emitSessionEvent, stripSplitSessionState } from '../../server/agent-session-events.mjs'
import { appendAssistantErrorMessageOnce } from '../../server/agent-manager.mjs'

// 自 agent-harness.test.mjs 迁移（该文件随 harness 概念删除）；本用例只覆盖
// agent-session-events 的通用错误消息追加行为，与 harness 无关。
describe('agent session events', () => {
  it('does not append a duplicate assistant error message', () => {
    const existing = [{ role: 'assistant', stopReason: 'error', errorMessage: 'failed' }]
    expect(appendAssistantErrorMessageOnce(existing, 'failed', null)).toBe(existing)
    expect(appendAssistantErrorMessageOnce([], 'failed', null)).toEqual([
      expect.objectContaining({ role: 'assistant', stopReason: 'error', errorMessage: 'failed' }),
    ])
  })
})

describe('split goal iteration metadata snapshots', () => {
  it.each(['planning', 'execution', undefined])('ships sparse %s markers without historical message bodies', (kind) => {
    const marker = { goalId: 'g1', ...(kind ? { kind } : {}), iteration: 1, outcome: 'completed', finishedAt: 500 }
    const messages = [
      { role: 'user', timestamp: 100, content: 'PRIVATE HISTORY' },
      { id: 'a1', role: 'assistant', timestamp: 200, content: 'PRIVATE ANSWER', details: { privateDetail: 'PRIVATE DETAIL', quickforgeGoalIteration: marker } },
    ]
    const state = { messageStorage: 'split', stateVersion: 4, messages }
    const expected = [{ index: 1, id: 'a1', role: 'assistant', timestamp: 200, quickforgeGoalIteration: marker }]
    const wire = stripSplitSessionState(state)
    expect(wire.goalIterationMarkers).toEqual(expected)
    expect(wire.messagesSummary).toEqual({ count: 2 })
    expect(wire.messages).toBeUndefined()
    expect(JSON.stringify(wire)).not.toContain('PRIVATE')
    expect(state.messages).toBe(messages)

    const session = { sessionId: 's1', persistedMessageStorage: 'split', stateVersion: 3, eventBus: new EventEmitter() }
    let frame
    session.eventBus.on('agent_event', (event) => { frame = event })
    emitSessionEvent(session, { type: 'state', messages })
    expect(frame.goalIterationMarkers).toEqual(expected)
    expect(frame.stateVersion).toBe(4)
    expect(frame.messages).toBeUndefined()
    expect(JSON.stringify(frame)).not.toContain('PRIVATE')
  })
})
