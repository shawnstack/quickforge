import { describe, expect, it, vi } from 'vitest'
import { CloudApiError, CloudClient } from '../../../server/cloud/client.mjs'

function hangingFetch() {
  // Hangs until the request signal aborts, mirroring a stalled upstream.
  return vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason))
  }))
}

describe('cloud client device flow', () => {
  it('uses the configured remote paths and OAuth device grant payloads', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const client = new CloudClient({ baseUrl: new URL('https://cloud.test/base/'), fetchImpl })

    await client.authorizeDevice({ installationId: 'install-1', clientId: 'quickforge-desktop' })
    await client.exchangeDeviceCode('device-secret', 'quickforge-desktop')
    await client.authorizeRemoteAgent('desktop-access-token', 'ABCD-EFGH')

    expect(fetchImpl).toHaveBeenNthCalledWith(1, new URL('https://cloud.test/base/oauth/device_authorization'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ installationId: 'install-1', clientId: 'quickforge-desktop' }),
    }))
    expect(new Headers(fetchImpl.mock.calls[0][1].headers).get('authorization')).toBeNull()
    expect(fetchImpl).toHaveBeenNthCalledWith(2, new URL('https://cloud.test/base/oauth/token'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
        deviceCode: 'device-secret',
        clientId: 'quickforge-desktop',
      }),
    }))
    expect(new Headers(fetchImpl.mock.calls[1][1].headers).get('authorization')).toBeNull()
    expect(fetchImpl).toHaveBeenNthCalledWith(3, new URL('https://cloud.test/base/v1/remote/agents/authorize'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ userCode: 'ABCD-EFGH' }),
    }))
    expect(new Headers(fetchImpl.mock.calls[2][1].headers).get('authorization')).toBe('Bearer desktop-access-token')
  })

  it('preserves OAuth error code, description, retryability, and status', async () => {
    const client = new CloudClient({
      baseUrl: new URL('https://cloud.test/'),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        error: 'slow_down',
        error_description: 'Poll less frequently.',
        retryable: true,
      }), { status: 400, headers: { 'content-type': 'application/json' } })),
    })

    const error = await client.exchangeDeviceCode('device-secret').catch((value) => value)
    expect(error).toBeInstanceOf(CloudApiError)
    expect(error).toMatchObject({
      message: 'Poll less frequently.',
      status: 400,
      code: 'slow_down',
      retryable: true,
    })
  })
})

describe('cloud client transport error classification', () => {
  it('maps a request that hits the timeout to a retryable 504 cloud_timeout', async () => {
    const fetchImpl = hangingFetch()
    const client = new CloudClient({ baseUrl: new URL('https://cloud.test/'), timeoutMs: 10, fetchImpl })

    const error = await client.models('token').catch((value) => value)
    expect(error).toBeInstanceOf(CloudApiError)
    expect(error).toMatchObject({
      status: 504,
      code: 'cloud_timeout',
      retryable: true,
    })
    expect(error.message).toContain('10ms')
  })

  it('maps a network TypeError to a retryable 502 cloud_unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const client = new CloudClient({ baseUrl: new URL('https://cloud.test/'), fetchImpl })

    const error = await client.models('token').catch((value) => value)
    expect(error).toBeInstanceOf(CloudApiError)
    expect(error).toMatchObject({
      status: 502,
      code: 'cloud_unreachable',
      retryable: true,
    })
    expect(error.message).toContain('QuickForge Cloud is unreachable: fetch failed')
  })

  it('rethrows external AbortError aborts without converting them to CloudApiError', async () => {
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
    }))
    const client = new CloudClient({ baseUrl: new URL('https://cloud.test/'), timeoutMs: 10_000, fetchImpl })
    const controller = new AbortController()

    const pending = client.models('token', controller.signal)
    controller.abort()
    const error = await pending.catch((value) => value)
    expect(error).not.toBeInstanceOf(CloudApiError)
    expect(error).toBeInstanceOf(DOMException)
    expect(error.name).toBe('AbortError')
  })
})
