// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ServerAgent 侧的会话租约行为：
 * - 未启用租约时完全沿用旧行为（任何写请求照发）；
 * - 启用后，非持有者的写请求必须被本地拦下，一个网络请求都不发；
 * - `session_lease` SSE 帧与心跳结果都能把本页切进/切出只读；
 * - dispose 释放租约，让另一个窗口立刻可写。
 */
const sse = vi.hoisted(() => ({ handlers: new Map() }))

vi.mock('../../src/lib/global-agent-sse-client', () => ({
  globalAgentSseClient: {
    subscribe: (sessionId, baseUrl, handler) => {
      const set = sse.handlers.get(sessionId) ?? new Set()
      set.add(handler)
      sse.handlers.set(sessionId, set)
      return () => set.delete(handler)
    },
  },
  subscribeToAgentEvents: () => () => {},
  subscribeSseConnectionState: () => () => {},
  getSseConnectionState: () => null,
  requestSseReconnectNow: () => {},
}))

vi.mock('../../src/lib/i18n', () => ({
  t: (key) => key,
}))

const leaseMocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  takeOverLease: vi.fn(),
  releaseLease: vi.fn(),
  getClientId: vi.fn(() => 'client-a'),
}))

vi.mock('../../src/lib/session-lease-client', async () => {
  const actual = await vi.importActual('../../src/lib/session-lease-client')
  return {
    ...actual,
    acquireLease: leaseMocks.acquireLease,
    takeOverLease: leaseMocks.takeOverLease,
    releaseLease: leaseMocks.releaseLease,
    getClientId: leaseMocks.getClientId,
  }
})

import { ServerAgent } from '../../src/lib/server-agent'

function emitSse(sessionId, event) {
  for (const handler of sse.handlers.get(sessionId) ?? []) handler(event)
}

const OWNER = { status: 'owner', holder: 'client-a', isOwner: true, degraded: false }
const OBSERVER = { status: 'observer', holder: 'client-b', isOwner: false, degraded: false }

describe('ServerAgent session lease', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    sse.handlers.clear()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    leaseMocks.acquireLease.mockReset()
    leaseMocks.takeOverLease.mockReset()
    leaseMocks.releaseLease.mockReset()
    leaseMocks.acquireLease.mockResolvedValue({ ok: true, snapshot: OWNER })
    leaseMocks.releaseLease.mockResolvedValue({ ok: true, snapshot: { ...OWNER, isOwner: false, holder: null } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function createAgent() {
    return new ServerAgent({ sessionId: 'session-1', baseUrl: '', initialState: {} })
  }

  it('leaves writes untouched when the lease is never enabled', async () => {
    const agent = createAgent()

    await agent.prompt('hello')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/agents/session-1/prompt')
    // 未启用租约的视图（只读/分享/ACP）不应携带客户端标识，也不该多发请求。
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-quickforge-client-id')
    expect(leaseMocks.acquireLease).not.toHaveBeenCalled()
  })

  it('claims the lease on enable and renews on the heartbeat', async () => {
    vi.useFakeTimers()
    const agent = createAgent()

    agent.enableSessionLease()
    await vi.advanceTimersByTimeAsync(0)
    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(1)
    expect(agent.canWrite()).toBe(true)

    await vi.advanceTimersByTimeAsync(20_000)
    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(2)

    agent.dispose()
  })

  it('sends the client id header on writes once the lease is enabled', async () => {
    const agent = createAgent()
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(true))

    await agent.prompt('hello')

    const promptCall = fetchMock.mock.calls.find(([url]) => url === '/api/agents/session-1/prompt')
    expect(promptCall[1].headers['x-quickforge-client-id']).toBe('client-a')
    agent.dispose()
  })

  it('sends the client id header when aborting so the lease guard accepts it', async () => {
    const agent = createAgent()
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(true))

    agent.abort()

    const abortCall = fetchMock.mock.calls.find(([url]) => url === '/api/agents/session-1/abort')
    expect(abortCall).toBeTruthy()
    expect(abortCall[1].method).toBe('POST')
    // abort 路由同样有 assertSessionWriteAccess 守卫：缺这个头会 409 SESSION_LEASE_HELD，
    // 请求被静默拒绝后运行仍在继续。
    expect(abortCall[1].headers['x-quickforge-client-id']).toBe('client-a')
    agent.dispose()
  })

  it('sends the client id header when continuing (retry) without an appended message', async () => {
    const agent = createAgent()
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(true))

    await agent.continue()

    const continueCall = fetchMock.mock.calls.find(([url]) => url === '/api/agents/session-1/continue')
    expect(continueCall).toBeTruthy()
    expect(continueCall[1].method).toBe('POST')
    // continue 路由（消息「重试」实际走的写入口）同样有 assertSessionWriteAccess 守卫。
    // 裁剪重生成这种不带 body 的形态也必须带客户端头，否则本页明明持有租约却会被
    // 服务端判成匿名客户端，直接 409 "This session is open for writing in another window"。
    expect(continueCall[1].headers['x-quickforge-client-id']).toBe('client-a')
    agent.dispose()
  })

  it('sends the client id header when continuing with an appended message', async () => {
    const agent = createAgent()
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(true))

    await agent.continue({ role: 'user', content: 'continue' })

    const continueCall = fetchMock.mock.calls.find(([url]) => url === '/api/agents/session-1/continue')
    expect(continueCall[1].headers['x-quickforge-client-id']).toBe('client-a')
    expect(continueCall[1].body).toBe(JSON.stringify({ message: { role: 'user', content: 'continue' } }))
    agent.dispose()
  })

  it('drops a prompt locally when another window holds the lease', async () => {
    const agent = createAgent()
    leaseMocks.acquireLease.mockResolvedValue({ ok: false, snapshot: OBSERVER })
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(false))

    await agent.prompt('hello')

    // 服务端会以 409 拒绝；本地必须一个请求都不发，否则会先乐观插入一条
    // 最终被回滚的用户消息，界面闪一下。
    expect(fetchMock).not.toHaveBeenCalled()
    expect(agent.state.messages).toHaveLength(0)
    agent.dispose()
  })

  it('blocks the other write entry points too', async () => {
    const agent = createAgent()
    leaseMocks.acquireLease.mockResolvedValue({ ok: false, snapshot: OBSERVER })
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(false))

    agent.abort()
    agent.followUp({ role: 'user', content: 'x' })
    await agent.steer({ role: 'user', content: 'x' })
    await agent.updateAccessMode('full-access')
    await agent.updateModel({ id: 'm', provider: 'p' })
    await agent.updateThinkingLevel('high')
    await expect(agent.rollback(0)).rejects.toThrow()
    // 消息「重试」走 continue：旁观者必须本地拦截，否则会先乐观追加「继续」
    // 消息再被服务端 409 打回，界面闪一下。
    await expect(agent.continue()).rejects.toThrow()

    expect(fetchMock).not.toHaveBeenCalled()
    agent.dispose()
  })

  it('flips to observer when another client takes the lease over', async () => {
    const agent = createAgent()
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(true))

    emitSse('session-1', { type: 'session_lease', lease: { clientId: 'client-b' } })

    expect(agent.state.sessionLease).toMatchObject({ status: 'observer', holder: 'client-b', isOwner: false })
    expect(agent.canWrite()).toBe(false)
    agent.dispose()
  })

  it('flips back to owner when the other client releases', async () => {
    const agent = createAgent()
    leaseMocks.acquireLease.mockResolvedValue({ ok: false, snapshot: OBSERVER })
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(false))

    emitSse('session-1', { type: 'session_lease', lease: null })

    expect(agent.state.sessionLease).toMatchObject({ status: 'owner', holder: null, isOwner: true })
    expect(agent.canWrite()).toBe(true)
    agent.dispose()
  })

  it('notifies listeners on a lease change but stays silent on a repeat frame', async () => {
    const agent = createAgent()
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(true))
    const events = []
    agent.subscribe((event) => events.push(event.type))

    emitSse('session-1', { type: 'session_lease', lease: { clientId: 'client-b' } })
    emitSse('session-1', { type: 'session_lease', lease: { clientId: 'client-b' } })

    expect(events.filter((type) => type === 'session_lease')).toHaveLength(1)
    agent.dispose()
  })

  it('takes the lease over on request', async () => {
    const agent = createAgent()
    leaseMocks.acquireLease.mockResolvedValue({ ok: false, snapshot: OBSERVER })
    agent.enableSessionLease()
    await vi.waitFor(() => expect(agent.canWrite()).toBe(false))

    leaseMocks.takeOverLease.mockResolvedValue({ ok: true, snapshot: OWNER })
    await expect(agent.takeOverSessionLease()).resolves.toBe(true)

    expect(agent.canWrite()).toBe(true)
    agent.dispose()
  })

  it('releases the lease on dispose and stops the heartbeat', async () => {
    vi.useFakeTimers()
    const agent = createAgent()
    agent.enableSessionLease()
    await vi.advanceTimersByTimeAsync(0)

    agent.dispose()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(leaseMocks.releaseLease).toHaveBeenCalledWith('', 'session-1')
    // 释放后心跳必须停：否则定时器会在已销毁的 agent 上继续打服务端。
    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(1)
  })

  it('does not probe the lease twice when enable is called again', async () => {
    vi.useFakeTimers()
    const agent = createAgent()

    agent.enableSessionLease()
    agent.enableSessionLease()
    await vi.advanceTimersByTimeAsync(0)

    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(1)
    agent.dispose()
  })
})
