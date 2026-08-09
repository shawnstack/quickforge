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
    config: { enabled: true, baseUrl: new URL('https://old.example/') },
    identity: {
      status: vi.fn(async () => ({ mode: 'guest', hasSession: true, installationId: 'i-1' })),
      startGuest: vi.fn(async () => ({ mode: 'guest', usage: { remaining: 100 } })),
      startDeviceFlow: vi.fn(async () => ({ mode: 'guest', pendingDeviceFlow: { userCode: 'ABCD-EFGH' } })),
      pollDeviceFlow: vi.fn(async () => ({ mode: 'account', deviceFlowResult: 'success' })),
      cancelDeviceFlow: vi.fn(async () => ({ mode: 'guest' })),
      usage: vi.fn(async () => ({ remaining: 100 })),
      installations: vi.fn(async () => ({ items: [] })),
      revokeInstallation: vi.fn(async () => undefined),
      logout: vi.fn(async () => undefined),
      resetIdentity: vi.fn(async () => undefined),
    },
    models: { list: vi.fn(async () => [{ id: 'qf-fast', provider: 'quickforge-cloud' }]) },
  }
}

const savedConfig = {
  schemaVersion: 1,
  serviceType: 'quickforge-cloud',
  enabled: true,
  cloudUrl: 'https://old.example/',
  baseUrl: new URL('https://old.example/'),
  source: 'saved',
  saved: true,
  valid: true,
}

function handlerOptions(overrides = {}) {
  return {
    readServiceConfig: vi.fn(async () => savedConfig),
    saveServiceConfig: vi.fn(async () => undefined),
    credentialStoreFactory: () => ({ read: vi.fn(async () => ({ refreshToken: 'refresh-secret', sessionCloudUrl: 'https://old.example/' })), rotateInstallation: vi.fn() }),
    invalidateRuntime: vi.fn(),
    ...overrides,
  }
}

describe('cloud routes', () => {
  it('rejects requests without an explicit trusted client context', async () => {
    const runtimeFactory = vi.fn(runtime)
    const handler = createCloudRouteHandler({ runtimeFactory })
    await expect(handler(request(), response(), new URL('http://localhost/api/cloud/status')))
      .rejects.toMatchObject({ statusCode: 403, code: 'cloud_local_only' })
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('allows an authenticated remote client on any network', async () => {
    const current = runtime()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    const res = response()
    await handler(request(), res, new URL('http://localhost/api/cloud/status'), {
      isLocalRequest: false,
      remoteAddress: '192.168.1.20',
      remoteAuthorized: true,
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ configured: true, enabled: true, mode: 'guest' })
  })

  it.each([
    ['LAN authentication missing', { remoteAddress: '100.96.93.16', remoteAuthorized: false }],
    ['public client authentication missing', { remoteAddress: '8.8.8.8', remoteAuthorized: false }],
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
    ['POST', '/api/cloud/device/start', {}],
    ['POST', '/api/cloud/device/poll', {}],
    ['POST', '/api/cloud/device/cancel', {}],
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

  it('rejects JSON write bodies sent as text/plain', async () => {
    const cloudClientFactory = vi.fn()
    const handler = createCloudRouteHandler({ cloudClientFactory })
    await expect(handler(request('POST', { cloudUrl: 'http://127.0.0.1:8082' }, {
      ...CLOUD_ACTION_HEADERS,
      'content-type': 'text/plain',
    }), response(), new URL('http://localhost/api/cloud/test-connection'), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 415, code: 'cloud_json_content_type_required' })
    expect(cloudClientFactory).not.toHaveBeenCalled()
  })

  it('allows an authenticated remote client to perform a protected write', async () => {
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

  it('returns remote agent status before initializing the Cloud runtime', async () => {
    const runtimeFactory = vi.fn(runtime)
    const qfAgentStatus = vi.fn(() => ({ enabled: true, status: 'running', serverUrl: 'http://127.0.0.1:5176/', pid: 321 }))
    const handler = createCloudRouteHandler({ runtimeFactory, qfAgentStatus, readServiceConfig: vi.fn(async () => savedConfig) })
    const res = response()
    await handler(request(), res, new URL('http://localhost/api/cloud/remote/status'), { isLocalRequest: true })
    expect(JSON.parse(res.body)).toEqual({ enabled: true, status: 'running', serverUrl: 'http://127.0.0.1:5176/', pid: 321 })
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('returns disabled remote status without initializing the Cloud runtime', async () => {
    const runtimeFactory = vi.fn(runtime)
    const qfAgentStatus = vi.fn(() => ({ enabled: false, status: 'disabled', serverUrl: null, pid: null }))
    const handler = createCloudRouteHandler({ runtimeFactory, qfAgentStatus })
    const res = response()
    await handler(request(), res, new URL('http://localhost/api/cloud/remote/status'), { isLocalRequest: true })
    expect(JSON.parse(res.body)).toMatchObject({ enabled: false, status: 'disabled', serverUrl: null, pid: null })
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('returns and updates the safe managed-service config', async () => {
    const options = handlerOptions({ credentialStoreFactory: () => ({ read: async () => ({}), rotateInstallation: vi.fn() }) })
    const handler = createCloudRouteHandler(options)
    const get = response()
    await handler(request(), get, new URL('http://localhost/api/cloud/config'), { isLocalRequest: true })
    expect(JSON.parse(get.body)).toMatchObject({ serviceType: 'quickforge-cloud', enabled: true, cloudUrl: 'https://old.example/', source: 'saved' })

    const put = response()
    await handler(cloudRequest('PUT', { cloudUrl: 'http://127.0.0.1:8082' }), put, new URL('http://localhost/api/cloud/config'), { isLocalRequest: true })
    expect(options.saveServiceConfig).toHaveBeenCalledWith({ cloudUrl: 'http://127.0.0.1:8082/', enabled: true, allowInvalidUrl: false })
    expect(options.invalidateRuntime).toHaveBeenCalledTimes(1)
  })

  it('updates only enabled, preserves the URL, and does not read credentials', async () => {
    const credentialStore = { read: vi.fn(), rotateInstallation: vi.fn() }
    const onCloudServiceConfigChanged = vi.fn()
    const options = handlerOptions({
      readServiceConfig: vi.fn()
        .mockResolvedValueOnce(savedConfig)
        .mockResolvedValueOnce({ ...savedConfig, enabled: false }),
      credentialStoreFactory: () => credentialStore,
    })
    const handler = createCloudRouteHandler(options)
    const res = response()
    await handler(cloudRequest('PUT', { enabled: false }), res, new URL('http://localhost/api/cloud/config'), {
      isLocalRequest: true,
      onCloudServiceConfigChanged,
    })

    expect(credentialStore.read).not.toHaveBeenCalled()
    expect(options.saveServiceConfig).toHaveBeenCalledWith({ cloudUrl: 'https://old.example/', enabled: false, allowInvalidUrl: true })
    expect(onCloudServiceConfigChanged).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), { urlChanged: false })
    expect(JSON.parse(res.body)).toMatchObject({ enabled: false, cloudUrl: 'https://old.example/' })
  })

  it('can turn off an invalid saved URL without trying to parse it or read credentials', async () => {
    const credentialStore = { read: vi.fn(), rotateInstallation: vi.fn() }
    const invalidConfig = { ...savedConfig, enabled: true, valid: false, baseUrl: undefined, cloudUrl: 'ftp://invalid.example', configurationError: 'invalid' }
    const options = handlerOptions({
      readServiceConfig: vi.fn()
        .mockResolvedValueOnce(invalidConfig)
        .mockResolvedValueOnce({ ...invalidConfig, enabled: false, source: 'saved' }),
      credentialStoreFactory: () => credentialStore,
    })
    const handler = createCloudRouteHandler(options)
    const res = response()

    await handler(cloudRequest('PUT', { enabled: false }), res, new URL('http://localhost/api/cloud/config'), { isLocalRequest: true })

    expect(credentialStore.read).not.toHaveBeenCalled()
    expect(options.saveServiceConfig).toHaveBeenCalledWith({ cloudUrl: 'ftp://invalid.example', enabled: false, allowInvalidUrl: true })
    expect(JSON.parse(res.body)).toMatchObject({ enabled: false, valid: false, cloudUrl: 'ftp://invalid.example' })
  })

  it('keeps local status and logout available for a disabled invalid configuration', async () => {
    const store = {
      readPublic: vi.fn(async () => ({ mode: 'account', hasSession: true, account: { email: 'user@example.test' } })),
      clearSession: vi.fn(async () => undefined),
    }
    const invalidConfig = { ...savedConfig, enabled: false, valid: false, baseUrl: undefined, cloudUrl: 'ftp://invalid.example', configurationError: 'invalid' }
    const handler = createCloudRouteHandler({
      runtimeFactory: vi.fn(async () => { throw new Error('invalid') }),
      readServiceConfig: vi.fn(async () => invalidConfig),
      credentialStoreFactory: () => store,
    })

    const status = response()
    await handler(request(), status, new URL('http://localhost/api/cloud/status'), { isLocalRequest: true })
    expect(JSON.parse(status.body)).toMatchObject({ configured: true, enabled: false, mode: 'account', hasSession: true, configurationError: 'invalid' })

    await handler(cloudRequest('POST'), response(), new URL('http://localhost/api/cloud/logout'), { isLocalRequest: true })
    expect(store.clearSession).toHaveBeenCalledTimes(1)
  })

  it('blocks cross-URL save with an active session but allows the same URL', async () => {
    const options = handlerOptions()
    const handler = createCloudRouteHandler(options)
    await expect(handler(cloudRequest('PUT', { cloudUrl: 'https://new.example' }), response(), new URL('http://localhost/api/cloud/config'), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 409, code: 'cloud_session_active' })
    expect(options.saveServiceConfig).not.toHaveBeenCalled()

    await handler(cloudRequest('PUT', { cloudUrl: 'https://old.example' }), response(), new URL('http://localhost/api/cloud/config'), { isLocalRequest: true })
    expect(options.saveServiceConfig).toHaveBeenCalledWith({ cloudUrl: 'https://old.example/', enabled: true, allowInvalidUrl: false })

    const legacyOptions = handlerOptions({
      credentialStoreFactory: () => ({ read: vi.fn(async () => ({ refreshToken: 'legacy-refresh' })), rotateInstallation: vi.fn() }),
    })
    const legacyHandler = createCloudRouteHandler(legacyOptions)
    await expect(legacyHandler(cloudRequest('PUT', { cloudUrl: 'https://old.example' }), response(), new URL('http://localhost/api/cloud/config'), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 409, code: 'cloud_session_active' })

    const invalidOptions = handlerOptions({
      readServiceConfig: vi.fn(async () => ({ ...savedConfig, valid: false, cloudUrl: 'http://192.168.1.2:8082', baseUrl: undefined })),
      credentialStoreFactory: () => ({ read: vi.fn(async () => ({ refreshToken: 'refresh-secret', sessionCloudUrl: 'http://192.168.1.2:8082/' })), rotateInstallation: vi.fn() }),
    })
    const invalidHandler = createCloudRouteHandler(invalidOptions)
    await expect(invalidHandler(cloudRequest('PUT', { cloudUrl: 'https://repair.example' }), response(), new URL('http://localhost/api/cloud/config'), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 409, code: 'cloud_session_active' })
  })

  it('tests health and readiness with a one-time client only', async () => {
    const health = vi.fn(async () => ({ ok: true }))
    const ready = vi.fn(async () => ({ ready: true }))
    const runtimeFactory = vi.fn(runtime)
    const handler = createCloudRouteHandler({
      runtimeFactory,
      cloudClientFactory: vi.fn(({ baseUrl }) => ({ baseUrl, health, ready })),
    })
    const res = response()
    await handler(cloudRequest('POST', { cloudUrl: 'http://localhost:8082' }), res, new URL('http://localhost/api/cloud/test-connection'), { isLocalRequest: true })
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, cloudUrl: 'http://localhost:8082/' })
    expect(health).toHaveBeenCalledTimes(1)
    expect(ready).toHaveBeenCalledTimes(1)
    expect(runtimeFactory).not.toHaveBeenCalled()
  })

  it('requires explicit reset confirmation and does not perform remote logout', async () => {
    const current = runtime()
    const options = handlerOptions({ runtimeFactory: () => current })
    const handler = createCloudRouteHandler(options)
    await expect(handler(cloudRequest('POST', {}), response(), new URL('http://localhost/api/cloud/identity/reset'), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 400, code: 'cloud_reset_confirmation_required' })
    await handler(cloudRequest('POST', { confirm: 'reset-cloud-identity' }), response(), new URL('http://localhost/api/cloud/identity/reset'), { isLocalRequest: true })
    expect(current.identity.resetIdentity).toHaveBeenCalledTimes(1)
    expect(current.identity.logout).not.toHaveBeenCalled()
    expect(current.identity.revokeInstallation).not.toHaveBeenCalled()
    expect(options.invalidateRuntime).toHaveBeenCalledTimes(1)
  })

  it('returns only the safe local status summary and never starts a guest implicitly', async () => {
    const current = runtime()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    const res = response()
    await handler(request(), res, new URL('http://localhost/api/cloud/status'), { isLocalRequest: true })
    expect(JSON.parse(res.body)).toEqual({ configured: true, enabled: true, mode: 'guest', hasSession: true, installationId: 'i-1' })
    expect(res.body).not.toContain('token')
    expect(current.identity.startGuest).not.toHaveBeenCalled()
  })

  it('blocks remote Cloud operations while disabled but keeps local status and logout available', async () => {
    const current = runtime()
    current.enabled = false
    current.config = { enabled: false, baseUrl: new URL('https://old.example/') }
    current.identity.status.mockResolvedValue({ mode: 'account', hasSession: true, account: { email: 'person@example.com', plan: 'pro' }, installationId: 'i-1' })
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })

    const status = response()
    await handler(request(), status, new URL('http://localhost/api/cloud/status'), { isLocalRequest: true })
    expect(JSON.parse(status.body)).toEqual({
      configured: true,
      enabled: false,
      mode: 'account',
      hasSession: true,
      account: { email: 'person@example.com', plan: 'pro' },
      installationId: 'i-1',
    })

    for (const pathname of ['/api/cloud/models', '/api/cloud/usage', '/api/cloud/installations']) {
      await expect(handler(request(), response(), new URL(`http://localhost${pathname}`), { isLocalRequest: true }))
        .rejects.toMatchObject({ statusCode: 503, code: 'cloud_disabled' })
    }
    for (const pathname of ['/api/cloud/device/start', '/api/cloud/device/poll', '/api/cloud/device/cancel']) {
      await expect(handler(cloudRequest('POST', {}), response(), new URL(`http://localhost${pathname}`), { isLocalRequest: true }))
        .rejects.toMatchObject({ statusCode: 503, code: 'cloud_disabled' })
    }
    await expect(handler(cloudRequest('DELETE'), response(), new URL('http://localhost/api/cloud/installations/i-2'), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 503, code: 'cloud_disabled' })

    await handler(cloudRequest('POST'), response(), new URL('http://localhost/api/cloud/logout'), { isLocalRequest: true })
    expect(current.identity.logout).toHaveBeenCalledTimes(1)
    expect(current.identity.usage).not.toHaveBeenCalled()
    expect(current.identity.installations).not.toHaveBeenCalled()
    expect(current.identity.revokeInstallation).not.toHaveBeenCalled()
    expect(current.models.list).not.toHaveBeenCalled()
  })

  it('starts guest explicitly, returns models, and preserves remote-first logout semantics', async () => {
    const current = runtime()
    const invalidateRuntime = vi.fn()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current, invalidateRuntime })
    const guest = response()
    await handler(cloudRequest('POST'), guest, new URL('http://localhost/api/cloud/guest/start'), { isLocalRequest: true })
    expect(guest.status).toBe(201)

    const models = response()
    await handler(request(), models, new URL('http://localhost/api/cloud/models'), { isLocalRequest: true })
    expect(JSON.parse(models.body).items).toEqual([{ id: 'qf-fast', provider: 'quickforge-cloud' }])

    await handler(cloudRequest('DELETE'), response(), new URL('http://localhost/api/cloud/installations/i-2'), { isLocalRequest: true })
    expect(current.identity.revokeInstallation).toHaveBeenCalledWith('i-2')
    await handler(cloudRequest('POST'), response(), new URL('http://localhost/api/cloud/logout'), { isLocalRequest: true })
    expect(current.identity.logout).toHaveBeenCalledTimes(1)
    expect(invalidateRuntime).toHaveBeenCalledTimes(1)
  })

  it('proxies device flow start, poll, and cancel without exposing a device code', async () => {
    const current = runtime()
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    for (const [pathname, method] of [
      ['/api/cloud/device/start', 'startDeviceFlow'],
      ['/api/cloud/device/poll', 'pollDeviceFlow'],
      ['/api/cloud/device/cancel', 'cancelDeviceFlow'],
    ]) {
      const res = response()
      await handler(cloudRequest('POST', {}), res, new URL(`http://localhost${pathname}`), { isLocalRequest: true })
      expect(res.status).toBe(pathname.endsWith('/start') ? 201 : 200)
      expect(current.identity[method]).toHaveBeenCalledTimes(1)
      expect(res.body).not.toContain('deviceCode')
    }
  })

  it('does not report logout success when remote revocation fails', async () => {
    const current = runtime()
    current.identity.logout.mockRejectedValue(new Error('offline'))
    const handler = createCloudRouteHandler({ runtimeFactory: () => current })
    await expect(handler(cloudRequest('POST'), response(), new URL('http://localhost/api/cloud/logout'), { isLocalRequest: true }))
      .rejects.toThrow('offline')
  })
})
