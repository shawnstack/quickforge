// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LEASE_HEARTBEAT_MS,
  acquireLease,
  getClientId,
  leaseSnapshotFromWire,
  releaseLease,
  resetClientIdCache,
  takeOverLease,
} from '../../src/lib/session-lease-client'

/**
 * 会话写入租约的前端客户端契约。
 *
 * 重点是三件事：clientId 的标签页作用域（刷新不变、新标签页变）、
 * 409/网络失败都不允许被当成「可以写」，以及租约请求带上正确的头部。
 */
describe('session lease client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    sessionStorage.clear()
    resetClientIdCache()
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function jsonResponse(body, { ok = true, status = 200 } = {}) {
    return { ok, status, json: async () => body }
  }

  it('keeps one client id per tab across reads', () => {
    const first = getClientId()
    const second = getClientId()

    expect(first).toBeTruthy()
    expect(second).toBe(first)
    expect(sessionStorage.getItem('quickforge:client-id')).toBe(first)
  })

  it('reuses the persisted client id after a reload', () => {
    sessionStorage.setItem('quickforge:client-id', 'persisted-tab')
    resetClientIdCache()

    expect(getClientId()).toBe('persisted-tab')
  })

  it('falls back to a generated id when sessionStorage is unavailable', () => {
    const storage = window.sessionStorage
    // 隐私模式下写入会抛错；此时必须仍然拿到一个可用 id 而不是崩溃。
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('denied') },
    })
    resetClientIdCache()
    const id = getClientId()
    expect(id).toMatch(/^qf-|^[0-9a-f-]{8}/)

    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: storage })
    resetClientIdCache()
  })

  describe('leaseSnapshotFromWire', () => {
    it('treats an absent lease as writable (legacy behaviour)', () => {
      expect(leaseSnapshotFromWire(null, 'client-a')).toMatchObject({ status: 'owner', isOwner: true, holder: null })
      expect(leaseSnapshotFromWire(undefined, 'client-a').isOwner).toBe(true)
    })

    it('marks the holder as owner', () => {
      expect(leaseSnapshotFromWire({ clientId: 'client-a', expiresAt: 'x' }, 'client-a')).toMatchObject({
        status: 'owner',
        isOwner: true,
        holder: 'client-a',
        degraded: false,
      })
    })

    it('marks another client as observer', () => {
      expect(leaseSnapshotFromWire({ clientId: 'client-b' }, 'client-a')).toMatchObject({
        status: 'observer',
        isOwner: false,
        holder: 'client-b',
      })
    })
  })

  describe('acquireLease', () => {
    it('posts the client id as both header and body', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ lease: { clientId: getClientId() }, acquired: true }))

      const result = await acquireLease('', 'session-1')

      expect(result.ok).toBe(true)
      expect(result.snapshot.isOwner).toBe(true)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/agents/session-1/lease')
      expect(init.method).toBe('POST')
      expect(init.headers['x-quickforge-client-id']).toBe(getClientId())
      expect(JSON.parse(init.body)).toMatchObject({ clientId: getClientId(), takeover: false })
    })

    it('reports the holder as observer on 409 instead of assuming writability', async () => {
      fetchMock.mockResolvedValue(jsonResponse(
        { code: 'SESSION_LEASE_HELD', lease: { clientId: 'client-b' } },
        { ok: false, status: 409 },
      ))

      const result = await acquireLease('', 'session-1')

      expect(result.ok).toBe(false)
      expect(result.snapshot).toMatchObject({ status: 'observer', isOwner: false, holder: 'client-b', degraded: false })
    })

    it('degrades to read-only when the request fails outright', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))

      const result = await acquireLease('', 'session-1')

      expect(result.ok).toBe(false)
      // 网络失败不能假装拿到租约：否则会乐观地允许发送，最后被服务端 409 打回。
      expect(result.snapshot).toMatchObject({ status: 'unknown', isOwner: false, degraded: true })
    })

    it('degrades on an unexpected status', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, { ok: false, status: 500 }))

      const result = await acquireLease('', 'session-1')

      expect(result.snapshot).toMatchObject({ degraded: true, isOwner: false })
    })
  })

  it('sends takeover through the same endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ lease: { clientId: getClientId() } }))

    await takeOverLease('', 'session-1')

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toMatchObject({ takeover: true })
  })

  it('releases with DELETE and no body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ released: true }))

    const result = await releaseLease('', 'session-1')

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/agents/session-1/lease')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('encodes the session id in the lease URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ lease: null }))

    await acquireLease('', 'session with/slash')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/agents/session%20with%2Fslash/lease')
  })

  it('keeps the heartbeat well below the server TTL', () => {
    // 服务端 TTL 是 60s；心跳必须留出至少两次重试余量，否则一次网络抖动
    // 就会让持有者丢掉租约。
    expect(LEASE_HEARTBEAT_MS).toBeLessThanOrEqual(20_000)
  })
})
