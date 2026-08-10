import { describe, expect, it, vi } from 'vitest'
import { CloudApiError } from '../../../server/cloud/client.mjs'
import { CloudIdentityManager } from '../../../server/cloud/identity.mjs'

function createMemoryStore(seed = {}) {
  let record = {
    mode: 'local', installationName: 'Test', platform: 'linux', clientVersion: '1.0.0',
    publicKey: 'public-key', privateKeyPkcs8: 'private-key', ...seed,
  }
  return {
    read: async () => ({ ...record }),
    ensureInstallation: async () => {
      if (!record.installationId) {
        record = { ...record, installationId: 'install-local' }
      }
      return { ...record }
    },
    rotateInstallation: async () => {
      record = {
        ...record,
        mode: 'local',
        installationId: undefined,
        refreshToken: undefined,
        sessionCloudUrl: undefined,
        pendingDeviceFlow: undefined,
        account: undefined,
        publicKey: 'rotated-public-key',
        privateKeyPkcs8: 'rotated-private-key',
        rotateInstallationBeforeRegistration: undefined,
      }
      return { ...record }
    },
    update: async (fn) => { record = await fn({ ...record }); return { ...record } },
    readPublic: async () => ({
      mode: record.mode,
      installationId: record.installationId,
      hasSession: Boolean(record.refreshToken),
      account: record.account,
      pendingDeviceFlow: record.pendingDeviceFlow && {
        userCode: record.pendingDeviceFlow.userCode,
        verificationUri: record.pendingDeviceFlow.verificationUri,
        verificationUriComplete: record.pendingDeviceFlow.verificationUriComplete,
        expiresAt: record.pendingDeviceFlow.expiresAt,
        interval: record.pendingDeviceFlow.interval,
        status: record.pendingDeviceFlow.status,
      },
    }),
    clearSession: async (options = {}) => {
      record = {
        ...record,
        mode: 'local',
        installationId: undefined,
        refreshToken: undefined,
        sessionCloudUrl: undefined,
        pendingDeviceFlow: undefined,
        account: undefined,
        rotateInstallationBeforeRegistration: options.rotateInstallationBeforeRegistration || undefined,
      }
      return { ...record }
    },
    value: () => ({ ...record }),
  }
}

function createManager(client, store, serviceUrl = 'https://cloud.test/') {
  return new CloudIdentityManager({ client, store, serviceUrl })
}

describe('cloud identity manager', () => {
  it('refuses to send a refresh token to a different or unknown Cloud service', async () => {
    const client = { refresh: vi.fn() }
    const mismatched = createManager(client, createMemoryStore({
      mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-1', sessionCloudUrl: 'https://old.example/',
    }), 'https://new.example/')
    await expect(mismatched.refresh()).rejects.toMatchObject({ status: 409, code: 'cloud_session_service_mismatch' })

    const legacy = createManager(client, createMemoryStore({
      mode: 'guest', installationId: 'install-1', refreshToken: 'legacy-refresh',
    }))
    await expect(legacy.refresh()).rejects.toMatchObject({ status: 409, code: 'cloud_session_service_mismatch' })
    expect(client.refresh).not.toHaveBeenCalled()
    await expect(legacy.status()).resolves.toMatchObject({ hasSession: true, sessionServiceMismatch: true })
  })

  it('starts device authorization from local with complete installation and persists only the pending server-side secret', async () => {
    const store = createMemoryStore()
    const client = {
      authorizeDevice: vi.fn(async () => ({
        deviceCode: 'device-secret', userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device',
        verificationUriComplete: 'https://cloud.test/device?user_code=ABCD-EFGH', expiresIn: 600, interval: 5,
      })),
    }
    const manager = createManager(client, store)
    const status = await manager.startDeviceFlow()
    expect(store.value().installationId).toBe('install-local')
    expect(client.authorizeDevice).toHaveBeenCalledWith({
      installationId: 'install-local',
      clientId: 'quickforge-desktop',
      publicKey: 'public-key',
      installationName: 'Test',
      platform: 'linux',
      clientVersion: '1.0.0',
      signal: undefined,
    })
    expect(store.value().pendingDeviceFlow).toMatchObject({ deviceCode: 'device-secret', sessionCloudUrl: 'https://cloud.test/' })
    expect(status.pendingDeviceFlow).not.toHaveProperty('deviceCode')
  })

  it('keeps the guest session for pending, network, denied, expired, and cancel outcomes', async () => {
    const outcomes = [
      [new CloudApiError('wait', { status: 400, code: 'authorization_pending' }), 'pending', true],
      [new CloudApiError('slow', { status: 400, code: 'slow_down' }), 'slow_down', true],
      [new CloudApiError('offline', { code: 'cloud_unavailable', retryable: true }), 'network', true],
      [new CloudApiError('no', { status: 400, code: 'access_denied' }), 'denied', false],
      [new CloudApiError('old', { status: 400, code: 'expired_token' }), 'expired', false],
    ]
    for (const [error, result, remainsPending] of outcomes) {
      const store = createMemoryStore({
        mode: 'guest', installationId: 'install-1', refreshToken: 'guest-refresh', sessionCloudUrl: 'https://cloud.test/',
        pendingDeviceFlow: { deviceCode: 'device-secret', userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() + 60_000, interval: 5, sessionCloudUrl: 'https://cloud.test/' },
      })
      const manager = createManager({ exchangeDeviceCode: vi.fn(async () => { throw error }) }, store)
      await expect(manager.pollDeviceFlow()).resolves.toMatchObject({ mode: 'guest', hasSession: true, deviceFlowResult: result })
      expect(Boolean(store.value().pendingDeviceFlow)).toBe(remainsPending)
      expect(store.value().refreshToken).toBe('guest-refresh')
    }

    const store = createMemoryStore({
      mode: 'guest', installationId: 'install-1', refreshToken: 'guest-refresh', sessionCloudUrl: 'https://cloud.test/',
      pendingDeviceFlow: { deviceCode: 'device-secret', userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() + 60_000, interval: 5, sessionCloudUrl: 'https://cloud.test/' },
    })
    await createManager({}, store).cancelDeviceFlow()
    expect(store.value()).toMatchObject({ mode: 'guest', refreshToken: 'guest-refresh' })
    expect(store.value().pendingDeviceFlow).toBeUndefined()
  })

  it('atomically upgrades the guest session to an account and whitelists the account summary', async () => {
    const store = createMemoryStore({
      mode: 'guest', installationId: 'install-1', refreshToken: 'guest-refresh', sessionCloudUrl: 'https://cloud.test/',
      pendingDeviceFlow: { deviceCode: 'device-secret', userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() + 60_000, interval: 5, sessionCloudUrl: 'https://cloud.test/' },
    })
    const client = {
      exchangeDeviceCode: vi.fn(async () => ({ accessToken: 'account-access', refreshToken: 'account-refresh', expiresIn: 300, installationId: 'install-1', identityMode: 'account' })),
      me: vi.fn(async () => ({ id: 'account-1', email: 'user@example.test', plan: 'pro', role: 'admin', passwordHash: 'secret' })),
      usage: vi.fn(async () => ({ remaining: 99 })),
    }
    const manager = createManager(client, store)
    manager.modelsCache = [{ id: 'old' }]
    const status = await manager.pollDeviceFlow()
    expect(status).toMatchObject({ mode: 'account', deviceFlowResult: 'success', account: { id: 'account-1', email: 'user@example.test', plan: 'pro' } })
    expect(status.account).not.toHaveProperty('role')
    expect(store.value()).toMatchObject({ mode: 'account', installationId: 'install-1', refreshToken: 'account-refresh' })
    expect(store.value().pendingDeviceFlow).toBeUndefined()
    expect(manager.modelsCache).toBeUndefined()
  })

  it('clears an expired pending device flow when status is restored after restart', async () => {
    const store = createMemoryStore({
      mode: 'guest', installationId: 'install-1', refreshToken: 'guest-refresh', sessionCloudUrl: 'https://cloud.test/',
      pendingDeviceFlow: { deviceCode: 'device-secret', userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() - 1, interval: 5, sessionCloudUrl: 'https://cloud.test/' },
    })
    await expect(createManager({}, store).status()).resolves.toMatchObject({ mode: 'guest', hasSession: true })
    expect(store.value().pendingDeviceFlow).toBeUndefined()
  })

  it('refuses to resume a pending device flow against another Cloud URL', async () => {
    const store = createMemoryStore({
      mode: 'guest', installationId: 'install-1', refreshToken: 'guest-refresh', sessionCloudUrl: 'https://cloud.test/',
      pendingDeviceFlow: { deviceCode: 'device-secret', userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() + 60_000, interval: 5, sessionCloudUrl: 'https://old.example/' },
    })
    const client = { exchangeDeviceCode: vi.fn() }
    const manager = createManager(client, store)
    await expect(manager.pollDeviceFlow()).rejects.toMatchObject({ status: 409, code: 'cloud_session_service_mismatch' })
    expect(client.exchangeDeviceCode).not.toHaveBeenCalled()
  })

  it('starts, resumes, slows, completes, denies, expires, cancels, and binds device flow to the service URL', async () => {
    const expiresAt = Date.now() + 60_000
    const store = createMemoryStore({
      mode: 'guest', installationId: 'install-1', refreshToken: 'guest-refresh', sessionCloudUrl: 'https://cloud.test/',
    })
    const client = {
      refresh: vi.fn(async () => ({ accessToken: 'guest-access', refreshToken: 'guest-refresh-2', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })),
      authorizeDevice: vi.fn(async () => ({
        deviceCode: 'device-secret', userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device',
        verificationUriComplete: 'https://cloud.test/device?user_code=ABCD-EFGH', expiresIn: 60, interval: 2,
      })),
      exchangeDeviceCode: vi.fn(),
      me: vi.fn(async () => ({ id: 'account-1', email: 'user@example.test', plan: 'pro' })),
      usage: vi.fn(async () => ({ remaining: 99 })),
    }
    const manager = createManager(client, store)

    const started = await manager.startDeviceFlow()
    expect(client.authorizeDevice).toHaveBeenCalledWith({
      installationId: 'install-1',
      clientId: 'quickforge-desktop',
      publicKey: 'public-key',
      installationName: 'Test',
      platform: 'linux',
      clientVersion: '1.0.0',
      signal: undefined,
    })
    expect(started.pendingDeviceFlow).toMatchObject({ userCode: 'ABCD-EFGH', interval: 2 })
    expect(started.pendingDeviceFlow).not.toHaveProperty('deviceCode')
    expect(store.value().pendingDeviceFlow).toMatchObject({ deviceCode: 'device-secret', sessionCloudUrl: 'https://cloud.test/' })

    client.exchangeDeviceCode.mockRejectedValueOnce(new CloudApiError('pending', { status: 400, code: 'authorization_pending' }))
    await expect(manager.pollDeviceFlow()).resolves.toMatchObject({ mode: 'guest', deviceFlowResult: 'pending', pendingDeviceFlow: { userCode: 'ABCD-EFGH' } })

    client.exchangeDeviceCode.mockRejectedValueOnce(new CloudApiError('slow', { status: 400, code: 'slow_down' }))
    await expect(manager.pollDeviceFlow()).resolves.toMatchObject({ deviceFlowResult: 'slow_down', pendingDeviceFlow: { interval: 7, status: 'slow_down' } })

    client.exchangeDeviceCode.mockResolvedValueOnce({ accessToken: 'account-access', refreshToken: 'account-refresh', expiresIn: 300, installationId: 'install-1' })
    await expect(manager.pollDeviceFlow()).resolves.toMatchObject({ mode: 'account', deviceFlowResult: 'success', account: { email: 'user@example.test' } })
    expect(store.value()).toMatchObject({ mode: 'account', refreshToken: 'account-refresh', sessionCloudUrl: 'https://cloud.test/' })
    expect(store.value().pendingDeviceFlow).toBeUndefined()

    await store.update((current) => ({ ...current, mode: 'guest', refreshToken: 'guest-refresh', pendingDeviceFlow: { deviceCode: 'denied-secret', userCode: 'DENIED', verificationUri: 'https://cloud.test/device', expiresAt, interval: 5, sessionCloudUrl: 'https://cloud.test/' } }))
    client.exchangeDeviceCode.mockRejectedValueOnce(new CloudApiError('denied', { status: 400, code: 'access_denied' }))
    await expect(manager.pollDeviceFlow()).resolves.toMatchObject({ deviceFlowResult: 'denied' })
    expect(store.value().pendingDeviceFlow).toBeUndefined()

    await store.update((current) => ({ ...current, pendingDeviceFlow: { deviceCode: 'expired-secret', userCode: 'EXPIRED', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() - 1, interval: 5, sessionCloudUrl: 'https://cloud.test/' } }))
    await expect(manager.pollDeviceFlow()).resolves.toMatchObject({ deviceFlowResult: 'expired' })
    expect(client.exchangeDeviceCode).toHaveBeenCalledTimes(4)

    await store.update((current) => ({ ...current, pendingDeviceFlow: { deviceCode: 'cancel-secret', userCode: 'CANCEL', verificationUri: 'https://cloud.test/device', expiresAt, interval: 5, sessionCloudUrl: 'https://cloud.test/' } }))
    await expect(manager.cancelDeviceFlow()).resolves.toMatchObject({ mode: 'guest', hasSession: true })
    expect(store.value().pendingDeviceFlow).toBeUndefined()
  })

  it('maps only network or unavailable failures to network and rethrows protocol failures', async () => {
    const pendingDeviceFlow = { deviceCode: 'device-secret', userCode: 'ABCD', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() + 60_000, interval: 5, sessionCloudUrl: 'https://cloud.test/' }
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh', sessionCloudUrl: 'https://cloud.test/', pendingDeviceFlow })
    const client = { exchangeDeviceCode: vi.fn() }
    const manager = createManager(client, store)

    client.exchangeDeviceCode.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(manager.pollDeviceFlow()).resolves.toMatchObject({ deviceFlowResult: 'network', pendingDeviceFlow: { userCode: 'ABCD' } })

    client.exchangeDeviceCode.mockRejectedValueOnce(new CloudApiError('unavailable', { status: 503, code: 'cloud_request_failed' }))
    await expect(manager.pollDeviceFlow()).resolves.toMatchObject({ deviceFlowResult: 'network' })

    client.exchangeDeviceCode.mockRejectedValueOnce(new CloudApiError('invalid response', { code: 'invalid_token_response' }))
    await expect(manager.pollDeviceFlow()).rejects.toMatchObject({ code: 'invalid_token_response' })

    client.exchangeDeviceCode.mockResolvedValueOnce({ accessToken: 'access-only' })
    await expect(manager.pollDeviceFlow()).rejects.toMatchObject({ code: 'invalid_token_response' })
    expect(store.value().pendingDeviceFlow.deviceCode).toBe('device-secret')
  })

  it('rejects a pending flow bound to another URL before sending the device code', async () => {
    const client = { exchangeDeviceCode: vi.fn() }
    const manager = createManager(client, createMemoryStore({
      mode: 'guest', installationId: 'install-1', refreshToken: 'refresh', sessionCloudUrl: 'https://cloud.test/',
      pendingDeviceFlow: { deviceCode: 'device-secret', userCode: 'ABCD', verificationUri: 'https://old.example/device', expiresAt: Date.now() + 60_000, interval: 5, sessionCloudUrl: 'https://old.example/' },
    }))
    await expect(manager.pollDeviceFlow()).rejects.toMatchObject({ code: 'cloud_session_service_mismatch' })
    expect(client.exchangeDeviceCode).not.toHaveBeenCalled()
  })

  it('coalesces concurrent device polls so a device code is exchanged once', async () => {
    let release
    const store = createMemoryStore({
      mode: 'guest', installationId: 'install-1', refreshToken: 'refresh', sessionCloudUrl: 'https://cloud.test/',
      pendingDeviceFlow: { deviceCode: 'device-secret', userCode: 'ABCD', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() + 60_000, interval: 5, sessionCloudUrl: 'https://cloud.test/' },
    })
    const client = {
      exchangeDeviceCode: vi.fn(() => new Promise((resolve) => { release = resolve })),
      me: vi.fn(async () => ({ id: 'account-1' })),
      usage: vi.fn(async () => ({ remaining: 1 })),
    }
    const manager = createManager(client, store)
    const first = manager.pollDeviceFlow()
    const second = manager.pollDeviceFlow()
    await vi.waitFor(() => expect(client.exchangeDeviceCode).toHaveBeenCalledTimes(1))
    release({ accessToken: 'access', refreshToken: 'account-refresh', expiresIn: 300 })
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ deviceFlowResult: 'success' }),
      expect.objectContaining({ deviceFlowResult: 'success' }),
    ])
  })

  it('caches the Cloud model catalog, supports forced refresh, and can fail closed without stale data', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-1', sessionCloudUrl: 'https://cloud.test/' })
    const client = {
      refresh: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh-2', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })),
      models: vi.fn(async () => ({ items: [{ id: `m-${client.models.mock.calls.length}` }] })),
    }
    const manager = createManager(client, store)
    await expect(manager.models()).resolves.toEqual([{ id: 'm-1' }])
    await expect(manager.models()).resolves.toEqual([{ id: 'm-1' }])
    expect(client.models).toHaveBeenCalledTimes(1)
    await expect(manager.models(undefined, { refresh: true })).resolves.toEqual([{ id: 'm-2' }])
    client.models.mockRejectedValueOnce(new CloudApiError('offline', { code: 'cloud_unavailable' }))
    await expect(manager.models(undefined, { refresh: true, allowStale: false })).rejects.toThrow('offline')
  })

  it('coalesces concurrent refresh calls and rotates the persisted token', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'old-refresh', sessionCloudUrl: 'https://cloud.test/' })
    let release
    const client = {
      refresh: vi.fn(() => new Promise((resolve) => { release = resolve })),
    }
    const manager = createManager(client, store)
    const first = manager.refresh()
    const second = manager.refresh()
    await vi.waitFor(() => expect(client.refresh).toHaveBeenCalledTimes(1))
    release({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })
    await expect(Promise.all([first, second])).resolves.toEqual(['new-access', 'new-access'])
    expect(store.value().refreshToken).toBe('new-refresh')
  })

  it('refreshes once after a 401 and does not loop', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-1', sessionCloudUrl: 'https://cloud.test/' })
    const client = {
      refresh: vi.fn(async () => ({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })),
    }
    const manager = createManager(client, store)
    let attempts = 0
    const result = await manager.withAccessToken(async () => {
      attempts++
      if (attempts === 1) throw new CloudApiError('expired', { status: 401, code: 'unauthorized' })
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(attempts).toBe(2)
    expect(client.refresh).toHaveBeenCalledTimes(2)
  })

  it('clears invalid sessions without deleting the installation keys', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'bad', sessionCloudUrl: 'https://cloud.test/' })
    const client = { refresh: vi.fn(async () => { throw new CloudApiError('reused', { status: 401, code: 'refresh_token_reused' }) }) }
    const manager = createManager(client, store)
    await expect(manager.refresh()).rejects.toThrow('reused')
    expect(store.value().refreshToken).toBeUndefined()
    expect(store.value().publicKey).toBe('public-key')
    expect(store.value().rotateInstallationBeforeRegistration).toBe(true)
  })

  it('revokes the current installation before clearing the local session', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-1', sessionCloudUrl: 'https://cloud.test/' })
    const client = {
      refresh: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh-2', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })),
      revokeInstallation: vi.fn(async () => undefined),
    }
    const manager = createManager(client, store)
    await manager.logout()
    expect(client.revokeInstallation).toHaveBeenCalledWith('access', 'install-1', undefined)
    expect(store.value()).toMatchObject({ mode: 'local', rotateInstallationBeforeRegistration: true })
    expect(store.value().refreshToken).toBeUndefined()
  })

  it('keeps the local session when remote logout fails', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-1', sessionCloudUrl: 'https://cloud.test/' })
    const client = {
      refresh: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh-2', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })),
      revokeInstallation: vi.fn(async () => { throw new CloudApiError('offline', { code: 'cloud_unavailable' }) }),
    }
    const manager = createManager(client, store)
    await expect(manager.logout()).rejects.toThrow('offline')
    expect(store.value()).toMatchObject({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-2' })
  })

  it('resets local identity state without contacting either cloud service', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-1', sessionCloudUrl: 'https://cloud.test/' })
    const client = {
      refresh: vi.fn(),
      revokeInstallation: vi.fn(),
    }
    const manager = createManager(client, store)
    manager.accessToken = 'memory-access'
    manager.modelsCache = [{ id: 'm1' }]
    await manager.resetIdentity()
    expect(client.refresh).not.toHaveBeenCalled()
    expect(client.revokeInstallation).not.toHaveBeenCalled()
    expect(store.value()).toMatchObject({ mode: 'local', publicKey: 'rotated-public-key' })
    expect(store.value().refreshToken).toBeUndefined()
    expect(manager.accessToken).toBeUndefined()
    expect(manager.modelsCache).toBeUndefined()
  })

  it('rotates the installation identity before registering after logout', async () => {
    const store = createMemoryStore({ rotateInstallationBeforeRegistration: true })
    const client = {
      authorizeDevice: vi.fn(async () => ({
        deviceCode: 'device-secret', userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device',
        verificationUriComplete: 'https://cloud.test/device?user_code=ABCD-EFGH', expiresIn: 600, interval: 5,
      })),
    }
    const manager = createManager(client, store)
    const status = await manager.startDeviceFlow()
    expect(store.value()).toMatchObject({
      publicKey: 'rotated-public-key',
      privateKeyPkcs8: 'rotated-private-key',
      installationId: 'install-local',
    })
    expect(store.value().rotateInstallationBeforeRegistration).toBeUndefined()
    expect(client.authorizeDevice).toHaveBeenCalledWith({
      installationId: 'install-local',
      clientId: 'quickforge-desktop',
      publicKey: 'rotated-public-key',
      installationName: 'Test',
      platform: 'linux',
      clientVersion: '1.0.0',
      signal: undefined,
    })
    expect(status.pendingDeviceFlow).toMatchObject({ userCode: 'ABCD-EFGH' })
  })
})
