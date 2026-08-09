import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'

const reactHarness = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
  stateUpdates: [] as Array<{ index: number; value: unknown }>,
  stateCursor: 0,
  states: [] as unknown[],
}))

const cloudMocks = vi.hoisted(() => ({
  getCloudModels: vi.fn(),
  getCloudStatus: vi.fn(),
  startCloudGuest: vi.fn(),
}))

vi.mock('react', () => ({
  useCallback<T>(callback: T) {
    return callback
  },
  useEffect(effect: () => void | (() => void)) {
    const cleanup = effect()
    if (cleanup) reactHarness.cleanups.push(cleanup)
  },
  useRef<T>(initialValue: T) {
    return { current: initialValue }
  },
  useState<T>(initialValue: T | (() => T)) {
    const index = reactHarness.stateCursor
    reactHarness.stateCursor += 1
    reactHarness.states[index] = typeof initialValue === 'function'
      ? (initialValue as () => T)()
      : initialValue
    const setState = (update: T | ((previous: T) => T)) => {
      const previous = reactHarness.states[index] as T
      const value = typeof update === 'function'
        ? (update as (current: T) => T)(previous)
        : update
      reactHarness.states[index] = value
      reactHarness.stateUpdates.push({ index, value })
    }
    return [reactHarness.states[index] as T, setState] as const
  },
}))

vi.mock('@/lib/cloud-client', () => cloudMocks)

import { CLOUD_STATE_CHANGED_EVENT, useCloudModels } from '../../src/hooks/useCloudModels'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

function model(id: string) {
  return { id, provider: 'quickforge-cloud' } as Model<Api>
}

function createWindowHarness() {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  return {
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      const registered = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
      registered.add(listener)
      listeners.set(type, registered)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener)
    }),
    dispatchEvent(event: Event) {
      for (const listener of listeners.get(event.type) ?? []) {
        if (typeof listener === 'function') listener(event)
        else listener.handleEvent(event)
      }
      return true
    },
  }
}

describe('useCloudModels', () => {
  beforeEach(() => {
    reactHarness.cleanups = []
    reactHarness.stateUpdates = []
    reactHarness.stateCursor = 0
    reactHarness.states = []
    cloudMocks.getCloudModels.mockReset()
    cloudMocks.getCloudStatus.mockReset()
    cloudMocks.startCloudGuest.mockReset()
    vi.stubGlobal('window', createWindowHarness())
  })

  it('keeps the new service catalog when an invalidated request completes last', async () => {
    const oldCatalog = deferred<Model<Api>[]>()
    const newCatalog = [model('new-model')]
    cloudMocks.getCloudStatus.mockResolvedValue({ configured: true, mode: 'account', hasSession: true })
    cloudMocks.getCloudModels
      .mockImplementationOnce(() => oldCatalog.promise)
      .mockResolvedValueOnce(newCatalog)

    const hook = useCloudModels()
    const requestA = hook.loadCloudModels()
    await flushMicrotasks()
    expect(cloudMocks.getCloudModels).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event(CLOUD_STATE_CHANGED_EVENT))
    const requestB = hook.loadCloudModels()
    await expect(requestB).resolves.toEqual(newCatalog)

    oldCatalog.resolve([model('old-model')])
    await expect(requestA).resolves.toEqual([])

    await expect(hook.loadCloudModels()).resolves.toEqual(newCatalog)
    expect(cloudMocks.getCloudModels).toHaveBeenCalledTimes(2)
    expect(cloudMocks.getCloudModels.mock.calls[0][0].aborted).toBe(true)
  })

  it('preserves same-generation request deduplication after an older promise settles', async () => {
    const oldCatalog = deferred<Model<Api>[]>()
    const newCatalog = deferred<Model<Api>[]>()
    cloudMocks.getCloudStatus.mockResolvedValue({ configured: true, mode: 'account', hasSession: true })
    cloudMocks.getCloudModels
      .mockImplementationOnce(() => oldCatalog.promise)
      .mockImplementationOnce(() => newCatalog.promise)

    const hook = useCloudModels()
    const requestA = hook.loadCloudModels()
    await flushMicrotasks()
    window.dispatchEvent(new Event(CLOUD_STATE_CHANGED_EVENT))
    const requestB = hook.loadCloudModels()
    await flushMicrotasks()

    oldCatalog.resolve([model('old-model')])
    await expect(requestA).resolves.toEqual([])

    const joinedRequest = hook.loadCloudModels()
    await flushMicrotasks()
    expect(cloudMocks.getCloudModels).toHaveBeenCalledTimes(2)

    const expected = [model('new-model')]
    newCatalog.resolve(expected)
    await expect(Promise.all([requestB, joinedRequest])).resolves.toEqual([expected, expected])
  })

  it('does not request the Cloud catalog while the service switch is off', async () => {
    cloudMocks.getCloudStatus.mockResolvedValue({ configured: true, enabled: false, mode: 'account', hasSession: true })
    const hook = useCloudModels()

    await expect(hook.loadCloudModels()).resolves.toEqual([])
    expect(cloudMocks.getCloudModels).not.toHaveBeenCalled()
  })

  it('aborts in-flight work and avoids state updates after unmount', async () => {
    const catalog = deferred<Model<Api>[]>()
    cloudMocks.getCloudStatus.mockResolvedValue({ configured: true, mode: 'account', hasSession: true })
    cloudMocks.getCloudModels.mockImplementationOnce(() => catalog.promise)

    const hook = useCloudModels()
    const request = hook.loadCloudModels()
    await flushMicrotasks()
    const signal = cloudMocks.getCloudModels.mock.calls[0][0] as AbortSignal
    const updatesBeforeUnmount = reactHarness.stateUpdates.length

    for (const cleanup of [...reactHarness.cleanups].reverse()) cleanup()
    expect(signal.aborted).toBe(true)

    catalog.resolve([model('late-model')])
    await expect(request).resolves.toEqual([])
    expect(reactHarness.stateUpdates).toHaveLength(updatesBeforeUnmount)
  })
})
