import type { BackgroundTask, BackgroundTaskStatus } from './types'

// 0 = 前端不缓存空闲会话副本：每个驻留 agent 都持有该会话的全量 messages
// （工具结果、diff 等可达 MB 级），切走的空闲会话立即销毁，切换回去时走
// 服务端 restore。taskMap 只作为活动注册表：当前会话 + 正在后台运行的任务。
export const MAX_IDLE_AGENT_TASKS = 0

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
