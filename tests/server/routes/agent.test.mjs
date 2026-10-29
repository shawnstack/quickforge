import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restoreAgent: vi.fn(),
  getSessionState: vi.fn(),
  getSessionEventBus: vi.fn(),
  tryAcquireSse: vi.fn(),
  touchSession: vi.fn(),
  runPrompt: vi.fn(),
  isSessionFileRollbackBusy: vi.fn(() => false),
  releaseSse: vi.fn(),
  acquireSessionLease: vi.fn(() => ({ ok: true, lease: { clientId: 'client-a' }, acquired: true })),
  takeOverSessionLease: vi.fn(() => ({ ok: true, lease: { clientId: 'client-a' }, acquired: true })),
  releaseSessionLease: vi.fn(() => ({ ok: true, released: true })),
  getSessionLease: vi.fn(() => null),
  // 默认放行：绝大多数用例不测租约，保持「无租约 → 谁都能写」的旧行为。
  canWriteSession: vi.fn(() => ({ ok: true })),
  agentEvents: null,
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

class TestEventEmitter {
  constructor() {
    this.listeners = new Map()
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) || []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  emit(event, ...args) {
    for (const listener of [...(this.listeners.get(event) || [])]) listener(...args)
  }

  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter((candidate) => candidate !== listener))
    return this
  }

  removeAllListeners(event) {
    if (event) this.listeners.delete(event)
    else this.listeners.clear()
  }

  listenerCount(event) {
    return (this.listeners.get(event) || []).length
  }
}

vi.mock('../../../server/agent-manager.mjs', () => ({
  abortRun: vi.fn(),
  abortToolCall: vi.fn(),
  agentEvents: (() => {
    const events = new TestEventEmitter()
    mocks.agentEvents = events
    return events
  })(),
  approveAutoCompact: vi.fn(),
  approveToolCall: vi.fn(),
  continueSession: vi.fn(),
  createAgent: vi.fn(),
  destroyAgent: vi.fn(),
  followUpAgent: vi.fn(),
  getSessionEventBus: mocks.getSessionEventBus,
  getSessionState: mocks.getSessionState,
  getSessionStatus: vi.fn(),
  isSessionFileRollbackBusy: mocks.isSessionFileRollbackBusy,
  isSseConnected: vi.fn(),
  listSessions: vi.fn(() => []),
  rejectAutoCompact: vi.fn(),
  rejectToolCall: vi.fn(),
  releaseSse: mocks.releaseSse,
  restoreAgent: mocks.restoreAgent,
  rollbackSessionMessages: vi.fn(),
  runPrompt: mocks.runPrompt,
  steerAgent: vi.fn(),
  touchSession: mocks.touchSession,
  tryAcquireSse: mocks.tryAcquireSse,
  updateSessionAccessMode: vi.fn(),
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

vi.mock('../../../server/agent-session-lease.mjs', () => ({
  acquireSessionLease: mocks.acquireSessionLease,
  takeOverSessionLease: mocks.takeOverSessionLease,
  releaseSessionLease: mocks.releaseSessionLease,
  getSessionLease: mocks.getSessionLease,
  canWriteSession: mocks.canWriteSession,
  clearSessionLease: vi.fn(),
}))

vi.mock('../../../server/utils/logger.mjs', () => ({
  logger: mocks.logger,
}))

const attachmentMocks = vi.hoisted(() => ({
  createTextAttachment: vi.fn(),
  isTextAttachmentPath: vi.fn(),
  openPathInFileManager: vi.fn(),
}))

vi.mock('../../../server/text-attachments.mjs', () => ({
  createTextAttachment: attachmentMocks.createTextAttachment,
  isTextAttachmentPath: attachmentMocks.isTextAttachmentPath,
}))

vi.mock('../../../server/utils/platform.mjs', () => ({
  openPathInFileManager: attachmentMocks.openPathInFileManager,
}))

const commandLogMocks = vi.hoisted(() => ({
  isCommandLogPath: vi.fn(),
  readCommandLog: vi.fn(),
}))

vi.mock('../../../server/utils/command-log.mjs', () => ({
  isCommandLogPath: commandLogMocks.isCommandLogPath,
  readCommandLog: commandLogMocks.readCommandLog,
}))

const fileBackupMocks = vi.hoisted(() => ({
  getSessionTurnRollbackPreview: vi.fn(),
  rollbackSessionTurn: vi.fn(),
}))

vi.mock('../../../server/session-file-backups.mjs', () => ({
  getSessionTurnRollbackPreview: fileBackupMocks.getSessionTurnRollbackPreview,
  rollbackSessionTurn: fileBackupMocks.rollbackSessionTurn,
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

describe('agent asynchronous setters and restore failures', () => {
  beforeEach(() => {
    mocks.restoreAgent.mockReset()
    mocks.getSessionState.mockReset()
    mocks.getSessionEventBus.mockReset()
  })

  it('waits for the model setter before returning its result', async () => {
    const manager = await import('../../../server/agent-manager.mjs')
    const catalog = await import('../../../server/model-catalog.mjs')
    const model = { provider: 'mock', id: 'mock-model' }
    const binding = vi.spyOn(catalog, 'resolveModelBinding').mockResolvedValue({ model, modelRef: null })
    mocks.getSessionState.mockReturnValue({ model })
    let finish
    manager.updateSessionModel.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    try {
      const pending = handleAgentApi(request({ model }), res, new URL('http://localhost/api/agents/session-1/model'))
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      expect(res.status).toBe(0)
      finish({ sessionId: 'session-1', model })
      await pending
      expect(JSON.parse(res.body)).toEqual({ sessionId: 'session-1', model })
      expect(mocks.restoreAgent).not.toHaveBeenCalled()
    } finally {
      binding.mockRestore()
    }
  })

  it('waits for the thinking setter before returning its result', async () => {
    const manager = await import('../../../server/agent-manager.mjs')
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    let finish
    manager.updateSessionThinkingLevel.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const res = response()
    const pending = handleAgentApi(request({ thinkingLevel: 'high' }), res, new URL('http://localhost/api/agents/session-1/thinking-level'))
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(res.status).toBe(0)
    finish({ sessionId: 'session-1', thinkingLevel: 'high' })
    await pending
    expect(JSON.parse(res.body)).toEqual({ sessionId: 'session-1', thinkingLevel: 'high' })
  })

  it.each([['POST', 'restore'], ['GET', 'state'], ['GET', 'messages'], ['GET', 'stream'], ['HEAD', 'stream'], ['POST', 'model']])('propagates restore errors before writing %s /%s headers', async (method, subPath) => {
    const error = Object.assign(new Error('Failed to restore session. Please try again.'), { statusCode: 500, errorCode: 'SESSION_RESTORE_FAILED' })
    mocks.restoreAgent.mockRejectedValue(error)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const req = request({ model: { provider: 'mock', id: 'mock-model' } })
    req.method = method
    const res = response()
    await expect(handleAgentApi(req, res, new URL(`http://localhost/api/agents/session-1/${subPath}`))).rejects.toBe(error)
    expect(res.status).toBe(0)
  })
})

describe('agent text attachment routes', () => {
  beforeEach(() => {
    attachmentMocks.createTextAttachment.mockReset()
    attachmentMocks.isTextAttachmentPath.mockReset()
    attachmentMocks.openPathInFileManager.mockReset()
  })

  it('creates a text attachment for the session', async () => {
    const attachment = { id: 'text-1', type: 'document', path: 'C:\\qf\\a.txt' }
    attachmentMocks.createTextAttachment.mockResolvedValue(attachment)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(
      request({ text: 'pasted content', fileName: 'pasted-content.txt' }),
      res,
      new URL('http://localhost/api/agents/session-1/text-attachment'),
    )

    expect(attachmentMocks.createTextAttachment).toHaveBeenCalledWith({
      sessionId: 'session-1',
      text: 'pasted content',
      fileName: 'pasted-content.txt',
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ attachment })
  })

  it('passes the attachment file itself to the system file manager open helper', async () => {
    attachmentMocks.isTextAttachmentPath.mockReturnValue(true)
    attachmentMocks.openPathInFileManager.mockResolvedValue()
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    const attachmentPath = 'C:\\qf\\cache\\global\\tmp\\conversations\\s1\\pasted-content.txt'

    await handleAgentApi(
      request({ path: attachmentPath }),
      res,
      new URL('http://localhost/api/agents/session-1/open-text-attachment'),
    )

    expect(attachmentMocks.openPathInFileManager).toHaveBeenCalledWith(attachmentPath)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, opened: 'file' })
  })

  it('rejects opening paths outside the temporary attachment root', async () => {
    attachmentMocks.isTextAttachmentPath.mockReturnValue(false)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')

    await expect(handleAgentApi(
      request({ path: 'C:\\Windows\\system.ini' }),
      response(),
      new URL('http://localhost/api/agents/session-1/open-text-attachment'),
    )).rejects.toMatchObject({ statusCode: 400, message: 'Invalid text attachment path' })

    expect(attachmentMocks.openPathInFileManager).not.toHaveBeenCalled()
  })
})

describe('agent command log route', () => {
  beforeEach(() => {
    commandLogMocks.isCommandLogPath.mockReset()
    commandLogMocks.readCommandLog.mockReset()
  })

  function getRequest() {
    const req = Readable.from([])
    req.method = 'GET'
    req.headers = {}
    return req
  }

  it('returns the log content for a path inside the command log root', async () => {
    commandLogMocks.isCommandLogPath.mockReturnValue(true)
    commandLogMocks.readCommandLog.mockResolvedValue({
      path: 'C:\\qf\\logs\\commands\\a.log',
      content: 'Command: npm run build',
      size: 21,
      mtimeMs: 1,
      language: 'plaintext',
      readonly: true,
      totalLines: 1,
      truncated: false,
    })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(
      getRequest(),
      res,
      new URL('http://localhost/api/agents/session-1/command-log?path=C%3A%5Cqf%5Clogs%5Ccommands%5Ca.log&limit=10'),
    )

    expect(commandLogMocks.readCommandLog).toHaveBeenCalledWith('C:\\qf\\logs\\commands\\a.log', { limit: '10', offset: null })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ content: 'Command: npm run build', truncated: false })
  })

  it('rejects paths outside the command log root without reading them', async () => {
    commandLogMocks.isCommandLogPath.mockReturnValue(false)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')

    await expect(handleAgentApi(
      getRequest(),
      response(),
      new URL('http://localhost/api/agents/session-1/command-log?path=C%3A%5CWindows%5Csystem.ini'),
    )).rejects.toMatchObject({ statusCode: 400, message: 'Invalid command log path' })

    expect(commandLogMocks.readCommandLog).not.toHaveBeenCalled()
  })
})

describe('agent turn rollback routes', () => {
  beforeEach(() => {
    fileBackupMocks.getSessionTurnRollbackPreview.mockReset()
    fileBackupMocks.rollbackSessionTurn.mockReset()
  })

  it('returns the per-turn preview with a live busy guard', async () => {
    const preview = { revision: 'turn-rev', turnIds: ['turn-1', 'turn-1r'], canRollback: true, files: [{ path: 'C:\\ws\\a.ts', safe: true, reason: null, action: 'restore', created: false, beforeBytes: 3, afterBytes: 5 }] }
    fileBackupMocks.getSessionTurnRollbackPreview.mockResolvedValue(preview)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const req = request()
    req.method = 'GET'
    const res = response()
    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/rollback-turn/preview?turnIds=turn-1,turn-1r'))
    expect(fileBackupMocks.getSessionTurnRollbackPreview).toHaveBeenCalledWith('session-1', { turnIds: ['turn-1', 'turn-1r'], isSessionBusy: expect.any(Function) })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual(preview)
    fileBackupMocks.getSessionTurnRollbackPreview.mock.calls.at(-1)[1].isSessionBusy()
    expect(mocks.isSessionFileRollbackBusy).toHaveBeenCalledWith('session-1')
  })

  it('parses turnIds as a deduplicated comma-separated list', async () => {
    fileBackupMocks.getSessionTurnRollbackPreview.mockResolvedValue({ revision: 'turn-rev', turnIds: ['turn-1'], canRollback: true, files: [] })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const req = request()
    req.method = 'GET'
    await handleAgentApi(req, response(), new URL('http://localhost/api/agents/session-1/rollback-turn/preview?turnIds=turn-1,,turn-1,'))
    expect(fileBackupMocks.getSessionTurnRollbackPreview).toHaveBeenCalledWith('session-1', { turnIds: ['turn-1'], isSessionBusy: expect.any(Function) })
  })

  it.each([['missing', ''], ['blank', ',,'], ['absent', null]])('rejects a per-turn preview without turnIds (%s)', async (_name, raw) => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const req = request()
    req.method = 'GET'
    const url = new URL('http://localhost/api/agents/session-1/rollback-turn/preview')
    if (raw !== null) url.searchParams.set('turnIds', raw)
    await expect(handleAgentApi(req, response(), url)).rejects.toMatchObject({ statusCode: 400 })
    expect(fileBackupMocks.getSessionTurnRollbackPreview).not.toHaveBeenCalled()
  })

  it.each([['completed', 200], ['partial', 200], ['blocked', 409], ['failed', 500]])('maps turn rollback %s to HTTP %s', async (status, code) => {
    const result = {
      status,
      rolledBack: status === 'completed' || status === 'partial' ? [{ path: 'C:\\ws\\a.ts', action: 'restore' }] : [],
      conflicts: status === 'partial' ? [{ path: 'C:\\ws\\b.ts', reason: 'modified-after-turn' }] : [],
      errors: [],
      preview: { revision: 'turn-rev', turnIds: ['turn-1', 'turn-1r'], canRollback: false, files: [] },
    }
    fileBackupMocks.rollbackSessionTurn.mockResolvedValue(result)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    await handleAgentApi(request({ turnIds: ['turn-1', 'turn-1r'], revision: 'turn-rev' }), res, new URL('http://localhost/api/agents/session-1/rollback-turn'))
    expect(fileBackupMocks.rollbackSessionTurn).toHaveBeenCalledWith('session-1', { turnIds: ['turn-1', 'turn-1r'], revision: 'turn-rev', isSessionBusy: expect.any(Function) })
    expect(res.status).toBe(code)
    expect(JSON.parse(res.body)).toEqual(result)
  })

  it.each([
    {},
    { turnIds: [] },
    { turnIds: 'turn-1' },
    { turnIds: [''] },
    { turnIds: ['turn-1', 42], revision: 'turn-rev' },
  ])('rejects turn rollback without a valid turnIds array: %j', async (body) => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    await expect(handleAgentApi(request(body), response(), new URL('http://localhost/api/agents/session-1/rollback-turn'))).rejects.toMatchObject({ statusCode: 400 })
    expect(fileBackupMocks.rollbackSessionTurn).not.toHaveBeenCalled()
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
    mocks.releaseSse.mockReset()
    for (const method of Object.values(mocks.logger)) method.mockReset()
    mocks.agentEvents.removeAllListeners()
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

  it('logs session SSE event write failure without payload and cleans up', async () => {
    const eventBus = new TestEventEmitter()
    mocks.getSessionEventBus.mockReturnValue(eventBus)
    mocks.tryAcquireSse.mockReturnValue(true)
    mocks.getSessionState.mockReturnValue(null)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const req = new TestEventEmitter()
    req.method = 'GET'
    req.headers = {}
    const sensitivePayload = 'sensitive-sse-event-payload'
    const res = new TestEventEmitter()
    res.writableEnded = false
    res.writeHead = vi.fn()
    res.write = vi.fn(() => { throw new Error('socket write failed') })
    res.end = vi.fn(() => { res.writableEnded = true })

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-write-failure/stream'))
    // message_update 现在经节流延迟写出，用终态事件触发同一写入失败路径。
    eventBus.emit('agent_event', { type: 'message_end', content: sensitivePayload })
    res.emit('error', new TypeError('repeated response error'))
    req.emit('error', new Error('request error after cleanup'))
    req.emit('close')

    expect(mocks.releaseSse).toHaveBeenCalledTimes(1)
    expect(mocks.releaseSse).toHaveBeenCalledWith('session-write-failure')
    expect(eventBus.listenerCount('agent_event')).toBe(0)
    expect(res.end).toHaveBeenCalledTimes(1)
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Session agent SSE connection failure',
      expect.objectContaining({
        streamScope: 'session',
        sessionId: 'session-write-failure',
        failureType: 'event_write_failed',
        errorName: 'Error',
      }),
    )
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain(sensitivePayload)
  })

  it('logs one global SSE failure and cleans up once across repeated error paths', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const req = new TestEventEmitter()
    req.method = 'GET'
    req.headers = {}
    const res = new TestEventEmitter()
    res.writableEnded = false
    res.writeHead = vi.fn()
    res.flushHeaders = vi.fn()
    res.write = vi.fn()
    res.end = vi.fn(() => { res.writableEnded = true })

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/events'))
    expect(mocks.agentEvents.listenerCount('agent_event')).toBe(1)
    res.emit('error', new Error('socket error with private payload'))
    res.emit('error', new TypeError('repeated socket error'))
    req.emit('error', new Error('request error after cleanup'))
    req.emit('close')

    expect(mocks.agentEvents.listenerCount('agent_event')).toBe(0)
    expect(res.end).toHaveBeenCalledTimes(1)
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Global agent SSE connection failure',
      expect.objectContaining({ streamScope: 'global', failureType: 'response_socket_error', errorName: 'Error' }),
    )
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain('private payload')
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

    expect(mocks.releaseSse).toHaveBeenCalledTimes(1)
    expect(mocks.logger.warn).not.toHaveBeenCalled()
    const frame = chunks.join('')
    expect(frame).toContain('event: state')
    expect(frame).not.toContain('"messages"')
    expect(frame).toContain('"messagesSummary":{"count":2}')
    expect(frame).toContain('"stateVersion":2')
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
    expect(agentEvents.listenerCount('agent_event')).toBe(1)

    req.emit('close')
    expect(agentEvents.listenerCount('agent_event')).toBe(0)
    expect(res.writableEnded).toBe(true)
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })
})

describe('SSE streaming throttle and backpressure', () => {
  beforeEach(() => {
    mocks.restoreAgent.mockReset()
    mocks.getSessionState.mockReset()
    mocks.getSessionEventBus.mockReset()
    mocks.tryAcquireSse.mockReset()
    mocks.touchSession.mockReset()
    mocks.releaseSse.mockReset()
    for (const method of Object.values(mocks.logger)) method.mockReset()
    mocks.agentEvents.removeAllListeners()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function sessionStream() {
    const eventBus = new TestEventEmitter()
    mocks.getSessionEventBus.mockReturnValue(eventBus)
    mocks.tryAcquireSse.mockReturnValue(true)
    mocks.getSessionState.mockReturnValue(null)
    const req = new TestEventEmitter()
    req.method = 'GET'
    req.headers = {}
    const chunks = []
    const res = new TestEventEmitter()
    res.writableEnded = false
    res.writableLength = 0
    res.writeHead = vi.fn()
    res.write = vi.fn((chunk) => { chunks.push(chunk) })
    res.end = vi.fn(() => { res.writableEnded = true })
    return { eventBus, req, res, chunks }
  }

  it('coalesces message_update frames inside the throttle window to the last one', async () => {
    vi.useFakeTimers()
    const { createSseUpdateThrottle, SSE_MESSAGE_UPDATE_THROTTLE_MS } = await import('../../../server/routes/agent.mjs')
    const frames = []
    const throttle = createSseUpdateThrottle({ write: (event) => frames.push(event) })

    throttle.push({ type: 'message_update', seq: 1 })
    throttle.push({ type: 'message_update', seq: 2 })
    throttle.push({ type: 'message_update', seq: 3 })
    expect(frames).toEqual([])

    vi.advanceTimersByTime(SSE_MESSAGE_UPDATE_THROTTLE_MS - 1)
    expect(frames).toEqual([])
    vi.advanceTimersByTime(1)
    expect(frames.map((event) => event.seq)).toEqual([3])

    throttle.dispose()
  })

  it('flushes the pending message_update before writing message_end', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const { eventBus, req, res, chunks } = sessionStream()

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-throttle/stream'))

    eventBus.emit('agent_event', { type: 'message_update', seq: 1 })
    eventBus.emit('agent_event', { type: 'message_update', seq: 2 })
    eventBus.emit('agent_event', { type: 'message_end', seq: 2 })

    const frame = chunks.join('')
    const updateIndex = frame.indexOf('event: message_update')
    const endIndex = frame.indexOf('event: message_end')
    expect(updateIndex).toBeGreaterThan(-1)
    expect(endIndex).toBeGreaterThan(updateIndex)
    expect(frame).not.toContain('"seq":1')
    expect(frame).toContain('"seq":2')
    expect(mocks.logger.warn).not.toHaveBeenCalled()

    req.emit('close')
  })

  it('drops droppable frames above the writableLength threshold but always keeps terminal frames', async () => {
    vi.useFakeTimers()
    const { handleAgentApi, SSE_BACKPRESSURE_BYTES, SSE_MESSAGE_UPDATE_THROTTLE_MS } = await import('../../../server/routes/agent.mjs')
    const { eventBus, req, res, chunks } = sessionStream()

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-throttle/stream'))

    // 低于阈值：写入行为与改动前一致。
    res.writableLength = 0
    eventBus.emit('agent_event', { type: 'message_update', seq: 1 })
    vi.advanceTimersByTime(SSE_MESSAGE_UPDATE_THROTTLE_MS)
    expect(chunks.join('')).toContain('event: message_update')

    // 超过阈值：节流窗口到期写出的 message_update 与 tool_execution_update 被丢弃。
    chunks.length = 0
    res.writableLength = SSE_BACKPRESSURE_BYTES + 1
    eventBus.emit('agent_event', { type: 'message_update', seq: 2 })
    vi.advanceTimersByTime(SSE_MESSAGE_UPDATE_THROTTLE_MS)
    eventBus.emit('agent_event', { type: 'tool_execution_update', seq: 2 })
    expect(chunks).toEqual([])

    // 终态事件永不丢弃。
    eventBus.emit('agent_event', { type: 'message_end', seq: 2 })
    eventBus.emit('agent_event', { type: 'agent_end', seq: 2 })

    const frame = chunks.join('')
    expect(frame).not.toContain('event: message_update')
    expect(frame).not.toContain('event: tool_execution_update')
    expect(frame).toContain('event: message_end')
    expect(frame).toContain('event: agent_end')

    req.emit('close')
  })

  it('disposes the pending throttle timer on cleanup without writing after close', async () => {
    vi.useFakeTimers()
    const { handleAgentApi, SSE_MESSAGE_UPDATE_THROTTLE_MS } = await import('../../../server/routes/agent.mjs')
    const { eventBus, req, res, chunks } = sessionStream()

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-throttle/stream'))
    eventBus.emit('agent_event', { type: 'message_update', seq: 1 })
    expect(chunks).toEqual([])

    req.emit('close')
    vi.advanceTimersByTime(SSE_MESSAGE_UPDATE_THROTTLE_MS * 4)

    expect(chunks).toEqual([])
    expect(res.end).toHaveBeenCalledTimes(1)
    expect(eventBus.listenerCount('agent_event')).toBe(0)
  })

  it('throttles the global agent stream through the same writer', async () => {
    vi.useFakeTimers()
    const { handleAgentApi, SSE_MESSAGE_UPDATE_THROTTLE_MS } = await import('../../../server/routes/agent.mjs')
    const req = new TestEventEmitter()
    req.method = 'GET'
    req.headers = {}
    const chunks = []
    const res = new TestEventEmitter()
    res.writableEnded = false
    res.writableLength = 0
    res.writeHead = vi.fn()
    res.flushHeaders = vi.fn()
    res.write = vi.fn((chunk) => { chunks.push(chunk) })
    res.end = vi.fn(() => { res.writableEnded = true })

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/events'))
    mocks.agentEvents.emit('agent_event', { type: 'message_update', seq: 1 })
    mocks.agentEvents.emit('agent_event', { type: 'message_update', seq: 2 })
    expect(chunks).toEqual([])

    vi.advanceTimersByTime(SSE_MESSAGE_UPDATE_THROTTLE_MS)
    expect(chunks.join('')).toContain('"seq":2')
    expect(chunks.join('')).not.toContain('"seq":1')

    req.emit('close')
  })

  it('projects attachment bytes out of wire frames', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const req = new TestEventEmitter()
    req.method = 'GET'
    req.headers = {}
    const chunks = []
    const res = new TestEventEmitter()
    res.writableEnded = false
    res.writableLength = 0
    res.writeHead = vi.fn()
    res.flushHeaders = vi.fn()
    res.write = vi.fn((chunk) => { chunks.push(chunk) })
    res.end = vi.fn(() => { res.writableEnded = true })

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/events'))
    mocks.agentEvents.emit('agent_event', {
      type: 'message_end',
      sessionId: 'session-1',
      message: {
        role: 'user-with-attachments',
        content: 'look',
        attachments: [{ id: 'a1', type: 'image', mimeType: 'image/png', content: 'AAAA', preview: 'AAAA' }],
      },
    })

    const frame = chunks.join('')
    expect(frame).toContain('/api/sessions/session-1/attachments/a1')
    expect(frame).not.toContain('"content":"AAAA"')

    req.emit('close')
  })
})

describe('agent create route', () => {
  it('strips restore-only fields from the client create body', async () => {
    const agentManager = await import('../../../server/agent-manager.mjs')
    agentManager.createAgent.mockResolvedValue({
      sessionId: 'session-1',
      status: 'idle',
      scope: 'global',
      title: 'New chat',
      accessMode: 'default',
      yoloMode: false,
    })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(
      request({
        scope: 'global',
        restoredGoal: { id: 'goal_injected', status: 'running', objective: 'injected' },
        persistedStateJson: '{"goal":{"id":"goal_injected"}}',
        persistedStorageRevision: 99,
        persistedMessageCount: 5,
        persistedTailDigest: 'forged',
      }),
      res,
      new URL('http://localhost/api/agents/session-1'),
      { isLocalRequest: true },
    )

    expect(agentManager.createAgent).toHaveBeenCalledTimes(1)
    const [, config] = agentManager.createAgent.mock.calls[0]
    expect(config).not.toHaveProperty('restoredGoal')
    expect(config).not.toHaveProperty('persistedStateJson')
    expect(config).not.toHaveProperty('persistedStorageRevision')
    expect(config).not.toHaveProperty('persistedMessageCount')
    expect(config).not.toHaveProperty('persistedTailDigest')
    expect(config.scope).toBe('global')
    expect(res.status).toBe(200)
  })
})

describe('session lease routes', () => {
  beforeEach(() => {
    mocks.acquireSessionLease.mockReset()
    mocks.takeOverSessionLease.mockReset()
    mocks.releaseSessionLease.mockReset()
    mocks.getSessionLease.mockReset()
    mocks.canWriteSession.mockReset()
    mocks.runPrompt.mockReset()
    mocks.acquireSessionLease.mockReturnValue({ ok: true, lease: { clientId: 'client-a' }, acquired: true })
    mocks.takeOverSessionLease.mockReturnValue({ ok: true, lease: { clientId: 'client-a' }, acquired: true })
    mocks.releaseSessionLease.mockReturnValue({ ok: true, released: true })
    mocks.getSessionLease.mockReturnValue(null)
    mocks.canWriteSession.mockReturnValue({ ok: true })
  })

  it('reports the current holder without mutating it', async () => {
    mocks.getSessionLease.mockReturnValue({ clientId: 'client-a' })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    const req = request(undefined)
    req.method = 'GET'

    await handleAgentApi(
      req,
      res,
      new URL('http://localhost/api/agents/session-1/lease'),
      { isLocalRequest: true },
    )

    expect(mocks.getSessionLease).toHaveBeenCalledWith('session-1')
    expect(mocks.acquireSessionLease).not.toHaveBeenCalled()
    expect(JSON.parse(res.body)).toEqual({ sessionId: 'session-1', lease: { clientId: 'client-a' } })
  })

  it('acquires the lease from the client id header', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    const req = request({})
    req.headers = { 'x-quickforge-client-id': 'client-a' }

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/lease'), { isLocalRequest: true })

    expect(mocks.acquireSessionLease).toHaveBeenCalledWith('session-1', 'client-a')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ sessionId: 'session-1', acquired: true })
  })

  it('answers 409 with the holder when another client owns the lease', async () => {
    mocks.acquireSessionLease.mockReturnValue({ ok: false, reason: 'held', lease: { clientId: 'client-b' }, holder: 'client-b' })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    const req = request({})
    req.headers = { 'x-quickforge-client-id': 'client-a' }

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/lease'), { isLocalRequest: true })

    expect(res.status).toBe(409)
    expect(JSON.parse(res.body)).toMatchObject({ code: 'SESSION_LEASE_HELD', sessionId: 'session-1' })
  })

  it('takes the lease over when the body asks for it', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    const req = request({ takeover: true })
    req.headers = { 'x-quickforge-client-id': 'client-b' }

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/lease'), { isLocalRequest: true })

    expect(mocks.takeOverSessionLease).toHaveBeenCalledWith('session-1', 'client-b')
    expect(mocks.acquireSessionLease).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it('releases the lease for the requesting client', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    const req = request(undefined)
    req.method = 'DELETE'
    req.headers = { 'x-quickforge-client-id': 'client-a' }

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/lease'), { isLocalRequest: true })

    expect(mocks.releaseSessionLease).toHaveBeenCalledWith('session-1', 'client-a')
    expect(JSON.parse(res.body)).toEqual({ sessionId: 'session-1', released: true })
  })

  it('rejects a lease request without any client identity', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await expect(handleAgentApi(
      request({}),
      res,
      new URL('http://localhost/api/agents/session-1/lease'),
      { isLocalRequest: true },
    )).rejects.toMatchObject({ statusCode: 400, errorCode: 'SESSION_LEASE_CLIENT_ID_REQUIRED' })
    expect(mocks.acquireSessionLease).not.toHaveBeenCalled()
  })

  it('blocks a write from a non-owner with 409 before touching the run', async () => {
    mocks.canWriteSession.mockReturnValue({ ok: false, holder: 'client-b', lease: { clientId: 'client-b' } })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    const req = request({ message: 'hello' })
    req.headers = { 'x-quickforge-client-id': 'client-a' }

    await expect(handleAgentApi(
      req,
      res,
      new URL('http://localhost/api/agents/session-1/prompt'),
      { isLocalRequest: true },
    )).rejects.toMatchObject({ statusCode: 409, errorCode: 'SESSION_LEASE_HELD', holder: 'client-b' })

    // 关键：被守卫拦下时绝不能真的开跑。
    expect(mocks.runPrompt).not.toHaveBeenCalled()
    expect(res.status).toBe(0)
  })

  it('guards every mutating route with the same lease check', async () => {
    mocks.canWriteSession.mockReturnValue({ ok: false, holder: 'client-b' })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')

    for (const route of ['abort', 'title', 'access-mode', 'model', 'thinking-level', 'rollback', 'steer', 'follow-up', 'continue', 'goal']) {
      const req = request(route === 'goal' ? { action: 'pause' } : { message: 'x' })
      req.headers = { 'x-quickforge-client-id': 'client-a' }
      await expect(handleAgentApi(
        req,
        response(),
        new URL(`http://localhost/api/agents/session-1/${route}`),
        { isLocalRequest: true },
      )).rejects.toMatchObject({ errorCode: 'SESSION_LEASE_HELD' })
    }

    expect(mocks.canWriteSession).toHaveBeenCalledTimes(10)
  })

  it('lets the owner write through', async () => {
    mocks.runPrompt.mockResolvedValue({ sessionId: 'session-1', status: 'running' })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    const req = request({ message: 'hello' })
    req.headers = { 'x-quickforge-client-id': 'client-a' }

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/prompt'), { isLocalRequest: true })

    expect(mocks.canWriteSession).toHaveBeenCalledWith('session-1', 'client-a')
    expect(mocks.runPrompt).toHaveBeenCalled()
    expect(res.status).toBe(200)
  })
})
