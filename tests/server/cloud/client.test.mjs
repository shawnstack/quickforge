import { describe, expect, it, vi } from 'vitest'
import { CloudApiError, CloudClient } from '../../../server/cloud/client.mjs'

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
