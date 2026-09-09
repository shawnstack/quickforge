import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@earendil-works/pi-web-ui', () => ({ translations: { en: {}, zh: {} } }))
import { ServerAgent } from '../../src/lib/server-agent'

const preview = {
  revision: 'revision-1', canRollback: true,
  files: [{ path: '/workspace/a', relativePath: 'a', revision: 'file-r1', safe: true, reason: '', action: 'restore' }],
}
const result = { status: 'completed', restored: 1, removedCreated: 0, errors: [], preview }
// Exercise the actual HTTP methods without starting the unrelated global SSE subscription.
function client() {
  return Object.assign(Object.create(ServerAgent.prototype) as ServerAgent, { sessionId: 'session/a', baseUrl: 'http://localhost:5176' })
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('file rollback HTTP contract', () => {
  it('fetches the encoded read-only preview and forwards an abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(preview))
    vi.stubGlobal('fetch', fetchMock)
    await expect(client().getFileRollbackPreview()).resolves.toEqual(preview)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5176/api/agents/session%2Fa/rollback-files/preview', { signal: expect.any(AbortSignal) })
  })

  it.each([[200, 'completed'], [409, 'blocked'], [500, 'failed']] as const)('preserves structured HTTP %s %s including preview and partial counts', async (status, outcome) => {
    const payload = { ...result, status: outcome, restored: 3, removedCreated: 2, errors: outcome === 'failed' ? [{ path: 'a', message: 'IO failure' }] : [] }
    const fetchMock = vi.fn().mockResolvedValue(response(payload, status))
    vi.stubGlobal('fetch', fetchMock)
    await expect(client().rollbackFiles('revision-1')).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5176/api/agents/session%2Fa/rollback-files', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: 'revision-1' }), signal: expect.any(AbortSignal),
    })
  })

  it.each([
    [403, { error: 'Forbidden' }], [500, { error: 'Internal error' }], [200, { ...result, errors: undefined }],
    [200, { ...result, status: 'blocked' }], [409, { ...result, status: 'completed' }],
    [200, { ...result, preview: { ...preview, files: [{}] } }],
  ])('throws unstructured or invalid HTTP %s responses instead of inventing success', async (status, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload, status as number)))
    await expect(client().rollbackFiles('r1')).rejects.toThrow()
  })

  it.each([[200, 'partial'], [200, 'completed'], [409, 'blocked'], [500, 'failed']] as const)('uses the separate single endpoint for HTTP %s %s with exact path and file revision', async (status, outcome) => {
    const remaining = { ...preview, files: [{ ...preview.files[0], path: '/workspace/b', revision: 'file-r2' }] }
    const payload = { ...result, status: outcome, preview: outcome === 'completed' ? { ...preview, files: [] } : remaining }
    const fetchMock = vi.fn().mockResolvedValue(response(payload, status))
    vi.stubGlobal('fetch', fetchMock)
    await expect(client().rollbackFile('/workspace/a', 'file-r1')).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5176/api/agents/session%2Fa/rollback-file', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/workspace/a', revision: 'file-r1' }), signal: expect.any(AbortSignal),
    })
  })

  it.each([
    [404, { error: 'Not found' }], [500, { error: 'IO' }], [200, { ...result, status: 'blocked' }],
    [409, { ...result, status: 'partial' }], [200, { ...result, errors: undefined }],
    [200, { ...result, preview: { ...preview, files: [{ ...preview.files[0], revision: 123 }] } }],
  ])('rejects invalid single-file HTTP %s responses and never falls back to whole-batch rollback', async (status, payload) => {
    const fetchMock = vi.fn().mockResolvedValue(response(payload, status as number))
    vi.stubGlobal('fetch', fetchMock)
    await expect(client().rollbackFile('/workspace/a', 'file-r1')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:5176/api/agents/session%2Fa/rollback-file')
  })

  it('accepts legacy previews but validates any file revision supplied by a newer server', async () => {
    const legacy = { ...preview, files: [{ ...preview.files[0], revision: undefined }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(legacy))
      .mockResolvedValueOnce(response({ ...preview, files: [{ ...preview.files[0], revision: 42 }] })))
    await expect(client().getFileRollbackPreview()).resolves.toEqual(legacy)
    await expect(client().getFileRollbackPreview()).rejects.toThrow()
  })

  it('rejects malformed and unavailable previews', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ ...preview, canRollback: 'yes' })).mockResolvedValueOnce(response({ error: 'not found' }, 404)))
    await expect(client().getFileRollbackPreview()).rejects.toThrow()
    await expect(client().getFileRollbackPreview()).rejects.toThrow()
  })

  it.each(['preview', 'execute', 'single'] as const)('propagates cancellation and clears the %s timeout', async (operation) => {
    vi.useFakeTimers()
    let receivedSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      receivedSignal = init.signal as AbortSignal
      receivedSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })))
    const abort = new AbortController()
    const request = operation === 'preview' ? client().getFileRollbackPreview(abort.signal)
      : operation === 'single' ? client().rollbackFile('/workspace/a', 'file-r1', abort.signal) : client().rollbackFiles('r1', abort.signal)
    const assertion = expect(request).rejects.toThrow('aborted')
    abort.abort()
    await assertion
    expect(receivedSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([['preview', 30_000], ['execute', 60_000], ['single', 60_000]] as const)('bounds the %s request including response-body reading', async (operation, timeout) => {
    vi.useFakeTimers()
    let receivedSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      receivedSignal = init.signal as AbortSignal
      return { status: 200, ok: true, json: () => new Promise((_resolve, reject) => {
        receivedSignal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
      }) }
    }))
    const request = operation === 'preview' ? client().getFileRollbackPreview()
      : operation === 'single' ? client().rollbackFile('/workspace/a', 'file-r1') : client().rollbackFiles('r1')
    const assertion = expect(request).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(timeout)
    await assertion
    expect(receivedSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
