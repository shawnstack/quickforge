import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getCloudInstallations,
  getCloudModels,
  getCloudStatus,
  getCloudUsage,
  logoutCloud,
  revokeCloudInstallation,
  startCloudGuest,
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
    expect(init?.headers).not.toHaveProperty('Authorization')
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
  })

  it('uses the local service error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Cloud is disabled' }), { status: 503 })))
    await expect(getCloudStatus()).rejects.toThrow('Cloud is disabled')
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
  })
})
