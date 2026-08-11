import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restoreAgent: vi.fn(),
  getSessionState: vi.fn(),
  updateSessionHarnessConfigOption: vi.fn(),
  updateSessionHarnessMode: vi.fn(),
  forkSession: vi.fn(),
}))

vi.mock('../../../server/agent-manager.mjs', () => ({
  abortRun: vi.fn(),
  abortToolCall: vi.fn(),
  agentEvents: { on: vi.fn(), off: vi.fn() },
  approveAutoCompact: vi.fn(),
  approveToolCall: vi.fn(),
  continueSession: vi.fn(),
  createAgent: vi.fn(),
  destroyAgent: vi.fn(),
  followUpAgent: vi.fn(),
  getSessionEventBus: vi.fn(),
  getSessionState: mocks.getSessionState,
  getSessionStatus: vi.fn(),
  isSseConnected: vi.fn(),
  listSessions: vi.fn(() => []),
  rejectAutoCompact: vi.fn(),
  rejectToolCall: vi.fn(),
  releaseSse: vi.fn(),
  restoreAgent: mocks.restoreAgent,
  rollbackSessionMessages: vi.fn(),
  runPrompt: vi.fn(),
  steerAgent: vi.fn(),
  touchSession: vi.fn(),
  tryAcquireSse: vi.fn(),
  updateSessionAccessMode: vi.fn(),
  updateSessionHarnessConfigOption: mocks.updateSessionHarnessConfigOption,
  updateSessionHarnessMode: mocks.updateSessionHarnessMode,
  forkSession: mocks.forkSession,
  updateSessionModel: vi.fn(),
  updateSessionThinkingLevel: vi.fn(),
  updateSessionTitle: vi.fn(),
  updateSessionYoloMode: vi.fn(),
}))

vi.mock('../../../server/utils/logger.mjs', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

function request(body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.headers = {}
  return req
}

function response() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(body = '') { this.body = body },
  }
}

describe('agent restore route', () => {
  beforeEach(() => {
    mocks.restoreAgent.mockReset()
    mocks.getSessionState.mockReset()
  })

  it('restores once and returns the full state snapshot', async () => {
    const state = {
      sessionId: 'session-1',
      title: 'History',
      messages: [{ role: 'user', content: 'hello' }],
      isStreaming: false,
    }
    mocks.restoreAgent.mockResolvedValue({ sessionId: 'session-1' })
    mocks.getSessionState.mockReturnValue(state)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(request(), res, new URL('http://localhost/api/agents/session-1/restore'))

    expect(mocks.restoreAgent).toHaveBeenCalledTimes(1)
    expect(mocks.restoreAgent).toHaveBeenCalledWith('session-1')
    expect(mocks.getSessionState).toHaveBeenCalledWith('session-1')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual(state)
  })

  it('returns a not-found error when the session cannot be restored', async () => {
    mocks.restoreAgent.mockResolvedValue(null)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')

    await expect(handleAgentApi(
      request(),
      response(),
      new URL('http://localhost/api/agents/missing/restore'),
    )).rejects.toMatchObject({ statusCode: 404 })

    expect(mocks.restoreAgent).toHaveBeenCalledTimes(1)
    expect(mocks.getSessionState).not.toHaveBeenCalled()
  })
})

describe('agent Harness configuration routes', () => {
  beforeEach(() => {
    mocks.updateSessionHarnessConfigOption.mockReset()
    mocks.updateSessionHarnessMode.mockReset()
    mocks.forkSession.mockReset()
  })

  it('calls the config option manager method', async () => {
    const result = { sessionId: 'session-1', acpSession: { configOptions: [] } }
    mocks.updateSessionHarnessConfigOption.mockResolvedValue(result)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(request({ configId: 'model', value: 'gpt' }), res, new URL('http://localhost/api/agents/session-1/harness/config-option'))

    expect(mocks.updateSessionHarnessConfigOption).toHaveBeenCalledWith('session-1', 'model', 'gpt')
    expect(JSON.parse(res.body)).toEqual(result)
  })

  it('calls the mode manager method and validates required fields', async () => {
    const result = { sessionId: 'session-1', acpSession: { modes: { currentModeId: 'plan' } } }
    mocks.updateSessionHarnessMode.mockResolvedValue(result)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(request({ modeId: 'plan' }), res, new URL('http://localhost/api/agents/session-1/harness/mode'))
    expect(mocks.updateSessionHarnessMode).toHaveBeenCalledWith('session-1', 'plan')
    expect(JSON.parse(res.body)).toEqual(result)

    await expect(handleAgentApi(request({ configId: 'model' }), response(), new URL('http://localhost/api/agents/session-1/harness/config-option'))).rejects.toMatchObject({ statusCode: 400 })
    await expect(handleAgentApi(request({}), response(), new URL('http://localhost/api/agents/session-1/harness/mode'))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('calls the whole-session fork manager method', async () => {
    const result = { sessionId: 'forked-1', title: 'Copy', scope: 'global', projectId: null }
    mocks.forkSession.mockResolvedValue(result)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(request(), res, new URL('http://localhost/api/agents/session-1/fork'))

    expect(mocks.forkSession).toHaveBeenCalledWith('session-1')
    expect(JSON.parse(res.body)).toEqual(result)
  })
})
