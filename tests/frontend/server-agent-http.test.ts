import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJsonWithTimeout } from '../../src/lib/server-agent-http'

const TIMEOUT_MS = 1000

function mockAbortableFetch() {
  const fetchMock = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
    const signal = init!.signal!
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function observeExternalSignal() {
  const controller = new AbortController()
  const add = vi.spyOn(controller.signal, 'addEventListener')
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  return { controller, add, remove }
}

describe('fetchJsonWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns the original Response and parsed body, preserving init and clearing resources', async () => {
    const response = new Response(JSON.stringify({ ok: true }))
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const { controller, add, remove } = observeExternalSignal()
    const init = { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' }, signal: controller.signal }

    const result = await fetchJsonWithTimeout<{ ok: boolean }>('/test', TIMEOUT_MS, init)

    expect(result.response).toBe(response)
    expect(result.body).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/test', { ...init, signal: expect.any(AbortSignal) })
    const internalSignal = fetchMock.mock.calls[0][1]!.signal!
    expect(internalSignal).not.toBe(controller.signal)
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0][1])
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(internalSignal.aborted).toBe(false)
  })

  it('returns undefined body when JSON parsing rejects without losing the Response', async () => {
    const response = new Response('not JSON', { status: 502 })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response))
    const { controller, add, remove } = observeExternalSignal()

    const result = await fetchJsonWithTimeout('/test', TIMEOUT_MS, { signal: controller.signal })

    expect(result.response).toBe(response)
    expect(result.body).toBeUndefined()
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0][1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates fetch rejection and still clears the timeout and external listener', async () => {
    const error = new TypeError('fetch failed')
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(error)
    vi.stubGlobal('fetch', fetchMock)
    const { controller, add, remove } = observeExternalSignal()

    await expect(fetchJsonWithTimeout('/test', TIMEOUT_MS, { signal: controller.signal })).rejects.toBe(error)

    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0][1])
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false)
  })

  it('aborts a pending fetch at the timeout and removes the external listener', async () => {
    const fetchMock = mockAbortableFetch()
    const { controller, add, remove } = observeExternalSignal()
    const promise = fetchJsonWithTimeout('/test', TIMEOUT_MS, { signal: controller.signal })
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    const signal = fetchMock.mock.calls[0][1]!.signal!

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejection

    expect(signal.aborted).toBe(true)
    expect(controller.signal.aborted).toBe(false)
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0][1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forwards external abort and its reason to the pending fetch', async () => {
    const fetchMock = mockAbortableFetch()
    const { controller, add, remove } = observeExternalSignal()
    const reason = new Error('caller cancelled')
    const promise = fetchJsonWithTimeout('/test', TIMEOUT_MS, { signal: controller.signal })
    const rejection = expect(promise).rejects.toBe(reason)

    controller.abort(reason)
    await rejection

    expect(fetchMock.mock.calls[0][1]!.signal!.reason).toBe(reason)
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0][1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes an already-aborted external signal and reason through without registering a listener', async () => {
    const fetchMock = mockAbortableFetch()
    const { controller, add, remove } = observeExternalSignal()
    const reason = new Error('already cancelled')
    controller.abort(reason)

    await expect(fetchJsonWithTimeout('/test', TIMEOUT_MS, { signal: controller.signal })).rejects.toBe(reason)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true)
    expect(fetchMock.mock.calls[0][1]!.signal!.reason).toBe(reason)
    expect(add).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})
