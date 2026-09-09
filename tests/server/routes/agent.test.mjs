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
  updateSessionHarnessConfigOption: vi.fn(),
  updateSessionHarnessMode: vi.fn(),
  forkSession: vi.fn(),
  releaseSse: vi.fn(),
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

const fileBackupMocks = vi.hoisted(() => ({
  getSessionFileChanges: vi.fn(),
  getSessionFileRollbackPreview: vi.fn(),
  rollbackSessionFiles: vi.fn(),
  rollbackSessionFile: vi.fn(),
}))

vi.mock('../../../server/session-file-backups.mjs', () => ({
  getSessionFileChanges: fileBackupMocks.getSessionFileChanges,
  getSessionFileRollbackPreview: fileBackupMocks.getSessionFileRollbackPreview,
  rollbackSessionFiles: fileBackupMocks.rollbackSessionFiles,
  rollbackSessionFile: fileBackupMocks.rollbackSessionFile,
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

describe('agent file change summary routes', () => {
  beforeEach(() => {
    fileBackupMocks.getSessionFileChanges.mockReset()
    fileBackupMocks.rollbackSessionFiles.mockReset()
    fileBackupMocks.rollbackSessionFile.mockReset()
  })

  it('returns the session-scoped file change summary', async () => {
    const summary = {
      files: [{ path: 'C:\\ws\\a.ts', relativePath: 'a.ts', created: false, added: 3, removed: 1 }],
      totalAdded: 3,
      totalRemoved: 1,
    }
    fileBackupMocks.getSessionFileChanges.mockResolvedValue(summary)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')

    const req = request(undefined)
    req.method = 'GET'
    const res = response()
    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/file-changes'))

    expect(fileBackupMocks.getSessionFileChanges).toHaveBeenCalledWith('session-1')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual(summary)
  })

  it('returns whole-batch preview with a live busy guard', async () => {
    const preview = { revision: 'r1', canRollback: true, files: [] }
    fileBackupMocks.getSessionFileRollbackPreview.mockResolvedValue(preview)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const req = request()
    req.method = 'GET'
    const res = response()
    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/rollback-files/preview'))
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual(preview)
    const [, options] = fileBackupMocks.getSessionFileRollbackPreview.mock.calls.at(-1)
    options.isSessionBusy()
    expect(mocks.isSessionFileRollbackBusy).toHaveBeenCalledWith('session-1')
  })

  it.each([['completed', 200], ['blocked', 409], ['failed', 500]])('returns structured %s response with HTTP %s', async (status, code) => {
    const result = { status, restored: status === 'completed' ? 2 : 0, removedCreated: 0, errors: [], preview: { revision: 'r2', canRollback: false, files: [] } }
    fileBackupMocks.rollbackSessionFiles.mockResolvedValue(result)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    await handleAgentApi(request({ revision: 'r1' }), res, new URL('http://localhost/api/agents/session-1/rollback-files'))
    expect(fileBackupMocks.rollbackSessionFiles).toHaveBeenCalledWith('session-1', { revision: 'r1', isSessionBusy: expect.any(Function) })
    expect(res.status).toBe(code)
    expect(JSON.parse(res.body)).toEqual(result)
  })

  it.each([['partial', 200], ['completed', 200], ['blocked', 409], ['failed', 500]])('dispatches single-file %s to its dedicated backend with HTTP %s', async (status, code) => {
    const result = { status, restored: 1, removedCreated: 0, errors: [], preview: { revision: 'batch', canRollback: false, files: [] } }
    fileBackupMocks.rollbackSessionFile.mockResolvedValue(result)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    await handleAgentApi(request({ path: 'C:\\ws\\a.ts', revision: 'item' }), res, new URL('http://localhost/api/agents/session-1/rollback-file'))
    expect(fileBackupMocks.rollbackSessionFile).toHaveBeenCalledWith('session-1', { path: 'C:\\ws\\a.ts', revision: 'item', isSessionBusy: expect.any(Function) })
    expect(fileBackupMocks.rollbackSessionFiles).not.toHaveBeenCalled()
    fileBackupMocks.rollbackSessionFile.mock.calls.at(-1)[1].isSessionBusy()
    expect(mocks.isSessionFileRollbackBusy).toHaveBeenCalledWith('session-1')
    expect(res.status).toBe(code)
    expect(JSON.parse(res.body)).toEqual(result)
  })

  it.each([{}, { path: '' }, { path: 42, revision: 'r' }, { path: '/unknown', revision: 'r' }])('invalid single-file payload never falls back to batch: %j', async (body) => {
    fileBackupMocks.rollbackSessionFile.mockResolvedValue({ status: 'blocked', restored: 0, removedCreated: 0, errors: [], preview: { files: [] } })
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    await handleAgentApi(request(body), res, new URL('http://localhost/api/agents/session-1/rollback-file'))
    expect(fileBackupMocks.rollbackSessionFile).toHaveBeenCalledWith('session-1', { path: body.path, revision: body.revision, isSessionBusy: expect.any(Function) })
    expect(fileBackupMocks.rollbackSessionFiles).not.toHaveBeenCalled()
    expect(res.status).toBe(409)
  })

  it('malformed single-file JSON returns blocked without calling either rollback backend', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const req = Readable.from([Buffer.from('{invalid')])
    req.method = 'POST'
    req.headers = {}
    const res = response()
    fileBackupMocks.getSessionFileRollbackPreview.mockResolvedValue({ revision: 'batch', canRollback: true, files: [] })
    await handleAgentApi(req, res, new URL('http://localhost/api/agents/session-1/rollback-file'))
    expect(res.status).toBe(409)
    expect(JSON.parse(res.body).status).toBe('blocked')
    expect(fileBackupMocks.rollbackSessionFile).not.toHaveBeenCalled()
    expect(fileBackupMocks.rollbackSessionFiles).not.toHaveBeenCalled()
  })

  it('passes missing revision to the fail-closed backend instead of blind rollback', async () => {
    const result = { status: 'blocked', restored: 0, removedCreated: 0, errors: [], preview: { revision: 'r1', canRollback: false, files: [], reason: 'batch_changed' } }
    fileBackupMocks.rollbackSessionFiles.mockResolvedValue(result)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    await handleAgentApi(request({}), res, new URL('http://localhost/api/agents/session-1/rollback-files'))
    expect(fileBackupMocks.rollbackSessionFiles).toHaveBeenCalledWith('session-1', { revision: undefined, isSessionBusy: expect.any(Function) })
    expect(res.status).toBe(409)
    expect(JSON.parse(res.body)).toEqual(result)
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
    expect(agentEvents.listenerCount('agent_event')).toBe(1)

    req.emit('close')
    expect(agentEvents.listenerCount('agent_event')).toBe(0)
    expect(res.writableEnded).toBe(true)
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })

  it('forwards only channel sessions-changed events and detaches the channel listener on close', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const { channelEvents } = await import('../../../server/channels/registry.mjs')
    const { agentEvents } = await import('../../../server/agent-manager.mjs')
    const req = new Readable({ read() {} })
    req.method = 'GET'
    req.headers = {}
    const frames = []
    let endCalls = 0
    const res = {
      writableEnded: false,
      writeHead() {},
      flushHeaders() {},
      write(chunk) { frames.push(chunk) },
      end() { endCalls += 1; this.writableEnded = true },
      on() {},
    }

    await handleAgentApi(req, res, new URL('http://localhost/api/agents/events'), {})
    expect(channelEvents.listenerCount('channel_event')).toBe(1)

    // 非 sessions-changed 的渠道事件（log/status/qrcode）不得进入 agent 流。
    channelEvents.emit('channel_event', { type: 'log', channelId: 'wechat', line: 'noise' })
    channelEvents.emit('channel_event', { type: 'status', channelId: 'wechat', status: 'running' })
    channelEvents.emit('channel_event', { type: 'qrcode', channelId: 'wechat' })
    expect(frames).toEqual([])

    const payload = { type: 'sessions-changed', channelId: 'wechat', sessionId: 's1', projectId: 'p1' }
    channelEvents.emit('channel_event', payload)
    expect(frames.join('')).toBe(`event: sessions-changed\ndata: ${JSON.stringify(payload)}\n\n`)

    req.emit('close')
    req.emit('close')
    expect(channelEvents.listenerCount('channel_event')).toBe(0)
    expect(agentEvents.listenerCount('agent_event')).toBe(0)
    expect(endCalls).toBe(1)
    expect(res.writableEnded).toBe(true)
  })

  it('raises the channel event listener limit so multi-tab subscribers stay under the default warning threshold', async () => {
    const { channelEvents } = await import('../../../server/channels/registry.mjs')
    expect(channelEvents.getMaxListeners()).toBeGreaterThanOrEqual(100)
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
})
