import { describe, expect, it, vi } from 'vitest'
import { createCloudRouteHandler } from '../../../server/routes/cloud.mjs'

const CLOUD_ACTION_HEADERS = { 'x-quickforge-action': 'cloud-action' }
const CLOUD_JSON_HEADERS = { ...CLOUD_ACTION_HEADERS, 'content-type': 'application/json' }

function request(method = 'GET', body, headers = {}) {
  async function* chunks() {
    if (body !== undefined) yield Buffer.from(JSON.stringify(body))
  }
  return { method, headers, [Symbol.asyncIterator]: chunks }
}

function cloudRequest(method, body) {
  return request(method, body, body === undefined ? CLOUD_ACTION_HEADERS : CLOUD_JSON_HEADERS)
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

  it.each([
    ['PUT', '/api/cloud/config', { cloudUrl: 'http://127.0.0.1:8082' }],
    ['POST', '/api/cloud/test-connection', { cloudUrl: 'http://127.0.0.1:8082' }],
    ['POST', '/api/cloud/identity/reset', { confirm: 'reset-cloud-identity' }],
    ['POST', '/api/cloud/guest/start'],
    ['POST', '/api/cloud/logout'],
    ['DELETE', '/api/cloud/installations/i-2'],
  ])('rejects %s %s without the Cloud action header', async (method, pathname, body) => {
    const runtimeFactory = vi.fn(runtime)
    const handler = createCloudRouteHandler({ runtimeFactory })
    const headers = body === undefined ? {} : { 'content-type': 'application/json' }
    await expect(handler(request(method, body, headers), response(), new URL(`http://localhost${pathname}`), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 403, code: 'cloud_action_header_required' })
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('rejects Cloud JSON writes sent as text/plain', async () => {
    const runtimeFactory = vi.fn(runtime)
    const handler = createCloudRouteHandler({ runtimeFactory })
    await expect(handler(request('POST', { cloudUrl: 'http://127.0.0.1:8082' }, {
      ...CLOUD_ACTION_HEADERS,
      'content-type': 'text/plain',
    }), response(), new URL('http://localhost/api/cloud/test-connection'), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 415, code: 'cloud_json_content_type_required' })
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('lets a valid action header and JSON Content-Type pass the request guards', async () => {
    const runtimeFactory = vi.fn(runtime)
    const handler = createCloudRouteHandler({ runtimeFactory })
    await expect(handler(cloudRequest('POST', { cloudUrl: 'http://127.0.0.1:8082' }), response(), new URL('http://localhost/api/cloud/test-connection'), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 404, code: 'route_not_found' })
    expect(runtimeFactory).toHaveBeenCalledTimes(1)
  })

  it('allows an authenticated Tailscale client to perform a protected write', async () => {
    const current = runtime()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    const res = response()
    await handler(cloudRequest('POST'), res, new URL('http://localhost/api/cloud/guest/start'), {
      isLocalRequest: false,
      remoteAddress: '100.96.93.16',
      remoteAuthorized: true,
    })
    expect(res.status).toBe(201)
    expect(current.identity.startGuest).toHaveBeenCalledTimes(1)
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
    await handler(cloudRequest('POST'), res, new URL('http://localhost/api/cloud/guest/start'), { isLocalRequest: true })
    expect(res.status).toBe(201)
    expect(current.identity.startGuest).toHaveBeenCalledTimes(1)
  })

  it('returns public cloud models and handles revoke/logout locally', async () => {
    const current = runtime()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    const models = response()
    await handler(request(), models, new URL('http://localhost/api/cloud/models'), { isLocalRequest: true })
    expect(JSON.parse(models.body).items).toEqual([{ id: 'qf-fast', provider: 'quickforge-cloud' }])

    await handler(cloudRequest('DELETE'), response(), new URL('http://localhost/api/cloud/installations/i-2'), { isLocalRequest: true })
    expect(current.identity.revokeInstallation).toHaveBeenCalledWith('i-2')
    await handler(cloudRequest('POST'), response(), new URL('http://localhost/api/cloud/logout'), { isLocalRequest: true })
    expect(current.identity.logout).toHaveBeenCalledTimes(1)
  })

  it('does not report logout success when remote revocation fails', async () => {
    const current = runtime()
    current.identity.logout.mockRejectedValue(new Error('offline'))
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    await expect(handler(cloudRequest('POST'), response(), new URL('http://localhost/api/cloud/logout'), { isLocalRequest: true }))
      .rejects.toThrow('offline')
  })
})
