import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ToastItem } from '@/components/ui/toast'
import {
  isBackgroundTaskStatus,
  isBotHeartbeatNotification,
  isScheduledTaskNotification,
  isScheduledTaskStarted,
} from '@/lib/agent-event-guards'
import { t } from '@/lib/i18n'
import { subscribeToAgentEvents } from '@/lib/server-agent'
import { showTaskSystemNotification } from '@/lib/system-notifications'
import type { QuickForgeSessionMetadata } from '@/lib/types'

export type AddToast = (toast: Omit<ToastItem, 'id' | 'createdAt'>) => void

/** Agent 事件 → 会话列表联动 / 任务 Toast / 系统通知的统一出口。
 *
 *  - `scheduled_task_started`：展开对应项目并拉取其会话分页（定时任务会话刚创建）；
 *  - `session_created` / `title_updated` / `agent_end` / `session_forked`：
 *    以最小代价同步会话列表（upsert / 改标题 / 刷新）；
 *  - `scheduled_task_notification`：任务终态 Toast + 系统通知；
 *  - `bot_heartbeat_notification`：bot 心跳 `[报告]` 的 Toast + 系统通知
 *    （只有首行带标记才走到这里，无事/idle 跳不会发这个事件）。
 */
export function useAgentSessionEvents(context: {
  addToast: AddToast
  loadProjectSessions: (projectId: string, offset: number) => unknown
  refreshSessions: (opts?: { broadcast?: boolean }) => Promise<void>
  setExpandedProjectIds: Dispatch<SetStateAction<Set<string>>>
  updateSessionTitle: (sessionId: string, title: string) => void
  upsertSessionMetadata: (metadata: QuickForgeSessionMetadata) => void
}) {
  const { addToast, loadProjectSessions, refreshSessions, setExpandedProjectIds, updateSessionTitle, upsertSessionMetadata } = context

  useEffect(() => {
    const unsubscribe = subscribeToAgentEvents((event) => {
      if (isScheduledTaskStarted(event)) {
        const projectId = typeof event.projectId === 'string' ? event.projectId : undefined
        if (projectId) {
          setExpandedProjectIds((current) => {
            const next = new Set(current)
            next.add(projectId)
            return next
          })
          void loadProjectSessions(projectId, 0)
        }
        void refreshSessions({ broadcast: true })
        return
      }
      if (event.type === 'session_created') {
        const metadata = event.metadata as QuickForgeSessionMetadata | undefined
        if (metadata?.id) upsertSessionMetadata(metadata)
      } else if (event.type === 'title_updated') {
        const sessionId = typeof event.sessionId === 'string' ? event.sessionId : undefined
        const title = typeof event.title === 'string' ? event.title : undefined
        if (sessionId && title) updateSessionTitle(sessionId, title)
      } else if (event.type === 'agent_end' || event.type === 'session_forked') {
        void refreshSessions({ broadcast: true })
      }
      if (!isScheduledTaskNotification(event)) return
      const sessionId = typeof event.sessionId === 'string' ? event.sessionId : undefined
      const title = typeof event.title === 'string' ? event.title : t('scheduledTasks')
      const status = isBackgroundTaskStatus(event.status) ? event.status : 'idle'
      const message = typeof event.message === 'string' ? event.message : undefined
      addToast({ sessionId: sessionId ?? '', title, status, message })
      const runId = typeof event.runId === 'string' ? event.runId : undefined
      void showTaskSystemNotification({
        key: runId ? `scheduled:${runId}` : `scheduled:${sessionId ?? title}:${status}`,
        sessionId,
        title,
        status,
      })
    })
    return unsubscribe
  }, [addToast, loadProjectSessions, refreshSessions, setExpandedProjectIds, updateSessionTitle, upsertSessionMetadata])

  useEffect(() => {
    const unsubscribe = subscribeToAgentEvents((event) => {
      if (!isBotHeartbeatNotification(event)) return
      const sessionId = typeof event.sessionId === 'string' ? event.sessionId : undefined
      const title = typeof event.title === 'string' ? event.title : t('bots')
      const message = typeof event.message === 'string' ? event.message : undefined
      const reportKey = typeof event.reportKey === 'string' ? event.reportKey : `${sessionId ?? title}:${Date.now()}`
      addToast({ sessionId: sessionId ?? '', title, status: 'idle', message })
      void showTaskSystemNotification({
        key: `bot-heartbeat:${reportKey}`,
        sessionId,
        title,
        status: 'idle',
        message,
      })
    })
    return unsubscribe
  }, [addToast])
}
