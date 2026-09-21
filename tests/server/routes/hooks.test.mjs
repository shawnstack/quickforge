import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'

const mocks = vi.hoisted(() => ({ readStore: vi.fn(async () => ({})), writeStore: vi.fn(async () => {}) }))

vi.mock('../../../server/storage.mjs', () => ({ readStore: mocks.readStore, writeStore: mocks.writeStore }))
vi.mock('../../../server/agent-session-events.mjs', () => import('node:events').then(({ EventEmitter }) => ({ agentEvents: new EventEmitter() })))

const { handleHooksApi } = await import('../../../server/routes/hooks.mjs')
const { getRecentHookExecutions, pushHookExecution } = await import('../../../server/hooks/hook-engine.mjs')

function mockRequest(method, body) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  request.method = method
  request.headers = {}
  return request
}

function mockResponse() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null
    },
  }
}

const localContext = { isLocalRequest: true }
const remoteUnauthorizedContext = { isLocalRequest: false, remoteAuthorized: false }

function apiUrl(pathname) {
  return new URL(`http://127.0.0.1:5176${pathname}`)
}

describe('hooks routes', () => {
  it('rejects unauthenticated clients with 403', async () => {
    await expect(handleHooksApi(mockRequest('GET'), mockResponse(), apiUrl('/api/hooks/executions'), remoteUnauthorizedContext))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns the recent execution log', async () => {
    pushHookExecution({ id: 'exec-1', hookId: 'h1', status: 'success' })
    const response = mockResponse()
    await handleHooksApi(mockRequest('GET'), response, apiUrl('/api/hooks/executions'), localContext)
    expect(response.status).toBe(200)
    const ids = response.body.executions.map((execution) => execution.id)
    expect(ids).toContain('exec-1')
  })

  it('pages the execution log with limit/offset query params', async () => {
    for (let index = 0; index < 6; index += 1) {
      pushHookExecution({ id: `page-${index}`, hookId: 'h1', status: 'success' })
    }

    // Default envelope: limit 20, offset 0, newest-first.
    const first = mockResponse()
    await handleHooksApi(mockRequest('GET'), first, apiUrl('/api/hooks/executions'), localContext)
    expect(first.status).toBe(200)
    expect(first.body.limit).toBe(20)
    expect(first.body.offset).toBe(0)
    expect(first.body.total).toBeGreaterThanOrEqual(6)
    expect(Array.isArray(first.body.executions)).toBe(true)
    expect(first.body.executions[0].id).toBe('page-5')

    // Explicit limit/offset slice the same newest-first order.
    const second = mockResponse()
    await handleHooksApi(mockRequest('GET'), second, apiUrl('/api/hooks/executions?limit=2&offset=1'), localContext)
    expect(second.body.limit).toBe(2)
    expect(second.body.offset).toBe(1)
    expect(second.body.total).toBe(first.body.total)
    expect(second.body.executions.map((execution) => execution.id))
      .toEqual(first.body.executions.slice(1, 3).map((execution) => execution.id))

    // Clamp: 0 → 1, oversized → 100, unparsable → default 20.
    const clampedLow = mockResponse()
    await handleHooksApi(mockRequest('GET'), clampedLow, apiUrl('/api/hooks/executions?limit=0'), localContext)
    expect(clampedLow.body.limit).toBe(1)

    const clampedHigh = mockResponse()
    await handleHooksApi(mockRequest('GET'), clampedHigh, apiUrl('/api/hooks/executions?limit=999'), localContext)
    expect(clampedHigh.body.limit).toBe(100)

    const unparsable = mockResponse()
    await handleHooksApi(mockRequest('GET'), unparsable, apiUrl('/api/hooks/executions?limit=abc&offset=xyz'), localContext)
    expect(unparsable.body.limit).toBe(20)
    expect(unparsable.body.offset).toBe(0)

    // Out-of-range offset yields an empty page while total stays intact.
    const beyond = mockResponse()
    await handleHooksApi(mockRequest('GET'), beyond, apiUrl(`/api/hooks/executions?offset=${first.body.total}`), localContext)
    expect(beyond.body.executions).toEqual([])
    expect(beyond.body.total).toBe(first.body.total)
    expect(beyond.body.offset).toBe(first.body.total)
  })

  it('runs a manual test with a synthetic context without touching the execution log', async () => {
    const before = getRecentHookExecutions().length
    const response = mockResponse()
    await handleHooksApi(mockRequest('POST', {
      hook: {
        id: 'manual',
        name: 'Manual',
        enabled: true,
        events: ['agent_start'],
        action: { type: 'command', command: 'node -e "process.stdout.write(\'manual\')"' },
        timeoutSeconds: 10,
        silentOnFailure: false,
      },
    }), response, apiUrl('/api/hooks/test'), localContext)
    expect(response.status).toBe(200)
    expect(response.body.execution.status).toBe('success')
    expect(response.body.execution.test).toBe(true)
    expect(response.body.execution.event).toBe('test')
    expect(getRecentHookExecutions().length).toBe(before)
  })

  it('rejects a test payload without a usable hook action with 400', async () => {
    await expect(handleHooksApi(mockRequest('POST', { hook: { id: 'broken', name: 'Broken', action: { type: 'nope' } } }), mockResponse(), apiUrl('/api/hooks/test'), localContext))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(handleHooksApi(mockRequest('POST', {}), mockResponse(), apiUrl('/api/hooks/test'), localContext))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('falls through to 404 for unknown hooks endpoints', async () => {
    await expect(handleHooksApi(mockRequest('GET'), mockResponse(), apiUrl('/api/hooks/unknown'), localContext))
      .rejects.toMatchObject({ statusCode: 404 })
    await expect(handleHooksApi(mockRequest('DELETE'), mockResponse(), apiUrl('/api/hooks/executions'), localContext))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
