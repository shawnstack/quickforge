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

function createAgent(options: { streaming?: boolean; failOn?: (text: string) => boolean; onPrompt?: (text: string) => void } = {}) {
  const calls: string[] = []
  const agent: QueueDrainAgent = {
    state: { isStreaming: options.streaming ?? false },
    prompt: (text: string) => {
      calls.push(text)
      options.onPrompt?.(text)
      return options.failOn?.(text) ? Promise.reject(new Error('prompt failed')) : Promise.resolve()
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
