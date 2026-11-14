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
    // logger 的 5s 刷盘定时器还挂在这个临时数据目录上：留着它会在 rm 之后把
    // data/logs 重新 mkdir 出来（Windows 上表现为 ENOTEMPTY 或 %TEMP% 空壳目录）。
    // 先把缓冲刷完并关流，再恢复 env / 删目录；之后 logger 会按需重建。
    const { flushLogger } = await import('../../server/utils/logger.mjs')
    flushLogger()
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

  /**
   * Park the next goal round inside `startGoalRun`, between `beginGoalRun`
   * (which registers `session.goalRun`) and `agent.prompt`. The injected runtime
   * refresh is the only await in between, so holding it open reproduces exactly
   * the window a user's clear/Stop has to land in.
   */
  async function holdNextGoalRoundWindow() {
    const [{ configureGoalRunner }, { refreshSessionRuntime }] = await Promise.all([
      import('../../server/goal/engine.mjs'),
      import('../../server/agent-session-lifecycle.mjs'),
    ])
    let enterWindow
    const windowOpened = new Promise((resolve) => { enterWindow = resolve })
    let openGate
    const gate = new Promise((resolve) => { openGate = resolve })
    let holdNextRefresh = true
    configureGoalRunner({
      refreshRuntime: async (target) => {
        if (holdNextRefresh) {
          holdNextRefresh = false
          enterWindow()
          await gate
        }
        return refreshSessionRuntime(target)
      },
    })
    return { windowOpened, open: () => openGate() }
  }

  /** Park the first persisted session write that matches `shouldHold`. */
  async function armPersistenceGate(shouldHold) {
    const { configureSessionStateService } = await import('../../server/session-state-service.mjs')
    let entered
    const enteredPromise = new Promise((resolve) => { entered = resolve })
    let release
    const gate = new Promise((resolve) => { release = resolve })
    let armed = true
    // The repository instance is frozen, so gate a delegate copy of it and hand
    // that to the session-state service for the duration of this test.
    const gated = { ...repository }
    const originalSave = repository.save
    gated.save = async (record, options) => {
      if (armed && shouldHold(record)) {
        armed = false
        entered()
        await gate
      }
      return originalSave.call(repository, record, options)
    }
    configureSessionStateService({ repository: gated })
    return {
      enteredPromise,
      release: () => { armed = false; release() },
      restore: () => {
        armed = false
        release()
        configureSessionStateService({ repository })
      },
    }
  }

  /** The persisted record carries the goal snapshot the write was made for. */
  function persistedRoundsStarted(record) {
    try {
      const state = typeof record?.state === 'string' ? JSON.parse(record.state) : record?.state
      return Number(state?.goal?.roundsStarted) || 0
    } catch {
      return 0
    }
  }

  it('runs bounded rounds until the round limit then blocks (DSH: no no-progress detection)', async () => {
    const sessionId = 'goal-v2-manager-round-limit'
    const session = await createSession(sessionId)
    session.agent.autoEnd = true
    try {
      // Create directly with a small round budget via the model tool.
      session.agent.state.messages.push({ role: 'user', content: 'Ship goal v2', timestamp: Date.now() })
      await toolByName(session, 'create_goal').execute('call-create', {
        objective: 'Ship goal v2',
        max_goal_rounds: 3,
      })
      expect(session.goal).toMatchObject({ phase: 'active', activation: 'armed', maxRounds: 3 })

      // The driver starts rounds after idle; 3 rounds exhaust the budget.
      await vi.waitFor(() => expect(session.goal.phase).toBe('blocked'), { timeout: 30_000 })
      expect(session.goal.blockerInfo?.code).toBe('round_limit')
      expect(session.goal.roundsStarted).toBe(3)
      expect(session.agent.prompts.length).toBeGreaterThanOrEqual(3)

      const record = repository.findBySessionId(sessionId)
      expect(record.state.goal).toMatchObject({ phase: 'blocked' })
      expect(record.state.goalEvents?.length).toBeGreaterThan(0)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('completes immediately when the model calls update_goal complete (DSH: no evidence gate)', async () => {
    const sessionId = 'goal-v2-manager-complete'
    const session = await createSession(sessionId)
    session.agent.autoEnd = false
    try {
      // Create the goal via /goal.
      await agentManager.runPrompt(sessionId, '/goal Ship goal v2')
      expect(session.goal.phase).toBe('active')

      // The driver schedules the first round; wait for it to start.
      await vi.waitFor(() => expect(session.goalRun?.kind).toBe('execution'), { timeout: 10_000 })

      // Model marks complete directly (DSH behavior).
      const goal = session.goal
      await toolByName(session, 'update_goal').execute('call-complete', {
        goal_id: goal.id,
        revision: goal.revision,
        action: 'complete',
      })
      expect(session.goal.phase).toBe('complete')
      expect(session.goal.completedBy).toBe('user')
    } finally {
      session.agent.autoEnd = true
      await session.agent.emit({ type: 'agent_end', messages: [] })
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
      // v2 has exactly one completion entry (`update_goal`); the legacy
      // `goal_report` tool is not mounted because its plan precondition can
      // never be met here — offering it made the model report completion into
      // a rejected call while the driver kept scheduling rounds.
      expect(toolByName(session, 'goal_report')).toBeUndefined()
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

      // A completed goal ends the round and never schedules another one: the
      // round's own normal end must not turn the model's completion into a
      // continuation.
      const promptCount = session.agent.prompts.length
      await session.agent.emit({ type: 'agent_end', messages: [] })
      await vi.waitFor(() => expect(session.goalRun ?? null).toBeNull())
      expect(session.agent.prompts).toHaveLength(promptCount)
      expect(session.goal).toMatchObject({ phase: 'complete', roundsStarted: goal.roundsStarted })
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
      expect(toolByName(resumeSession, 'update_goal')).toBeDefined()
      expect(toolByName(resumeSession, 'goal_report')).toBeUndefined()
    } finally {
      await agentManager.destroyAgent(resumeSessionId)
    }
  })

  it('restores a v2 goal as active but disarmed and never replays it', async () => {
    const sessionId = 'goal-v2-manager-restore'
    const session = await createSession(sessionId)
    session.agent.autoEnd = false
    await agentManager.runPrompt(sessionId, '/goal Ship goal v2')
    await vi.waitFor(() => expect(session.goal?.roundsStarted).toBe(1), { timeout: 10_000 })
    await vi.waitFor(() => expect(session.goalRun?.kind).toBe('execution'))
    await agentManager.destroyAgent(sessionId)

    const restored = await agentManager.restoreAgent(sessionId)
    try {
      expect(restored.goal).toMatchObject({ phase: 'active', activation: 'disarmed', status: 'paused' })
      expect(restored.agent.prompts).toHaveLength(0)
      expect(restored.goal.roundsStarted).toBe(1)
    } finally {
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('does not dispatch a goal round the user cleared while it was still starting', async () => {
    const sessionId = 'goal-v2-manager-clear-window'
    const session = await createSession(sessionId)
    const { handleGoalAction } = await import('../../server/goal/engine.mjs')
    const window = await holdNextGoalRoundWindow()
    session.agent.autoEnd = false
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal v2')
      await window.windowOpened

      // Inside the window the round is registered, the service says it is
      // executing, and nothing has reached the agent yet.
      const run = session.goalRun
      expect(run?.kind).toBe('execution')
      expect(session.goal).toMatchObject({ phase: 'active', activation: 'armed', runtime: 'executing' })
      expect(session.agent.prompts).toHaveLength(0)

      await handleGoalAction(session, 'cancel')
      // v2 cancel/clear only clears the service goal: the round stays registered
      // on the session, so only a driver-side settlement can drop it.
      expect(session.goal).toBeNull()
      expect(session.goalRun).toBe(run)

      window.open()
      await vi.waitFor(() => expect(session.goalRun).toBeNull(), { timeout: 5_000 })
      expect(session.agent.prompts).toHaveLength(0)
      expect(session.goal).toBeNull()
      expect(session.goalEvents?.at(-1)?.tombstone?.outcome).toBe('cancelled')
    } finally {
      window.open()
      session.agent.autoEnd = true
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('settles the goal round a Stop landed on while it was still starting', async () => {
    const sessionId = 'goal-v2-manager-stop-window'
    const session = await createSession(sessionId)
    const window = await holdNextGoalRoundWindow()
    session.agent.autoEnd = false
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal v2')
      await window.windowOpened
      expect(session.goalRun?.kind).toBe('execution')
      expect(session.agent.prompts).toHaveLength(0)

      // Real Stop path: POST /api/agents/<id>/abort -> abortRun -> notifyGoalAbort.
      // v2 only records the abort intent here (the goal stays active and the
      // round stays registered), so the driver must settle the round itself: no
      // agent_end is coming for a round that was never dispatched.
      await agentManager.abortRun(sessionId)
      expect(session.goalTerminationKind).toBe('abort')
      expect(session.goal).toMatchObject({ phase: 'active' })

      window.open()
      await vi.waitFor(() => expect(session.goalRun).toBeNull(), { timeout: 5_000 })
      expect(session.agent.prompts).toHaveLength(0)
      // v2 semantics: a user abort pauses (and disarms) instead of running on.
      expect(session.goal).toMatchObject({ phase: 'paused', activation: 'disarmed' })
      expect(session.goal.runtime).not.toBe('executing')
    } finally {
      window.open()
      session.agent.autoEnd = true
      await agentManager.destroyAgent(sessionId)
    }
  })

  it('refuses the round when the goal is cleared while it is being admitted', async () => {
    const sessionId = 'goal-v2-manager-clear-during-admit'
    const session = await createSession(sessionId)
    const { handleGoalAction } = await import('../../server/goal/engine.mjs')
    const { logger } = await import('../../server/utils/logger.mjs')
    const errorSpy = vi.spyOn(logger, 'error')
    session.agent.autoEnd = false
    // Park the round's own persist: the round is already admitted (roundsStarted
    // bumped, runtime executing) but not yet registered as session.goalRun.
    const gate = await armPersistenceGate((record) => persistedRoundsStarted(record) >= 1)
    try {
      await agentManager.runPrompt(sessionId, '/goal Ship goal v2')
      await gate.enteredPromise
      expect(session.goalRun).toBeNull()
      expect(session.goal.roundsStarted).toBe(1)

      const cancelPromise = handleGoalAction(session, 'cancel')
      await vi.waitFor(() => expect(session.goal).toBeNull())
      gate.release()
      await cancelPromise
      const driverFailures = () => errorSpy.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes('Failed to continue goal'))
      // Let the parked admission finish and the driver reach its decision.
      await vi.waitFor(() => expect(driverFailures()).toEqual([]), { timeout: 5_000 })
      expect(session.agent.prompts).toHaveLength(0)
      expect(session.goalRun).toBeNull()
      expect(session.goal).toBeNull()
    } finally {
      gate.release()
      gate.restore()
      session.agent.autoEnd = true
      await agentManager.destroyAgent(sessionId)
    }
  })
})
