import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class MockAgent {
  constructor(options = {}) {
    this.state = {
      ...(options.initialState || {}),
      messages: options.initialState?.messages ? [...options.initialState.messages] : [],
      pendingToolCalls: new Set(),
      isStreaming: false,
    }
    this.listeners = new Set()
    this.signal = null
    this.prompts = []
    this.onPrompt = null
    this.autoEnd = true
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async emit(event) {
    for (const listener of [...this.listeners]) await listener(event)
  }

  async prompt(input) {
    this.prompts.push(input)
    this.state.isStreaming = true
    this.state.messages = [...this.state.messages, input]
    await this.emit({ type: 'agent_start' })
    await this.emit({ type: 'message_end', message: input })
    if (this.onPrompt) await this.onPrompt(this, input)
    this.state.isStreaming = false
    if (this.autoEnd) await this.emit({ type: 'agent_end', messages: [] })
  }

  async continue() {}

  abort() {
    this.signal = { aborted: true }
  }

  async waitForIdle() {}
}

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: MockAgent,
  estimateContextTokens: vi.fn(() => 0),
  estimateTokens: vi.fn(() => 0),
  shouldCompact: vi.fn(() => false),
}))
vi.mock('../../server/ai-http-logger.mjs', () => ({ streamSimpleWithAiHttpLogging: vi.fn() }))
vi.mock('../../server/mcp/registry.mjs', () => ({
  createMcpToolDefinitions: vi.fn(async () => []),
  isMcpToolName: vi.fn(() => false),
  subscribeMcpToolsetChanged: vi.fn(() => () => {}),
}))
vi.mock('../../server/plugins/registry.mjs', () => ({
  callPluginTool: vi.fn(),
  createPluginToolDefinitions: vi.fn(async () => []),
  getEnabledPluginCommandSources: vi.fn(async () => []),
  getEnabledPluginSkillSources: vi.fn(async () => []),
  isPluginToolName: vi.fn(() => false),
}))
vi.mock('../../server/session-utils.mjs', () => ({
  buildSystemPrompt: vi.fn(async () => 'system prompt'),
  generateAiTitle: vi.fn(async () => null),
  generateTitle: vi.fn(() => 'New chat'),
}))

const PLAN = {
  action: 'plan',
  summary: 'Implement and verify.',
  criteria: [
    { description: 'Tests pass', required: true },
    { description: 'Docs reviewed', required: false },
  ],
  scope: ['server/'],
}

describe('goal mode through the agent manager', () => {
  let tmpDir
  let previousDataDir
  let agentManager
  let database
  let repository
  let storageModule

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-goal-manager-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    vi.resetModules()

    const { initializeSqliteStorage } = await import('../../server/sqlite/database.mjs')
    const { createSessionStateRepository } = await import('../../server/sqlite/session-state-repository.mjs')
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    database = await initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createSessionStateRepository(database)
    configureSessionStateService({ repository })

    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    agentManager = await import('../../server/agent-manager.mjs')
    storageModule = await import('../../server/storage.mjs')
  })

  afterEach(async () => {
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    configureSessionStateService({ repository: null })
    const { closeSqliteStorage } = await import('../../server/sqlite/database.mjs')
    await closeSqliteStorage()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function createSession(sessionId, extra = {}) {
    return agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }],
      title: 'Goal session',
      ...extra,
    })
  }

  function toolByName(session, name) {
    return session.agent.state.tools.find((tool) => tool.name === name)
  }

  it('runs /goal read-only planning and stops at awaiting_confirmation', async () => {
    const sessionId = 'goal-manager-plan'
    const session = await createSession(sessionId)
    // Keep the first planning run open so the assertions below observe the
    // planning state deterministically (the bounded retry loop is covered by
    // the continuation test).
    session.agent.autoEnd = false
    let commandDuringRun = null
    session.agent.onPrompt = () => {
      commandDuringRun = { name: session.activeCommandName, permissions: session.activeCommandPermissions }
    }
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')

      expect(session.goal).toMatchObject({ status: 'planning', objective: 'Ship goal mode' })
      expect(agentManager.getSessionState(sessionId).goal).toMatchObject({ status: 'planning' })
      expect(agentManager.getSessionStatus(sessionId).goal).toMatchObject({ status: 'planning' })
      expect(toolByName(session, 'goal_report')).toBeDefined()
      // Planning ran with the /plan read-only whitelist.
      await vi.waitFor(() => expect(commandDuringRun).not.toBeNull())
      expect(commandDuringRun).toEqual({
        name: 'plan',
        permissions: { allowEdit: false, allowCommands: false, allowSubagents: true },
      })

      const record = repository.findBySessionId(sessionId)
      expect(record.state.goal).toMatchObject({ status: 'planning', objective: 'Ship goal mode' })
      const metadata = await storageModule.readStore('sessions-metadata')
      expect(metadata[sessionId].goal).toMatchObject({ id: session.goal.id, status: 'planning' })

      await toolByName(session, 'goal_report').execute('call-plan', PLAN)
      expect(session.goal).toMatchObject({ status: 'awaiting_confirmation' })
      expect(session.goal.criteria.map((criterion) => criterion.id)).toEqual(['c1', 'c2'])
      expect(agentManager.getSessionState(sessionId).goal.status).toBe('awaiting_confirmation')
      expect(repository.findBySessionId(sessionId).state.goal.status).toBe('awaiting_confirmation')

      // Ending the planning run must not start an execution round.
      session.agent.autoEnd = true
      await session.agent.emit({ type: 'agent_end', messages: [] })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(session.agent.prompts).toHaveLength(1)
      expect(session.goal.status).toBe('awaiting_confirmation')
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('keeps continuing in bounded rounds after confirmation and stops without progress', async () => {
    const sessionId = 'goal-manager-loop'
    const session = await createSession(sessionId)
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
      await toolByName(session, 'goal_report').execute('call-plan', PLAN)

      const { handleGoalAction } = await import('../../server/agent-goal-runner.mjs')
      await handleGoalAction(session, 'confirm')
      expect(session.goal.status).toBe('running')

      // Two execution rounds run, each without progress, then the goal pauses
      // instead of looping forever.
      await vi.waitFor(() => expect(session.goal.status).toBe('paused'), { timeout: 10_000 })
      expect(session.goal.blocker).toBe('no_progress')
      expect(session.goal.usage.iterations).toBe(2)
      expect(session.agent.prompts).toHaveLength(3)
      expect(session.agent.prompts[1].metadata).toEqual({ quickforgeGoalRun: 'execution' })
      expect(session.agent.prompts[1].content).toContain('继续执行目标')

      const record = repository.findBySessionId(sessionId)
      expect(record.state.goal).toMatchObject({ status: 'paused', blocker: 'no_progress' })
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('restores an in-flight goal as paused and never replays it', async () => {
    const sessionId = 'goal-manager-restore'
    const session = await createSession(sessionId)
    await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
    await toolByName(session, 'goal_report').execute('call-plan', PLAN)
    // Let the planning run settle before overriding the goal body.
    await vi.waitFor(() => expect(session.goalRun ?? null).toBeNull())
    session.goal = { ...session.goal, status: 'running', usage: { iterations: 3, activeDurationMs: 60_000 } }
    await agentManager.persistSessionState(session)
    await agentManager.destroyAgent(sessionId)

    const restored = await agentManager.restoreAgent(sessionId)
    try {
      expect(restored.goal).toMatchObject({
        status: 'paused',
        usage: { iterations: 3, activeDurationMs: 60_000 },
      })
      expect(restored.goal.blocker).toContain('restarted')
      expect(agentManager.getSessionState(sessionId).goal.status).toBe('paused')
      expect(toolByName(restored, 'goal_report')).toBeDefined()
      expect(restored.agent.prompts).toHaveLength(0)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('keeps a goal-only session alive with an empty message history', async () => {
    const sessionId = 'goal-manager-empty'
    const session = await createSession(sessionId, { messages: [] })
    try {
      session.goal = {
        id: 'goal_empty',
        sessionId,
        revision: 1,
        objective: 'Empty history goal',
        status: 'awaiting_confirmation',
        criteria: [{ id: 'c1', description: 'x', required: true, status: 'pending', evidenceIds: [] }],
        scope: [],
        summary: '',
        budget: { maxIterations: 8, maxActiveDurationMs: 30 * 60 * 1000 },
        usage: { iterations: 0, activeDurationMs: 0 },
        evidence: [],
        updatedAt: new Date().toISOString(),
      }
      await agentManager.persistSessionState(session)
      expect(repository.findBySessionId(sessionId)).not.toBeNull()
      expect(repository.findBySessionId(sessionId).state.goal.id).toBe('goal_empty')
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('rejects ordinary prompts and retries while a goal is active', async () => {
    const sessionId = 'goal-manager-exclusive'
    const session = await createSession(sessionId)
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
      await vi.waitFor(() => expect(session.agent.state.isStreaming).toBe(false))
      await expect(agentManager.runPrompt(sessionId, 'unrelated message')).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'GOAL_ACTIVE',
      })
      await expect(agentManager.continueSession(sessionId)).rejects.toMatchObject({ errorCode: 'GOAL_ACTIVE' })
      await expect(agentManager.rollbackSessionMessages(sessionId, 0)).rejects.toMatchObject({ errorCode: 'GOAL_ACTIVE' })
      // The goal survived the rejected prompts (still owned by the card).
      expect(session.goal).not.toBeNull()
      expect(['planning', 'paused', 'blocked']).toContain(session.goal.status)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('does not offer goal mode to ACP sessions', async () => {
    const sessionId = 'goal-manager-acp'
    const session = await createSession(sessionId, { source: 'acp' })
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
      expect(session.goal).toBeNull()
      expect(agentManager.getSessionState(sessionId).goal).toBeNull()
      expect(toolByName(session, 'goal_report')).toBeUndefined()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('clears a finished goal on the next ordinary prompt', async () => {
    const sessionId = 'goal-manager-terminal'
    const session = await createSession(sessionId)
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
      await toolByName(session, 'goal_report').execute('call-plan', PLAN)
      const { handleGoalAction } = await import('../../server/agent-goal-runner.mjs')
      await handleGoalAction(session, 'cancel')
      expect(session.goal.status).toBe('cancelled')
      expect(toolByName(session, 'goal_report')).toBeUndefined()
      await vi.waitFor(() => expect(session.agent.state.isStreaming).toBe(false))

      await agentManager.runPrompt(sessionId, 'next task')
      expect(session.goal).toBeNull()
      expect(agentManager.getSessionState(sessionId).goal).toBeNull()
      expect(toolByName(session, 'goal_report')).toBeUndefined()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('rejects steer and follow-up while a goal is active', async () => {
    const sessionId = 'goal-manager-steer'
    const session = await createSession(sessionId)
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
      await vi.waitFor(() => expect(session.goal?.status).toBe('planning'))
      await expect(async () => agentManager.steerAgent(sessionId, 'do something else')).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'GOAL_ACTIVE',
      })
      await expect(async () => agentManager.followUpAgent(sessionId, 'and then')).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'GOAL_ACTIVE',
      })
      expect(session.goal).not.toBeNull()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('settles a goal run whose prompt rejects without leaving it stuck', async () => {
    const sessionId = 'goal-manager-prompt-reject'
    const session = await createSession(sessionId)
    session.agent.prompt = async () => { throw new Error('planning boom') }
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
      // The synthetic agent_end path (prompt rejection) must still persist and
      // settle the run; repeated planning failures then pause the goal.
      await vi.waitFor(() => expect(session.goalRun ?? null).toBeNull(), { timeout: 10_000 })
      await vi.waitFor(() => expect(session.goal.status).toBe('paused'), { timeout: 10_000 })
      expect(['repeated_failures', 'planning_incomplete']).toContain(session.goal.blocker)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('drops a malformed restored goal body instead of trusting it', async () => {
    const sessionId = 'goal-manager-bad-restore'
    const session = await agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }],
      restoredGoal: { id: 'goal_x', status: 'not-a-status', objective: 'injected' },
    })
    try {
      expect(session.goal).toBeNull()
      expect(toolByName(session, 'goal_report')).toBeUndefined()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('hands a completed goal to the user only after the run truly ends', async () => {
    const sessionId = 'goal-manager-complete-defer'
    const session = await createSession(sessionId)
    const { handleGoalAction } = await import('../../server/agent-goal-runner.mjs')
    try {
      // Settle the planning run, then keep the execution run open.
      session.agent.autoEnd = false
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
      await toolByName(session, 'goal_report').execute('call-plan', PLAN)
      session.agent.autoEnd = true
      await session.agent.emit({ type: 'agent_end', messages: [] })
      await vi.waitFor(() => expect(session.goalRun ?? null).toBeNull())
      expect(session.goal.status).toBe('awaiting_confirmation')

      session.agent.autoEnd = false
      await handleGoalAction(session, 'confirm')
      await vi.waitFor(() => expect(session.goalRun).not.toBeNull())

      // Real event path: the manager records the successful verification tool.
      await session.agent.emit({
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'run_command',
        isError: false,
        result: { content: [{ type: 'text', text: 'ok' }], details: { code: 0, signal: null, timedOut: false, aborted: false } },
      })
      await toolByName(session, 'goal_report').execute('call-complete', {
        action: 'complete',
        summary: 'All done',
        evidence: [{ id: 'e1', description: 'tests passed', toolCallId: 'tool-1' }],
        criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
      })
      expect(session.goal.status).toBe('verifying')
      expect(session.goal.status).not.toBe('needs_review')

      await session.agent.emit({ type: 'agent_end', messages: [] })
      await vi.waitFor(() => expect(session.goal?.status).toBe('needs_review'))
      expect(session.goalRun).toBeNull()
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('rejects a shared /goal request without locking the owner out of the goal card', async () => {
    const sessionId = 'goal-manager-shared'
    const session = await createSession(sessionId)
    try {
      // Shared visitor: /goal is rejected before any goal state exists. The
      // request-scoped model access overlay is recorded on the session, but it
      // must stay request-scoped.
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode', [], null, null, { source: 'shared', allowCloud: false })
      expect(session.goal).toBeNull()
      expect(session.agent.prompts).toHaveLength(0)
      expect(session.modelAccessContext).toMatchObject({ source: 'shared' })

      // Owner: the same session still creates (and can act on) a goal.
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
      expect(session.goal).toMatchObject({ status: 'planning' })
      await toolByName(session, 'goal_report').execute('call-plan', PLAN)
      expect(session.goal.status).toBe('awaiting_confirmation')
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('keeps the goal command state on every continuation round with an immediate persist flush', async () => {
    const sessionId = 'goal-manager-settle-barrier'
    const session = await createSession(sessionId)
    const observed = []
    session.agent.onPrompt = (agent, input) => {
      observed.push({ name: session.activeCommandName, prompt: session.activeCommandPrompt, content: input.content })
    }
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal mode')
      await toolByName(session, 'goal_report').execute('call-plan', PLAN)
      const { handleGoalAction } = await import('../../server/agent-goal-runner.mjs')
      await handleGoalAction(session, 'confirm')
      await vi.waitFor(() => expect(session.goal.status).toBe('paused'), { timeout: 10_000 })

      // Each execution round ran with its own goal command state: a finished
      // run's cleanup never wiped the next round even though persistence
      // resolved immediately.
      const executionRounds = observed.filter((entry) => String(entry.content).includes('继续执行目标'))
      expect(executionRounds.length).toBeGreaterThanOrEqual(2)
      for (const entry of executionRounds) {
        expect(entry.name).toBe('goal')
        expect(entry.prompt).toContain('<goal_continuation')
      }
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })
})
