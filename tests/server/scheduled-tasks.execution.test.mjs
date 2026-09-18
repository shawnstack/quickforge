import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  sessions: new Map(),
  eventBuses: new Map(),
  stores: new Map(),
  nextAgentMode: 'timeout',
  abortRun: vi.fn(),
  agentEvents: null,
  shadowSyncRun: vi.fn(async () => null),
  shadowDeleteTaskRuns: vi.fn(async () => false),
  shadowListRuns: vi.fn(async () => ({ runs: [], total: 0, page: 1, pageSize: 10 })),
  recentRuns: vi.fn(async () => []),
  deleteRun: vi.fn(async () => true),
  runtimeHooks: null,
  authoritative: false,
}))

vi.mock('../../server/scheduled-task-runs-service.mjs', () => ({
  createScheduledTaskRunsService: vi.fn(() => ({
    syncRun: mocks.shadowSyncRun,
    deleteTaskRuns: mocks.shadowDeleteTaskRuns,
    deleteRun: mocks.deleteRun,
    listRuns: mocks.shadowListRuns,
    recentRuns: mocks.recentRuns,
    getDiagnostics: vi.fn(() => ({})),
  })),
}))

vi.mock('../../server/scheduled-runs-cutover.mjs', () => ({
  assertScheduledRunsAvailable: vi.fn(),
  canStartScheduledRun: vi.fn(() => true),
  configureScheduledRunsRuntimeHooks: vi.fn((hooks) => { mocks.runtimeHooks = hooks }),
  isScheduledRunsAuthoritative: vi.fn(() => mocks.authoritative),
  isScheduledRunsMaintenanceActive: vi.fn(() => false),
  recordScheduledRunsDiagnostic: vi.fn(),
}))

vi.mock('../../server/storage.mjs', () => ({
  storageDir: path.join(process.env.QUICKFORGE_DATA_DIR, 'storage'),
  ensureStorage: vi.fn(async () => {}),
  readStore: vi.fn(async (name) => structuredClone(mocks.stores.get(name) || {})),
  atomicUpdate: vi.fn(async (name, updater) => {
    const current = structuredClone(mocks.stores.get(name) || {})
    const next = await updater(current)
    mocks.stores.set(name, structuredClone(next))
    return structuredClone(next)
  }),
}))

// Goal admission/settlement is exercised with the real manager in commands.test;
// these scheduler-only tests intentionally isolate all prompt dependencies.
vi.mock('../../server/custom-commands.mjs', () => ({ parseInternalCommandInvocation: vi.fn(() => null) }))
vi.mock('../../server/agent-goal-runner.mjs', () => ({ sessionGoal: vi.fn(() => null), waitForGoalCompletion: vi.fn() }))

vi.mock('../../server/agent-manager.mjs', async () => {
  const { EventEmitter } = await import('node:events')
  mocks.agentEvents = new EventEmitter()

  function eventBusFor(sessionId) {
    let eventBus = mocks.eventBuses.get(sessionId)
    if (!eventBus) {
      eventBus = new EventEmitter()
      mocks.eventBuses.set(sessionId, eventBus)
    }
    return eventBus
  }

  return {
    agentEvents: mocks.agentEvents,
    getSessionEventBus: vi.fn((sessionId) => eventBusFor(sessionId)),
    runPrompt: vi.fn((sessionId, message) => {
      const session = mocks.sessions.get(sessionId)
      // Only model dispatch is mocked here; real command parsing has its own suite.
      expect(session.agent.state.messages).toEqual([])
      session.agent.state.messages.push(message)
      if (mocks.nextAgentMode === 'dispatched') return { sessionId, status: 'running' }
      return session.agent.continue()
    }),
    createAgent: vi.fn(async (sessionId, options) => {
      let settleContinue
      const continuePromise = new Promise((resolve, reject) => {
        settleContinue = { resolve, reject }
      })
      const agent = {
        state: { messages: [], errorMessage: undefined },
        continue: vi.fn(async () => {
          if (mocks.nextAgentMode === 'success') {
            const assistantMessage = {
              role: 'assistant',
              content: [{ type: 'text', text: '正常完成结果' }],
            }
            agent.state.messages = [...agent.state.messages, assistantMessage]
            eventBusFor(sessionId).emit('agent_event', {
              type: 'agent_end',
              status: 'idle',
              messages: agent.state.messages,
            })
            return
          }
          return continuePromise
        }),
        abort: vi.fn(() => settleContinue.reject(new Error('Scheduled task aborted'))),
        waitForIdle: vi.fn(async () => {}),
        resolveContinue: () => settleContinue.resolve(),
      }
      const session = {
        sessionId,
        agent,
        status: 'idle',
        scope: options.scope,
        projectId: options.projectId,
        createdAt: new Date().toISOString(),
      }
      mocks.sessions.set(sessionId, session)
      return session
    }),
    abortRun: mocks.abortRun,
  }
})

vi.mock('../../server/agent-profiles.mjs', () => ({
  getAgentProfile: vi.fn(async () => ({
    id: 'timeout-agent',
    label: 'Timeout Agent',
    maxRuntimeMs: 1000,
  })),
  agentProfileSnapshot: vi.fn((profile) => ({ id: profile.id, label: profile.label })),
}))

vi.mock('../../server/model-catalog.mjs', () => ({
  resolveModelBinding: vi.fn(async () => ({ model: { id: 'test', provider: 'test' }, modelRef: { id: 'test', provider: 'test' } })),
}))

vi.mock('../../server/project-config.mjs', () => ({
  readProjectConfig: vi.fn(async () => ({ projects: [] })),
  projectContextFromId: vi.fn(),
}))

let tempDir
let fixtureRoot
let previousDataDir
let previousHome
let previousUserProfile

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(process.cwd(), '.tmp-scheduled-execution-'))
  previousHome = process.env.HOME
  previousUserProfile = process.env.USERPROFILE
  process.env.HOME = fixtureRoot
  process.env.USERPROFILE = fixtureRoot
  vi.spyOn(os, 'homedir').mockReturnValue(fixtureRoot)
})

afterAll(async () => {
  vi.restoreAllMocks()
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = previousUserProfile
  await fs.rm(fixtureRoot, { recursive: true, force: true })
})

function mockResponse() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    },
  }
}

async function waitFor(predicate, message = 'condition') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await predicate()
    if (value) return value
    await vi.advanceTimersByTimeAsync(0)
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for ${message}`)
}

async function createRecurringTask(storage, taskId = 'task-lifecycle', executionMode = 'serial') {
  const now = new Date().toISOString()
  const task = {
    id: taskId,
    title: '生命周期任务',
    instruction: '执行生命周期测试',
    scheduleType: 'daily',
    executeTime: '09:00',
    scheduleRule: '每天 09:00',
    executionMode,
    agentId: 'timeout-agent',
    status: 'enabled',
    createdAt: now,
    updatedAt: now,
    nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    runs: [],
  }
  await storage.atomicUpdate('scheduled-tasks', (data) => {
    data[taskId] = task
    return data
  })
  return task
}

async function runTask(routes, taskId) {
  const response = mockResponse()
  await routes.handleScheduledTasksApi(
    { method: 'POST' },
    response,
    new URL(`http://localhost/api/scheduled-tasks/${taskId}/run`),
  )
  return response
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(fixtureRoot, 'case-'))
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tempDir
  mocks.sessions.clear()
  mocks.eventBuses.clear()
  mocks.stores.clear()
  mocks.nextAgentMode = 'timeout'
  mocks.authoritative = false
  mocks.runtimeHooks = null
  mocks.recentRuns.mockReset()
  mocks.recentRuns.mockImplementation(async () => [])
  mocks.deleteRun.mockReset()
  mocks.deleteRun.mockImplementation(async () => true)
  mocks.abortRun.mockReset()
  mocks.shadowSyncRun.mockReset()
  mocks.shadowSyncRun.mockImplementation(async () => null)
  mocks.shadowDeleteTaskRuns.mockReset()
  mocks.shadowDeleteTaskRuns.mockImplementation(async () => false)
  mocks.shadowListRuns.mockReset()
  mocks.shadowListRuns.mockImplementation(async () => ({ runs: [], total: 0, page: 1, pageSize: 10 }))
  mocks.abortRun.mockImplementation(async (sessionId) => {
    const session = mocks.sessions.get(sessionId)
    session.agent.abort()
    await session.agent.waitForIdle()
    session.status = 'aborted'
    mocks.eventBuses.get(sessionId)?.emit('agent_event', {
      type: 'agent_end',
      status: 'aborted',
      messages: session.agent.state.messages,
    })
    return { sessionId, aborted: true }
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  vi.resetModules()
})

afterEach(async () => {
  vi.useRealTimers()
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  vi.resetModules()
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('scheduled task manual schedule API', () => {
  async function edit(task, patch) {
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.atomicUpdate('scheduled-tasks', (data) => ({ ...data, [task.id]: task }))
    const req = Readable.from([Buffer.from(JSON.stringify({ task: patch }))])
    req.method = 'PUT'
    const response = mockResponse()
    await routes.handleScheduledTasksApi(req, response, new URL(`http://localhost/api/scheduled-tasks/${task.id}`))
    return response.body.task
  }
  const baseTask = () => ({ id: 'manual', title: 'task', instruction: 'do work', scheduleType: 'daily', executeTime: '09:00', status: 'paused', runs: [] })

  it.each(['once', 'interval', 'daily', 'weekly', 'monthly', 'cron'])('creates %s directly through POST', async (scheduleType) => {
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    const task = { ...baseTask(), scheduleType, executeAt: new Date(Date.now() + 3600000).toISOString(), intervalValue: 30, intervalUnit: 'minute', weekDays: [1, 3], monthDay: 31, cronExpression: '0 9 * * 1,3' }
    const req = Readable.from([Buffer.from(JSON.stringify({ task }))])
    req.method = 'POST'
    const response = mockResponse()
    await routes.handleScheduledTasksApi(req, response, new URL('http://localhost/api/scheduled-tasks'))
    expect(response.status).toBe(200)
    expect(response.body.task.scheduleType).toBe(scheduleType)
    expect(new Date(response.body.task.nextRunAt).getTime()).toBeGreaterThan(Date.now())
    if (scheduleType !== 'cron') expect(response.body.task.cronExpression).toBeUndefined()
    if (scheduleType !== 'interval') expect(response.body.task.intervalValue).toBeUndefined()
  })

  it.each([
    { scheduleType: 'interval', intervalValue: 150000000000, intervalUnit: 'minute' },
    { scheduleType: 'cron', cronExpression: '0 9 * * 0-7' },
    { scheduleType: 'cron', cronExpression: '0 9 * * 1,7' },
  ])('rejects invalid new schedules before persistence: %j', async (schedule) => {
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    const task = { ...baseTask(), ...schedule, executeAt: new Date(Date.now() + 3600000).toISOString() }
    const req = Readable.from([Buffer.from(JSON.stringify({ task }))])
    req.method = 'POST'
    await expect(routes.handleScheduledTasksApi(req, mockResponse(), new URL('http://localhost/api/scheduled-tasks'))).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.stores.get('scheduled-tasks')).toBeUndefined()
  })

  it('keeps unchanged historical cron editable but validates a replacement strictly', async () => {
    const legacy = { ...baseTask(), scheduleType: 'cron', cronExpression: '0 9 * * 0-7' }
    const renamed = await edit(legacy, { title: 'renamed', cronExpression: legacy.cronExpression })
    expect(renamed.cronExpression).toBe(legacy.cronExpression)
    expect(new Date(renamed.nextRunAt).getTime()).toBeGreaterThan(Date.now())
    await expect(edit(renamed, { cronExpression: '0 10 * * 0-7' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('saves structured intervals, preserves past anchors on edit, and clears stale cron/calendar fields', async () => {
    const executeAt = new Date(Date.now() + 3600000).toISOString()
    const task = await edit({ ...baseTask(), cronExpression: '0 9 * * *', weekDays: [1] }, { scheduleType: 'interval', intervalValue: 2, intervalUnit: 'hour', executeAt, enabled: false })
    expect(task).toMatchObject({ scheduleType: 'interval', intervalValue: 2, intervalUnit: 'hour', executeAt, nextRunAt: executeAt, status: 'paused' })
    expect(task.cronExpression).toBeUndefined()
    expect(task.weekDays).toBeUndefined()
    expect(task.executeTime).toBeUndefined()
    const oldAnchor = new Date(Date.now() - 5 * 3600000).toISOString()
    const updated = await edit({ ...task, executeAt: oldAnchor }, { title: 'renamed' })
    expect(updated.executeAt).toBe(oldAnchor)
    expect(new Date(updated.nextRunAt).getTime()).toBe(new Date(oldAnchor).getTime() + 6 * 3600000)
    const daily = await edit(updated, { scheduleType: 'daily', executeTime: '10:00' })
    expect(daily.intervalValue).toBeUndefined()
    expect(daily.intervalUnit).toBeUndefined()
    expect(daily.executeAt).toBeUndefined()
  })

  it('supports weekly multi-select and old weekDay updates, cleaning fields on type switch', async () => {
    const task = await edit(baseTask(), { scheduleType: 'weekly', weekDays: [5, 1, 5], weekDay: 0 })
    expect(task.weekDays).toEqual([1, 5])
    expect(task.weekDay).toBe(1)
    expect(task.scheduleRule).toContain('周一、周五')
    const legacy = await edit(task, { weekDay: 0 })
    expect(legacy.weekDays).toEqual([0])
    const monthly = await edit(legacy, { scheduleType: 'monthly', monthDay: 31 })
    expect(monthly.weekDays).toBeUndefined()
    expect(monthly.weekDay).toBeUndefined()
    expect(monthly.monthDay).toBe(31)
  })

  it('preserves once semantics and accepts editable cron lists', async () => {
    const executeAt = new Date(Date.now() + 3600000).toISOString()
    const once = await edit(baseTask(), { scheduleType: 'once', executeAt })
    expect(once.nextRunAt).toBe(executeAt)
    const cron = await edit(once, { scheduleType: 'cron', cronExpression: '0 9 * * 1,3', scheduleRule: '0 9 * * 1,3' })
    expect(cron.executeAt).toBeUndefined()
    expect(cron.cronExpression).toBe('0 9 * * 1,3')
  })

  it.each([
    { scheduleType: 'interval', intervalValue: 0, intervalUnit: 'minute' },
    { scheduleType: 'interval', intervalValue: 2, intervalUnit: 'second' },
    { scheduleType: 'interval', intervalValue: 2, intervalUnit: 'hour', executeAt: '2020-01-01' },
    { scheduleType: 'interval', intervalValue: 150000000000, intervalUnit: 'minute', executeAt: '+200000-01-01T00:00:00.000Z' },
    { scheduleType: 'cron', cronExpression: '0 9 * * 0-7' },
    { scheduleType: 'weekly', weekDays: [] },
    { scheduleType: 'weekly', weekDays: [7] },
    { scheduleType: 'cron', cronExpression: '0 99 * * *' },
    { scheduleType: 'once', executeAt: 'invalid' },
  ])('rejects invalid schedule %j with HTTP 400', async (patch) => {
    await expect(edit(baseTask(), patch)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('scheduled task scheduler ticks', () => {
  let routes
  const minuteMs = 60000
  const anchor = new Date('2026-01-01T00:00:00.000Z').getTime()
  const taskId = 'tick-cadence'
  const currentTask = () => mocks.stores.get('scheduled-tasks')[taskId]

  beforeEach(async () => {
    // These tests advance wall time as well as timers, unlike the manual-run suite.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(anchor)
    routes = await import('../../server/routes/scheduled-tasks.mjs')
    mocks.stores.set('scheduled-tasks', { [taskId]: {
      id: taskId, title: 'cadence', instruction: 'run', scheduleType: 'interval',
      intervalValue: 1, intervalUnit: 'minute', executeAt: new Date(anchor).toISOString(),
      nextRunAt: new Date(anchor).toISOString(), scheduleRule: '每隔 1 分钟',
      executionMode: 'serial', status: 'enabled', runs: [],
    } })
  })

  afterEach(() => routes.stopScheduledTaskRunner())

  async function waitForRun(count) {
    return waitFor(() => {
      const task = currentTask()
      const sessionId = task.runs[0]?.sessionId
      return task.runs.length === count && mocks.eventBuses.get(sessionId)?.listenerCount('agent_event') === 1 ? task.runs[0] : null
    }, `scheduled run ${count}`)
  }

  async function finish(run) {
    const session = mocks.sessions.get(run.sessionId)
    const messages = [{ role: 'assistant', content: [{ type: 'text', text: 'finished' }] }]
    session.agent.state.messages = messages
    mocks.eventBuses.get(run.sessionId).emit('agent_event', { type: 'agent_end', status: 'idle', messages })
    session.agent.resolveContinue()
    await waitFor(() => currentTask().runs.find((value) => value.id === run.id)?.status === 'success', 'scheduled completion')
  }

  async function action(name) {
    const response = mockResponse()
    await routes.handleScheduledTasksApi({ method: 'POST' }, response, new URL(`http://localhost/api/scheduled-tasks/${taskId}/${name}`))
    expect(response.status).toBe(200)
    return response.body.task
  }

  it('advances parallel schedule slots at start and preserves cadence across overlapping completions', async () => {
    currentTask().executionMode = 'parallel'
    routes.startScheduledTaskRunner()
    const first = await waitForRun(1)
    expect(first).toMatchObject({ trigger: 'schedule', scheduledAt: new Date(anchor).toISOString(), status: 'running' })
    expect(currentTask().nextRunAt).toBe(new Date(anchor + minuteMs).toISOString())

    await vi.advanceTimersByTimeAsync(30000)
    expect(currentTask().runs).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(30000)
    const second = await waitForRun(2)
    expect(second).toMatchObject({ trigger: 'schedule', scheduledAt: new Date(anchor + minuteMs).toISOString() })
    expect(currentTask().currentRunIds).toHaveLength(2)
    const nextRunAt = new Date(anchor + 2 * minuteMs).toISOString()
    expect(currentTask().nextRunAt).toBe(nextRunAt)
    await finish(first)
    expect(currentTask().currentRunIds).toEqual([second.id])
    expect(currentTask().nextRunAt).toBe(nextRunAt)
    await finish(second)
    expect(currentTask().currentRunIds).toEqual([])
    expect(currentTask().nextRunAt).toBe(nextRunAt)
    expect(currentTask().runs).toHaveLength(2)
  })

  it('skips elapsed slots after a long serial run instead of replaying or drifting', async () => {
    routes.startScheduledTaskRunner()
    const first = await waitForRun(1)
    await vi.advanceTimersByTimeAsync(150000)
    expect(currentTask().runs).toHaveLength(1)
    expect(currentTask().nextRunAt).toBe(new Date(anchor).toISOString())
    await finish(first)
    expect(currentTask().nextRunAt).toBe(new Date(anchor + 3 * minuteMs).toISOString())
    await vi.advanceTimersByTimeAsync(29999)
    expect(currentTask().runs).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    const second = await waitForRun(2)
    expect(second).toMatchObject({ trigger: 'schedule', scheduledAt: new Date(anchor + 3 * minuteMs).toISOString() })
    await finish(second)
    expect(currentTask().nextRunAt).toBe(new Date(anchor + 4 * minuteMs).toISOString())
  })

  it.each(['serial', 'parallel'])('does not replay missed %s interval slots on pause/resume', async (executionMode) => {
    currentTask().executionMode = executionMode
    currentTask().nextRunAt = new Date(anchor + minuteMs).toISOString()
    await action('pause')
    routes.startScheduledTaskRunner()
    await vi.advanceTimersByTimeAsync(150000)
    expect(currentTask().runs).toHaveLength(0)
    const resumed = await action('resume')
    expect(resumed.nextRunAt).toBe(new Date(anchor + 3 * minuteMs).toISOString())
    await vi.advanceTimersByTimeAsync(29999)
    expect(currentTask().runs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    const run = await waitForRun(1)
    expect(run).toMatchObject({ trigger: 'schedule', scheduledAt: resumed.nextRunAt })
    await finish(run)
    expect(currentTask().nextRunAt).toBe(new Date(anchor + 4 * minuteMs).toISOString())
  })

  it('continues scheduling historical clipped cron ranges after execution and resume', async () => {
    const due = new Date(2026, 0, 5, 9)
    vi.setSystemTime(due)
    Object.assign(currentTask(), { scheduleType: 'cron', cronExpression: '0 9 * * 0-7', nextRunAt: due.toISOString() })
    routes.startScheduledTaskRunner()
    const run = await waitForRun(1)
    await finish(run)
    expect(currentTask()).toMatchObject({ status: 'enabled', nextRunAt: new Date(2026, 0, 6, 9).toISOString() })
    await action('pause')
    vi.setSystemTime(new Date(2026, 0, 8, 10))
    const resumed = await action('resume')
    expect(resumed.nextRunAt).toBe(new Date(2026, 0, 9, 9).toISOString())
    await vi.advanceTimersByTimeAsync(30000)
    expect(currentTask().runs).toHaveLength(1)
  })
})

describe('scheduled task execution lifecycle', () => {
  it('dispatches once through runPrompt and captures synchronous agent_end', async () => {
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    const manager = await import('../../server/agent-manager.mjs')
    manager.runPrompt.mockClear()
    await createRecurringTask(storage)
    mocks.nextAgentMode = 'success'

    const response = await runTask(routes, 'task-lifecycle')
    const sessionId = response.body.task.lastSessionId
    const task = await waitFor(async () => {
      const current = (await storage.readStore('scheduled-tasks'))['task-lifecycle']
      return current.runs[0]?.status === 'success' ? current : null
    }, 'synchronous completion')

    expect(manager.runPrompt).toHaveBeenCalledExactlyOnceWith(sessionId, {
      role: 'user',
      content: [{ type: 'text', text: '执行生命周期测试' }],
      timestamp: expect.any(Number),
    }, [], null, null, { source: 'scheduled' })
    expect(mocks.sessions.get(sessionId).agent.state.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(task.runs[0].aiResult).toBe('正常完成结果')
    expect(mocks.eventBuses.get(sessionId).listenerCount('agent_event')).toBe(0)
  })

  it('waits for agent_end after runPrompt returns from dispatch', async () => {
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await createRecurringTask(storage)
    mocks.nextAgentMode = 'dispatched'

    const response = await runTask(routes, 'task-lifecycle')
    const sessionId = response.body.task.lastSessionId
    const eventBus = mocks.eventBuses.get(sessionId)
    await waitFor(() => eventBus?.listenerCount('agent_event') === 1)
    await vi.advanceTimersByTimeAsync(0)
    expect((await storage.readStore('scheduled-tasks'))['task-lifecycle'].runs[0].status).toBe('running')

    const messages = [{ role: 'assistant', content: [{ type: 'text', text: 'delayed completion' }] }]
    eventBus.emit('agent_event', { type: 'agent_end', messages })
    await waitFor(async () => (await storage.readStore('scheduled-tasks'))['task-lifecycle'].runs[0].status === 'success')
    expect((await storage.readStore('scheduled-tasks'))['task-lifecycle'].runs[0].aiResult).toBe('delayed completion')
    expect(eventBus.listenerCount('agent_event')).toBe(0)
  })

  it.each(['serial', 'parallel'])('keeps interval cadence after a %s run finishes', async (executionMode) => {
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    const anchor = Date.now() - 5 * 60000
    await storage.atomicUpdate('scheduled-tasks', (data) => ({ ...data, cadence: {
      id: 'cadence', title: 'cadence', instruction: 'run', scheduleType: 'interval',
      intervalValue: 2, intervalUnit: 'minute', executeAt: new Date(anchor).toISOString(),
      nextRunAt: new Date(anchor + 4 * 60000).toISOString(), scheduleRule: '每隔 2 分钟',
      executionMode, status: 'enabled', runs: [],
    } }))
    mocks.nextAgentMode = 'success'
    expect((await runTask(routes, 'cadence')).status).toBe(200)
    const task = await waitFor(async () => {
      const current = (await storage.readStore('scheduled-tasks')).cadence
      return current.runs[0]?.status === 'success' ? current : null
    })
    expect(new Date(task.nextRunAt).getTime()).toBe(anchor + 6 * 60000)
    expect(task.status).toBe('enabled')
  })

  it('aborts timed out runs and clears listeners and active run state', async () => {
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage)

    const response = await runTask(routes, 'task-lifecycle')
    expect(response.status).toBe(200)

    const sessionId = response.body.task.lastSessionId
    const eventBus = mocks.eventBuses.get(sessionId)
    await waitFor(() => eventBus?.listenerCount('agent_event') === 1, 'scheduled task listener')

    await vi.advanceTimersByTimeAsync(1000)

    await waitFor(async () => {
      const task = (await storage.readStore('scheduled-tasks'))['task-lifecycle']
      return task?.runs?.[0]?.status === 'failed' ? task : null
    }, 'timed out task persistence')

    const task = (await storage.readStore('scheduled-tasks'))['task-lifecycle']
    expect(mocks.abortRun).toHaveBeenCalledOnce()
    expect(mocks.abortRun).toHaveBeenCalledWith(sessionId)
    expect(eventBus.listenerCount('agent_event')).toBe(0)
    expect(task.currentRunId).toBeNull()
    expect(task.currentRunIds).toEqual([])
    expect(task.runs[0]).toMatchObject({
      status: 'failed',
      errorMessage: '执行超时',
    })
    expect(task.status).toBe('paused')

    mocks.nextAgentMode = 'success'
    await expect(runTask(routes, 'task-lifecycle')).resolves.toMatchObject({ status: 200 })
    await waitFor(async () => {
      const current = (await storage.readStore('scheduled-tasks'))['task-lifecycle']
      return current?.runs?.[0]?.status === 'success'
    }, 'second task run completion')
  })

  it('preserves a concurrently started parallel run when the first run finishes', async () => {
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage, 'task-parallel', 'parallel')

    const firstResponse = await runTask(routes, 'task-parallel')
    const firstSessionId = firstResponse.body.task.lastSessionId
    await waitFor(() => mocks.eventBuses.get(firstSessionId)?.listenerCount('agent_event') === 1, 'first parallel listener')
    vi.setSystemTime(new Date(Date.now() + 1))
    // Date.now() is NOT faked by this suite (toFake covers timers only), and
    // sessionId embeds a millisecond timestamp. Without crossing into the next
    // real millisecond the two parallel runs can collide on one sessionId and
    // share a single event bus (listenerCount 2 instead of 1).
    const firstRunMs = Date.now()
    await new Promise((resolve) => {
      const tick = () => (Date.now() > firstRunMs ? resolve() : setImmediate(tick))
      tick()
    })
    const secondResponse = await runTask(routes, 'task-parallel')
    const secondSessionId = secondResponse.body.task.lastSessionId
    await waitFor(() => mocks.eventBuses.get(secondSessionId)?.listenerCount('agent_event') === 1, 'second parallel listener')

    const finish = (sessionId) => {
      const session = mocks.sessions.get(sessionId)
      const messages = [{ role: 'assistant', content: [{ type: 'text', text: `${sessionId} 完成` }] }]
      session.agent.state.messages = messages
      mocks.eventBuses.get(sessionId).emit('agent_event', { type: 'agent_end', status: 'idle', messages })
      // The runtime's continue() promise only settles when the agent run ends;
      // mirror that here so executeTask's runPromise can finish without the
      // 1000ms timeout path.
      session.agent.resolveContinue()
    }
    finish(firstSessionId)
    await new Promise((resolve) => setImmediate(resolve))
    await waitFor(async () => (await storage.readStore('scheduled-tasks'))['task-parallel']?.currentRunIds?.length === 1, 'first parallel completion')

    const duringSecond = (await storage.readStore('scheduled-tasks'))['task-parallel']
    expect(duringSecond.currentRunIds).toContain(secondResponse.body.task.currentRunId)
    finish(secondSessionId)
    const completed = await waitFor(async () => {
      const current = (await storage.readStore('scheduled-tasks'))['task-parallel']
      return current?.runs?.filter((run) => run.status === 'success').length === 2 ? current : null
    }, 'second parallel completion')
    expect(completed.currentRunIds).toEqual([])
    expect(completed.status).toBe('enabled')
  })

  it('finishes cleanup even when abortRun never settles', async () => {
    mocks.abortRun.mockImplementationOnce(() => new Promise(() => {}))
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage, 'task-stuck-abort')

    const response = await runTask(routes, 'task-stuck-abort')
    const sessionId = response.body.task.lastSessionId
    await waitFor(() => mocks.eventBuses.get(sessionId)?.listenerCount('agent_event') === 1, 'scheduled task listener')

    await vi.advanceTimersByTimeAsync(3000)

    const task = await waitFor(async () => {
      const current = (await storage.readStore('scheduled-tasks'))['task-stuck-abort']
      return current?.runs?.[0]?.status === 'failed' ? current : null
    }, 'stuck abort task persistence')
    expect(task.currentRunIds).toEqual([])
    expect(mocks.eventBuses.get(sessionId).listenerCount('agent_event')).toBe(0)
  })

  it('preserves the normal successful result and does not abort', async () => {
    mocks.nextAgentMode = 'success'
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage, 'task-success')

    const response = await runTask(routes, 'task-success')
    expect(response.status).toBe(200)

    const task = await waitFor(async () => {
      const current = (await storage.readStore('scheduled-tasks'))['task-success']
      return current?.runs?.[0]?.status === 'success' ? current : null
    }, 'successful task persistence')

    expect(mocks.abortRun).not.toHaveBeenCalled()
    expect(task.status).toBe('enabled')
    expect(task.currentRunId).toBeNull()
    expect(task.currentRunIds).toEqual([])
    expect(task.runs[0]).toMatchObject({
      status: 'success',
      aiResult: '正常完成结果',
      result: '正常完成结果',
    })
    expect(mocks.shadowSyncRun.mock.calls.map(([taskId, authoritativeRun, options]) => ({
      taskId,
      status: authoritativeRun.status,
      phase: options.phase,
    }))).toEqual([
      { taskId: 'task-success', status: 'running', phase: 'created' },
      { taskId: 'task-success', status: 'running', phase: 'resolved' },
      { taskId: 'task-success', status: 'success', phase: 'terminal' },
    ])
    expect(mocks.eventBuses.get(task.lastSessionId).listenerCount('agent_event')).toBe(0)
  })

  it('does not change successful execution when every SQLite shadow write fails', async () => {
    mocks.nextAgentMode = 'success'
    mocks.shadowSyncRun.mockRejectedValue(new Error('shadow failure'))
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage, 'task-shadow-failure')

    const response = await runTask(routes, 'task-shadow-failure')
    expect(response.status).toBe(200)
    const completed = await waitFor(async () => {
      const current = (await storage.readStore('scheduled-tasks'))['task-shadow-failure']
      return current?.runs?.[0]?.status === 'success' ? current : null
    }, 'successful JSON task despite shadow failure')
    expect(completed.runs[0].result).toBe('正常完成结果')
  })

  it('keeps DELETE successful when SQLite cleanup fails after JSON deletion', async () => {
    mocks.shadowDeleteTaskRuns.mockRejectedValue(new Error('cleanup failed'))
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage, 'task-delete')
    const response = mockResponse()

    await expect(routes.handleScheduledTasksApi(
      { method: 'DELETE' },
      response,
      new URL('http://localhost/api/scheduled-tasks/task-delete'),
    )).resolves.toBeUndefined()

    expect(response.status).toBe(200)
    expect((await storage.readStore('scheduled-tasks'))['task-delete']).toBeUndefined()
  })

  it('does not clean SQLite when the authoritative JSON delete fails', async () => {
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage, 'task-delete-json-failure')
    storage.atomicUpdate.mockRejectedValueOnce(new Error('JSON delete failed'))

    await expect(routes.handleScheduledTasksApi(
      { method: 'DELETE' },
      mockResponse(),
      new URL('http://localhost/api/scheduled-tasks/task-delete-json-failure'),
    )).rejects.toThrow('JSON delete failed')

    expect(mocks.shadowDeleteTaskRuns).not.toHaveBeenCalled()
  })

  it('does not rewrite the task store when recurring statuses need no repair', async () => {
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    storage.atomicUpdate.mockClear()
    storage.readStore.mockClear()

    routes.startScheduledTaskRunner()
    await waitFor(() => storage.readStore.mock.calls.length >= 2, 'initial scheduler reads')
    routes.stopScheduledTaskRunner()

    expect(storage.atomicUpdate).not.toHaveBeenCalled()
  })

  it('keeps authoritative JSON metadata-only and returns recent runs through the API', async () => {
    mocks.authoritative = true
    mocks.nextAgentMode = 'success'
    mocks.shadowSyncRun.mockImplementation(async (_taskId, value) => value)
    mocks.recentRuns.mockImplementation(async () => [{
      id: 'recent',
      status: 'success',
      startedAt: '2026-01-01T00:00:00.000Z',
      result: 'SQLite result',
    }])
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage, 'task-authoritative')
    const original = mocks.stores.get('scheduled-tasks')['task-authoritative']
    delete original.runs
    mocks.stores.get('scheduled-tasks')['task-authoritative'] = original

    const response = await runTask(routes, 'task-authoritative')
    expect(response.status).toBe(200)
    await waitFor(() => mocks.shadowSyncRun.mock.calls.some(([, value, options]) => value.status === 'success' && options.phase === 'terminal'), 'authoritative terminal persistence')
    const persisted = (await storage.readStore('scheduled-tasks'))['task-authoritative']
    expect(persisted).not.toHaveProperty('runs')
    expect(response.body.task.runs).toEqual([expect.objectContaining({ id: 'recent' })])
  })

  it('compensates the created authoritative run when active metadata persistence fails', async () => {
    mocks.authoritative = true
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage, 'task-created-compensation')
    storage.atomicUpdate.mockRejectedValueOnce(new Error('metadata failed'))

    await expect(runTask(routes, 'task-created-compensation')).rejects.toThrow('metadata failed')
    expect(mocks.deleteRun).toHaveBeenCalledWith('task-created-compensation', expect.any(String))
  })

  it('does not report a successful authoritative execution when terminal SQLite persistence fails', async () => {
    mocks.authoritative = true
    mocks.nextAgentMode = 'success'
    mocks.shadowSyncRun.mockImplementation(async (_taskId, value, options) => {
      if (options.phase === 'terminal') throw new Error('terminal sqlite failed')
      return value
    })
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await storage.ensureStorage()
    await createRecurringTask(storage, 'task-terminal-failure')
    const task = mocks.stores.get('scheduled-tasks')['task-terminal-failure']
    delete task.runs

    const response = await runTask(routes, 'task-terminal-failure')
    expect(response.status).toBe(200)
    await waitFor(() => mocks.shadowSyncRun.mock.calls.some(([, value, options]) => value.status === 'failed' && options.phase === 'exception-terminal'), 'failed terminal persistence')
  })

  it('recovers stale authoritative running rows and clears serial active metadata', async () => {
    mocks.authoritative = true
    mocks.shadowListRuns.mockResolvedValue({
      runs: [{ id: 'stale-run', taskId: 'task-stale', status: 'running', trigger: 'schedule', startedAt: '2025-12-31T23:59:00.000Z' }],
      total: 1,
      page: 1,
      pageSize: 200,
    })
    mocks.stores.set('scheduled-tasks', {
      'task-stale': {
        id: 'task-stale', title: 'Stale', instruction: 'x', scheduleType: 'daily', executeTime: '01:00',
        executionMode: 'serial', status: 'running', currentRunId: 'stale-run', currentRunIds: ['stale-run'],
        nextRunAt: '2026-01-01T01:00:00.000Z', updatedAt: '2025-12-31T23:59:00.000Z',
      },
    })
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    await routes.recoverStaleScheduledTaskRuns({ now: () => new Date('2026-01-01T00:00:00.000Z') })
    expect(mocks.shadowSyncRun).toHaveBeenCalledWith('task-stale', expect.objectContaining({
      id: 'stale-run', status: 'failed', errorMessage: 'Interrupted by previous process shutdown', durationMs: 60_000,
    }), { phase: 'startup-recovery' })
    expect(mocks.stores.get('scheduled-tasks')['task-stale']).toMatchObject({
      status: 'enabled', currentRunId: null, currentRunIds: [],
    })
  })

  it('repairs a completed recurring task with a single store update', async () => {
    mocks.stores.set('scheduled-tasks', {
      'task-repair': {
        id: 'task-repair',
        title: '待修复任务',
        instruction: '执行修复测试',
        scheduleType: 'daily',
        executeTime: '09:00',
        scheduleRule: '每天 09:00',
        status: 'completed',
        nextRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        runs: [],
      },
    })
    const storage = await import('../../server/storage.mjs')
    const routes = await import('../../server/routes/scheduled-tasks.mjs')
    storage.atomicUpdate.mockClear()

    routes.startScheduledTaskRunner()
    await waitFor(() => mocks.stores.get('scheduled-tasks')?.['task-repair']?.status === 'enabled', 'recurring task repair')
    routes.stopScheduledTaskRunner()

    expect(storage.atomicUpdate).toHaveBeenCalledTimes(1)
  })
})
