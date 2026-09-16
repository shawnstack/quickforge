import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Keep the route, manager, command/skill resolvers, model catalog and storage real.
// Only the model loop and external integrations are replaced; no provider is called.
class MockAgent {
  static onPrompt = null
  static onTurn = null

  constructor(options = {}) {
    this.state = {
      ...options.initialState,
      messages: [...(options.initialState?.messages || [])],
      pendingToolCalls: new Set(),
      isStreaming: false,
    }
    this.controller = new AbortController()
    this.signal = this.controller.signal
    this.idle = Promise.resolve()
    this.listeners = new Set()
    this.prompts = []
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async emit(event) {
    for (const listener of this.listeners) await listener(event)
  }

  async prompt(input) {
    this.prompts.push(input)
    MockAgent.onPrompt?.(this)
    this.controller = new AbortController()
    this.signal = this.controller.signal
    this.idle = new Promise((resolve) => { this.resolveIdle = resolve })
    this.state.isStreaming = true
    await this.emit({ type: 'agent_start' })
    this.state.messages.push(input)
    await this.emit({ type: 'message_end', message: input })
    await MockAgent.onTurn?.(this)
    const message = { role: 'assistant', content: [{ type: 'text', text: 'mock completion' }], timestamp: Date.now() }
    this.state.messages.push(message)
    await this.emit({ type: 'message_end', message })
    this.state.isStreaming = false
    await this.emit({ type: 'agent_end', messages: this.state.messages })
    this.resolveIdle()
  }

  abort() { this.controller.abort() }
  async waitForIdle() { await this.idle }
}

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: MockAgent,
  estimateContextTokens: vi.fn(() => 0),
  estimateTokens: vi.fn(() => 0),
  shouldCompact: vi.fn(() => false),
}))
vi.mock('../../server/ai-http-logger.mjs', () => ({
  streamSimpleWithAiHttpLogging: vi.fn(() => { throw new Error('Unexpected model request') }),
}))
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
vi.mock('../../server/channels/event-relay.mjs', () => ({
  publishChannelSessionChanged: vi.fn(async () => true),
}))
vi.mock('../../server/utils/logger.mjs', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  logger.child = () => logger
  return { logger }
})

const model = { id: 'scheduled-test-model', provider: 'scheduled-test', api: 'openai-completions', baseUrl: 'http://model.invalid/v1', contextWindow: 32000, maxTokens: 1000 }
let fixtureRoot
let manager
let sessions
let storage
let database
let routes
let nextTaskId = 0
const environment = ['QUICKFORGE_DATA_DIR', 'HOME', 'USERPROFILE']
const previousEnvironment = new Map()

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(process.cwd(), '.tmp-scheduled-commands-'))
  for (const name of environment) previousEnvironment.set(name, process.env[name])
  // storage caches QUICKFORGE_DATA_DIR at import; skills/profiles/instructions use
  // os.homedir(). Set both before importing any server module. SQLite's default
  // path and storage's config/cache/log/workspace initialization stay in this root.
  process.env.QUICKFORGE_DATA_DIR = path.join(fixtureRoot, 'data')
  process.env.HOME = fixtureRoot
  process.env.USERPROFILE = fixtureRoot
  vi.spyOn(os, 'homedir').mockReturnValue(fixtureRoot)
  vi.resetModules()
  storage = await import('../../server/storage.mjs')
  await storage.ensureStorage()
  database = await import('../../server/sqlite/database.mjs')
  await database.initializeSqliteStorage()
  const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
  setDefaultWorkspaceRoot(path.join(fixtureRoot, 'data', 'workspace'))
  await storage.atomicUpdate('custom-providers', () => ({
    'scheduled-test': { id: 'scheduled-test', models: [model] },
  }))
  await storage.atomicUpdate('settings', () => ({ language: 'en', 'yolo-mode': true }))
  await mkdir(storage.userCommandsDir, { recursive: true })
  await writeFile(path.join(storage.userCommandsDir, 'scheduled-report.md'), `---
name: scheduled-report
description: Isolated report command
allow_edit: false
allow_commands: true
---
Report target: $ARGUMENTS
`, 'utf8')
  const skillDir = path.join(storage.dataDir, 'skills', 'scheduled-skill')
  await mkdir(skillDir, { recursive: true })
  await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: scheduled-skill
description: Isolated scheduled skill
---
Summarize the requested report.
`, 'utf8')
  await storage.atomicProjectConfigUpdate((config) => ({ ...config, globalSkills: ['scheduled-skill'] }))
  manager = await import('../../server/agent-manager.mjs')
  sessions = (await import('../../server/agent-session-store.mjs')).agentSessions
  routes = await import('../../server/routes/scheduled-tasks.mjs')
}, 20000)

afterEach(async () => {
  MockAgent.onPrompt = null
  MockAgent.onTurn = null
  for (const session of sessions?.values() || []) {
    await session.activePromptPromise
    await manager.destroyAgent(session.sessionId)
  }
})

afterAll(async () => {
  try {
    routes?.stopScheduledTaskRunner()
    await database?.closeSqliteStorage()
  } finally {
    vi.restoreAllMocks()
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true })
  }
})

async function createTask(instruction, options = {}) {
  const taskId = `command-${++nextTaskId}`
  const now = new Date().toISOString()
  await storage.atomicUpdate('scheduled-tasks', (tasks) => ({ ...tasks, [taskId]: {
    id: taskId, title: 'Command integration', instruction, model,
    scheduleType: 'once', executeAt: now, nextRunAt: now,
    status: 'enabled', createdAt: now, updatedAt: now, runs: [], ...options,
  } }))
  return taskId
}

async function start(instruction, options = {}) {
  const taskId = await createTask(instruction, options)
  const response = {
    writeHead(status) { this.status = status },
    end(body) { this.body = JSON.parse(body) },
  }
  await routes.handleScheduledTasksApi({ method: 'POST' }, response, new URL(`http://localhost/api/scheduled-tasks/${taskId}/run`))
  expect(response.status).toBe(200)
  return taskId
}

async function finish(taskId) {
  let run
  await vi.waitFor(async () => {
    run = (await storage.readStore('scheduled-tasks'))[taskId].runs[0]
    expect(run.status).not.toBe('running')
  }, { timeout: 10000 })
  const session = sessions.get(run.sessionId)
  expect(session).toBeDefined()
  await session.activePromptPromise
  expect(manager.getSessionEventBus(run.sessionId).listenerCount('agent_event')).toBe(0)
  return { run, session }
}

async function execute(instruction) {
  return finish(await start(instruction))
}

function captureCommand() {
  let command
  MockAgent.onPrompt = (agent) => {
    const session = [...sessions.values()].find((value) => value.agent === agent)
    command = {
      name: session.activeCommandName,
      permissions: session.activeCommandPermissions,
      prompt: session.activeCommandPrompt,
    }
  }
  return () => command
}

const PLAN = { action: 'plan', summary: 'Verify report', criteria: [{ description: 'Report verified', required: true }], scope: ['server/'] }

function sessionFor(agent) {
  return [...sessions.values()].find((session) => session.agent === agent)
}

async function report(agent, args) {
  return agent.state.tools.find((tool) => tool.name === 'goal_report').execute(`report-${agent.prompts.length}`, args)
}

async function completeGoal(agent) {
  await agent.emit({ type: 'tool_execution_end', toolCallId: 'verify-report', toolName: 'read_file', isError: false, result: { content: [{ type: 'text', text: 'verified' }] } })
  await report(agent, {
    action: 'complete', summary: 'done',
    evidence: [{ id: 'e1', description: 'verified report', toolCallId: 'verify-report' }],
    criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
  })
}

async function taskState(taskId) {
  return (await storage.readStore('scheduled-tasks'))[taskId]
}

async function goalSession(taskId, status) {
  let session
  await vi.waitFor(async () => {
    const task = await taskState(taskId)
    session = sessions.get(task.lastSessionId)
    expect(session?.goal?.status).toBe(status)
    expect(session.goalRunSettling).toBeFalsy()
    expect(session.activePromptPromise).toBeFalsy()
  }, { timeout: 10000 })
  return session
}

function gate() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

describe('scheduled goals through the real manager and runner', () => {
  it('starts a due enabled /goal on the immediate scheduler tick and waits for completion', async () => {
    const release = gate()
    const seen = []
    MockAgent.onTurn = async (agent) => {
      seen.push(sessionFor(agent).goal.status)
      if (agent.prompts.length === 1) {
        await release.promise
        await report(agent, PLAN)
      } else await completeGoal(agent)
    }
    const id = await createTask('/goal automatically verify the report')
    expect(await taskState(id)).toMatchObject({ status: 'enabled', runs: [] })
    try {
      // No manual /run request or timer advancement: this must use the initial tick.
      routes.startScheduledTaskRunner()
      await vi.waitFor(() => expect(seen).toEqual(['planning']))
      const task = await taskState(id)
      expect(task.runs).toHaveLength(1)
      expect(task.runs[0]).toMatchObject({ trigger: 'schedule', status: 'running' })
      expect(task.currentRunIds).toContain(task.runs[0].id)
      expect(sessions.get(task.lastSessionId).goal.status).toBe('planning')
      release.resolve()
      const { run, session } = await finish(id)
      expect(run).toMatchObject({ trigger: 'schedule', status: 'success' })
      expect(session.goal.status).toBe('completed')
      expect(seen).toEqual(['planning', 'running'])
      expect((await taskState(id)).currentRunIds).toEqual([])
    } finally {
      release.resolve()
      routes.stopScheduledTaskRunner()
    }
  })

  it('waits across planning/execution and the completed persistence barrier, not the first agent_end', async () => {
    const stateService = await import('../../server/session-state-service.mjs')
    const save = stateService.saveSessionStatePair
    const entered = gate()
    const release = gate()
    const barrier = vi.spyOn(stateService, 'saveSessionStatePair').mockImplementation(async (args) => {
      if (args.state?.goal?.status === 'completed') {
        entered.resolve()
        await release.promise
      }
      return save(args)
    })
    const seen = []
    MockAgent.onTurn = async (agent) => {
      const session = sessionFor(agent)
      seen.push(session.goal.status)
      if (agent.prompts.length === 1) await report(agent, PLAN)
      else await completeGoal(agent)
    }
    const id = await start('/goal verify the report')
    try {
      await vi.waitFor(() => expect(seen).toHaveLength(2))
      // Also allow a synchronous persistence implementation: success must only
      // become observable after its promise is released.
      await entered.promise
      expect((await taskState(id)).runs[0].status).toBe('running')
      release.resolve()
      const { run, session } = await finish(id)
      expect(run.status).toBe('success')
      expect(session.goal.status).toBe('completed')
      expect((await storage.readSessionValue(session.sessionId)).goal.status).toBe('completed')
      expect(seen).toEqual(['planning', 'running'])
      expect(session.agent.prompts).toHaveLength(2)
    } finally {
      release.resolve()
      barrier.mockRestore()
    }
  })

  it('does not fail or succeed the scheduled run on a failed first planning round', async () => {
    const entered = gate()
    const release = gate()
    MockAgent.onPrompt = (agent) => {
      if (agent.prompts.length === 1) throw new Error('First planning attempt failed')
    }
    MockAgent.onTurn = async (agent) => {
      if (sessionFor(agent).goalRun.kind === 'planning') {
        entered.resolve()
        await release.promise
        agent.state.errorMessage = undefined
        await report(agent, PLAN)
      } else await completeGoal(agent)
    }
    const id = await start('/goal retry planning')
    try {
      await entered.promise
      expect((await taskState(id)).runs[0].status).toBe('running')
    } finally {
      release.resolve()
    }
    const { run, session } = await finish(id)
    expect(run.status).toBe('success')
    expect(session.agent.prompts).toHaveLength(3)
  })

  it('holds paused serial goals, survives goal object replacement and resumes from the linked session', async () => {
    MockAgent.onTurn = async (agent) => {
      if (agent.prompts.length === 1) await report(agent, PLAN)
    }
    const id = await start('/goal verify the report', { executionMode: 'serial' })
    const session = await goalSession(id, 'paused')
    const task = await taskState(id)
    expect(session.goal.blocker).toBe('no_progress')
    expect(task.runs[0].status).toBe('running')
    expect(task.currentRunIds).toContain(task.runs[0].id)
    await expect(routes.handleScheduledTasksApi({ method: 'POST' }, {}, new URL(`http://localhost/api/scheduled-tasks/${id}/run`))).rejects.toMatchObject({ statusCode: 409 })
    // syncSessionFromStorage normalizes stored goals into new objects.
    session.goal = structuredClone(session.goal)
    const runner = await import('../../server/agent-goal-runner.mjs')
    expect(runner.hasGoalCompletionWaiter(session.sessionId)).toBe(true)
    MockAgent.onTurn = completeGoal
    await runner.handleGoalAction(session, 'resume')
    const { run } = await finish(id)
    expect(run.status).toBe('success')
    expect((await taskState(id)).currentRunIds).toEqual([])
    expect(runner.hasGoalCompletionWaiter(session.sessionId)).toBe(false)
  })

  it('does not release a cancelled serial run before abort and the underlying prompt settle', async () => {
    const entered = gate()
    const release = gate()
    MockAgent.onTurn = async () => { entered.resolve(); await release.promise }
    const id = await start('/goal cancel safely', { executionMode: 'serial' })
    await entered.promise
    const task = await taskState(id)
    const session = sessions.get(task.lastSessionId)
    const runner = await import('../../server/agent-goal-runner.mjs')
    try {
      await runner.handleGoalAction(session, 'cancel')
      expect(session.agent.signal.aborted).toBe(true)
      expect(session.goal.status).toBe('cancelled')
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect((await taskState(id)).runs[0].status).toBe('running')
      expect((await taskState(id)).currentRunIds).toContain(task.runs[0].id)
    } finally {
      release.resolve()
    }
    expect((await finish(id)).run.status).toBe('failed')
  })

  it('keeps a failed completion persist paused and running until the user cancels', async () => {
    const stateService = await import('../../server/session-state-service.mjs')
    const save = stateService.saveSessionStatePair
    const barrier = vi.spyOn(stateService, 'saveSessionStatePair').mockImplementation(async (args) => {
      if (args.state?.goal?.status === 'completed') return null
      return save(args)
    })
    MockAgent.onTurn = async (agent) => {
      if (agent.prompts.length === 1) await report(agent, PLAN)
      else await completeGoal(agent)
    }
    const id = await start('/goal persist before success')
    try {
      const session = await goalSession(id, 'paused')
      expect(session.goal.blocker).toBe('persist_failed')
      expect((await taskState(id)).runs[0].status).toBe('running')
      const runner = await import('../../server/agent-goal-runner.mjs')
      await runner.handleGoalAction(session, 'cancel')
      expect((await finish(id)).run.status).toBe('failed')
    } finally {
      barrier.mockRestore()
    }
  })

  it.each(['awaiting_approval', 'awaiting_input'])('retains the scheduled run while %s', async (status) => {
    const runner = await import('../../server/agent-goal-runner.mjs')
    const entered = gate()
    const release = gate()
    MockAgent.onTurn = async (agent) => {
      const session = sessionFor(agent)
      if (agent.prompts.length === 1) return report(agent, PLAN)
      if (status === 'awaiting_approval') await runner.notifyGoalApprovalRequested(session)
      else await runner.notifyGoalAskRequested(session)
      entered.resolve()
      await release.promise
      if (status === 'awaiting_approval') await runner.notifyGoalApprovalOutcome(session, { outcome: 'approved' })
      else await runner.notifyGoalAskOutcome(session)
      await completeGoal(agent)
    }
    const id = await start('/goal await user decision')
    try {
      await entered.promise
      const task = await taskState(id)
      expect(sessions.get(task.lastSessionId).goal.status).toBe(status)
      expect(task.runs[0].status).toBe('running')
      expect(task.currentRunIds).toContain(task.runs[0].id)
    } finally {
      release.resolve()
    }
    expect((await finish(id)).run.status).toBe('success')
  })

  it.each(['blocked', 'budget'])('retains the run while the goal is %s', async (mode) => {
    MockAgent.onTurn = async (agent) => {
      const session = sessionFor(agent)
      if (agent.prompts.length === 1) {
        await report(agent, PLAN)
        if (mode === 'budget') session.goal = { ...session.goal, budget: { ...session.goal.budget, maxIterations: 1 } }
      } else if (mode === 'blocked') {
        await report(agent, { action: 'blocked', blocker: 'missing_input', summary: 'Need input' })
      }
    }
    const id = await start(`/goal ${mode} report`)
    const session = await goalSession(id, mode === 'budget' ? 'paused' : 'blocked')
    expect((await taskState(id)).runs[0].status).toBe('running')
    const runner = await import('../../server/agent-goal-runner.mjs')
    await runner.handleGoalAction(session, 'cancel')
    expect((await finish(id)).run.status).toBe('failed')
  })

  it('keeps overlapping parallel runs bound to independent goals in their own sessions', async () => {
    MockAgent.onTurn = async (agent) => {
      if (agent.prompts.length === 1) await report(agent, PLAN)
    }
    const id = await start('/goal parallel reports', { executionMode: 'parallel' })
    const first = await goalSession(id, 'paused')
    const response = { writeHead(status) { this.status = status }, end() {} }
    await routes.handleScheduledTasksApi({ method: 'POST' }, response, new URL(`http://localhost/api/scheduled-tasks/${id}/run`))
    expect(response.status).toBe(200)
    const second = await goalSession(id, 'paused')
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(second.goal.id).not.toBe(first.goal.id)
    expect((await taskState(id)).currentRunIds).toHaveLength(2)
    const runner = await import('../../server/agent-goal-runner.mjs')
    await runner.handleGoalAction(first, 'cancel')
    await vi.waitFor(async () => expect((await taskState(id)).currentRunIds).toHaveLength(1))
    expect((await taskState(id)).runs.find((run) => run.sessionId === second.sessionId).status).toBe('running')
    await runner.handleGoalAction(second, 'cancel')
    await vi.waitFor(async () => expect((await taskState(id)).currentRunIds).toHaveLength(0))
    expect((await taskState(id)).runs.every((run) => run.status === 'failed')).toBe(true)
  })

  it.each([null, 1000])('does not apply the scheduler/Profile %s timeout to paused goals', async (maxRuntimeMs) => {
    let agentId
    let profileLookup
    if (maxRuntimeMs) {
      const profiles = await import('../../server/agent-profiles.mjs')
      agentId = 'scheduled-timeout'
      // Profile discovery is not under test: isolate its fixture while keeping
      // scheduler timeout selection and the manager/command/goal runner real.
      profileLookup = vi.spyOn(profiles, 'getAgentProfile').mockResolvedValue({
        id: agentId, name: agentId, label: 'Scheduled timeout', maxRuntimeMs,
        allowedTools: ['read_file', 'grep_files'], capabilityPolicy: 'readonly-research',
      })
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ordinaryEntered = gate()
    MockAgent.onTurn = async (agent) => {
      if (sessionFor(agent).goal) {
        if (agent.prompts.length === 1) await report(agent, PLAN)
      } else {
        ordinaryEntered.resolve()
        await new Promise((resolve) => agent.signal.addEventListener('abort', resolve, { once: true }))
      }
    }
    const goalId = await start('/goal wait indefinitely', { agentId })
    const session = await goalSession(goalId, 'paused')
    const ordinaryId = await start('ordinary long report', { agentId })
    await ordinaryEntered.promise
    const runner = await import('../../server/agent-goal-runner.mjs')
    try {
      await vi.advanceTimersByTimeAsync((maxRuntimeMs || 60 * 60 * 1000) + 5000)
      expect((await finish(ordinaryId)).run).toMatchObject({ status: 'failed', errorMessage: '执行超时' })
      if (maxRuntimeMs) await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(sessions.get(session.sessionId)).toBe(session)
      expect(session.goal.status).toBe('paused')
      expect((await taskState(goalId)).runs[0].status).toBe('running')
      await runner.handleGoalAction(session, 'cancel')
      await vi.advanceTimersByTimeAsync(1000)
      await finish(goalId)
    } finally {
      vi.useRealTimers()
      profileLookup?.mockRestore()
    }
  })

  it('fails Goal creation persistence without registering an indefinite completion waiter', async () => {
    const stateService = await import('../../server/session-state-service.mjs')
    const save = stateService.saveSessionStatePair
    const barrier = vi.spyOn(stateService, 'saveSessionStatePair').mockImplementation(async (args) => {
      if (args.state?.goal?.status === 'planning') return null
      return save(args)
    })
    try {
      const { run, session } = await execute('/goal cannot persist admission')
      expect(run.status).toBe('failed')
      expect(session.agent.prompts).toHaveLength(0)
      expect(session.goal).toBeNull()
      const runner = await import('../../server/agent-goal-runner.mjs')
      expect(runner.hasGoalCompletionWaiter(session.sessionId)).toBe(false)
    } finally {
      barrier.mockRestore()
    }
  })

  it('fails an invalid /goal short circuit without hanging or reporting success', async () => {
    const { run, session } = await execute('/goal')
    expect(run.status).toBe('failed')
    expect(run.errorMessage).toContain('Goal')
    expect(session.goal).toBeNull()
    expect(session.agent.prompts).toHaveLength(0)
  })
})

describe('scheduled tasks through the real prompt command pipeline', () => {
  it('persists ordinary text exactly once through the unified prompt flow', async () => {
    const { session, run } = await execute('Generate the daily report')
    expect(run).toMatchObject({ status: 'success', aiResult: 'mock completion' })
    expect(session.agent.prompts).toHaveLength(1)
    expect(session.agent.state.messages.filter((message) => message.role === 'user')).toEqual([
      expect.objectContaining({ content: [{ type: 'text', text: 'Generate the daily report' }] }),
    ])
    await vi.waitFor(async () => {
      const persisted = await storage.readSessionValue(session.sessionId)
      expect(persisted?.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    })
  })

  it('applies /plan read-only permissions even with full-access settings', async () => {
    const command = captureCommand()
    const { run, session } = await execute('/plan inspect the release')
    expect(run.status).toBe('success')
    expect(command()).toMatchObject({ name: 'plan', permissions: { allowEdit: false, allowCommands: false, allowSubagents: true } })
    expect(command().prompt).toContain('inspect the release')
    expect(session.agent.prompts[0].details.quickforgeCommand).toEqual({ type: 'plan' })
  })

  it('loads a custom command file and interpolates invocation arguments', async () => {
    const command = captureCommand()
    const { run } = await execute('/scheduled-report sales north region')
    expect(run.status).toBe('success')
    expect(command()).toMatchObject({ name: 'scheduled-report', permissions: { allowEdit: false, allowCommands: true } })
    expect(command().prompt).toContain('Report target: sales north region')
    expect(command().prompt).not.toContain('$ARGUMENTS')
  })

  it('resolves an enabled fixture skill and forwards its task', async () => {
    const command = captureCommand()
    const { run } = await execute('/skill scheduled-skill summarize daily sales')
    expect(run.status).toBe('success')
    expect(command()).toMatchObject({ name: 'skill', permissions: null })
    expect(command().prompt).toContain('<skill_invocation name="scheduled-skill" source="slash">')
    expect(command().prompt).toContain('activate_skill tool with name="scheduled-skill"')
    expect(command().prompt).toContain('Task:\nsummarize daily sales')
  })

  it('finishes /clear with an empty transcript and the existing session-result fallback', async () => {
    const { run, session } = await execute('/clear')
    expect(session.agent.prompts).toHaveLength(0)
    expect(session.agent.state.messages).toEqual([])
    expect(session.status).toBe('idle')
    expect(run).toMatchObject({
      status: 'success',
      aiResult: '',
      result: `已完成，结果保存在会话 ${session.sessionId}`,
    })
    expect(run.errorMessage).toBeUndefined()
    expect(run.finishedAt).toBeTruthy()
  })

  it.each([
    ['/summary', 'Not enough earlier history to summarize. Continue chatting and run /summary again later.'],
    ['/compact', 'Not enough earlier history to compact. Continue chatting and run /compact again later.'],
  ])('finishes %s on a fresh empty session without entering the model loop', async (instruction, text) => {
    const { run, session } = await execute(instruction)
    expect(session.agent.prompts).toHaveLength(0)
    expect(session.agent.state.messages).toEqual([
      expect.objectContaining({ role: 'user', content: [{ type: 'text', text: instruction }] }),
      expect.objectContaining({ role: 'assistant', content: [{ type: 'text', text }] }),
    ])
    expect(session.status).toBe('idle')
    expect(session.agent.state.isStreaming).toBe(false)
    expect(run).toMatchObject({ status: 'success', aiResult: text })
    expect(run.errorMessage).toBeUndefined()
    expect(run.finishedAt).toBeTruthy()
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    expect(streamSimpleWithAiHttpLogging).not.toHaveBeenCalled()
  })

  it('emits error and terminal events and records failed when Agent.prompt rejects', async () => {
    const errorMessage = 'Mock Agent.prompt rejected'
    const events = []
    const listener = (event) => events.push(event)
    MockAgent.onPrompt = () => { throw new Error(errorMessage) }
    manager.agentEvents.on('agent_event', listener)
    try {
      const { run, session } = await execute('/plan inspect the release')
      expect(session.agent.prompts).toHaveLength(1)
      expect(run).toMatchObject({ status: 'failed', errorMessage })
      expect(run.finishedAt).toBeTruthy()
      expect(run.aiResult).toBeUndefined()
      expect(session.status).toBe('error')
      expect(session.agent.state).toMatchObject({ isStreaming: false, errorMessage })
      expect(session.agent.state.messages).toContainEqual(expect.objectContaining({
        role: 'assistant',
        errorMessage,
        stopReason: 'error',
      }))
      const failureEvents = events.filter((event) => event.sessionId === session.sessionId && ['error', 'agent_end'].includes(event.type))
      expect(failureEvents).toEqual([
        expect.objectContaining({ type: 'error', error: errorMessage }),
        expect.objectContaining({ type: 'agent_end', errorMessage, status: 'error' }),
      ])
    } finally {
      manager.agentEvents.removeListener('agent_event', listener)
    }
  })

  it.each([
    ['/help', 'QuickForge command reference'],
  ])('does not lose the short-circuit completion of %s', async (instruction, text) => {
    const { run, session } = await execute(instruction)
    expect(session.agent.prompts).toHaveLength(0)
    expect(session.agent.state.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(run.aiResult).toContain(text)
    expect(run.errorMessage).not.toBe('执行超时')
    expect(session.goal ?? null).toBeNull()
  })
})
