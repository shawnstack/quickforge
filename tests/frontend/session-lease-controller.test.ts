import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionLeaseSnapshot } from '../../src/lib/session-lease-client'

const leaseMocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  takeOverLease: vi.fn(),
  releaseLease: vi.fn(),
  getClientId: vi.fn(() => 'client-a'),
  leaseSnapshotFromWire: vi.fn(),
}))

vi.mock('../../src/lib/session-lease-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/session-lease-client')>('../../src/lib/session-lease-client')
  return {
    ...actual,
    acquireLease: leaseMocks.acquireLease,
    takeOverLease: leaseMocks.takeOverLease,
    releaseLease: leaseMocks.releaseLease,
    getClientId: leaseMocks.getClientId,
    leaseSnapshotFromWire: leaseMocks.leaseSnapshotFromWire,
  }
})

import { SessionLeaseController } from '../../src/lib/session-lease-controller'

const OWNER: SessionLeaseSnapshot = { status: 'owner', holder: 'client-a', isOwner: true, degraded: false }
const OBSERVER: SessionLeaseSnapshot = { status: 'observer', holder: 'client-b', isOwner: false, degraded: false }

function createController() {
  let snapshot: SessionLeaseSnapshot | undefined
  let disposed = false
  const applied: SessionLeaseSnapshot[] = []
  const controller = new SessionLeaseController({
    baseUrl: '',
    sessionId: 'session-1',
    getSnapshot: () => snapshot,
    applySnapshot: (next) => {
      snapshot = next
      applied.push(next)
    },
    isDisposed: () => disposed,
  })
  return {
    controller,
    applied,
    get snapshot() { return snapshot },
    disposeSource: () => { disposed = true },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  leaseMocks.acquireLease.mockReset()
  leaseMocks.takeOverLease.mockReset()
  leaseMocks.releaseLease.mockReset()
  leaseMocks.getClientId.mockClear()
  leaseMocks.leaseSnapshotFromWire.mockReset()
  leaseMocks.acquireLease.mockResolvedValue({ ok: true, snapshot: OWNER })
  leaseMocks.releaseLease.mockResolvedValue({ ok: true, snapshot: { ...OWNER, isOwner: false, holder: null } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SessionLeaseController', () => {
  it('claims immediately, renews on the heartbeat, and sends the client id only while enabled', async () => {
    const state = createController()
    state.controller.enable()
    await vi.advanceTimersByTimeAsync(0)

    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(1)
    expect(state.snapshot).toMatchObject({ isOwner: true })
    expect(state.controller.canWrite()).toBe(true)
    expect(state.controller.writeHeaders()).toEqual({ 'x-quickforge-client-id': 'client-a' })

    await vi.advanceTimersByTimeAsync(20_000)
    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(2)
    state.controller.dispose()
  })

  it('follows an observer snapshot and triggers takeover', async () => {
    const state = createController()
    leaseMocks.acquireLease.mockResolvedValue({ ok: false, snapshot: OBSERVER })
    state.controller.enable()
    await vi.advanceTimersByTimeAsync(0)
    expect(state.controller.canWrite()).toBe(false)

    leaseMocks.takeOverLease.mockResolvedValue({ ok: true, snapshot: OWNER })
    await expect(state.controller.takeOver()).resolves.toBe(true)
    expect(state.snapshot).toMatchObject({ isOwner: true })
    state.controller.dispose()
  })

  it('stops probing when the server does not support leases', async () => {
    const state = createController()
    leaseMocks.acquireLease.mockResolvedValue({
      ok: false,
      snapshot: { ...OWNER, failure: 'unsupported', failureStatus: 404 },
    })
    state.controller.enable()
    await vi.advanceTimersByTimeAsync(0)
    expect(state.snapshot).toMatchObject({ degraded: false })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(1)
    state.controller.dispose()
  })

  it('degrades only after consecutive failures and stays writable on a single blip', async () => {
    const state = createController()
    leaseMocks.acquireLease.mockResolvedValue({
      ok: false,
      snapshot: { ...OBSERVER, degraded: true, failure: 'network' },
    })
    state.controller.enable()
    await vi.advanceTimersByTimeAsync(0)
    expect(state.applied).toHaveLength(0)

    await state.controller.retry()
    expect(state.applied).toHaveLength(1)
    expect(state.snapshot).toMatchObject({ isOwner: false, degraded: true })
    state.controller.dispose()
  })

  it('releases on dispose and stops the heartbeat', async () => {
    const state = createController()
    state.controller.enable()
    await vi.advanceTimersByTimeAsync(0)

    state.controller.dispose()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(leaseMocks.releaseLease).toHaveBeenCalledWith('', 'session-1')
    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(1)
  })

  it('adopts wire lease frames through the shared snapshot mapper', () => {
    const state = createController()
    leaseMocks.leaseSnapshotFromWire.mockReturnValue(OBSERVER)
    state.controller.applyWireLease({ clientId: 'client-b' })
    expect(leaseMocks.leaseSnapshotFromWire).toHaveBeenCalledWith({ clientId: 'client-b' })
    expect(state.snapshot).toEqual(OBSERVER)
  })
})
