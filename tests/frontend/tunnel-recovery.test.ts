import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoverTunnelConnection, TUNNEL_RECOVERED_EVENT, type TunnelRecoveredEventDetail } from '../../src/lib/tunnel-recovery'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

function okFetch(sessions: unknown[] = []) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url)
    if (path === '/api/health') return jsonResponse({ ok: true })
    if (path === '/api/agents') return jsonResponse({ sessions })
    return jsonResponse(null, false)
  })
}

/**
 * 构造一个会透传 quickforge:tunnel-recovered detail 的 dispatch：
 * 通过 registerWaitUntil 回调拿到 waitUntil 后按测试需要注册任务。
 */
function recoveringDispatch(registerWaitUntil?: (waitUntil: (task: Promise<unknown>) => void) => void) {
  return vi.fn((event: Event) => {
    if (event.type === TUNNEL_RECOVERED_EVENT) {
      const detail = (event as CustomEvent<TunnelRecoveredEventDetail>).detail
      registerWaitUntil?.(detail.waitUntil)
    }
    return true
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tunnel recovery coordinator', () => {
  it('probe 未就绪时返回 deferred(probe-failed) 且不 reload、不派发事件', async () => {
    const reload = vi.fn()
    const dispatch = vi.fn()
    const result = await recoverTunnelConnection({
      probe: async () => false,
      reload,
      dispatchEvent: dispatch,
    })
    expect(result).toEqual({ status: 'deferred', reason: 'probe-failed' })
    expect(reload).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('对账通过但无人注册 waitUntil 时视为没有恢复监听者，reload 兜底', async () => {
    const reload = vi.fn()
    const result = await recoverTunnelConnection({
      probe: async () => true,
      fetchImpl: okFetch() as unknown as typeof fetch,
      reload,
      dispatchEvent: () => true, // 不注册 waitUntil
    })
    expect(result).toEqual({ status: 'reloaded' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('waitUntil 任务全部成功则免刷新恢复：不 reload，派发 online + quickforge:tunnel-recovered', async () => {
    const reload = vi.fn()
    const dispatched: string[] = []
    const fetchMock = okFetch([{ sessionId: 's1', status: 'idle' }])
    const result = await recoverTunnelConnection({
      probe: async () => true,
      fetchImpl: fetchMock as unknown as typeof fetch,
      reload,
      dispatchEvent: (event) => {
        dispatched.push(event.type)
        if (event.type === TUNNEL_RECOVERED_EVENT) {
          const detail = (event as CustomEvent<TunnelRecoveredEventDetail>).detail
          detail.waitUntil(Promise.resolve())
          detail.waitUntil(Promise.resolve('background-session-synced'))
        }
        return true
      },
    })
    expect(result).toEqual({ status: 'recovered' })
    expect(reload).not.toHaveBeenCalled()
    expect(dispatched).toEqual(['online', TUNNEL_RECOVERED_EVENT])
    // 对账请求：/api/health + /api/agents 各一次
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('waitUntil 任务任一 reject 则 reload 兜底', async () => {
    const reload = vi.fn()
    const result = await recoverTunnelConnection({
      probe: async () => true,
      fetchImpl: okFetch() as unknown as typeof fetch,
      reload,
      dispatchEvent: (event) => {
        if (event.type === TUNNEL_RECOVERED_EVENT) {
          const detail = (event as CustomEvent<TunnelRecoveredEventDetail>).detail
          detail.waitUntil(Promise.reject(new Error('agent state sync failed')))
        }
        return true
      },
    })
    expect(result).toEqual({ status: 'reloaded' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('waitUntil 任务超过 recoveryWaitTimeoutMs 仍未完成则 reload 兜底', async () => {
    const reload = vi.fn()
    let resolveTask!: () => void
    const gate = new Promise<void>((resolve) => {
      resolveTask = resolve
    })
    const result = await recoverTunnelConnection({
      probe: async () => true,
      fetchImpl: okFetch() as unknown as typeof fetch,
      reload,
      dispatchEvent: (event) => {
        if (event.type === TUNNEL_RECOVERED_EVENT) {
          const detail = (event as CustomEvent<TunnelRecoveredEventDetail>).detail
          detail.waitUntil(gate) // 永不 resolve 的任务
        }
        return true
      },
      recoveryWaitTimeoutMs: 20,
    })
    expect(result).toEqual({ status: 'reloaded' })
    expect(reload).toHaveBeenCalledTimes(1)
    resolveTask()
  })

  it('对账失败后最多重试一次，仍失败则 reload 兜底', async () => {
    const reload = vi.fn()
    const fetchMock = vi.fn(async () => jsonResponse(null, false))
    const result = await recoverTunnelConnection({
      probe: async () => true,
      fetchImpl: fetchMock as unknown as typeof fetch,
      reload,
      retryDelayMs: 0,
    })
    expect(result).toEqual({ status: 'reloaded' })
    expect(reload).toHaveBeenCalledTimes(1)
    // 首次 + 重试一次 = 2 次对账，每次请求 health + agents 两个端点
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('对账失败重试一次后成功则免刷新恢复（不误 reload）', async () => {
    const reload = vi.fn()
    let calls = 0
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      calls += 1
      if (calls <= 2) return jsonResponse(null, false) // 首次对账两个请求都失败
      const path = String(url)
      if (path === '/api/health') return jsonResponse({ ok: true })
      return jsonResponse({ sessions: [] })
    })
    const result = await recoverTunnelConnection({
      probe: async () => true,
      fetchImpl: fetchMock as unknown as typeof fetch,
      reload,
      dispatchEvent: (event) => {
        if (event.type === TUNNEL_RECOVERED_EVENT) {
          const detail = (event as CustomEvent<TunnelRecoveredEventDetail>).detail
          detail.waitUntil(Promise.resolve())
        }
        return true
      },
      retryDelayMs: 0,
    })
    expect(result).toEqual({ status: 'recovered' })
    expect(reload).not.toHaveBeenCalled()
  })

  it('事件派发抛错时不声称已恢复，走 reload 兜底', async () => {
    const reload = vi.fn()
    const result = await recoverTunnelConnection({
      probe: async () => true,
      fetchImpl: okFetch() as unknown as typeof fetch,
      reload,
      dispatchEvent: () => {
        throw new Error('listener boom')
      },
    })
    expect(result).toEqual({ status: 'reloaded' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('防重入：恢复流程在跑时再次调用返回 deferred(in-flight)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetchMock = vi.fn(async () => {
      await gate
      return jsonResponse({ sessions: [] })
    })
    const reload = vi.fn()
    const dispatch = recoveringDispatch((waitUntil) => waitUntil(Promise.resolve()))

    const first = recoverTunnelConnection({
      probe: async () => true,
      fetchImpl: fetchMock as unknown as typeof fetch,
      reload,
      dispatchEvent: dispatch,
    })
    const second = await recoverTunnelConnection({ probe: async () => true, reload })
    expect(second).toEqual({ status: 'deferred', reason: 'in-flight' })

    release()
    const firstResult = await first
    expect(firstResult).toEqual({ status: 'recovered' })
    expect(reload).not.toHaveBeenCalled()
  })
})
