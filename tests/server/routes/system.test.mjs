import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { handleSystemApi } from '../../../server/routes/system.mjs'

function request(headers = {}) {
  const req = Readable.from([])
  req.method = 'POST'
  req.headers = headers
  return req
}

function getRequest() {
  const req = request()
  req.method = 'GET'
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
  it('rejects unauthenticated remote restart requests before side effects', async () => {
    const requestRestart = vi.fn()
    await expect(handleSystemApi(
      request({ 'x-quickforge-action': 'restart' }),
      response(),
      new URL('http://localhost/api/system/restart'),
      { isLocalRequest: false, remoteAuthorized: false, requestRestart },
    )).rejects.toMatchObject({ statusCode: 403 })
    expect(requestRestart).not.toHaveBeenCalled()
  })

  it('allows authenticated remote update and restart requests', async () => {
    const updateQuickForge = vi.fn(async () => ({ ok: true, updateStarted: false }))
    const updateRes = response()
    await handleSystemApi(
      request({ 'x-quickforge-action': 'update' }),
      updateRes,
      new URL('http://localhost/api/system/update'),
      { isLocalRequest: false, remoteAuthorized: true, updateQuickForge },
    )
    expect(updateQuickForge).toHaveBeenCalledOnce()
    expect(updateRes.status).toBe(200)

    const requestRestart = vi.fn(async () => ({ ok: true }))
    const restartRes = response()
    await handleSystemApi(
      request({ 'x-quickforge-action': 'restart' }),
      restartRes,
      new URL('http://localhost/api/system/restart'),
      { isLocalRequest: false, remoteAuthorized: true, requestRestart },
    )
    expect(requestRestart).toHaveBeenCalledOnce()
    expect(restartRes.status).toBe(202)
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

  it('serves update check snapshots without a 500 even when the registry check failed', async () => {
    const getUpdateCheckState = vi.fn(() => ({ status: 'error', checkError: 'request timeout' }))
    const res = response()
    await handleSystemApi(
      getRequest(),
      res,
      new URL('http://localhost/api/system/update/check'),
      { getUpdateCheckState },
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ status: 'error', checkError: 'request timeout' })
    expect(getUpdateCheckState).toHaveBeenCalledWith(false)
  })

  it('passes force=1 through to a manual update check', async () => {
    const getUpdateCheckState = vi.fn(() => ({ status: 'checking' }))
    const res = response()
    await handleSystemApi(
      getRequest(),
      res,
      new URL('http://localhost/api/system/update/check?force=1'),
      { getUpdateCheckState },
    )
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ status: 'checking' })
    expect(getUpdateCheckState).toHaveBeenCalledWith(true)
  })
})
