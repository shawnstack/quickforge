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
    ensureInstallation: async () => ({ ...record }),
    rotateInstallation: async () => {
      record = { ...record, publicKey: 'rotated-public-key', privateKeyPkcs8: 'rotated-private-key', rotateInstallationBeforeRegistration: undefined }
      return { ...record }
    },
    update: async (fn) => { record = await fn({ ...record }); return { ...record } },
    readPublic: async () => ({ mode: record.mode, installationId: record.installationId, hasSession: Boolean(record.refreshToken), account: record.account }),
    clearSession: async (options = {}) => {
      record = {
        ...record,
        mode: 'local',
        installationId: undefined,
        refreshToken: undefined,
        account: undefined,
        rotateInstallationBeforeRegistration: options.rotateInstallationBeforeRegistration || undefined,
      }
      return { ...record }
    },
    value: () => ({ ...record }),
  }
}

describe('cloud identity manager', () => {
  it('persists a pending registration key and reuses it after a failed attempt', async () => {
    const store = createMemoryStore()
    const calls = []
    const client = {
      registerGuest: vi.fn(async (_body, key) => {
        calls.push(key)
        if (calls.length === 1) throw new CloudApiError('offline', { code: 'cloud_unavailable' })
        return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' }
      }),
      me: vi.fn(async () => ({ id: 'account-1', mode: 'guest', plan: 'guest' })),
      usage: vi.fn(async () => ({ remaining: 10 })),
    }
    const manager = new CloudIdentityManager({ client, store })

    await expect(manager.startGuest()).rejects.toThrow('offline')
    const pending = store.value().pendingRegistrationKey
    expect(pending).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    await manager.startGuest()
    expect(calls).toEqual([pending, pending])
    expect(store.value()).toMatchObject({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh' })
    expect(store.value().pendingRegistrationKey).toBeUndefined()
  })

  it('replaces a persisted legacy registration key even when the request is unchanged', async () => {
    const store = createMemoryStore()
    const client = {
      registerGuest: vi.fn(async () => {
        if (client.registerGuest.mock.calls.length === 1) throw new CloudApiError('offline', { code: 'cloud_unavailable' })
        return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' }
      }),
      me: vi.fn(async () => ({ id: 'account-1', mode: 'guest', plan: 'guest' })),
      usage: vi.fn(async () => ({ remaining: 10 })),
    }
    const manager = new CloudIdentityManager({ client, store })

    await expect(manager.startGuest()).rejects.toThrow('offline')
    await store.update((current) => ({ ...current, pendingRegistrationKey: 'legacy-base64url-registration-key' }))
    await manager.startGuest()
    const idempotencyKey = client.registerGuest.mock.calls[1][1]
    expect(idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(idempotencyKey).not.toBe('legacy-base64url-registration-key')
  })

  it('coalesces concurrent refresh calls and rotates the persisted token', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'old-refresh' })
    let release
    const client = {
      refresh: vi.fn(() => new Promise((resolve) => { release = resolve })),
    }
    const manager = new CloudIdentityManager({ client, store })
    const first = manager.refresh()
    const second = manager.refresh()
    await vi.waitFor(() => expect(client.refresh).toHaveBeenCalledTimes(1))
    release({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })
    await expect(Promise.all([first, second])).resolves.toEqual(['new-access', 'new-access'])
    expect(store.value().refreshToken).toBe('new-refresh')
  })

  it('refreshes once after a 401 and does not loop', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-1' })
    const client = {
      refresh: vi.fn(async () => ({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })),
    }
    const manager = new CloudIdentityManager({ client, store })
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
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'bad' })
    const client = { refresh: vi.fn(async () => { throw new CloudApiError('reused', { status: 401, code: 'refresh_token_reused' }) }) }
    const manager = new CloudIdentityManager({ client, store })
    await expect(manager.refresh()).rejects.toThrow('reused')
    expect(store.value().refreshToken).toBeUndefined()
    expect(store.value().publicKey).toBe('public-key')
    expect(store.value().rotateInstallationBeforeRegistration).toBe(true)
  })

  it('revokes the current installation before clearing the local session', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-1' })
    const client = {
      refresh: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh-2', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })),
      revokeInstallation: vi.fn(async () => undefined),
    }
    const manager = new CloudIdentityManager({ client, store })
    await manager.logout()
    expect(client.revokeInstallation).toHaveBeenCalledWith('access', 'install-1', undefined)
    expect(store.value()).toMatchObject({ mode: 'local', rotateInstallationBeforeRegistration: true })
    expect(store.value().refreshToken).toBeUndefined()
  })

  it('keeps the local session when remote logout fails', async () => {
    const store = createMemoryStore({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-1' })
    const client = {
      refresh: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh-2', expiresIn: 300, installationId: 'install-1', identityMode: 'guest' })),
      revokeInstallation: vi.fn(async () => { throw new CloudApiError('offline', { code: 'cloud_unavailable' }) }),
    }
    const manager = new CloudIdentityManager({ client, store })
    await expect(manager.logout()).rejects.toThrow('offline')
    expect(store.value()).toMatchObject({ mode: 'guest', installationId: 'install-1', refreshToken: 'refresh-2' })
  })

  it('rotates the installation identity before registering after logout', async () => {
    const store = createMemoryStore({ rotateInstallationBeforeRegistration: true })
    const client = {
      registerGuest: vi.fn(async () => ({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 300, installationId: 'install-2', identityMode: 'guest' })),
      me: vi.fn(async () => ({ id: 'account-2', mode: 'guest', plan: 'guest' })),
      usage: vi.fn(async () => ({ remaining: 10 })),
    }
    const manager = new CloudIdentityManager({ client, store })
    await manager.startGuest()
    expect(client.registerGuest).toHaveBeenCalledWith(expect.objectContaining({ publicKey: 'rotated-public-key' }), expect.any(String), undefined)
  })
})
