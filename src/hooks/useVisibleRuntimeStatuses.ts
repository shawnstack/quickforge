import { useCallback, useEffect, useMemo, useRef } from 'react'
import { fetchActiveAgentStatuses, subscribeToAgentEvents } from '@/lib/server-agent'
import type { BackgroundTaskStatus, QuickForgeSessionMetadata } from '@/lib/types'
import { logger } from '@/lib/logger'
import { useRuntimeStatusesStore } from '@/stores/runtime-statuses-store'

function toBackgroundTaskStatus(status: unknown): BackgroundTaskStatus | undefined {
  return status === 'running' || status === 'idle' || status === 'error' || status === 'aborted'
    ? status
    : undefined
}

/** 运行态状态已迁入 useRuntimeStatusesStore（zustand）。
 *  本 hook 保留为兼容层：返回结构与旧实现一致，App.tsx 接线不变；
 *  setter 引用恒定（等价于旧 useState setter），轮询 / SSE / visibilitychange
 *  副作用逻辑仍在此处，只是 setState 改为调用 store 的 set action。
 */
export function useVisibleRuntimeStatuses(sessions: QuickForgeSessionMetadata[]) {
  const statuses = useRuntimeStatusesStore((s) => s.statuses)
  const completedSessionIds = useRuntimeStatusesStore((s) => s.completedSessionIds)
  const setStatuses = useRuntimeStatusesStore((s) => s.setStatuses)
  const setCompletedSessionIds = useRuntimeStatusesStore((s) => s.setCompletedSessionIds)

  const visibleSessionIds = useMemo(() => {
    return new Set(sessions.map((session) => session.id))
  }, [sessions])

  const visibleSessionKey = useMemo(() => {
    return sessions.map((session) => session.id).sort().join('\n')
  }, [sessions])

  const refreshVisibleStatuses = useCallback(async () => {
    if (visibleSessionIds.size === 0) {
      setStatuses({})
      return
    }

    try {
      const activeSessions = await fetchActiveAgentStatuses()
      const activeStatuses = new Map(
        activeSessions
          .map((session) => [session.sessionId, toBackgroundTaskStatus(session.status)] as const)
          .filter((entry): entry is readonly [string, BackgroundTaskStatus] => Boolean(entry[1])),
      )

      setStatuses((current) => {
        const next: Record<string, BackgroundTaskStatus> = {}
        for (const sessionId of visibleSessionIds) {
          const activeStatus = activeStatuses.get(sessionId)
          const currentStatus = current[sessionId]
          if (activeStatus) {
            next[sessionId] = activeStatus
          } else if (currentStatus === 'running') {
            next[sessionId] = 'idle'
          } else if (currentStatus && currentStatus !== 'idle') {
            next[sessionId] = currentStatus
          }
        }
        return next
      })
    } catch (error) {
      logger.error('Failed to refresh visible agent statuses:', error)
    }
  }, [visibleSessionIds, setStatuses])

  // sessions 数组身份变化会重建 refreshVisibleStatuses（其闭包依赖 visibleSessionIds），
  // 用 ref 持有最新回调，让刷新只在可见 id 集合真正变化时触发。
  const refreshVisibleStatusesRef = useRef(refreshVisibleStatuses)

  useEffect(() => {
    refreshVisibleStatusesRef.current = refreshVisibleStatuses
  }, [refreshVisibleStatuses])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshVisibleStatusesRef.current()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [visibleSessionKey])

  useEffect(() => {
    const unsubscribe = subscribeToAgentEvents((event) => {
      const sessionId = event.sessionId as string | undefined
      if (!sessionId || !visibleSessionIds.has(sessionId)) return

      if (event.type === 'agent_start') {
        setStatuses((current) => ({ ...current, [sessionId]: 'running' }))
        setCompletedSessionIds((current) => {
          if (!current.has(sessionId)) return current
          const next = new Set(current)
          next.delete(sessionId)
          return next
        })
        return
      }

      if (event.type === 'agent_end') {
        const eventStatus = toBackgroundTaskStatus(event.status)
        const status: BackgroundTaskStatus = eventStatus === 'aborted'
          ? 'aborted'
          : event.errorMessage
            ? 'error'
            : 'idle'
        setStatuses((current) => ({ ...current, [sessionId]: status }))
        if (status === 'idle') {
          setCompletedSessionIds((current) => new Set(current).add(sessionId))
        }
      }
    })

    return unsubscribe
  }, [visibleSessionIds, setStatuses, setCompletedSessionIds])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshVisibleStatuses()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refreshVisibleStatuses])

  const markSessionRead = useCallback((sessionId: string) => {
    setCompletedSessionIds((current) => {
      if (!current.has(sessionId)) return current
      const next = new Set(current)
      next.delete(sessionId)
      return next
    })
  }, [setCompletedSessionIds])

  return { statuses, completedSessionIds, markSessionRead }
}
