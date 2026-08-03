import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { handleSystemApi } from '../../../server/routes/system.mjs'

function request(headers = {}) {
  const req = Readable.from([])
  req.method = 'POST'
  req.headers = headers
  return req
}

function response() {
  return {
    status: undefined,
    body: '',
    writeHead(status) { this.status = status },
    end(body = '') { this.body += body },
  }
}

describe('system remote access policy', () => {
  it('rejects restart requests from remote clients before side effects', async () => {
    const requestRestart = vi.fn()
    await expect(handleSystemApi(
      request({ 'x-quickforge-action': 'restart' }),
      response(),
      new URL('http://localhost/api/system/restart'),
      { isLocalRequest: false, requestRestart },
    )).rejects.toMatchObject({ statusCode: 403 })
    expect(requestRestart).not.toHaveBeenCalled()
  })

  it('rejects remote terminal shell updates', async () => {
    const req = request()
    req.method = 'PUT'
    await expect(handleSystemApi(
      req,
      response(),
      new URL('http://localhost/api/system/terminal-shell'),
      { isLocalRequest: false },
    )).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a local restart request with the action header', async () => {
    const requestRestart = vi.fn(async () => ({ ok: true }))
    const res = response()
    await handleSystemApi(
      request({ 'x-quickforge-action': 'restart' }),
      res,
      new URL('http://localhost/api/system/restart'),
      { isLocalRequest: true, requestRestart },
    )
    expect(requestRestart).toHaveBeenCalledOnce()
    expect(res.status).toBe(202)
  })
})
