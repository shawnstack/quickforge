import { describe, expect, it, vi } from 'vitest'
import { createCloudRouteHandler } from '../../../server/routes/cloud.mjs'

function request(method = 'GET') {
  return { method, headers: {} }
}

function response() {
  return {
    status: undefined, headers: undefined, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body = '') { this.body += body },
  }
}

function runtime() {
  return {
    enabled: true,
    identity: {
      status: vi.fn(async () => ({ mode: 'guest', hasSession: true, installationId: 'i-1' })),
      startGuest: vi.fn(async () => ({ mode: 'guest', usage: { remaining: 100 } })),
      usage: vi.fn(async () => ({ remaining: 100 })),
      installations: vi.fn(async () => ({ items: [] })),
      revokeInstallation: vi.fn(async () => undefined),
      logout: vi.fn(async () => undefined),
    },
    models: { list: vi.fn(async () => [{ id: 'qf-fast', provider: 'quickforge-cloud' }]) },
  }
}

describe('cloud routes', () => {
  it('rejects ordinary LAN requests before initializing the cloud runtime', async () => {
    const runtimeFactory = vi.fn(runtime)
    const handler = createCloudRouteHandler({ runtimeFactory })
    await expect(handler(request(), response(), new URL('http://localhost/api/cloud/status'), {
      isLocalRequest: false,
      remoteAddress: '192.168.1.20',
      remoteAuthorized: true,
    })).rejects.toMatchObject({ statusCode: 403, code: 'cloud_local_only' })
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('allows an authenticated Tailscale client', async () => {
    const current = runtime()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    const res = response()
    await handler(request(), res, new URL('http://localhost/api/cloud/status'), {
      isLocalRequest: false,
      remoteAddress: '::ffff:100.96.93.16',
      remoteAuthorized: true,
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ configured: true, mode: 'guest' })
  })

  it.each([
    ['LAN authentication missing', { remoteAddress: '100.96.93.16', remoteAuthorized: false }],
    ['ordinary LAN address', { remoteAddress: '192.168.1.20', remoteAuthorized: true }],
    ['public address', { remoteAddress: '8.8.8.8', remoteAuthorized: true }],
  ])('rejects %s', async (_name, options) => {
    const runtimeFactory = vi.fn(runtime)
    const handler = createCloudRouteHandler({ runtimeFactory })
    await expect(handler(request(), response(), new URL('http://localhost/api/cloud/status'), {
      isLocalRequest: false,
      ...options,
    })).rejects.toMatchObject({ statusCode: 403, code: 'cloud_local_only' })
    expect(runtimeFactory).not.toHaveBeenCalled()
  })


  it('returns local mode without creating a cloud session when disabled', async () => {
    const handler = createCloudRouteHandler({ runtimeFactory: () => ({ enabled: false }) })
    const res = response()
    await handler(request(), res, new URL('http://localhost/api/cloud/status'), { isLocalRequest: true })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ configured: false, mode: 'local' })
  })

  it('returns only the safe local status summary', async () => {
    const current = runtime()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    const res = response()
    await handler(request(), res, new URL('http://localhost/api/cloud/status'), { isLocalRequest: true })
    expect(JSON.parse(res.body)).toEqual({ configured: true, mode: 'guest', hasSession: true, installationId: 'i-1' })
    expect(res.body).not.toContain('token')
    expect(res.body).not.toContain('private')
  })

  it('starts a guest only after an explicit local POST', async () => {
    const current = runtime()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    const status = response()
    await handler(request(), status, new URL('http://localhost/api/cloud/status'), { isLocalRequest: true })
    expect(current.identity.startGuest).not.toHaveBeenCalled()

    const res = response()
    await handler(request('POST'), res, new URL('http://localhost/api/cloud/guest/start'), { isLocalRequest: true })
    expect(res.status).toBe(201)
    expect(current.identity.startGuest).toHaveBeenCalledTimes(1)
  })

  it('returns public cloud models and handles revoke/logout locally', async () => {
    const current = runtime()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    const models = response()
    await handler(request(), models, new URL('http://localhost/api/cloud/models'), { isLocalRequest: true })
    expect(JSON.parse(models.body).items).toEqual([{ id: 'qf-fast', provider: 'quickforge-cloud' }])

    await handler(request('DELETE'), response(), new URL('http://localhost/api/cloud/installations/i-2'), { isLocalRequest: true })
    expect(current.identity.revokeInstallation).toHaveBeenCalledWith('i-2')
    await handler(request('POST'), response(), new URL('http://localhost/api/cloud/logout'), { isLocalRequest: true })
    expect(current.identity.logout).toHaveBeenCalledTimes(1)
  })

  it('does not report logout success when remote revocation fails', async () => {
    const current = runtime()
    current.identity.logout.mockRejectedValue(new Error('offline'))
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    await expect(handler(request('POST'), response(), new URL('http://localhost/api/cloud/logout'), { isLocalRequest: true }))
      .rejects.toThrow('offline')
  })
})
