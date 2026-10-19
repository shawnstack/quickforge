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

  abort() {}

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

describe('goal v2 through the agent manager', () => {
  let tmpDir
  let previousDataDir
  let agentManager
  let database
  let repository

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-goal-v2-manager-'))
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
      title: 'Goal v2 session',
      goalEngine: 'v2',
      ...extra,
    })
  }

  function toolByName(session, name) {
    return session.agent.state.tools.find((tool) => tool.name === name)
  }

  it('plans read-only, auto-starts execution, and blocks after repeated no-progress rounds', async () => {
    const sessionId = 'goal-v2-manager-loop'
    const session = await createSession(sessionId)
    session.agent.autoEnd = false
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal v2')

      expect(session.goal).toMatchObject({
        phase: 'active',
        activation: 'armed',
        objective: 'Ship goal v2',
        status: 'planning',
      })
      expect(toolByName(session, 'goal_report')).toBeDefined()

      await toolByName(session, 'goal_report').execute('call-plan', PLAN)
      expect(session.goal.phase).toBe('active')
      expect(session.goal.plan.criteria.map((criterion) => criterion.id)).toEqual(['c1', 'c2'])
      expect(session.goal.criteria).toHaveLength(2)

      session.agent.autoEnd = true
      await session.agent.emit({ type: 'agent_end', messages: [] })
      await vi.waitFor(() => expect(session.goal.phase).toBe('blocked'), { timeout: 10_000 })
      expect(session.goal.blocker).toBe('no_progress')
      expect(session.goal.roundsStarted).toBe(2)
      expect(session.agent.prompts).toHaveLength(3)
      expect(session.agent.prompts[1].metadata).toMatchObject({ quickforgeGoalRun: 'execution', quickforgeGoalRound: 1 })

      const record = repository.findBySessionId(sessionId)
      expect(record.state.goal).toMatchObject({ phase: 'blocked' })
      expect(record.state.goalEvents?.length).toBeGreaterThan(0)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('completes only after evidence, normal run end and durable persistence', async () => {
    const sessionId = 'goal-v2-manager-complete'
    const session = await createSession(sessionId)
    session.agent.autoEnd = false
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal v2')
      await toolByName(session, 'goal_report').execute('call-plan', {
        action: 'plan',
        summary: 'Plan',
        criteria: [{ description: 'Tests pass', required: true }],
      })

      // Keep the execution run open so goal_report sees an active run.
      session.agent.autoEnd = false
      await session.agent.emit({ type: 'agent_end', messages: [] })
      await vi.waitFor(() => expect(session.goalRun?.kind).toBe('execution'), { timeout: 10_000 })
      await session.agent.emit({
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'run_command',
        isError: false,
        result: { details: { code: 0 } },
      })
      await toolByName(session, 'goal_report').execute('call-progress', {
        action: 'progress',
        summary: 'Verified',
        evidence: [{ description: 'tests passed', toolCallId: 'tool-1' }],
        criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
      })
      await toolByName(session, 'goal_report').execute('call-complete', { action: 'complete' })
      expect(session.goal.phase).toBe('active')
      expect(session.goal.runtime).toBe('verifying')

      session.agent.autoEnd = true
      await session.agent.emit({ type: 'agent_end', messages: [] })
      await vi.waitFor(() => expect(session.goal?.phase).toBe('complete'), { timeout: 10_000 })
      expect(session.goal.completedBy).toBe('verified')
      expect(session.goal.plan.criteria[0].status).toBe('passed')
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('creates a goal through create_goal on a direct human message', async () => {
    const sessionId = 'goal-v2-manager-auto-create-direct'
    const session = await createSession(sessionId)
    try {
      expect(toolByName(session, 'get_goal')).toBeDefined()
      expect(toolByName(session, 'create_goal')).toBeDefined()
      expect(toolByName(session, 'update_goal')).toBeDefined()
      session.agent.state.messages.push({ role: 'user', content: 'Please finish the migration', timestamp: Date.now() })
      const result = await toolByName(session, 'create_goal').execute('call-create', {
        objective: 'Finish the migration',
        max_goal_rounds: 5,
      })
      expect(result).toMatchObject({ content: [{ type: 'text' }] })
      expect(session.goal).toMatchObject({ phase: 'active', objective: 'Finish the migration', maxRounds: 5 })
      expect(toolByName(session, 'goal_report')).toBeDefined()
      const read = await toolByName(session, 'get_goal').execute('call-read', {})
      expect(JSON.parse(read.content[0].text).goal.objective).toBe('Finish the migration')
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('lets the model complete from an execution round through update_goal', async () => {
    const sessionId = 'goal-v2-manager-goal-round-complete'
    const session = await createSession(sessionId)
    session.agent.autoEnd = false
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal v2')
      await toolByName(session, 'goal_report').execute('call-plan', PLAN)

      await session.agent.emit({ type: 'agent_end', messages: [] })
      await vi.waitFor(() => expect(session.goalRun?.kind).toBe('execution'), { timeout: 10_000 })

      const goal = session.goal
      const result = await toolByName(session, 'update_goal').execute('call-complete', {
        goal_id: goal.id,
        revision: goal.revision,
        action: 'complete',
      })
      expect(result).toMatchObject({ content: [{ type: 'text' }] })
      expect(session.goal).toMatchObject({ phase: 'complete', activation: 'disarmed' })
    } finally {
      session.agent.autoEnd = true
      await session.agent.emit({ type: 'agent_end', messages: [] })
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('supports /goal pause, /goal resume and /goal clear without a model turn', async () => {
    const now = new Date().toISOString()
    const snapshot = (sessionId, phase) => ({
      id: 'goal_command',
      sessionId,
      revision: 3,
      objective: 'Ship goal v2',
      phase,
      maxRounds: 20,
      roundsStarted: 1,
      plan: {
        criteria: [{ id: 'c1', description: 'Tests pass', required: true, status: 'pending', evidenceIds: [] }],
        scope: [],
        summary: 'Plan',
        submittedAt: now,
      },
      evidence: [],
      blocker: null,
      attachments: [],
      usage: { activeDurationMs: 0 },
      createdAt: now,
      updatedAt: now,
    })

    const pauseSessionId = 'goal-v2-manager-command-pause'
    const pauseSession = await createSession(pauseSessionId, { restoredGoal: snapshot(pauseSessionId, 'active') })
    try {
      await agentManager.runPrompt(pauseSessionId, '/goal pause')
      expect(pauseSession.goal).toMatchObject({ phase: 'paused', activation: 'disarmed' })

      await agentManager.runPrompt(pauseSessionId, '/goal clear')
      expect(pauseSession.goal).toBeNull()
    } finally {
      await agentManager.destroyAgent(pauseSessionId)
    }

    const resumeSessionId = 'goal-v2-manager-command-resume'
    const resumeSession = await createSession(resumeSessionId, { restoredGoal: snapshot(resumeSessionId, 'paused') })
    try {
      await agentManager.runPrompt(resumeSessionId, '/goal resume')
      expect(resumeSession.goal).toMatchObject({ phase: 'active', activation: 'armed' })
      expect(toolByName(resumeSession, 'goal_report')).toBeDefined()
    } finally {
      await agentManager.destroyAgent(resumeSessionId)
    }
  })

  it('restores a v2 goal as active but disarmed and never replays it', async () => {
    const sessionId = 'goal-v2-manager-restore'
    const session = await createSession(sessionId)
    await agentManager.runPrompt(sessionId, '/goal Ship goal v2')
    await toolByName(session, 'goal_report').execute('call-plan', PLAN)
    await vi.waitFor(() => expect(session.goalRun ?? null).toBeNull())
    await agentManager.destroyAgent(sessionId)

    const restored = await agentManager.restoreAgent(sessionId)
    try {
      expect(restored.goal).toMatchObject({ phase: 'active', activation: 'disarmed', status: 'paused' })
      expect(restored.agent.prompts).toHaveLength(0)
      expect(restored.goal.plan.criteria).toHaveLength(2)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })
})
