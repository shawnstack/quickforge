import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SseConnectionStatus } from '../../src/lib/server-agent-types'

// Keep the legacy entry import real; only isolate its unrelated browser UI dependency.
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

class MockEventSource {
  static instances: MockEventSource[] = []
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, data: Record<string, unknown>) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  fail() {
    this.onerror?.(new Event('error'))
  }

  open() {
    this.onopen?.(new Event('open'))
  }
}

const subscriptions = new Set<() => void>()

function track(unsubscribe: () => void): () => void {
  subscriptions.add(unsubscribe)
  return () => {
    subscriptions.delete(unsubscribe)
    unsubscribe()
  }
}

function latestSource() {
  const source = MockEventSource.instances.at(-1)
  if (!source) throw new Error('Expected an EventSource instance')
  return source
}

describe('globalAgentSseClient', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    MockEventSource.instances = []
    vi.stubGlobal('location', { port: '5176', protocol: 'http:' })
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => (
      new Response(JSON.stringify({ ok: true, bootId: 'boot-1' }))
    )))
  })

  afterEach(async () => {
    for (const unsubscribe of subscriptions) unsubscribe()
    subscriptions.clear()
    await vi.advanceTimersByTimeAsync(0)
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shares one connection across multiple session subscriptions and routes only to matching sessions', async () => {
    const { globalAgentSseClient: client } = await import('../../src/lib/global-agent-sse-client')
    const first = vi.fn()
    const second = vi.fn()
    const sameSession = vi.fn()
    const stopFirst = track(client.subscribe('one', '', first))
    track(client.subscribe('two', '', second))
    track(client.subscribe('one', '', sameSession))

    expect(MockEventSource.instances).toHaveLength(1)
    const source = latestSource()
    expect(source.url).toBe('/api/agents/events')
    source.emit('agent_start', { sessionId: 'one' })
    expect(first).toHaveBeenCalledExactlyOnceWith({ type: 'agent_start', sessionId: 'one' })
    expect(sameSession).toHaveBeenCalledExactlyOnceWith({ type: 'agent_start', sessionId: 'one' })
    expect(second).not.toHaveBeenCalled()

    stopFirst()
    source.emit('agent_start', { sessionId: 'one' })
    source.emit('agent_start', { sessionId: 'two' })
    expect(first).toHaveBeenCalledOnce()
    expect(sameSession).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledExactlyOnceWith({ type: 'agent_start', sessionId: 'two' })
    expect(source.close).not.toHaveBeenCalled()
  })

  it('closes the connection only when the last session subscription is released', async () => {
    const { globalAgentSseClient: client } = await import('../../src/lib/global-agent-sse-client')
    const stopOne = track(client.subscribe('one', '', vi.fn()))
    const stopTwo = track(client.subscribe('two', '', vi.fn()))
    const source = latestSource()

    stopOne()
    expect(source.close).not.toHaveBeenCalled()
    stopTwo()
    expect(source.close).toHaveBeenCalledOnce()
    expect(client.getConnectionStatus()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a pending reconnect when the last subscription is released', async () => {
    const { globalAgentSseClient: client } = await import('../../src/lib/global-agent-sse-client')
    const stop = track(client.subscribe('one', '', vi.fn()))
    const source = latestSource()
    source.fail()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.close).toHaveBeenCalledOnce()
    expect(client.getConnectionStatus()).toMatchObject({ status: 'reconnecting', attempt: 1 })
    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(client.getConnectionStatus()).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(MockEventSource.instances).toHaveLength(1)
    expect(source.close).toHaveBeenCalledOnce()
  })

  it.each(['global', 'session'] as const)('isolates release of the %s subscription from the remaining subscriber', async (released) => {
    const { globalAgentSseClient: client, subscribeToAgentEvents } = await import('../../src/lib/global-agent-sse-client')
    const globalHandler = vi.fn()
    const sessionHandler = vi.fn()
    const stopGlobal = track(subscribeToAgentEvents(globalHandler))
    const stopSession = track(client.subscribe('one', '', sessionHandler))
    const source = latestSource()
    expect(MockEventSource.instances).toHaveLength(1)

    source.emit('agent_start', { sessionId: 'one' })
    expect(globalHandler).toHaveBeenCalledOnce()
    expect(sessionHandler).toHaveBeenCalledOnce()
    const stopReleased = released === 'global' ? stopGlobal : stopSession
    const stopRemaining = released === 'global' ? stopSession : stopGlobal
    const releasedHandler = released === 'global' ? globalHandler : sessionHandler
    const remainingHandler = released === 'global' ? sessionHandler : globalHandler
    stopReleased()
    expect(source.close).not.toHaveBeenCalled()
    source.emit('agent_end', { sessionId: 'one', messages: [] })
    expect(releasedHandler).toHaveBeenCalledOnce()
    expect(remainingHandler).toHaveBeenCalledTimes(2)
    expect(remainingHandler).toHaveBeenLastCalledWith({ type: 'agent_end', sessionId: 'one', messages: [] })
    stopRemaining()
    expect(source.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the getter consistent with callbacks through reconnect and recovery, and removes status listeners', async () => {
    const { globalAgentSseClient: client, getSseConnectionState, subscribeSseConnectionState } = await import('../../src/lib/global-agent-sse-client')
    const snapshots: Array<{ status: SseConnectionStatus; getter: SseConnectionStatus | null; clientGetter: SseConnectionStatus | null }> = []
    const handler = vi.fn((status: SseConnectionStatus) => {
      snapshots.push({ status, getter: getSseConnectionState(), clientGetter: client.getConnectionStatus() })
    })
    const stopStatus = track(subscribeSseConnectionState(handler))
    const stopSession = track(client.subscribe('one', '', vi.fn()))
    expect(getSseConnectionState()).toBeNull()
    expect(handler).not.toHaveBeenCalled()

    latestSource().fail()
    expect(handler).toHaveBeenLastCalledWith({
      status: 'reconnecting', attempt: 1, maxAttempts: 10, nextRetryAt: Date.now() + 1000,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(MockEventSource.instances).toHaveLength(2)
    latestSource().open()
    await vi.advanceTimersByTimeAsync(0)
    expect(handler).toHaveBeenLastCalledWith({ status: 'connected', recovered: true })
    expect(getSseConnectionState()).toEqual({ status: 'connected', recovered: true })
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    for (const snapshot of snapshots) {
      expect(snapshot.getter).toBe(snapshot.status)
      expect(snapshot.clientGetter).toBe(snapshot.status)
    }

    stopStatus()
    const calls = handler.mock.calls.length
    latestSource().fail()
    await vi.advanceTimersByTimeAsync(0)
    expect(getSseConnectionState()).toMatchObject({ status: 'reconnecting', attempt: 1 })
    expect(handler).toHaveBeenCalledTimes(calls)
    stopSession()
    expect(getSseConnectionState()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the legacy server-agent exports bound to the same singleton and working API', async () => {
    const direct = await import('../../src/lib/global-agent-sse-client')
    const legacy = await import('../../src/lib/server-agent')
    expect(legacy.MAX_SSE_RECONNECT_ATTEMPTS).toBe(direct.MAX_SSE_RECONNECT_ATTEMPTS)
    expect(legacy.subscribeToAgentEvents).toBe(direct.subscribeToAgentEvents)
    expect(legacy.subscribeSseConnectionState).toBe(direct.subscribeSseConnectionState)
    expect(legacy.getSseConnectionState).toBe(direct.getSseConnectionState)
    expect(legacy.requestSseReconnectNow).toBe(direct.requestSseReconnectNow)
    const handler = vi.fn()
    const statusHandler = vi.fn()
    track(legacy.subscribeToAgentEvents(handler))
    track(direct.globalAgentSseClient.subscribe('one', '', vi.fn()))
    track(legacy.subscribeSseConnectionState(statusHandler))
    expect(MockEventSource.instances).toHaveLength(1)
    latestSource().emit('agent_start', { sessionId: 'one' })
    expect(handler).toHaveBeenCalledExactlyOnceWith({ type: 'agent_start', sessionId: 'one' })

    latestSource().fail()
    await vi.advanceTimersByTimeAsync(0)
    expect(legacy.getSseConnectionState()).toBe(direct.getSseConnectionState())
    expect(statusHandler).toHaveBeenLastCalledWith(legacy.getSseConnectionState())
    legacy.requestSseReconnectNow()
    expect(MockEventSource.instances).toHaveLength(2)
    expect(legacy.getSseConnectionState()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(MockEventSource.instances).toHaveLength(2)
  })
})
