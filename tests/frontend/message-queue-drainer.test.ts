import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadStoredMessageQueueState, saveStoredMessageQueueState } from '@/lib/message-queue'
import { drainStoredMessageQueue, pauseStoredMessageQueue, type QueueDrainAgent } from '@/lib/message-queue-drainer'

const STORAGE_KEY = 'quickforge:message-queue:v1'

function stubLocalStorage(): Map<string, string> {
  const backing = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
  })
  return backing
}

function createAgent(options: {
  streaming?: boolean
  failOn?: (text: string) => boolean
  accepted?: (text: string) => boolean
  streamOnPrompt?: (text: string) => boolean
  onPrompt?: (text: string) => void
} = {}) {
  const calls: string[] = []
  const state = { isStreaming: options.streaming ?? false }
  const agent: QueueDrainAgent = {
    state,
    prompt: (text: string) => {
      calls.push(text)
      options.onPrompt?.(text)
      if (options.streamOnPrompt?.(text)) {
        // 模拟「外层判断时还没流式，微任务里回合已经开跑」。
        state.isStreaming = true
        return Promise.resolve(false)
      }
      if (options.failOn?.(text)) return Promise.reject(new Error('prompt failed'))
      return Promise.resolve(options.accepted ? options.accepted(text) : true)
    },
  }
  return { agent, calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('drainStoredMessageQueue', () => {
  it('sends queued items in order, dropping each from storage on success', async () => {
    stubLocalStorage()
    saveStoredMessageQueueState('s1', {
      items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }, { id: 'q3', text: 'three' }],
      paused: false,
    })
    // Every prompt sees the queue one item shorter: each success persists the
    // removal before the next send.
    const remaining: number[] = []
    const { agent, calls } = createAgent({
      onPrompt: () => remaining.push(loadStoredMessageQueueState('s1').items.length),
    })
    await drainStoredMessageQueue('s1', agent)
    expect(calls).toEqual(['one', 'two', 'three'])
    expect(remaining).toEqual([3, 2, 1])
    expect(loadStoredMessageQueueState('s1')).toEqual({ items: [], paused: false })
  })

  it('keeps the failed item at the head, pauses, and stops draining', async () => {
    stubLocalStorage()
    saveStoredMessageQueueState('s1', {
      items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }],
      paused: false,
    })
    const { agent, calls } = createAgent({ failOn: (text) => text === 'one' })
    // Never rejects: prompt failures converge into a paused queue.
    await drainStoredMessageQueue('s1', agent)
    expect(calls).toEqual(['one'])
    expect(loadStoredMessageQueueState('s1')).toEqual({
      items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }],
      paused: true,
    })
  })

  it('keeps the whole queue when a prompt resolves without being sent', async () => {
    stubLocalStorage()
    saveStoredMessageQueueState('s1', {
      items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }],
      paused: false,
    })
    // 静默未发送（无写租约 / agent 已销毁）：promise 正常 resolve，但返回 false。
    // 这条回归钉的是「没发出去也被当成成功删掉」——两条一起消失的根因。
    const { agent, calls } = createAgent({ accepted: () => false })
    await drainStoredMessageQueue('s1', agent)
    expect(calls).toEqual(['one'])
    expect(loadStoredMessageQueueState('s1')).toEqual({
      items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }],
      paused: true,
    })
  })

  it('stops at the first unaccepted item and keeps everything after it', async () => {
    stubLocalStorage()
    saveStoredMessageQueueState('s1', {
      items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }, { id: 'q3', text: 'three' }],
      paused: false,
    })
    const { agent, calls } = createAgent({ accepted: (text) => text !== 'two' })
    await drainStoredMessageQueue('s1', agent)
    expect(calls).toEqual(['one', 'two'])
    expect(loadStoredMessageQueueState('s1')).toEqual({
      items: [{ id: 'q2', text: 'two' }, { id: 'q3', text: 'three' }],
      paused: true,
    })
  })

  it('keeps the queue running (not paused) when the turn is merely still streaming', async () => {
    stubLocalStorage()
    saveStoredMessageQueueState('s1', { items: [{ id: 'q1', text: 'one' }], paused: false })
    // 竞态：外层判断时还没流式，微任务里回合已经开跑 → prompt 静默返回 false。
    // 这不是发送失败，不能把队列暂停。
    const { agent, calls } = createAgent({ streamOnPrompt: () => true })
    await drainStoredMessageQueue('s1', agent)
    expect(calls).toEqual(['one'])
    expect(loadStoredMessageQueueState('s1')).toEqual({
      items: [{ id: 'q1', text: 'one' }],
      paused: false,
    })
  })

  it('does not send while the stored queue is paused', async () => {
    stubLocalStorage()
    saveStoredMessageQueueState('s1', { items: [{ id: 'q1', text: 'one' }], paused: true })
    const { agent, calls } = createAgent()
    await drainStoredMessageQueue('s1', agent)
    expect(calls).toHaveLength(0)
  })

  it('is a no-op without stored state or with empty items', async () => {
    const backing = stubLocalStorage()
    const { agent, calls } = createAgent()
    await drainStoredMessageQueue('s-none', agent)
    backing.set(STORAGE_KEY, JSON.stringify({
      'session:s-empty': { items: [], paused: false, updatedAt: '2026-01-01T00:00:00.000Z' },
    }))
    await drainStoredMessageQueue('s-empty', agent)
    expect(calls).toHaveLength(0)
  })

  it('leaves the queue untouched while the agent is streaming', async () => {
    stubLocalStorage()
    saveStoredMessageQueueState('s1', {
      items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }],
      paused: false,
    })
    const { agent, calls } = createAgent({ streaming: true })
    await drainStoredMessageQueue('s1', agent)
    expect(calls).toHaveLength(0)
    expect(loadStoredMessageQueueState('s1')).toEqual({
      items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }],
      paused: false,
    })
  })

  it('shares one in-flight drain per session instead of double-sending', async () => {
    stubLocalStorage()
    saveStoredMessageQueueState('s1', {
      items: [{ id: 'q1', text: 'one' }, { id: 'q2', text: 'two' }],
      paused: false,
    })
    const { agent, calls } = createAgent()
    const first = drainStoredMessageQueue('s1', agent)
    const second = drainStoredMessageQueue('s1', agent)
    expect(second).toBe(first)
    await first
    expect(calls).toEqual(['one', 'two'])
  })
})

describe('pauseStoredMessageQueue', () => {
  it('pauses a non-empty running queue and persists it', () => {
    stubLocalStorage()
    saveStoredMessageQueueState('s1', { items: [{ id: 'q1', text: 'one' }], paused: false })
    pauseStoredMessageQueue('s1')
    expect(loadStoredMessageQueueState('s1')).toEqual({
      items: [{ id: 'q1', text: 'one' }],
      paused: true,
    })
  })

  it('is a no-op for empty or already paused queues', () => {
    const backing = stubLocalStorage()
    pauseStoredMessageQueue('s-empty')
    expect(loadStoredMessageQueueState('s-empty')).toEqual({ items: [], paused: false })
    expect(backing.has(STORAGE_KEY)).toBe(false)

    saveStoredMessageQueueState('s1', { items: [{ id: 'q1', text: 'one' }], paused: true })
    const raw = backing.get(STORAGE_KEY)
    pauseStoredMessageQueue('s1')
    // Already paused — no rewrite (updatedAt untouched).
    expect(backing.get(STORAGE_KEY)).toBe(raw)
  })
})
