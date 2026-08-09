import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelCloudDeviceFlow,
  CloudClientError,
  getCloudConfig,
  getCloudInstallations,
  getCloudModels,
  getCloudRemoteStatus,
  getCloudStatus,
  getCloudUsage,
  logoutCloud,
  pollCloudDeviceFlow,
  resetCloudIdentity,
  revokeCloudInstallation,
  startCloudDeviceFlow,
  startCloudGuest,
  testCloudConnection,
  updateCloudConfig,
} from '../../src/lib/cloud-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cloud client', () => {
  it('loads local cloud status without credentials or browser caching', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ configured: true, mode: 'local' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getCloudStatus()).resolves.toMatchObject({ configured: true, mode: 'local' })
    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/status', expect.objectContaining({ cache: 'no-store' }))
    const init = fetchMock.mock.calls[0][1]
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('x-quickforge-action')).toBeNull()
  })

  it('loads the managed remote agent status with a same-origin GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ enabled: true, status: 'authorizing', serverUrl: 'http://127.0.0.1:5177/', pid: 42 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getCloudRemoteStatus()).resolves.toMatchObject({ status: 'authorizing', pid: 42 })
    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/remote/status', expect.objectContaining({ cache: 'no-store' }))
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('x-quickforge-action')).toBeNull()
  })

  it('uses same-origin typed config, test, update, and reset APIs', async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path.endsWith('/test-connection')) return new Response(JSON.stringify({ ok: true, cloudUrl: 'http://localhost:8082/', health: { ok: true }, ready: { ready: true } }), { status: 200 })
      if (path.endsWith('/identity/reset')) return new Response(JSON.stringify({ ok: true, mode: 'local' }), { status: 200 })
      return new Response(JSON.stringify({ schemaVersion: 1, serviceType: 'quickforge-cloud', cloudUrl: 'http://localhost:8082/', source: 'saved' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCloudConfig()).resolves.toMatchObject({ serviceType: 'quickforge-cloud' })
    await expect(testCloudConnection('http://localhost:8082')).resolves.toMatchObject({ ok: true })
    await expect(updateCloudConfig({ cloudUrl: 'http://localhost:8082' })).resolves.toMatchObject({ source: 'saved' })
    await expect(updateCloudConfig({ enabled: false })).resolves.toMatchObject({ source: 'saved' })
    await expect(resetCloudIdentity()).resolves.toMatchObject({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/test-connection', expect.objectContaining({ method: 'POST', body: JSON.stringify({ cloudUrl: 'http://localhost:8082' }) }))
    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/config', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ cloudUrl: 'http://localhost:8082' }) }))
    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/config', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: false }) }))
    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/identity/reset', expect.objectContaining({ body: JSON.stringify({ confirm: 'reset-cloud-identity' }) }))
    for (const [path, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBeNull()
      if (path === '/api/cloud/config' && !init?.method) {
        expect(headers.get('x-quickforge-action')).toBeNull()
        expect(headers.get('content-type')).toBeNull()
      } else {
        expect(headers.get('x-quickforge-action')).toBe('cloud-action')
        expect(headers.get('content-type')).toBe('application/json')
      }
    }
  })

  it('starts a guest explicitly and parses public models', async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path.endsWith('/guest/start')) return new Response(JSON.stringify({ configured: true, mode: 'guest' }), { status: 200 })
      return new Response(JSON.stringify({ items: [{ id: 'qf-fast', provider: 'quickforge-cloud' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(startCloudGuest()).resolves.toMatchObject({ mode: 'guest' })
    await expect(getCloudModels()).resolves.toEqual([{ id: 'qf-fast', provider: 'quickforge-cloud' }])
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('x-quickforge-action')).toBe('cloud-action')
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('x-quickforge-action')).toBeNull()
  })

  it('uses protected JSON requests for device flow and never sends a device code from the browser', async () => {
    const fetchMock = vi.fn(async (path: string) => new Response(JSON.stringify({
      configured: true,
      mode: path.endsWith('/poll') ? 'account' : 'guest',
      pendingDeviceFlow: path.endsWith('/start') ? { userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() + 60_000, interval: 5 } : undefined,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await startCloudDeviceFlow()
    await pollCloudDeviceFlow()
    await cancelCloudDeviceFlow()

    for (const [path, init] of fetchMock.mock.calls) {
      expect(path).toMatch(/^\/api\/cloud\/device\/(start|poll|cancel)$/)
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe('{}')
      expect(init?.body).not.toContain('deviceCode')
      const headers = new Headers(init?.headers)
      expect(headers.get('x-quickforge-action')).toBe('cloud-action')
      expect(headers.get('content-type')).toBe('application/json')
    }
  })

  it('preserves local service error codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Sign out first', code: 'cloud_session_active' }), { status: 409 })))
    const error = await updateCloudConfig({ cloudUrl: 'https://new.example' }).catch((value) => value)
    expect(error).toBeInstanceOf(CloudClientError)
    expect(error).toMatchObject({ message: 'Sign out first', status: 409, code: 'cloud_session_active' })
  })

  it('loads usage and installations and sends device lifecycle mutations', async () => {
    const fetchMock = vi.fn(async (path: string) => {
      if (path.endsWith('/usage')) return new Response(JSON.stringify({ remaining: 99, resetsAt: '2026-09-01T00:00:00Z' }), { status: 200 })
      if (path.endsWith('/installations')) return new Response(JSON.stringify({ items: [{ id: 'i-1', name: 'Laptop', current: true }] }), { status: 200 })
      return new Response(JSON.stringify({ ok: true, mode: 'local' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCloudUsage()).resolves.toMatchObject({ remaining: 99 })
    await expect(getCloudInstallations()).resolves.toEqual([{ id: 'i-1', name: 'Laptop', current: true }])
    await expect(revokeCloudInstallation('i/2')).resolves.toMatchObject({ ok: true })
    await expect(logoutCloud()).resolves.toMatchObject({ mode: 'local' })

    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/installations/i%2F2', expect.objectContaining({ method: 'DELETE' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/logout', expect.objectContaining({ method: 'POST' }))
    for (const [path, init] of fetchMock.mock.calls) {
      const header = new Headers(init?.headers).get('x-quickforge-action')
      expect(header).toBe(path.endsWith('/usage') || path.endsWith('/installations') ? null : 'cloud-action')
    }
  })
})
