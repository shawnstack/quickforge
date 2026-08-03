import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let tmpDir
let previousDataDir

function request(method, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = headers
  req.socket = { remoteAddress: '192.168.1.30' }
  return req
}

function response() {
  return {
    status: undefined,
    body: '',
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
    writeHead(status, headers = {}) {
      this.status = status
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value)
    },
    end(body = '') { this.body += body },
  }
}

beforeEach(async () => {
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-lan-access-route-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  await rm(tmpDir, { recursive: true, force: true })
})

describe('LAN access routes', () => {
  it('records device metadata and lets only the local host revoke a selected session', async () => {
    const store = await import('../../../server/lan-access-store.mjs')
    const { handleLanAccessApi } = await import('../../../server/routes/lan-access.mjs')
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })

    const unlockReq = request('POST', { password: 'password123' }, { 'user-agent': 'Route Test Browser' })
    const unlockRes = response()
    await handleLanAccessApi(unlockReq, unlockRes, new URL('http://localhost/api/lan-access/unlock'), { isLocalRequest: false, port: 5176 })
    expect(unlockRes.status).toBe(200)
    expect(unlockRes.headers['set-cookie']).toContain('qf_lan_access=')

    const statusRes = response()
    await handleLanAccessApi(request('GET'), statusRes, new URL('http://localhost/api/lan-access/status'), { isLocalRequest: true, port: 5176 })
    const status = JSON.parse(statusRes.body)
    expect(status.activeDevices[0]).toMatchObject({ address: '192.168.1.30', userAgent: 'Route Test Browser' })

    await expect(handleLanAccessApi(
      request('POST', { id: status.activeDevices[0].id }),
      response(),
      new URL('http://localhost/api/lan-access/revoke'),
      { isLocalRequest: false, port: 5176 },
    )).rejects.toMatchObject({ statusCode: 403 })

    const revokeRes = response()
    await handleLanAccessApi(
      request('POST', { id: status.activeDevices[0].id }),
      revokeRes,
      new URL('http://localhost/api/lan-access/revoke'),
      { isLocalRequest: true, port: 5176 },
    )
    expect(JSON.parse(revokeRes.body)).toMatchObject({ ok: true, activeTokenCount: 0, activeDevices: [] })
  })

  it('removes the server session when a LAN client logs out', async () => {
    const store = await import('../../../server/lan-access-store.mjs')
    const { handleLanAccessApi } = await import('../../../server/routes/lan-access.mjs')
    await store.updateLanAccessSettings({ enabled: true, password: 'password123', sessionTtlHours: 12 })
    const session = await store.issueLanAccessToken('password123')

    const logoutRes = response()
    await handleLanAccessApi(
      request('POST', undefined, { cookie: `${store.lanAccessCookieName()}=${encodeURIComponent(session.token)}` }),
      logoutRes,
      new URL('http://localhost/api/lan-access/logout'),
      { isLocalRequest: false, port: 5176 },
    )

    expect(logoutRes.headers['set-cookie']).toContain('Max-Age=0')
    await expect(store.verifyLanAccessToken(session.token)).resolves.toBe(false)
    await expect(store.readLanAccessStatus()).resolves.toMatchObject({ activeTokenCount: 0 })
  })
})
