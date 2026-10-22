import { describe, expect, it, vi } from 'vitest'

import { SESSION_LEASE_TTL_MS, createSessionLeaseStore } from '../../server/session-lease.mjs'

/**
 * 会话写入租约的纯逻辑契约。
 *
 * 这里覆盖的是「谁可以写」的判定本身：租约的获取/续约/接管/释放、TTL 过期后
 * 可被抢占、非持有者被拒，以及广播只发生在易主时。路由层如何把 409 抛给
 * 客户端由 tests/server/routes/agent.test.mjs 覆盖。
 */
describe('session lease store', () => {
  function createStore(now = 1_000) {
    const published = []
    const store = createSessionLeaseStore({ publish: (sessionId, lease) => published.push({ sessionId, lease }) })
    return { store, published, now }
  }

  it('grants an unheld session and reports the acquire', () => {
    const { store, published } = createStore()
    const result = store.acquire('session-1', 'client-a', 1_000)

    expect(result.ok).toBe(true)
    expect(result.acquired).toBe(true)
    expect(result.lease).toMatchObject({ clientId: 'client-a' })
    expect(store.get('session-1', 1_000)).toMatchObject({ clientId: 'client-a' })
    expect(published).toEqual([{ sessionId: 'session-1', lease: expect.objectContaining({ clientId: 'client-a' }) }])
  })

  it('renews for the same client without rebroadcasting', () => {
    const { store, published } = createStore()
    store.acquire('session-1', 'client-a', 1_000)
    const renewed = store.acquire('session-1', 'client-a', 2_000)

    expect(renewed.ok).toBe(true)
    expect(renewed.acquired).toBe(false)
    expect(renewed.lease.expiresAt).toBe(new Date(2_000 + SESSION_LEASE_TTL_MS).toISOString())
    // 续约不改变持有者，因此不广播：旁观者的只读态没有变化。
    expect(published).toHaveLength(1)
  })

  it('rejects a second client while the holder is live', () => {
    const { store } = createStore()
    store.acquire('session-1', 'client-a', 1_000)

    const result = store.acquire('session-1', 'client-b', 1_500)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('held')
    expect(result.holder).toBe('client-a')
    expect(store.canWrite('session-1', 'client-b', 1_500)).toMatchObject({ ok: false, holder: 'client-a' })
  })

  it('lets another client take the lease once the holder expires', () => {
    const { store } = createStore()
    store.acquire('session-1', 'client-a', 1_000)

    // 刚好到期即可抢占：客户端崩溃/关标签页不能把会话永久锁死。
    const result = store.acquire('session-1', 'client-b', 1_000 + SESSION_LEASE_TTL_MS)

    expect(result.ok).toBe(true)
    expect(result.acquired).toBe(true)
    expect(store.get('session-1', 1_000 + SESSION_LEASE_TTL_MS)).toMatchObject({ clientId: 'client-b' })
  })

  it('treats an expired lease as unheld for reads and writes', () => {
    const { store } = createStore()
    store.acquire('session-1', 'client-a', 1_000)
    const afterExpiry = 1_000 + SESSION_LEASE_TTL_MS + 1

    expect(store.get('session-1', afterExpiry)).toBeNull()
    // 无有效租约 = 沿用旧的「谁都能写」行为，不会因为一份过期记录卡住写入。
    expect(store.canWrite('session-1', 'client-b', afterExpiry)).toMatchObject({ ok: true })
  })

  it('force-takes on an explicit takeover and rebroadcasts', () => {
    const { store, published } = createStore()
    store.acquire('session-1', 'client-a', 1_000)
    const taken = store.forceTake('session-1', 'client-b', 1_100)

    expect(taken.ok).toBe(true)
    expect(taken.lease.clientId).toBe('client-b')
    expect(store.get('session-1', 1_100)).toMatchObject({ clientId: 'client-b' })
    expect(published).toHaveLength(2)
    expect(published[1].lease).toMatchObject({ clientId: 'client-b' })
  })

  it('only lets the holder release', () => {
    const { store, published } = createStore()
    store.acquire('session-1', 'client-a', 1_000)

    const foreign = store.release('session-1', 'client-b')
    expect(foreign).toMatchObject({ ok: false, holder: 'client-a' })
    expect(store.get('session-1', 1_100)).toMatchObject({ clientId: 'client-a' })

    const own = store.release('session-1', 'client-a')
    expect(own).toMatchObject({ ok: true, released: true })
    expect(store.get('session-1', 1_100)).toBeNull()
    expect(published.at(-1)).toEqual({ sessionId: 'session-1', lease: null })
  })

  it('rejects an unusable client id instead of silently allowing writes', () => {
    const { store } = createStore()

    expect(store.acquire('session-1', '', 1_000)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(store.acquire('session-1', '   ', 1_000)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(store.acquire('session-1', 'x'.repeat(200), 1_000)).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('a client id is trimmed before use', () => {
    const { store } = createStore()
    store.acquire('session-1', '  client-a  ', 1_000)

    expect(store.get('session-1', 1_000)).toMatchObject({ clientId: 'client-a' })
    expect(store.canWrite('session-1', 'client-a', 1_000)).toMatchObject({ ok: true })
  })

  it('a non-owning caller without a client id is rejected while a lease is held', () => {
    const { store } = createStore()
    store.acquire('session-1', 'client-a', 1_000)

    // 后台调用方（ACP / 定时任务）不带 clientId；只要有人持有租约就不该写，
    // 否则租约形同虚设。
    expect(store.canWrite('session-1', null, 1_000)).toMatchObject({ ok: false, holder: 'client-a' })
  })

  it('clear removes the lease and only honours the matching fence', () => {
    const { store } = createStore()
    const acquired = store.acquire('session-1', 'client-a', 1_000)

    // 跨代误释放：旧连接的 fence 与当前不一致时不能清掉新租约。
    expect(store.clear('session-1', { fence: acquired.lease.fence - 1 })).toBe(false)
    expect(store.get('session-1', 1_000)).toMatchObject({ clientId: 'client-a' })

    expect(store.clear('session-1', { fence: acquired.lease.fence })).toBe(true)
    expect(store.get('session-1', 1_000)).toBeNull()
  })

  it('clear({ force }) removes the lease regardless of fence', () => {
    const { store } = createStore()
    store.acquire('session-1', 'client-a', 1_000)

    expect(store.clear('session-1', { force: true })).toBe(true)
    expect(store.get('session-1', 1_000)).toBeNull()
    expect(store.size()).toBe(0)
  })

  it('keeps sessions independent', () => {
    const { store } = createStore()
    store.acquire('session-1', 'client-a', 1_000)
    store.acquire('session-2', 'client-b', 1_000)

    expect(store.canWrite('session-1', 'client-b', 1_000)).toMatchObject({ ok: false })
    expect(store.canWrite('session-2', 'client-b', 1_000)).toMatchObject({ ok: true })
  })

  it('swallows publish failures so a broken bus cannot block a write', () => {
    const store = createSessionLeaseStore({
      publish: () => {
        throw new Error('bus down')
      },
    })

    expect(() => store.acquire('session-1', 'client-a', 1_000)).not.toThrow()
    expect(store.get('session-1', 1_000)).toMatchObject({ clientId: 'client-a' })
  })

  it('defaults the publish hook to a no-op', () => {
    const store = createSessionLeaseStore()
    expect(() => store.acquire('session-1', 'client-a', 1_000)).not.toThrow()
    expect(store.get('session-1', 1_000)).toMatchObject({ clientId: 'client-a' })
  })

  it('honours a custom ttl', () => {
    const store = createSessionLeaseStore({ ttlMs: 5_000 })

    expect(store.ttlMs).toBe(5_000)
    store.acquire('session-1', 'client-a', 1_000)
    expect(store.get('session-1', 6_000)).toBeNull()
  })
})

describe('session lease store publish hook', () => {
  it('does not publish renewals but does publish takeovers', () => {
    const publish = vi.fn()
    const store = createSessionLeaseStore({ publish })

    store.acquire('session-1', 'client-a', 1_000)
    store.acquire('session-1', 'client-a', 2_000)
    expect(publish).toHaveBeenCalledTimes(1)

    store.forceTake('session-1', 'client-b', 3_000)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ clientId: 'client-b' }))
  })
})
