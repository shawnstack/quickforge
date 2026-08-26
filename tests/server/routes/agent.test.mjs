import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restoreAgent: vi.fn(),
  getSessionState: vi.fn(),
  getSessionEventBus: vi.fn(),
  tryAcquireSse: vi.fn(),
  touchSession: vi.fn(),
  runPrompt: vi.fn(),
  updateSessionHarnessConfigOption: vi.fn(),
  updateSessionHarnessMode: vi.fn(),
  forkSession: vi.fn(),
}))

vi.mock('../../../server/agent-manager.mjs', () => ({
  abortRun: vi.fn(),
  abortToolCall: vi.fn(),
  agentEvents: { on: vi.fn(), off: vi.fn(), removeListener: vi.fn() },
  approveAutoCompact: vi.fn(),
  approveToolCall: vi.fn(),
  continueSession: vi.fn(),
  createAgent: vi.fn(),
  destroyAgent: vi.fn(),
  followUpAgent: vi.fn(),
  getSessionEventBus: mocks.getSessionEventBus,
  getSessionState: mocks.getSessionState,
  getSessionStatus: vi.fn(),
  isSseConnected: vi.fn(),
  listSessions: vi.fn(() => []),
  rejectAutoCompact: vi.fn(),
  rejectToolCall: vi.fn(),
  releaseSse: vi.fn(),
  restoreAgent: mocks.restoreAgent,
  rollbackSessionMessages: vi.fn(),
  runPrompt: mocks.runPrompt,
  steerAgent: vi.fn(),
  touchSession: mocks.touchSession,
  tryAcquireSse: mocks.tryAcquireSse,
  updateSessionAccessMode: vi.fn(),
  updateSessionHarnessConfigOption: mocks.updateSessionHarnessConfigOption,
  updateSessionHarnessMode: mocks.updateSessionHarnessMode,
  forkSession: mocks.forkSession,
  updateSessionModel: vi.fn(),
  updateSessionThinkingLevel: vi.fn(),
  updateSessionTitle: vi.fn(),
  updateSessionYoloMode: vi.fn(),
  stripSplitSessionState: (state) => {
    if (!state || state.messageStorage !== 'split' || !Array.isArray(state.messages)) return state
    const next = { ...state }
    delete next.messages
    next.messagesSummary = { count: state.messages.length }
    return next
  },
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

describe('agent prompt route', () => {
  beforeEach(() => {
    mocks.runPrompt.mockReset()
  })

  it('passes contextReferences as the final runPrompt argument', async () => {
    mocks.runPrompt.mockResolvedValue({ sessionId: 'session-1', status: 'running' })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    const references = [{ type: 'file', projectId: 'project-1', path: 'src/app.ts' }]
    const context = { isLocalRequest: true }

    await handleAgentApi(
      request({ message: 'inspect', selectedCapabilities: [{ type: 'tool' }], command: '/review', contextReferences: references }),
      res,
      new URL('http://localhost/api/agents/session-1/prompt'),
      context,
    )

    expect(mocks.runPrompt).toHaveBeenCalledWith(
      'session-1',
      'inspect',
      [{ type: 'tool' }],
      '/review',
      null,
      context,
      references,
    )
    expect(JSON.parse(res.body)).toEqual({ sessionId: 'session-1', status: 'running' })
  })
})

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

describe('agent split-session state and messages routes', () => {
  beforeEach(() => {
    mocks.restoreAgent.mockReset()
    mocks.getSessionState.mockReset()
    mocks.getSessionEventBus.mockReset()
    mocks.tryAcquireSse.mockReset()
    mocks.touchSession.mockReset()
  })

  function getRequest() {
    const req = { method: 'GET', headers: {}, url: undefined }
    return req
  }

  it('strips full messages from GET /state for split sessions and ships a summary', async () => {
    const state = {
      sessionId: 'session-1',
      title: 'Big',
      messageStorage: 'split',
      messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }],
      stateVersion: 4,
      isStreaming: false,
    }
    mocks.getSessionState.mockReturnValue(state)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(getRequest(), res, new URL('http://localhost/api/agents/session-1/state'))

    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).not.toHaveProperty('messages')
    expect(body.messagesSummary).toEqual({ count: 2 })
    expect(body.stateVersion).toBe(4)
    expect(body.messageStorage).toBe('split')
  })

  it('keeps full messages in GET /state for non-split sessions', async () => {
    const state = {
      sessionId: 'session-1',
      title: 'Small',
      messages: [{ role: 'user', content: 'a' }],
      stateVersion: 1,
    }
    mocks.getSessionState.mockReturnValue(state)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(getRequest(), res, new URL('http://localhost/api/agents/session-1/state'))

    expect(JSON.parse(res.body).messages).toEqual([{ role: 'user', content: 'a' }])
    expect(JSON.parse(res.body)).not.toHaveProperty('messagesSummary')
  })

  it('strips messages from POST /restore for split sessions', async () => {
    mocks.restoreAgent.mockResolvedValue({ sessionId: 'session-1' })
    mocks.getSessionState.mockReturnValue({
      sessionId: 'session-1',
      messageStorage: 'split',
      messages: [{ role: 'user', content: 'a' }],
      stateVersion: 2,
    })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(request(), res, new URL('http://localhost/api/agents/session-1/restore'))

    const body = JSON.parse(res.body)
    expect(body).not.toHaveProperty('messages')
    expect(body.messagesSummary).toEqual({ count: 1 })
  })

  it('serves incremental message pages from the in-memory state', async () => {
    const messages = Array.from({ length: 5 }, (_, index) => ({ role: 'user', content: `m${index}` }))
    mocks.getSessionState.mockReturnValue({ sessionId: 'session-1', messages, stateVersion: 3 })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(getRequest(), res, new URL('http://localhost/api/agents/session-1/messages?after=2'))

    expect(res.status).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.after).toBe(2)
    expect(body.count).toBe(5)
    expect(body.hasMore).toBe(false)
    expect(body.messages.map((message) => message.content)).toEqual(['m2', 'm3', 'm4'])
  })

  it('paginates message fetches and reports hasMore', async () => {
    const messages = Array.from({ length: 5 }, (_, index) => ({ role: 'user', content: `m${index}` }))
    mocks.getSessionState.mockReturnValue({ sessionId: 'session-1', messages, stateVersion: 3 })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(getRequest(), res, new URL('http://localhost/api/agents/session-1/messages?after=0&limit=2'))

    const body = JSON.parse(res.body)
    expect(body.after).toBe(0)
    expect(body.hasMore).toBe(true)
    expect(body.messages.map((message) => message.content)).toEqual(['m0', 'm1'])
  })

  it('restores an evicted session before answering a message fetch', async () => {
    mocks.getSessionState.mockReturnValueOnce(null).mockReturnValueOnce({ sessionId: 'session-1', messages: [{ role: 'user', content: 'm0' }], stateVersion: 1 })
    mocks.restoreAgent.mockResolvedValue({ sessionId: 'session-1' })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(getRequest(), res, new URL('http://localhost/api/agents/session-1/messages?after=0'))

    expect(mocks.restoreAgent).toHaveBeenCalledWith('session-1')
    expect(JSON.parse(res.body).messages).toEqual([{ role: 'user', content: 'm0' }])
  })

  it('sends a lightweight initial state frame for split sessions on SSE connect', async () => {
    const { EventEmitter } = await import('node:events')
    const eventBus = new EventEmitter()
    eventBus.setMaxListeners(100)
    mocks.getSessionEventBus.mockReturnValue(eventBus)
    mocks.tryAcquireSse.mockReturnValue(true)
    mocks.touchSession.mockReturnValue(undefined)
    mocks.getSessionState.mockReturnValue({
      sessionId: 'session-1',
      messageStorage: 'split',
      messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }],
      stateVersion: 2,
    })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const chunks = []
    const req = new EventEmitter()
    req.method = 'GET'
    req.headers = {}
    const res = {
      writableEnded: false,
      writeHead() {},
      write(chunk) { chunks.push(chunk) },
      end() { this.writableEnded = true },
      on() {},
    }

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/stream'))
    // Cleanup triggers on req close, clearing the keep-alive interval.
    req.emit('close')

    const frame = chunks.join('')
    expect(frame).toContain('event: state')
    expect(frame).not.toContain('"messages"')
    expect(frame).toContain('"messagesSummary":{"count":2}')
    expect(frame).toContain('"stateVersion":2')
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

describe('agent global events stream', () => {
  it('flushes SSE headers immediately and detaches listeners on close', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const { agentEvents } = await import('../../../server/agent-manager.mjs')
    const req = new Readable({ read() {} })
    req.method = 'GET'
    req.headers = {}
    const res = {
      status: 0,
      headers: null,
      flushed: false,
      writableEnded: false,
      writeHead(status, headers) { this.status = status; this.headers = headers },
      flushHeaders() { this.flushed = true },
      write() {},
      end() { this.writableEnded = true },
      on() {},
    }

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/events'), {})

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.flushed).toBe(true)
    expect(agentEvents.on).toHaveBeenCalledWith('agent_event', expect.any(Function))

    req.emit('close')
    expect(agentEvents.removeListener).toHaveBeenCalledWith('agent_event', expect.any(Function))
    expect(res.writableEnded).toBe(true)
  })
})
