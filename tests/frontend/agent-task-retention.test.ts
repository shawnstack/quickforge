import { describe, expect, it, vi } from 'vitest'
import {
  MAX_IDLE_AGENT_TASKS,
  disposeAgentTask,
  disposeAllAgentTasks,
  selectAgentTaskEvictions,
} from '../../src/lib/agent-task-retention'
import type { BackgroundTask, BackgroundTaskStatus } from '../../src/lib/types'

function createTask(
  sessionId: string,
  status: BackgroundTaskStatus,
  lastAccessedAt: number,
  isStreaming = false,
): BackgroundTask {
  return {
    sessionId,
    status,
    lastAccessedAt,
    scope: 'global',
    title: sessionId,
    unsubscribe: vi.fn(),
    agent: {
      state: { isStreaming },
      dispose: vi.fn(),
    } as unknown as BackgroundTask['agent'],
  }
}

describe('agent task retention', () => {
  it('keeps the current session and running background tasks', () => {
    const tasks = [
      createTask('current', 'idle', 1),
      createTask('running-status', 'running', 2),
      createTask('running-agent', 'idle', 3, true),
      ...Array.from({ length: MAX_IDLE_AGENT_TASKS + 2 }, (_, index) => createTask(`idle-${index}`, 'idle', 10 + index)),
    ]

    expect(selectAgentTaskEvictions(tasks, 'current')).toEqual(['idle-0', 'idle-1'])
  })

  it('evicts only the least recently used idle, error, or aborted tasks', () => {
    const tasks = [
      createTask('idle-new', 'idle', 50),
      createTask('error-old', 'error', 10),
      createTask('aborted-middle', 'aborted', 20),
      createTask('idle-middle', 'idle', 30),
      createTask('error-middle', 'error', 40),
      createTask('idle-oldest', 'idle', 1),
    ]

    expect(selectAgentTaskEvictions(tasks, undefined, 3)).toEqual([
      'idle-oldest',
      'error-old',
      'aborted-middle',
    ])
  })

  it('unsubscribes, disposes, and removes an evicted task', () => {
    const task = createTask('evicted', 'idle', 1)
    const taskMap = new Map([[task.sessionId, task]])

    expect(disposeAgentTask(taskMap, task.sessionId)).toBe(true)
    expect(task.unsubscribe).toHaveBeenCalledOnce()
    expect(task.agent.dispose).toHaveBeenCalledOnce()
    expect(taskMap.has(task.sessionId)).toBe(false)
    expect(disposeAgentTask(taskMap, task.sessionId)).toBe(false)
  })

  it('cleans every tracked agent during page teardown', () => {
    const tasks = [
      createTask('first', 'idle', 1),
      createTask('second', 'running', 2, true),
    ]
    const taskMap = new Map(tasks.map((task) => [task.sessionId, task]))

    disposeAllAgentTasks(taskMap)

    expect(taskMap.size).toBe(0)
    for (const task of tasks) {
      expect(task.unsubscribe).toHaveBeenCalledOnce()
      expect(task.agent.dispose).toHaveBeenCalledOnce()
    }
  })
})
