import { describe, expect, it } from 'vitest'
import {
  buildBackgroundTasks,
  filterBackgroundTasks,
  formatBackgroundTaskDuration,
  matchesBackgroundTaskQuery,
  type BackgroundTaskView,
  type ToolResultLikeMessage,
} from '../../src/lib/background-tasks-model'

function toolResult(details: unknown): ToolResultLikeMessage {
  return { role: 'toolResult', details }
}

function finish(details: Record<string, unknown>): ToolResultLikeMessage {
  return toolResult({ running: false, ...details })
}

describe('buildBackgroundTasks', () => {
  it('merges running and finished, preferring the finished toolResult for the same taskId', () => {
    const tasks = buildBackgroundTasks({
      running: [
        { taskId: 'task-a', toolCallId: 'call-a', command: 'sleep 5', startedAt: 1000 },
        { taskId: 'task-b', toolCallId: 'call-b', command: 'npm run dev', startedAt: 2000 },
      ],
      messages: [
        finish({
          taskId: 'task-a',
          toolCallId: 'call-a',
          command: 'sleep 5',
          startedAt: 1000,
          finishedAt: 4000,
          code: 0,
          durationMs: 3000,
        }),
        finish({
          taskId: 'task-c',
          toolCallId: 'call-c',
          command: 'ls',
          startedAt: 500,
          finishedAt: 600,
          code: 1,
        }),
      ],
      sessionId: 'session-1',
    })

    expect(tasks.map((task) => task.taskId)).toEqual(['task-b', 'task-a', 'task-c'])
    expect(tasks).toHaveLength(3)

    const merged = tasks.find((task) => task.taskId === 'task-a')
    expect(merged?.status).toBe('completed')
    expect(merged?.finishedAt).toBe(4000)
    expect(merged?.sessionId).toBe('session-1')

    const running = tasks.find((task) => task.taskId === 'task-b')
    expect(running?.status).toBe('running')
    expect(running?.finishedAt).toBeNull()
    expect(running?.exitCode).toBeNull()
    expect(running?.durationMs).toBeNull()
  })

  it('sorts running first (startedAt desc) then finished (finishedAt desc, fallback startedAt)', () => {
    const tasks = buildBackgroundTasks({
      running: [
        { taskId: 'run-old', command: 'a', startedAt: 100 },
        { taskId: 'run-new', command: 'b', startedAt: 300 },
        { taskId: 'run-unknown', command: 'c' },
      ],
      messages: [
        finish({ taskId: 'fin-old', command: 'd', finishedAt: 200 }),
        finish({ taskId: 'fin-new', command: 'e', finishedAt: 900 }),
        finish({ taskId: 'fin-started', command: 'f', startedAt: 800, code: 0 }),
        finish({ taskId: 'fin-unknown', command: 'g', code: 0 }),
      ],
    })

    expect(tasks.map((task) => task.taskId)).toEqual([
      'run-new',
      'run-old',
      'run-unknown',
      'fin-new',
      'fin-started',
      'fin-old',
      'fin-unknown',
    ])
  })

  it('is deterministic for identical input', () => {
    const input = {
      running: [{ taskId: 'same', command: 'x' }],
      messages: [finish({ taskId: 'other', command: 'y' })],
    }
    expect(buildBackgroundTasks(input)).toEqual(buildBackgroundTasks(input))
  })

  it('derives all five statuses from message details', () => {
    const tasks = buildBackgroundTasks({
      running: [{ taskId: 'live', toolCallId: 'call-live', command: 'tail -f log' }],
      messages: [
        toolResult({ taskId: 'live', running: false, command: 'tail -f log', code: 0 }),
        finish({ taskId: 'done', command: 'ok', code: 0 }),
        finish({ taskId: 'failed', command: 'boom', code: 2 }),
        finish({ taskId: 'timed-out', command: 'slow', code: null, timedOut: true }),
        finish({ taskId: 'aborted', command: 'cancel', code: null, aborted: true }),
        // aborted 优先于 timedOut
        finish({ taskId: 'aborted-wins', command: 'cancel', aborted: true, timedOut: true }),
      ],
    })

    const statusById = new Map(tasks.map((task) => [task.taskId, task.status]))
    expect(statusById.get('live')).toBe('completed')
    expect(statusById.get('done')).toBe('completed')
    expect(statusById.get('failed')).toBe('failed')
    expect(statusById.get('timed-out')).toBe('timed_out')
    expect(statusById.get('aborted')).toBe('aborted')
    expect(statusById.get('aborted-wins')).toBe('aborted')
    expect(statusById.has('live')).toBe(true)
  })

  it('falls back to summary/description for command and tolerates missing fields', () => {
    const tasks = buildBackgroundTasks({
      running: [],
      messages: [
        finish({ taskId: 'summary-only', summary: 'grep foo' }),
        finish({ taskId: 'description-only', description: 'tail log' }),
        finish({ taskId: 'no-command' }),
      ],
    })

    expect(tasks.find((task) => task.taskId === 'summary-only')?.command).toBe('grep foo')
    expect(tasks.find((task) => task.taskId === 'description-only')?.command).toBe('tail log')
    expect(tasks.find((task) => task.taskId === 'no-command')?.command).toBe('')
  })

  it('ignores messages with null/non-object details or a missing taskId', () => {
    const tasks = buildBackgroundTasks({
      running: [],
      messages: [
        toolResult(null),
        toolResult('not-an-object'),
        toolResult(42),
        toolResult([{ taskId: 'array' }]),
        finish({ command: 'no task id' }),
        finish({ taskId: '', command: 'empty task id' }),
        finish({ taskId: 123, command: 'numeric task id' }),
        // running 仍为 true 的消息不是终态
        toolResult({ taskId: 'still-running', running: true, command: 'x' }),
        // 非 toolResult 角色忽略
        { role: 'assistant', details: { taskId: 'assistant', running: false } },
        finish({ taskId: 'real', command: 'ls' }),
      ],
    })

    expect(tasks.map((task) => task.taskId)).toEqual(['real'])
  })
})

describe('filterBackgroundTasks', () => {
  const tasks: BackgroundTaskView[] = [
    {
      taskId: 'running-1',
      toolCallId: 'call-1',
      command: 'npm run dev',
      status: 'running',
      startedAt: 10,
      finishedAt: null,
      exitCode: null,
      durationMs: null,
    },
    {
      taskId: 'done-1',
      toolCallId: 'call-2',
      command: 'ls -la',
      status: 'completed',
      startedAt: 5,
      finishedAt: 20,
      exitCode: 0,
      durationMs: 15000,
    },
    {
      taskId: 'failed-1',
      toolCallId: 'call-3',
      command: 'false',
      status: 'failed',
      startedAt: 4,
      finishedAt: 6,
      exitCode: 1,
      durationMs: 2000,
    },
  ]

  it('filters running', () => {
    expect(filterBackgroundTasks(tasks, 'running').map((task) => task.taskId)).toEqual(['running-1'])
  })

  it('filters finished', () => {
    expect(filterBackgroundTasks(tasks, 'finished').map((task) => task.taskId)).toEqual(['done-1', 'failed-1'])
  })

  it('returns a new array for all', () => {
    const all = filterBackgroundTasks(tasks, 'all')
    expect(all).toEqual(tasks)
    expect(all).not.toBe(tasks)
  })
})

describe('matchesBackgroundTaskQuery', () => {
  const task: BackgroundTaskView = {
    taskId: 'task-42',
    toolCallId: 'call-42',
    command: 'npm run dev',
    description: 'Start Dev Server',
    status: 'running',
  }

  it('matches empty and whitespace-only queries', () => {
    expect(matchesBackgroundTaskQuery(task, '')).toBe(true)
    expect(matchesBackgroundTaskQuery(task, '   ')).toBe(true)
  })

  it('matches command case-insensitively', () => {
    expect(matchesBackgroundTaskQuery(task, 'NPM RUN')).toBe(true)
  })

  it('matches description', () => {
    expect(matchesBackgroundTaskQuery(task, 'dev server')).toBe(true)
  })

  it('matches taskId', () => {
    expect(matchesBackgroundTaskQuery(task, '  TASK-4 ')).toBe(true)
  })

  it('does not match unrelated queries', () => {
    expect(matchesBackgroundTaskQuery(task, 'webpack')).toBe(false)
  })
})

describe('formatBackgroundTaskDuration', () => {
  it('formats edge and typical values', () => {
    expect(formatBackgroundTaskDuration(0)).toBe('0s')
    expect(formatBackgroundTaskDuration(999)).toBe('0s')
    expect(formatBackgroundTaskDuration(1000)).toBe('1s')
    expect(formatBackgroundTaskDuration(42000)).toBe('42s')
    expect(formatBackgroundTaskDuration(134000)).toBe('2m14s')
    expect(formatBackgroundTaskDuration(65000)).toBe('1m05s')
    expect(formatBackgroundTaskDuration(Number.POSITIVE_INFINITY)).toBe('0s')
    expect(formatBackgroundTaskDuration(-5)).toBe('0s')
    expect(formatBackgroundTaskDuration(Number.NaN)).toBe('0s')
  })
})
