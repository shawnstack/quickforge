import type { BackgroundTask, BackgroundTaskStatus } from './types'

export const MAX_IDLE_AGENT_TASKS = 5

const EVICTABLE_STATUSES = new Set<BackgroundTaskStatus>(['idle', 'error', 'aborted'])

export function touchAgentTask(task: BackgroundTask, now = Date.now()) {
  task.lastAccessedAt = now
}

export function selectAgentTaskEvictions(
  tasks: Iterable<BackgroundTask>,
  currentSessionId?: string,
  maxIdleTasks = MAX_IDLE_AGENT_TASKS,
) {
  const candidates = Array.from(tasks).filter((task) => (
    task.sessionId !== currentSessionId
    && task.status !== 'running'
    && !task.agent.state.isStreaming
    && EVICTABLE_STATUSES.has(task.status)
  ))

  if (candidates.length <= maxIdleTasks) return []
  candidates.sort((left, right) => (
    (left.lastAccessedAt ?? 0) - (right.lastAccessedAt ?? 0)
  ))
  return candidates.slice(0, candidates.length - maxIdleTasks).map((task) => task.sessionId)
}

export function disposeAgentTask(taskMap: Map<string, BackgroundTask>, sessionId: string) {
  const task = taskMap.get(sessionId)
  if (!task) return false
  task.unsubscribe()
  task.agent.dispose()
  taskMap.delete(sessionId)
  return true
}

export function disposeAllAgentTasks(taskMap: Map<string, BackgroundTask>) {
  for (const sessionId of [...taskMap.keys()]) disposeAgentTask(taskMap, sessionId)
}
