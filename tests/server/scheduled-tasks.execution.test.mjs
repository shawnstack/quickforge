import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
}))

vi.mock('../../server/storage.mjs', () => ({
  storageDir: path.join(os.tmpdir(), 'quickforge-scheduled-tasks-test-storage'),
  ensureStorage: vi.fn(async () => {}),
  readStore: vi.fn(async (name) => structuredClone(mocks.stores.get(name) || {})),
  atomicUpdate: vi.fn(async (name, updater) => {
    const current = structuredClone(mocks.stores.get(name) || {})
    const next = await updater(current)
    mocks.stores.set(name, structuredClone(next))
    return structuredClone(next)
  }),
}))

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
    persistSessionState: vi.fn(async () => {}),
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

vi.mock('../../server/project-config.mjs', () => ({
  readProjectConfig: vi.fn(async () => ({ projects: [] })),
  projectContextFromId: vi.fn(),
}))

let tempDir
let previousDataDir

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

async function createRecurringTask(storage, taskId = 'task-lifecycle') {
  const now = new Date().toISOString()
  const task = {
    id: taskId,
    title: '生命周期任务',
    instruction: '执行生命周期测试',
    scheduleType: 'daily',
    executeTime: '09:00',
    scheduleRule: '每天 09:00',
    executionMode: 'serial',
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-scheduled-lifecycle-'))
  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tempDir
  mocks.sessions.clear()
  mocks.eventBuses.clear()
  mocks.stores.clear()
  mocks.nextAgentMode = 'timeout'
  mocks.abortRun.mockReset()
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

describe('scheduled task execution lifecycle', () => {
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
    expect(mocks.eventBuses.get(task.lastSessionId).listenerCount('agent_event')).toBe(0)
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
