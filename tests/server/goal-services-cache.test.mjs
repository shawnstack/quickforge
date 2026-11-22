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

describe('goal v2 service cache lifecycle', () => {
  let tmpDir
  let previousDataDir
  let agentManager
  let database
  let repository

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-goal-services-cache-'))
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
    const { flushLogger } = await import('../../server/utils/logger.mjs')
    flushLogger()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function createSession(sessionId) {
    return agentManager.createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }],
      title: 'Goal service cache session',
      goalEngine: 'v2',
    })
  }

  function toolByName(session, name) {
    return session.agent.state.tools.find((tool) => tool.name === name)
  }

  it('drops the folded goal state from the service cache on destroy, so a restore reads storage, not the stale cache', async () => {
    const sessionId = 'goal-services-cache-destroy'
    const session = await createSession(sessionId)
    session.agent.autoEnd = false // Drive settlement explicitly so we can await its finally block.
    const persistence = await import('../../server/agent-persistence.mjs')
    const { finishGoalRun } = await import('../../server/goal/runner.mjs')
    const releasePersist = Promise.withResolvers()
    let settlement
    try {
      // Create a goal; the folded state (revision 1, active) now lives in the
      // v2 runner's module-level `services` cache.
      session.agent.state.messages.push({ role: 'user', content: 'Ship goal v2', timestamp: Date.now() })
      await toolByName(session, 'create_goal').execute('call-create', {
        objective: 'Ship goal v2',
        max_goal_rounds: 1,
      })
      expect(session.goal).toMatchObject({ phase: 'active', activation: 'armed' })
      const goalId = session.goal.id

      await vi.waitFor(() => expect(session.agent.prompts).toHaveLength(1), { timeout: 10_000 })
      // Hold only the return from the blocked round's real write, not the
      // storage lock or destroy's final persist. Settlement resumes after eviction.
      const blockedWrite = Promise.withResolvers()
      const persist = persistence.persistSession
      const spy = vi.spyOn(persistence, 'persistSession').mockImplementation(async (...args) => {
        const result = await persist(...args)
        if (args[0] === session && session.goal.phase === 'blocked') {
          spy.mockRestore()
          blockedWrite.resolve()
          await releasePersist.promise
        }
        return result
      })
      settlement = finishGoalRun(session)
      await blockedWrite.promise
      const preDestroyRevision = session.goal.revision
      await agentManager.destroyAgent(sessionId)
      releasePersist.resolve()
      await settlement

      // External writer (another process / fork): replace the stored goal
      // events with a fresh lifecycle at a higher revision — exactly what a
      // forked session write would look like to this process.
      const record = repository.findBySessionId(sessionId)
      const state = typeof record.state === 'string' ? JSON.parse(record.state) : record.state
      const blockedGoal = state.goal
      const externalGoal = {
        ...blockedGoal,
        revision: blockedGoal.revision + 1,
        phase: 'active',
      }
      const externalEvents = [
        ...state.goalEvents,
        { v: 1, operation: 'change', at: new Date().toISOString(), goal: externalGoal, roundsStarted: externalGoal.roundsStarted },
      ]
      repository.save({ ...record, state: { ...state, goal: externalGoal, goalEvents: externalEvents } })

      // Restore: with the fix, serviceFor() misses and loadSession() folds
      // the *stored* events; without it, the stale pre-destroy folded state
      // is reused and the external revision is never observed.
      const restored = await agentManager.restoreAgent(sessionId)
      expect(restored.goal).toMatchObject({ id: goalId, phase: 'active' })
      expect(restored.goal.revision).toBe(preDestroyRevision + 1)
      expect(restored.goal.revision).not.toBe(preDestroyRevision)
      expect(restored.goal.activation).toBe('disarmed')

      const read = await toolByName(restored, 'get_goal').execute('call-read', {})
      const parsed = JSON.parse(read.content[0].text)
      expect(parsed.goal).toMatchObject({ phase: 'active', revision: preDestroyRevision + 1 })
    } finally {
      releasePersist.resolve()
      await settlement
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('destroy stays safe for a session that never touched the goal cache', async () => {
    const sessionId = 'goal-services-cache-plain'
    const session = await createSession(sessionId)
    expect(session.goal).toBeNull()
    await agentManager.destroyAgent(sessionId)
    expect(agentManager.getSessionStatus(sessionId)).toBeNull()
  })
})
