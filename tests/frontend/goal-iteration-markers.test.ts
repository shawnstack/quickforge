import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  acceptFullGoalIterationMarkerSnapshot,
  acceptGoalIterationMarkerSnapshot,
  collectGoalIterationMarkers,
  mergeGoalIterationMarkers,
  replayGoalIterationMarkers,
} from '../../src/lib/server-agent/goal-iteration-markers'

/**
 * 目标轮次标记：把「这一轮属于目标的第几次规划/执行」贴回消息上，靠的是
 * **快照 + 位置**。位置错一位，标记就贴到别的消息上；身份校验少一道，重放时
 * 就会用旧快照覆盖更新的元数据。这条链路以前没有任何直接测试。
 */

type AnyMessage = AgentMessage & { id?: string; timestamp?: number; details?: Record<string, unknown> }

const message = (patch: Record<string, unknown> = {}): AnyMessage => ({ role: 'assistant', content: 'x', ...patch }) as AnyMessage

const marker = (patch: Record<string, unknown> = {}) => ({ kind: 'planning', round: 1, finishedAt: 100, ...patch })

describe('mergeGoalIterationMarkers', () => {
  it('returns the same array when there is nothing to merge', () => {
    const messages = [message({ id: 'm0' })]

    expect(mergeGoalIterationMarkers(messages, undefined)).toBe(messages)
    expect(mergeGoalIterationMarkers(messages, [])).toBe(messages)
  })

  it('attaches the marker to a verifiable message without mutating the input', () => {
    const original = message({ id: 'm1', details: { keep: true } })
    const messages = [message({ id: 'm0' }), original]

    const result = mergeGoalIterationMarkers(messages, [{ index: 1, role: 'assistant', id: 'm1', quickforgeGoalIteration: marker() }])

    expect(result).not.toBe(messages)
    expect(result[0]).toBe(messages[0])
    expect(result[1].details).toEqual({ keep: true, quickforgeGoalIteration: marker() })
    // 原消息对象保持干净。
    expect(original.details).toEqual({ keep: true })
  })

  it('skips a message whose role does not match the snapshot', () => {
    const messages = [message({ id: 'm1', role: 'user' })]
    const result = mergeGoalIterationMarkers(messages, [{ index: 0, role: 'assistant', id: 'm1', quickforgeGoalIteration: marker() }])

    expect(result).toBe(messages)
  })

  it.each([
    ['neither id nor timestamp', { index: 0, role: 'assistant' }],
    ['a mismatched id', { index: 0, role: 'assistant', id: 'nope' }],
    ['a mismatched timestamp', { index: 0, role: 'assistant', timestamp: 999 }],
    ['a negative index', { index: -1, role: 'assistant', id: 'm1' }],
    ['a fractional index', { index: 0.5, role: 'assistant', id: 'm1' }],
  ])('refuses to place a marker identified by %s', (_label, entry) => {
    const messages = [message({ id: 'm1', timestamp: 5 })]

    expect(mergeGoalIterationMarkers(messages, [{ ...entry, quickforgeGoalIteration: marker() }])).toBe(messages)
  })

  it('rejects malformed markers', () => {
    const messages = [message({ id: 'm1' })]
    const base = { index: 0, role: 'assistant', id: 'm1' }

    expect(mergeGoalIterationMarkers(messages, [{ ...base, quickforgeGoalIteration: null }])).toBe(messages)
    expect(mergeGoalIterationMarkers(messages, [{ ...base, quickforgeGoalIteration: [marker()] }])).toBe(messages)
    expect(mergeGoalIterationMarkers(messages, [{ ...base, quickforgeGoalIteration: marker({ kind: 'unknown' }) }])).toBe(messages)
  })

  it('accepts markers with no kind at all', () => {
    const messages = [message({ id: 'm1' })]
    const bare = { round: 2 }

    const result = mergeGoalIterationMarkers(messages, [{ index: 0, role: 'assistant', id: 'm1', quickforgeGoalIteration: bare }])

    expect(result[0].details?.quickforgeGoalIteration).toEqual(bare)
  })

  it('does nothing when the message already carries that exact marker', () => {
    const messages = [message({ id: 'm1', details: { quickforgeGoalIteration: marker() } })]

    expect(mergeGoalIterationMarkers(messages, [{ index: 0, role: 'assistant', id: 'm1', quickforgeGoalIteration: marker() }])).toBe(messages)
  })

  it('keeps the newer local marker instead of being overwritten by an older snapshot', () => {
    const messages = [message({ id: 'm1', details: { quickforgeGoalIteration: marker({ finishedAt: 500 }) } })]

    const result = mergeGoalIterationMarkers(messages, [
      { index: 0, role: 'assistant', id: 'm1', quickforgeGoalIteration: marker({ finishedAt: 100 }) },
    ])

    expect(result).toBe(messages)
  })

  it('lets a later finish win when replaying', () => {
    const messages = [message({ id: 'm1', details: { quickforgeGoalIteration: marker({ finishedAt: 100 }) } })]

    const result = mergeGoalIterationMarkers(
      messages,
      [{ index: 0, role: 'assistant', id: 'm1', quickforgeGoalIteration: marker({ finishedAt: 200 }) }],
      true,
    )

    expect(result[0].details?.quickforgeGoalIteration).toEqual(marker({ finishedAt: 200 }))
  })

  it('refuses to touch an existing marker during replay without a provable newer finish', () => {
    const messages = [message({ id: 'm1', details: { quickforgeGoalIteration: marker({ finishedAt: undefined }) } })]

    const result = mergeGoalIterationMarkers(
      messages,
      [{ index: 0, role: 'assistant', id: 'm1', quickforgeGoalIteration: marker({ finishedAt: 900 }) }],
      true,
    )

    expect(result).toBe(messages)
  })

  it('applies several markers in one pass and slices only once', () => {
    const messages = [message({ id: 'm0' }), message({ id: 'm1' }), message({ id: 'm2' })]

    const result = mergeGoalIterationMarkers(messages, [
      { index: 0, role: 'assistant', id: 'm0', quickforgeGoalIteration: marker({ round: 1 }) },
      { index: 2, role: 'assistant', id: 'm2', quickforgeGoalIteration: marker({ round: 2 }) },
    ])

    expect(result).not.toBe(messages)
    expect((result[0].details?.quickforgeGoalIteration as { round: number }).round).toBe(1)
    expect((result[2].details?.quickforgeGoalIteration as { round: number }).round).toBe(2)
    expect(result[1]).toBe(messages[1])
  })
})

describe('collectGoalIterationMarkers', () => {
  it('collects every message that carries a marker with its identity and position', () => {
    const messages = [
      message({ id: 'm0' }),
      message({ id: 'm1', timestamp: 7, details: { quickforgeGoalIteration: marker() } }),
      message({ role: 'user', details: { quickforgeGoalIteration: marker({ round: 3 }) } }),
    ]

    expect(collectGoalIterationMarkers(messages)).toEqual([
      { index: 1, role: 'assistant', id: 'm1', timestamp: 7, quickforgeGoalIteration: marker() },
      { index: 2, role: 'user', id: undefined, timestamp: undefined, quickforgeGoalIteration: marker({ round: 3 }) },
    ])
  })

  it('ignores array-shaped markers', () => {
    const messages = [message({ details: { quickforgeGoalIteration: [marker()] } })]

    expect(collectGoalIterationMarkers(messages)).toEqual([])
  })
})

describe('applying snapshots to a windowed session', () => {
  function makeCore(messages: AnyMessage[], baseSeq = 0) {
    return {
      messageBaseSeq: baseSeq,
      state: { messages },
      stateVersion: 3,
      latestGoalIterationMarkers: undefined as unknown,
      notifyMessageMetadataChanged: vi.fn(),
    }
  }

  it('translates absolute seq into the window index by subtracting baseSeq', () => {
    const core = makeCore([message({ id: 'm0' }), message({ id: 'm1' }), message({ id: 'm2' })], 5)

    acceptGoalIterationMarkerSnapshot(core as never, [
      { seq: 6, index: 6, role: 'assistant', id: 'm1', quickforgeGoalIteration: marker() },
    ])

    const applied = core.state.messages[1].details?.quickforgeGoalIteration
    expect(applied).toEqual(marker())
    expect(core.state.messages[0].details).toBeUndefined()
    expect(core.stateVersion).toBe(4)
    expect(core.notifyMessageMetadataChanged).toHaveBeenCalledTimes(1)
  })

  it('drops markers that fall outside the window', () => {
    const core = makeCore([message({ id: 'm0' }), message({ id: 'm1' })], 10)

    acceptGoalIterationMarkerSnapshot(core as never, [
      // 绝对 9 → 相对 -1：窗口之前。
      { seq: 9, index: 9, role: 'assistant', id: 'x', quickforgeGoalIteration: marker() },
      // 绝对 50 → 相对 40：窗口之后。
      { seq: 50, index: 50, role: 'assistant', id: 'x', quickforgeGoalIteration: marker() },
    ])

    expect(core.stateVersion).toBe(3)
    expect(core.notifyMessageMetadataChanged).not.toHaveBeenCalled()
  })

  it('counts the message itself as a change only when something actually merged', () => {
    const core = makeCore([message({ id: 'm0' })])

    acceptGoalIterationMarkerSnapshot(core as never, [])

    expect(core.stateVersion).toBe(3)
    expect(core.notifyMessageMetadataChanged).not.toHaveBeenCalled()
  })

  it('remembers the latest snapshot for replay', () => {
    const core = makeCore([message({ id: 'm0' })])
    const markers = [{ index: 0, role: 'assistant', id: 'm0', quickforgeGoalIteration: marker() }]

    acceptGoalIterationMarkerSnapshot(core as never, markers)

    expect(core.latestGoalIterationMarkers).toBe(markers)
  })

  it('derives the snapshot from a full message list', () => {
    const core = makeCore([])
    const full = [message({ id: 'm0', details: { quickforgeGoalIteration: marker() } })]

    acceptFullGoalIterationMarkerSnapshot(core as never, full)

    expect(core.latestGoalIterationMarkers).toEqual([
      { index: 0, role: 'assistant', id: 'm0', timestamp: undefined, quickforgeGoalIteration: marker() },
    ])
  })

  it('replays the remembered snapshot', () => {
    // 重放只在「快照能证明这一轮更晚结束」时才覆盖本地已有标记，所以本地先放
    // 一个较小的 finishedAt。
    const core = makeCore([message({ id: 'm0', details: { quickforgeGoalIteration: marker({ finishedAt: 100 }) } })])
    core.latestGoalIterationMarkers = [{ index: 0, role: 'assistant', id: 'm0', quickforgeGoalIteration: marker({ finishedAt: 1000 }) }]

    replayGoalIterationMarkers(core as never)

    expect(core.state.messages[0].details?.quickforgeGoalIteration).toEqual(marker({ finishedAt: 1000 }))
    expect(core.stateVersion).toBe(4)
  })

  it('ignores a non-array snapshot', () => {
    const core = makeCore([message({ id: 'm0' })])

    acceptGoalIterationMarkerSnapshot(core as never, undefined)

    expect(core.stateVersion).toBe(3)
  })
})
