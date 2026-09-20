import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'

const mocks = vi.hoisted(() => ({ readStore: vi.fn(async () => ({})) }))

vi.mock('../../../server/storage.mjs', () => ({ readStore: mocks.readStore }))
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
