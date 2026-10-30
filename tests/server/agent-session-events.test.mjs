import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { emitSessionEvent, stripSplitSessionState } from '../../server/agent-session-events.mjs'
import { appendAssistantErrorMessageOnce } from '../../server/agent-manager.mjs'
import { createConnectionProjector, projectSessionSnapshot } from '../../server/message-log.mjs'

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

describe('split final-answer delivery', () => {
  it('emits the full event and lets each connection crop by its own cursor', () => {
    const messages = [
      { role: 'user', content: 'go' },
      { role: 'toolResult', toolCallId: 'tool-1' },
      { role: 'assistant', content: [{ type: 'text', text: 'final summary' }] },
    ]
    const session = {
      sessionId: 's1',
      persistedMessageStorage: 'split',
      persistedMessageCount: messages.length,
      stateVersion: 3,
      eventBus: new EventEmitter(),
    }
    let frame
    session.eventBus.on('agent_event', (event) => { frame = event })

    emitSessionEvent(session, { type: 'agent_end', messages })

    // emit 层发完整事件：裁剪是连接层的职责，不是会话的职责。
    // 旧实现在这里用会话级 `deliveredMessageCount` 切尾，两个客户端共享同一
    // 个游标，后加入者会从别人的进度开始收增量（漏消息）。
    expect(frame.messages).toHaveLength(3)
    expect(frame.logVersion).toBe(1)

    // 新连接：拿到尾部窗口，其中包含最终回答。
    const fresh = createConnectionProjector({ limit: 200 })
    const forFresh = fresh.project('s1', frame)
    expect(forFresh.messagesAfter).toBe(0)
    expect(forFresh.messages).toHaveLength(3)
    expect(forFresh.messages[2].content).toEqual([{ type: 'text', text: 'final summary' }])

    // 已经同步到 3 条的连接：不重复收消息体。
    const synced = createConnectionProjector({ limit: 200 })
    synced.seed('s1', 3, 0)
    const forSynced = synced.project('s1', frame)
    expect(forSynced.messages).toBeUndefined()
    expect(forSynced.messagesSummary).toEqual({ count: 3, logVersion: 1 })
  })

  it('advances the message log version only when the message list changes', () => {
    const session = { sessionId: 's1', stateVersion: 0, eventBus: new EventEmitter() }
    const frames = []
    session.eventBus.on('agent_event', (event) => { frames.push(event) })
    const messages = [{ role: 'user', content: 'hi' }]

    emitSessionEvent(session, { type: 'agent_start', messages })
    emitSessionEvent(session, { type: 'message_update', messages })
    expect(frames.map((frame) => frame.logVersion)).toEqual([1, 1])

    emitSessionEvent(session, { type: 'message_end', messages: [...messages, { role: 'assistant', content: 'yo' }] })
    expect(frames[2].logVersion).toBe(2)
    // stateVersion 每个事件都推进，两套水位互不影响。
    expect(frames.map((frame) => frame.stateVersion)).toEqual([1, 2, 3])
  })
})

describe('split goal iteration metadata snapshots', () => {
  it.each(['planning', 'execution', undefined])('ships sparse %s markers with absolute seq', (kind) => {
    const marker = { goalId: 'g1', ...(kind ? { kind } : {}), iteration: 1, outcome: 'completed', finishedAt: 500 }
    const messages = [
      { role: 'user', timestamp: 100, content: 'PRIVATE HISTORY' },
      { id: 'a1', role: 'assistant', timestamp: 200, content: 'PRIVATE ANSWER', details: { privateDetail: 'PRIVATE DETAIL', quickforgeGoalIteration: marker } },
    ]
    const state = { messageStorage: 'split', stateVersion: 4, messages }
    const expected = [{ seq: 1, index: 1, id: 'a1', role: 'assistant', timestamp: 200, quickforgeGoalIteration: marker }]
    const wire = stripSplitSessionState(state)

    expect(wire.goalIterationMarkers).toEqual(expected)
    expect(wire.messagesSummary).toEqual({ count: 2, logVersion: 0 })
    expect(wire.messagesAfter).toBe(0)
    // 新契约：快照自带尾部窗口，客户端一次请求就能自洽渲染。
    expect(wire.messages).toEqual(messages)
    // markers 本身仍然只是稀疏元数据，不带历史正文/私有 details。
    expect(JSON.stringify(wire.goalIterationMarkers)).not.toContain('PRIVATE DETAIL')
    expect(JSON.stringify(wire.goalIterationMarkers)).not.toContain('PRIVATE HISTORY')
  })

  it('never leaks history beyond the requested window', () => {
    const messages = [
      { role: 'user', timestamp: 100, content: 'PRIVATE HISTORY' },
      { role: 'assistant', timestamp: 200, content: 'recent answer' },
    ]
    const wire = projectSessionSnapshot({ messages }, { limit: 1 })
    expect(wire.messagesAfter).toBe(1)
    expect(JSON.stringify(wire.messages)).not.toContain('PRIVATE HISTORY')

    // state 帧同样由连接层裁剪：已同步的连接拿不到任何消息体。
    const session = { sessionId: 's1', persistedMessageStorage: 'split', stateVersion: 3, eventBus: new EventEmitter() }
    let frame
    session.eventBus.on('agent_event', (event) => { frame = event })
    emitSessionEvent(session, { type: 'state', messages })
    expect(frame.goalIterationMarkers).toEqual([])

    const synced = createConnectionProjector({ limit: 1 })
    synced.seed('s1', 2, frame.logVersion)
    expect(synced.project('s1', frame).messages).toBeUndefined()
  })
})
