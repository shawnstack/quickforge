import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let tmpDir
let previousDataDir

function request(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = {}
  req.socket = { remoteAddress: '127.0.0.1' }
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
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-shares-route-'))
  process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  await rm(tmpDir, { recursive: true, force: true })
})

describe('share management routes', () => {
  it('lists, disables, restores and permanently deletes a share', async () => {
    const { writeSessionValue } = await import('../../../server/storage.mjs')
    const { handleSharesApi } = await import('../../../server/routes/shares.mjs')
    await writeSessionValue('route-session', {
      id: 'route-session',
      title: 'Route share',
      scope: 'global',
      messages: [],
    })

    const createRes = response()
    await handleSharesApi(
      request('POST', { sessionId: 'route-session', permission: 'read', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      createRes,
      new URL('http://localhost/api/shares'),
      { port: 5176 },
    )
    expect(createRes.status).toBe(201)
    const created = JSON.parse(createRes.body).share

    const listRes = response()
    await handleSharesApi(request('GET'), listRes, new URL('http://localhost/api/shares'), { port: 5176 })
    expect(JSON.parse(listRes.body).shares).toHaveLength(1)

    const expirationRes = response()
    await handleSharesApi(
      request('POST', { expiresAt: undefined }),
      expirationRes,
      new URL(`http://localhost/api/shares/${created.id}/expiration`),
      { port: 5176 },
    )
    expect(JSON.parse(expirationRes.body).share.expiresAt).toBeUndefined()

    const updateRes = response()
    await handleSharesApi(
      request('POST', { permission: 'operate', password: 'secret123' }),
      updateRes,
      new URL(`http://localhost/api/shares/${created.id}/update`),
      { port: 5176 },
    )
    expect(JSON.parse(updateRes.body).share).toMatchObject({ permission: 'operate', hasPassword: true })

    await expect(handleSharesApi(
      request('POST', { permission: 'operate', password: '' }),
      response(),
      new URL(`http://localhost/api/shares/${created.id}/update`),
      { port: 5176 },
    )).rejects.toMatchObject({ statusCode: 400 })

    const disableRes = response()
    await handleSharesApi(request('POST'), disableRes, new URL(`http://localhost/api/shares/${created.id}/disable`), { port: 5176 })
    expect(JSON.parse(disableRes.body).share.revokedAt).toBeTruthy()

    const restoreRes = response()
    await handleSharesApi(
      request('POST', { expiresAt: new Date(Date.now() + 120_000).toISOString() }),
      restoreRes,
      new URL(`http://localhost/api/shares/${created.id}/restore`),
      { port: 5176 },
    )
    expect(JSON.parse(restoreRes.body).share.revokedAt).toBeUndefined()

    const deleteRes = response()
    await handleSharesApi(request('DELETE'), deleteRes, new URL(`http://localhost/api/shares/${created.id}/permanent`), { port: 5176 })
    expect(JSON.parse(deleteRes.body).ok).toBe(true)

    const finalListRes = response()
    await handleSharesApi(request('GET'), finalListRes, new URL('http://localhost/api/shares'), { port: 5176 })
    expect(JSON.parse(finalListRes.body).shares).toEqual([])
  })
})
