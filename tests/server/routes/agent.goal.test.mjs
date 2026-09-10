import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  restoreAgent: vi.fn(),
  handleGoalAction: vi.fn(),
  isGoalModeAvailable: vi.fn(() => true),
  isGoalAction: (value) => ['confirm', 'pause', 'resume', 'extend_resume', 'cancel', 'revise', 'accept'].includes(value),
}))

vi.mock('../../../server/agent-goal-runner.mjs', () => ({
  handleGoalAction: mocks.handleGoalAction,
  isGoalModeAvailable: mocks.isGoalModeAvailable,
}))
vi.mock('../../../server/agent-goal-state.mjs', () => ({ isGoalAction: mocks.isGoalAction }))

// Minimal agent-manager facade: the goal route only needs restoreAgent, but the
// module imports the full named export list.
vi.mock('../../../server/agent-manager.mjs', () => ({
  abortRun: vi.fn(),
  abortToolCall: vi.fn(),
  agentEvents: { on: vi.fn(), removeListener: vi.fn(), emit: vi.fn(), listenerCount: vi.fn(() => 0), removeAllListeners: vi.fn() },
  approveAutoCompact: vi.fn(),
  approveToolCall: vi.fn(),
  continueSession: vi.fn(),
  createAgent: vi.fn(),
  destroyAgent: vi.fn(),
  followUpAgent: vi.fn(),
  getSessionEventBus: vi.fn(),
  getSessionState: vi.fn(),
  getSessionStatus: vi.fn(),
  isSessionFileRollbackBusy: vi.fn(() => false),
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
  updateSessionModel: vi.fn(),
  updateSessionThinkingLevel: vi.fn(),
  updateSessionTitle: vi.fn(),
  updateSessionYoloMode: vi.fn(),
  stripSplitSessionState: (state) => state,
}))
vi.mock('../../../server/utils/logger.mjs', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))
vi.mock('../../../server/text-attachments.mjs', () => ({ createTextAttachment: vi.fn(), isTextAttachmentPath: vi.fn() }))
vi.mock('../../../server/utils/platform.mjs', () => ({ openPathInFileManager: vi.fn() }))
vi.mock('../../../server/session-file-backups.mjs', () => ({
  getSessionFileChanges: vi.fn(),
  getSessionFileRollbackPreview: vi.fn(),
  rollbackSessionFiles: vi.fn(),
  rollbackSessionFile: vi.fn(),
  getSessionTurnRollbackPreview: vi.fn(),
  rollbackSessionTurn: vi.fn(),
}))
vi.mock('../../../server/channels/registry.mjs', () => ({ channelEvents: { on: vi.fn(), removeListener: vi.fn(), emit: vi.fn() } }))
vi.mock('../../../server/model-catalog.mjs', () => ({ resolveModelBinding: vi.fn() }))

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

describe('agent goal route', () => {
  beforeEach(() => {
    mocks.restoreAgent.mockReset()
    mocks.handleGoalAction.mockReset()
    mocks.isGoalModeAvailable.mockReset()
    mocks.isGoalModeAvailable.mockReturnValue(true)
  })

  it('rejects unknown actions without touching the session', async () => {
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    await expect(handleAgentApi(
      request({ action: 'explode' }),
      response(),
      new URL('http://localhost/api/agents/session-1/goal'),
    )).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.handleGoalAction).not.toHaveBeenCalled()
  })

  it('returns 404 when the session cannot be restored', async () => {
    mocks.restoreAgent.mockResolvedValue(null)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    await expect(handleAgentApi(
      request({ action: 'pause' }),
      response(),
      new URL('http://localhost/api/agents/session-1/goal'),
    )).rejects.toMatchObject({ statusCode: 404 })
  })

  it('forwards the exact extend_resume CAS body and returns the authoritative goal', async () => {
    const session = { sessionId: 'session-1', goal: { id: 'goal_1' } }
    const body = { action: 'extend_resume', goalId: 'goal_1', expectedRevision: 4 }
    const updated = { id: 'goal_1', status: 'running', revision: 5 }
    mocks.restoreAgent.mockResolvedValue(session)
    mocks.handleGoalAction.mockResolvedValue(updated)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()
    await handleAgentApi(request(body), res, new URL('http://localhost/api/agents/session-1/goal'))
    expect(mocks.handleGoalAction).toHaveBeenCalledWith(session, 'extend_resume', undefined, null, body)
    expect(JSON.parse(res.body)).toEqual({ goal: updated })
  })

  it('applies the action and returns the authoritative goal', async () => {
    const session = { sessionId: 'session-1', goal: { id: 'goal_1' } }
    const updated = { id: 'goal_1', status: 'paused', revision: 4 }
    mocks.restoreAgent.mockResolvedValue(session)
    mocks.handleGoalAction.mockResolvedValue(updated)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(
      request({ action: 'revise', objective: 'New scope' }),
      res,
      new URL('http://localhost/api/agents/session-1/goal'),
    )

    expect(mocks.handleGoalAction).toHaveBeenCalledWith(session, 'revise', 'New scope', null)
    expect(JSON.parse(res.body)).toEqual({ goal: updated })
  })

  it('propagates goal conflicts as HTTP errors', async () => {
    mocks.restoreAgent.mockResolvedValue({ sessionId: 'session-1', goal: { id: 'goal_1' } })
    mocks.handleGoalAction.mockRejectedValue(Object.assign(new Error('Cannot confirm'), { statusCode: 409, errorCode: 'GOAL_ACTION_INVALID' }))
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    await expect(handleAgentApi(
      request({ action: 'confirm' }),
      response(),
      new URL('http://localhost/api/agents/session-1/goal'),
    )).rejects.toMatchObject({ statusCode: 409, errorCode: 'GOAL_ACTION_INVALID' })
  })

  it('allows goal actions after a shared request left a request-scoped source on the session', async () => {
    // A shared visitor's prompt sets modelAccessContext.source = 'shared', but
    // that overlay is request-scoped: it must never permanently lock the owner
    // out of the goal card.
    const session = {
      sessionId: 'session-1',
      goal: { id: 'goal_1' },
      source: null,
      modelAccessContext: { source: 'shared' },
    }
    const updated = { id: 'goal_1', status: 'running' }
    mocks.restoreAgent.mockResolvedValue(session)
    mocks.handleGoalAction.mockResolvedValue(updated)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(
      request({ action: 'confirm' }),
      res,
      new URL('http://localhost/api/agents/session-1/goal'),
    )

    expect(mocks.isGoalModeAvailable).toHaveBeenCalledWith(session, null)
    expect(mocks.handleGoalAction).toHaveBeenCalledWith(session, 'confirm', undefined, null)
    expect(JSON.parse(res.body)).toEqual({ goal: updated })
  })

  it('rejects goal actions at the request entry when the runner gate denies the session', async () => {
    mocks.restoreAgent.mockResolvedValue({ sessionId: 'session-1', goal: { id: 'goal_1' }, source: 'acp' })
    mocks.isGoalModeAvailable.mockReturnValue(false)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    await expect(handleAgentApi(
      request({ action: 'accept' }),
      response(),
      new URL('http://localhost/api/agents/session-1/goal'),
    )).rejects.toMatchObject({ statusCode: 409, errorCode: 'GOAL_UNAVAILABLE' })
    expect(mocks.handleGoalAction).not.toHaveBeenCalled()
  })

  it('passes the explicit accept action through to the runner', async () => {
    const session = { sessionId: 'session-1', goal: { id: 'goal_1' } }
    const updated = { id: 'goal_1', status: 'completed', humanAcceptedAt: '2026-01-01T00:00:00.000Z' }
    mocks.restoreAgent.mockResolvedValue(session)
    mocks.handleGoalAction.mockResolvedValue(updated)
    const { handleAgentApi } = await import('../../../server/routes/agent.mjs')
    const res = response()

    await handleAgentApi(
      request({ action: 'accept' }),
      res,
      new URL('http://localhost/api/agents/session-1/goal'),
    )

    expect(mocks.handleGoalAction).toHaveBeenCalledWith(session, 'accept', undefined, null)
    expect(JSON.parse(res.body)).toEqual({ goal: updated })
  })
})
