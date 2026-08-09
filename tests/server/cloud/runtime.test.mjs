import { afterEach, describe, expect, it, vi } from 'vitest'

const { readCloudServiceConfig } = vi.hoisted(() => ({
  readCloudServiceConfig: vi.fn(),
}))

vi.mock('../../../server/cloud/service-config.mjs', () => ({ readCloudServiceConfig }))

import {
  createCloudRuntime,
  getCloudRuntime,
  invalidateCloudRuntime,
  resolveManagedCloudProvider,
  resetCloudRuntimeForTests,
  setCloudRuntimeFactoryForTests,
  setCloudRuntimeForTests,
} from '../../../server/cloud/runtime.mjs'

function fakeStore() {
  const state = {
    refreshToken: 'test-refresh', installationId: 'test-install', installationName: 'test', sessionCloudUrl: 'https://cloud.test/',
  }
  return {
    read: async () => ({ ...state }),
    readPublic: async () => ({ hasSession: true }),
    update: async (fn) => {
      Object.assign(state, fn({ ...state }))
      return { ...state }
    },
    clearSession: async () => {
      state.refreshToken = undefined
      return { ...state }
    },
  }
}

function fakeClient() {
  return {
    refresh: async () => ({ accessToken: 'test-access', expiresIn: 300, refreshToken: 'test-refresh-2' }),
    models: async () => ({ items: [{ id: 'm1', name: 'M1', available: true, capabilities: { tools: true, vision: false, reasoning: false } }] }),
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function serviceConfig(url, enabled = true) {
  const baseUrl = new URL(url)
  return { baseUrl, cloudUrl: baseUrl.href, enabled, source: 'saved', saved: true }
}

function runtime(url) {
  return { enabled: true, config: { enabled: true, baseUrl: new URL(url) } }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('cloud runtime singleton', () => {
  afterEach(() => {
    resetCloudRuntimeForTests()
    readCloudServiceConfig.mockReset()
  })

  it('builds local identity and store while the service is disabled', () => {
    const store = fakeStore()
    const current = createCloudRuntime({
      config: { enabled: false, baseUrl: new URL('https://cloud.test') },
      store,
      client: fakeClient(),
    })
    expect(current.enabled).toBe(false)
    expect(current.store).toBe(store)
    expect(current.identity).toBeDefined()
    expect(current.models).toBeDefined()
  })

  it('keeps the service disabled when only an env-backed URL is available', async () => {
    readCloudServiceConfig.mockResolvedValue(serviceConfig('https://env.test/', false))
    const factory = vi.fn(({ config }) => ({ enabled: config.enabled, config }))
    setCloudRuntimeFactoryForTests(factory)
    await expect(getCloudRuntime()).resolves.toMatchObject({ enabled: false })
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ enabled: false }) }))
  })

  it('deduplicates concurrent requests for the same config and generation', async () => {
    const pending = deferred()
    const currentRuntime = runtime('https://same.test/')
    const factory = vi.fn(() => pending.promise)
    readCloudServiceConfig.mockResolvedValue(serviceConfig('https://same.test/'))
    setCloudRuntimeFactoryForTests(factory)

    const first = getCloudRuntime()
    const second = getCloudRuntime()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))

    pending.resolve(currentRuntime)
    await expect(Promise.all([first, second])).resolves.toEqual([currentRuntime, currentRuntime])
    expect(factory).toHaveBeenCalledTimes(1)
    await expect(getCloudRuntime()).resolves.toBe(currentRuntime)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('does not let an old runtime overwrite a newer runtime when the old runtime finishes first', async () => {
    const oldPending = deferred()
    const newPending = deferred()
    const oldRuntime = runtime('https://old.test/')
    const newRuntime = runtime('https://new.test/')
    const factory = vi.fn()
      .mockReturnValueOnce(oldPending.promise)
      .mockReturnValueOnce(newPending.promise)
    readCloudServiceConfig
      .mockResolvedValueOnce(serviceConfig('https://old.test/'))
      .mockResolvedValue(serviceConfig('https://new.test/'))
    setCloudRuntimeFactoryForTests(factory)

    const oldRequest = getCloudRuntime()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
    invalidateCloudRuntime()
    const newRequest = getCloudRuntime()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2))

    oldPending.resolve(oldRuntime)
    await expect(oldRequest).resolves.toBe(oldRuntime)
    newPending.resolve(newRuntime)
    await expect(newRequest).resolves.toBe(newRuntime)

    await expect(getCloudRuntime()).resolves.toBe(newRuntime)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('does not let an old finally clear the newer pending promise', async () => {
    const oldPending = deferred()
    const newPending = deferred()
    const oldRuntime = runtime('https://old.test/')
    const newRuntime = runtime('https://new.test/')
    const factory = vi.fn()
      .mockReturnValueOnce(oldPending.promise)
      .mockReturnValueOnce(newPending.promise)
    readCloudServiceConfig
      .mockResolvedValueOnce(serviceConfig('https://old.test/'))
      .mockResolvedValue(serviceConfig('https://new.test/'))
    setCloudRuntimeFactoryForTests(factory)

    const oldRequest = getCloudRuntime()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
    invalidateCloudRuntime()
    const newRequest = getCloudRuntime()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2))

    oldPending.resolve(oldRuntime)
    await expect(oldRequest).resolves.toBe(oldRuntime)
    await flushPromises()

    const sharedNewRequest = getCloudRuntime()
    await flushPromises()
    expect(factory).toHaveBeenCalledTimes(2)

    newPending.resolve(newRuntime)
    await expect(Promise.all([newRequest, sharedNewRequest])).resolves.toEqual([newRuntime, newRuntime])
    await expect(getCloudRuntime()).resolves.toBe(newRuntime)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('keeps the newer runtime cached when it finishes before the old runtime', async () => {
    const oldPending = deferred()
    const newPending = deferred()
    const oldRuntime = runtime('https://old.test/')
    const newRuntime = runtime('https://new.test/')
    const factory = vi.fn()
      .mockReturnValueOnce(oldPending.promise)
      .mockReturnValueOnce(newPending.promise)
    readCloudServiceConfig
      .mockResolvedValueOnce(serviceConfig('https://old.test/'))
      .mockResolvedValue(serviceConfig('https://new.test/'))
    setCloudRuntimeFactoryForTests(factory)

    const oldRequest = getCloudRuntime()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
    invalidateCloudRuntime()
    const newRequest = getCloudRuntime()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2))

    newPending.resolve(newRuntime)
    await expect(newRequest).resolves.toBe(newRuntime)
    oldPending.resolve(oldRuntime)
    await expect(oldRequest).resolves.toBe(oldRuntime)

    await expect(getCloudRuntime()).resolves.toBe(newRuntime)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('keeps a test override when an older runtime creation finishes', async () => {
    const pending = deferred()
    const createdRuntime = runtime('https://created.test/')
    const overrideRuntime = runtime('https://override.test/')
    const factory = vi.fn(() => pending.promise)
    readCloudServiceConfig.mockResolvedValue(serviceConfig('https://created.test/'))
    setCloudRuntimeFactoryForTests(factory)

    const request = getCloudRuntime()
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))
    setCloudRuntimeForTests(overrideRuntime)
    pending.resolve(createdRuntime)
    await expect(request).resolves.toBe(createdRuntime)

    await expect(getCloudRuntime()).resolves.toBe(overrideRuntime)
  })
})

describe('managed cloud provider resolution', () => {
  afterEach(() => resetCloudRuntimeForTests())

  it('includes a zero cost table so pi-ai calculateCost does not throw on streamed usage', async () => {
    setCloudRuntimeForTests(createCloudRuntime({
      config: { enabled: true, baseUrl: new URL('https://cloud.test') },
      store: fakeStore(),
      client: fakeClient(),
    }))
    const resolved = await resolveManagedCloudProvider({
      provider: 'quickforge-cloud',
      quickforgeModelSource: 'cloud',
      quickforgeCatalogId: 'm1',
    })
    expect(resolved.apiKey).toBe('test-access')
    expect(resolved.model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    expect(resolved.model.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      supportsStrictMode: false,
      maxTokensField: 'max_tokens',
    })
    expect(resolved.model).toMatchObject({
      id: 'm1',
      provider: 'quickforge-cloud',
      api: 'openai-completions',
      baseUrl: 'https://cloud.test/v1',
    })
    // The resolved provider model must never carry client-controlled credentials.
    expect(resolved.model.apiKey).toBeUndefined()
    expect(resolved.model.headers).toBeUndefined()
  })

  it('returns cloud_disabled for a configured managed model while the service switch is off', async () => {
    setCloudRuntimeForTests(createCloudRuntime({
      config: { enabled: false, baseUrl: new URL('https://cloud.test') },
      store: fakeStore(),
      client: fakeClient(),
    }))
    await expect(resolveManagedCloudProvider({
      provider: 'quickforge-cloud',
      quickforgeModelSource: 'cloud',
      quickforgeCatalogId: 'm1',
    })).rejects.toMatchObject({ code: 'cloud_disabled' })
  })

  it('returns undefined for non-managed models', async () => {
    setCloudRuntimeForTests(createCloudRuntime({
      config: { enabled: true, baseUrl: new URL('https://cloud.test') },
      store: fakeStore(),
      client: fakeClient(),
    }))
    await expect(resolveManagedCloudProvider({ provider: 'anthropic', api: 'anthropic-messages' })).resolves.toBeUndefined()
  })
})
