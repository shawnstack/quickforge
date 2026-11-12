import type { BackgroundTaskStatus } from '@/lib/types'

type ScheduledTaskNotificationEvent = {
  type?: unknown
  runId?: unknown
  sessionId?: unknown
  title?: unknown
  status?: unknown
  message?: unknown
}

type ScheduledTaskStartedEvent = {
  type?: unknown
  sessionId?: unknown
  title?: unknown
  scope?: unknown
  projectId?: unknown
  createdAt?: unknown
}

export type BotHeartbeatNotificationEvent = {
  type?: unknown
  sessionId?: unknown
  botId?: unknown
  reportKey?: unknown
  title?: unknown
  status?: unknown
  message?: unknown
}

export function isBackgroundTaskStatus(value: unknown): value is BackgroundTaskStatus {
  return value === 'idle' || value === 'running' || value === 'error' || value === 'aborted'
}

export function isScheduledTaskNotification(event: Record<string, unknown>): event is ScheduledTaskNotificationEvent {
  return event.type === 'scheduled_task_notification'
}

export function isBotHeartbeatNotification(event: Record<string, unknown>): event is BotHeartbeatNotificationEvent {
  return event.type === 'bot_heartbeat_notification'
}

export function isScheduledTaskStarted(event: Record<string, unknown>): event is ScheduledTaskStartedEvent {
  return event.type === 'scheduled_task_started'
}
