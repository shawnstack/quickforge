import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServerAgent } from '../../src/lib/server-agent'

// Exercise the actual HTTP methods without starting the unrelated global SSE subscription.
function client() {
  return Object.assign(Object.create(ServerAgent.prototype) as ServerAgent, { sessionId: 'session/a', baseUrl: 'http://localhost:5176' })
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('turn rollback HTTP contract', () => {
  const turnPreview = {
    revision: 'turn-rev-1', turnIds: ['turn/1', 'turn 2'],
    files: [{ path: '/workspace/a', safe: true, reason: null, action: 'restore', created: true, beforeBytes: 0, afterBytes: 5 }],
  }
  const turnResult = {
    status: 'completed', rolledBack: [{ path: '/workspace/a', action: 'restore' }], conflicts: [],
  }

  it('fetches the encoded read-only turn preview for the whole turnIds collection and forwards an abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(turnPreview))
    vi.stubGlobal('fetch', fetchMock)
    await expect(client().getTurnRollbackPreview(['turn/1', 'turn 2'])).resolves.toEqual(turnPreview)
    // 一轮 = 原 run + 重试 run 的全部 turnId：逗号 join 后整体 encodeURIComponent
    //（逗号编码为 %2C，服务端 query 解码后再按逗号切分）。
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5176/api/agents/session%2Fa/rollback-turn/preview?turnIds=turn%2F1%2Cturn%202',
      { signal: expect.any(AbortSignal) },
    )
  })

  it.each([['completed'], ['partial']] as const)('resolves HTTP 200 turn rollback %s results with the reviewed revision and the whole turnIds array', async (outcome) => {
    const payload = { ...turnResult, status: outcome, conflicts: outcome === 'partial' ? [{ path: '/workspace/a', reason: 'external-change' }] : [] }
    const fetchMock = vi.fn().mockResolvedValue(response(payload))
    vi.stubGlobal('fetch', fetchMock)
    await expect(client().rollbackTurn(['turn/1', 'turn 2'], 'turn-rev-1')).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5176/api/agents/session%2Fa/rollback-turn', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnIds: ['turn/1', 'turn 2'], revision: 'turn-rev-1' }), signal: expect.any(AbortSignal),
    })
  })

  it('rejects an empty turnIds collection without issuing any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(client().getTurnRollbackPreview([])).rejects.toThrow()
    await expect(client().rollbackTurn([], 'turn-rev-1')).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('attaches the HTTP status to rejected executions (409 stale revision, 500 failure)', async () => {
    for (const [status, payload] of [[409, { error: 'stale revision' }], [500, { error: 'IO' }]] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload, status)))
      const request = client().rollbackTurn(['turn/1'], 'turn-rev-1')
      await expect(request).rejects.toThrow()
      await expect(request).rejects.toMatchObject({ status })
    }
  })

  it.each([
    [200, { ...turnResult, status: 'blocked' }],
    [200, { ...turnResult, rolledBack: undefined }],
    [200, { ...turnResult, conflicts: [{ path: 'a' }] }],
    [404, { error: 'Not found' }],
  ])('rejects invalid turn rollback HTTP %s responses instead of inventing success', async (status, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload, status as number)))
    await expect(client().rollbackTurn(['turn/1'], 'turn-rev-1')).rejects.toThrow()
  })

  it.each([
    [{ ...turnPreview, files: [{}] }],
    [{ ...turnPreview, revision: 42 }],
    [{ ...turnPreview, turnIds: 'turn/1' }],
    [{ ...turnPreview, turnIds: ['turn/1', 2] }],
  ])('rejects malformed turn previews with the HTTP status', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(payload)))
    await expect(client().getTurnRollbackPreview(['turn/1', 'turn 2'])).rejects.toThrow()
  })

  it('rejects unavailable turn previews with the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ error: 'not found' }, 404)))
    await expect(client().getTurnRollbackPreview(['turn/1'])).rejects.toMatchObject({ status: 404 })
  })
})
