import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const wire = vi.hoisted(() => ({
  handler: undefined as ((event: Record<string, unknown>) => void) | undefined,
  unsubscribe: vi.fn(),
}))

vi.mock('../../src/lib/global-agent-sse-client', () => ({
  globalAgentSseClient: {
    subscribe: (_sessionId: string, _baseUrl: string, handler: (event: Record<string, unknown>) => void) => {
      wire.handler = handler
      return wire.unsubscribe
    },
  },
}))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/session-message-cache', () => ({
  resolveServerCacheKey: () => 'test',
  readSessionMessageSnapshot: async () => null,
  writeSessionMessageSnapshot: vi.fn(),
}))

import { ServerAgent, type ServerAgentEvent } from '../../src/lib/server-agent'

function send(event: Record<string, unknown>): void {
  if (!wire.handler) throw new Error('Expected a wire subscriber')
  wire.handler(event)
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('ServerAgent event boundary', () => {
  let agent: ServerAgent

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    agent = new ServerAgent({ sessionId: 'event-contract', initialState: { messages: [] } })
  })

  afterEach(() => {
    agent.dispose()
    vi.unstubAllGlobals()
  })

  it('keeps legacy listener identity, synchronous order, exception isolation and either duplicate unsubscribe', () => {
    const calls: string[] = []
    const first = vi.fn(() => { calls.push('first'); throw new Error('listener failure') })
    const second = vi.fn(() => { calls.push('second') })
    const offFirst = agent.subscribe(first)
    const offDuplicate = agent.subscribe(first)
    const offSecond = agent.subscribe(second)
    send({ type: 'future_event' })
    expect(calls).toEqual(['first', 'second'])
    expect(first).toHaveBeenCalledTimes(1)

    offDuplicate()
    send({ type: 'future_event' })
    expect(calls).toEqual(['first', 'second', 'second'])
    agent.subscribe(first)
    send({ type: 'future_event' })
    expect(calls.slice(-2)).toEqual(['second', 'first'])
    // Like Set.delete(listener), an old unsubscribe removes a re-subscription.
    offFirst()
    offSecond()
    send({ type: 'future_event' })
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(3)
  })

  it('preserves live Set iteration when listeners unsubscribe, subscribe and dispose during dispatch', () => {
    const calls: string[] = []
    const third = () => { calls.push('third'); agent.dispose() }
    const fourth = () => { calls.push('fourth') }
    let offSecond = () => {}
    agent.subscribe(() => {
      calls.push('first')
      offSecond()
      agent.subscribe(third)
      agent.subscribe(fourth)
    })
    offSecond = agent.subscribe(() => { calls.push('second') })
    send({ type: 'future_event' })
    expect(calls).toEqual(['first', 'third'])
    expect(wire.unsubscribe).toHaveBeenCalledTimes(1)
    send({ type: 'future_event' })
    expect(calls).toEqual(['first', 'third'])
  })

  it('forwards standard, custom and unknown wire objects without cloning or filtering', () => {
    const received: AgentEvent[] = []
    agent.subscribe((event) => { received.push(event) })
    const message: AgentMessage = { role: 'user', content: 'hello', timestamp: 1 }
    const events = [
      { type: 'message_start', message },
      { type: 'error', error: 'server error' },
      { type: 'goal_updated' },
      { type: 'message_metadata_updated' },
      { type: 'future_event', future: { nested: true } },
      { type: 42, future: 'not a validated discriminant' },
      { future: 'no type' },
    ]
    for (const event of events) send(event)
    expect(received).toHaveLength(events.length)
    events.forEach((event, index) => { expect(received[index]).toBe(event) })
    expect(received[0]).toHaveProperty('message', message)
  })

  it('keeps a summary-only agent_end frame unchanged after asynchronous reconciliation', async () => {
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((done) => { resolve = done })))
    const received: AgentEvent[] = []
    const honest: ServerAgentEvent[] = []
    agent.subscribe((event) => { received.push(event) })
    agent.subscribeEvents((event) => { honest.push(event) })
    const frame = { type: 'agent_end', messagesSummary: { count: 1 }, extra: 'original' }
    send(frame)
    expect(received).toEqual([])
    const message = { role: 'user', content: 'reconciled', timestamp: 1 }
    resolve({ ok: true, status: 200, json: async () => ({ messages: [message] }) })
    await settle()
    expect(agent.state.messages).toEqual([message])
    expect(received.filter((event) => event.type === 'agent_end')).toEqual([frame])
    expect(received.at(-1)).toBe(frame)
    expect(frame).not.toHaveProperty('messages')
    expect(honest.at(-1)).toBe(frame)
  })

  it.each(['message_end', 'turn_end', 'agent_end'])('forwards the original %s fallback frame only after HTTP refresh', async (type) => {
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((done) => { resolve = done })))
    const legacy: AgentEvent[] = []
    const honest: ServerAgentEvent[] = []
    agent.subscribe((event) => { legacy.push(event) })
    agent.subscribeEvents((event) => { honest.push(event) })
    const frame = { type, opaqueExtension: { preserved: true } }
    send(frame)
    expect(honest).toEqual([])
    resolve({ ok: true, status: 200, json: async () => ({ messages: [{ role: 'user', content: 'refreshed', timestamp: 1 }] }) })
    await settle()
    expect(legacy.at(-1)).toBe(frame)
    expect(honest.at(-1)).toBe(frame)
    expect(frame).not.toHaveProperty('message')
    expect(frame).not.toHaveProperty('messages')
  })

  it('clears both APIs subscribers before a pending reconciliation completes on dispose', async () => {
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((done) => { resolve = done })))
    const legacy = vi.fn()
    const honest = vi.fn()
    agent.subscribe(legacy)
    agent.subscribeEvents(honest)
    send({ type: 'agent_end', messagesSummary: { count: 1 } })
    agent.dispose()
    resolve({ ok: true, status: 200, json: async () => ({ messages: [{ role: 'user', content: 'late', timestamp: 1 }] }) })
    await settle()
    expect(legacy).not.toHaveBeenCalled()
    expect(honest).not.toHaveBeenCalled()
  })

  it('shares locally normalized goal changes without altering raw goal frames', () => {
    const legacy: AgentEvent[] = []
    const honest: ServerAgentEvent[] = []
    agent.subscribe((event) => { legacy.push(event) })
    agent.subscribeEvents((event) => { honest.push(event) })
    const goal = {
      id: 'goal-1', objective: 'test goal', status: 'planning', revision: 1,
      budget: { maxIterations: 20, maxActiveDurationMs: null },
      usage: { iterations: 0, activeDurationMs: 0 }, evidence: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    send({ type: 'state', goal })
    expect(honest).toEqual([{ type: 'goal_updated', goal: agent.state.goal }])
    expect(agent.state.goal?.id).toBe('goal-1')
    expect(honest[0]).toBe(legacy[0])
    const frame = { type: 'goal_updated', goal: { ...goal, revision: 2 }, futureField: true }
    send(frame)
    expect(honest.at(-1)).toBe(frame)
    expect(legacy.at(-1)).toBe(frame)
  })

  it('deduplicates both APIs by listener identity in global registration order and clears both on dispose', () => {
    const calls: string[] = []
    const shared = vi.fn((event: ServerAgentEvent) => { void event; calls.push('shared') })
    const legacy = vi.fn(() => { calls.push('legacy') })
    const honest = vi.fn(() => { calls.push('honest'); throw new Error('honest listener failure') })
    agent.subscribe(legacy)
    const offShared = agent.subscribeEvents(shared)
    agent.subscribe(shared)
    const offHonest = agent.subscribeEvents(honest)
    const offDuplicate = agent.subscribeEvents(honest)
    send({ type: 'future_event' })
    expect(calls).toEqual(['legacy', 'shared', 'honest'])
    offDuplicate()
    offShared()
    agent.subscribeEvents(shared)
    offShared()
    offHonest()
    send({ type: 'future_event' })
    expect(calls).toEqual(['legacy', 'shared', 'honest', 'legacy'])
    agent.subscribeEvents(honest)
    agent.dispose()
    send({ type: 'future_event' })
    expect(calls).toHaveLength(4)
    expect(wire.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('shares original wire event and nested message identities across APIs, including unknown frames', () => {
    const legacy: AgentEvent[] = []
    const honest: ServerAgentEvent[] = []
    agent.subscribe((event) => { legacy.push(event) })
    agent.subscribeEvents((event) => { honest.push(event) })
    const message: AgentMessage = { role: 'user', content: 'wire', timestamp: 1 }
    const events = [
      { type: 'message_start', message },
      { type: 'message_end', message },
      { type: 'agent_end', messages: [message] },
      { type: 'error', error: 'wire error' },
      { type: 'goal_updated' },
      { type: 'message_metadata_updated' },
      { type: 'future_event', payload: { unexpected: true } },
      { type: 42 },
      { future: true },
    ]
    for (const event of events) send(event)
    expect(honest).toHaveLength(events.length)
    events.forEach((event, index) => {
      expect(legacy[index]).toBe(event)
      expect(honest[index]).toBe(event)
    })
    expect(honest[0]).toHaveProperty('message', message)
    expect(agent.state.messages[0]).toBe(message)
  })

  it('shares locally constructed standard events and missing-message notifications without filling payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'steer failed' }) }))
    const legacy: AgentEvent[] = []
    const honest: ServerAgentEvent[] = []
    agent.subscribe((event) => { legacy.push(event) })
    agent.subscribeEvents((event) => { honest.push(event) })
    const message: AgentMessage = { role: 'user', content: 'local', timestamp: 1 }
    await expect(agent.steer(message)).rejects.toThrow('Failed to steer: HTTP 500')
    expect(honest).toEqual([{ type: 'message_start', message }, { type: 'message_start' }])
    honest.forEach((event, index) => { expect(event).toBe(legacy[index]) })
    expect(honest[0]).toHaveProperty('message', message)
    expect(honest[1]).not.toHaveProperty('message')
  })

  it('shares local prompt errors and error agent_end without dropping extensions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'prompt failed' }) }))
    const legacy: AgentEvent[] = []
    const honest: ServerAgentEvent[] = []
    agent.subscribe((event) => { legacy.push(event) })
    agent.subscribeEvents((event) => { honest.push(event) })
    await agent.prompt('hello')
    await settle()
    expect(honest.map((event) => event.type)).toEqual(['message_start', 'agent_start', 'error', 'agent_end'])
    expect(honest.at(-2)).toEqual({ type: 'error', error: 'prompt failed' })
    expect(honest.at(-1)).toEqual({ type: 'agent_end', messages: agent.state.messages, errorMessage: 'prompt failed', status: 'error' })
    honest.forEach((event, index) => { expect(event).toBe(legacy[index]) })
  })

  it('shares local metadata, message_update and message_end invalidations from HTTP refresh', async () => {
    const legacy: AgentEvent[] = []
    const honest: ServerAgentEvent[] = []
    agent.subscribe((event) => { legacy.push(event) })
    agent.subscribeEvents((event) => { honest.push(event) })
    const message: AgentMessage = { role: 'user', content: 'from state', timestamp: 1 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [message], isStreaming: true }) }))
    await agent.syncState()
    expect(honest.map((event) => event.type)).toContain('message_metadata_updated')
    expect(honest.at(-1)).toEqual({ type: 'message_update', message })
    expect(honest.at(-1)).not.toHaveProperty('assistantMessageEvent')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [message], isStreaming: false }) }))
    await agent.syncState()
    await agent.syncState()
    expect(honest.at(-1)).toEqual({ type: 'message_end' })
    expect(honest.at(-1)).not.toHaveProperty('message')
    honest.forEach((event, index) => { expect(event).toBe(legacy[index]) })
  })
})
