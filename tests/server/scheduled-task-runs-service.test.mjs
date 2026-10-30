import { describe, expect, it, vi } from 'vitest'
import { createScheduledTaskRunsService } from '../../server/scheduled-task-runs-service.mjs'

function run(id, overrides = {}) {
  return {
    id,
    status: 'success',
    trigger: 'manual',
    inputContent: `input-${id}`,
    result: `result-${id}`,
    startedAt: '2026-01-01T00:00:00.000Z',
    customField: `custom-${id}`,
    ...overrides,
  }
}

function task(id, title, runs = []) {
  return { id, title, scheduleRule: '每天 09:00', projectName: `project-${id}`, runs }
}

function key(taskId, runId) {
  return `${taskId}\u0000${runId}`
}

function fakeRepository(initial = []) {
  const rows = new Map(initial.map((value) => [key(value.taskId, value.id), structuredClone(value)]))
  const repository = {
    get: vi.fn((taskId, runId) => {
      const value = rows.get(key(taskId, runId))
      if (!value) return null
      const { taskId: _taskId, ...runValue } = value
      return structuredClone(runValue)
    }),
    upsert: vi.fn((taskId, value, options = {}) => {
      const stored = { ...structuredClone(value), taskId, source: options.source || value.source || 'runtime' }
      rows.set(key(taskId, value.id), stored)
      const { taskId: _taskId, ...runValue } = stored
      return runValue
    }),
    update: vi.fn((taskId, runId, patch) => {
      const rowKey = key(taskId, runId)
      const current = rows.get(rowKey)
      if (!current) return null
      rows.set(rowKey, { ...current, ...structuredClone(patch) })
      const { taskId: _taskId, ...runValue } = rows.get(rowKey)
      return runValue
    }),
    delete: vi.fn((taskId, runId) => rows.delete(key(taskId, runId))),
    deleteByTask: vi.fn((taskId) => {
      let count = 0
      for (const [rowKey, value] of rows) if (value.taskId === taskId) { rows.delete(rowKey); count += 1 }
      return count
    }),
    listByTask: vi.fn((taskId, { limit = 200 } = {}) => [...rows.values()]
      .filter((value) => value.taskId === taskId)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || String(b.id).localeCompare(String(a.id)))
      .slice(0, limit)
      .map(({ taskId: _taskId, ...value }) => structuredClone(value))),
    list: vi.fn(({ taskId, taskIds, status, trigger, keyword, keywordTaskIds = [], page = 1, pageSize = 10 } = {}) => {
      let values = [...rows.values()].filter((value) => !taskId || value.taskId === taskId)
      if (taskIds) values = values.filter((value) => taskIds.includes(value.taskId))
      if (status) values = values.filter((value) => value.status === status)
      if (trigger) values = values.filter((value) => value.trigger === trigger)
      if (keyword) values = values.filter((value) => keywordTaskIds.includes(value.taskId) || [value.inputContent, value.result, value.errorMessage].join('\n').toLowerCase().includes(keyword.toLowerCase()))
      values.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || String(b.id).localeCompare(String(a.id)) || String(b.taskId).localeCompare(String(a.taskId)))
      const start = (page - 1) * pageSize
      return { runs: structuredClone(values.slice(start, start + pageSize)), total: values.length, page, pageSize }
    }),
  }
  return { repository, rows }
}

function serviceFor(tasks, repository, logger = { warn: vi.fn() }) {
  return createScheduledTaskRunsService({
    readTasks: vi.fn(async () => structuredClone(tasks)),
    getRepository: vi.fn(() => repository),
    logger,
  })
}

describe('scheduled task runs service', () => {
  it('records persistence failures in diagnostics without leaking error details', async () => {
    const { repository, rows } = fakeRepository()
    const logger = { warn: vi.fn() }
    const service = serviceFor([], repository, logger)
    await expect(service.syncRun('task-a', run('same'), { stage: 'created' })).resolves.toBeTruthy()
    await expect(service.syncRun('task-b', run('same'), { stage: 'created' })).resolves.toBeTruthy()
    expect(rows.size).toBe(2)

    repository.upsert.mockImplementationOnce(() => { throw new Error('secret') })
    await expect(service.syncRun('task-c', run('failed'), { stage: 'terminal' })).rejects.toThrow('secret')
    expect(service.getDiagnostics()).toMatchObject({ readDegraded: false, failureCounts: { sync: 1 } })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret')
  })
})

describe('scheduled task runs repository reads', () => {
  it('uses one SQL count/page query, current taskIds, and task-title keyword OR text', async () => {
    const tasks = [task('task-a', 'Alpha'), task('task-z', 'Needle title')]
    const { repository } = fakeRepository([
      { ...run('same', { result: 'other' }), taskId: 'task-z' },
      { ...run('text', { errorMessage: 'needle text' }), taskId: 'task-a' },
      { ...run('orphan'), taskId: 'deleted' },
    ])
    const service = serviceFor(tasks, repository)
    const result = await service.listRuns({ keyword: 'needle', page: 1, pageSize: 1 })
    expect(result).toMatchObject({ total: 2, page: 1, pageSize: 1 })
    expect(result.runs[0]).toHaveProperty('taskTitle')
    expect(repository.list).toHaveBeenCalledOnce()
    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ taskIds: ['task-a', 'task-z'], keywordTaskIds: ['task-z'] }))
  })

  it('strictly persists upserts/deletes, returns recent runs, and propagates failures', async () => {
    const { repository, rows } = fakeRepository()
    const service = serviceFor([], repository)
    await service.syncRun('task-a', run('same'), { stage: 'created' })
    await service.syncRun('task-b', run('same'), { stage: 'created' })
    expect(rows.size).toBe(2)
    expect(await service.recentRuns('task-a', 5)).toHaveLength(1)
    await expect(service.deleteRun('task-a', 'same')).resolves.toBe(true)
    expect(rows.has(key('task-b', 'same'))).toBe(true)

    repository.upsert.mockImplementationOnce(() => { throw new Error('sqlite down') })
    await expect(service.syncRun('task-c', run('x'), { stage: 'created' })).rejects.toThrow('sqlite down')
    repository.deleteByTask.mockImplementationOnce(() => { throw new Error('cleanup down') })
    await expect(service.deleteTaskRuns('task-b')).rejects.toThrow('cleanup down')
  })

  it('serializes same-task stages', async () => {
    const { repository } = fakeRepository()
    let release
    const original = repository.upsert.getMockImplementation()
    repository.upsert.mockImplementationOnce(async (...args) => {
      await new Promise((resolve) => { release = resolve })
      return original(...args)
    })
    const service = serviceFor([], repository)
    const first = service.syncRun('task-a', run('one', { status: 'running' }), { stage: 'created' })
    const second = service.syncRun('task-a', run('one', { status: 'success' }), { stage: 'terminal' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await Promise.all([first, second])
    expect(repository.upsert).toHaveBeenCalledTimes(2)
  })
})
