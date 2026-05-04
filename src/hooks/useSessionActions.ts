import { useCallback } from 'react'
import type { AgentManager } from '@/hooks/useAgentManager'
import { initializePiStorage } from '@/lib/pi-chat'
import { t } from '@/lib/i18n'

type UseSessionActionsOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  taskMapRef: AgentManager['taskMapRef']
  currentSessionIdRef: AgentManager['currentSessionIdRef']
  loadAgentSession: AgentManager['loadSession']
  setCurrentTitleRef: AgentManager['setCurrentTitleRef']
  refreshSessions: (opts?: { broadcast?: boolean }) => Promise<void>
  setScheduledTasksOpen: React.Dispatch<React.SetStateAction<boolean>>
  startNewGlobalChat: () => Promise<void>
}

export function useSessionActions({
  storageRef,
  taskMapRef,
  currentSessionIdRef,
  loadAgentSession,
  setCurrentTitleRef,
  refreshSessions,
  setScheduledTasksOpen,
  startNewGlobalChat,
}: UseSessionActionsOptions) {
  const loadSession = useCallback((sessionId: string) => {
    setScheduledTasksOpen(false)
    void loadAgentSession(sessionId)
  }, [loadAgentSession, setScheduledTasksOpen])

  const renameSession = useCallback(async (sessionId: string, currentTitle: string) => {
    const storage = storageRef.current
    if (!storage) return
    const { showPrompt } = await import('@/components/ui/prompt-dialog')
    const newTitle = await showPrompt({
      title: t('renameSession'),
      description: t('sessionName'),
      defaultValue: currentTitle,
      confirmLabel: t('save'),
      cancelLabel: t('cancel'),
    })
    if (!newTitle || newTitle === currentTitle) return
    const session = await storage.sessions.get(sessionId)
    if (!session) return
    const metadata = await storage.sessions.getMetadata(sessionId)
    if (!metadata) return
    await storage.sessions.save(session, { ...metadata, title: newTitle })
    await refreshSessions({ broadcast: true })
    if (currentSessionIdRef.current === sessionId) {
      setCurrentTitleRef(newTitle)
    }
  }, [currentSessionIdRef, refreshSessions, setCurrentTitleRef, storageRef])

  const deleteSession = useCallback(async (sessionId: string) => {
    const storage = storageRef.current
    if (!storage) return
    const { showConfirm } = await import('@/components/ui/confirm-dialog')
    const confirmed = await showConfirm({
      title: t('deleteSession'),
      description: t('deleteSessionConfirm'),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
    })
    if (!confirmed) return
    const task = taskMapRef.current.get(sessionId)
    task?.unsubscribe()
    task?.agent.dispose()
    taskMapRef.current.delete(sessionId)
    await storage.sessions.delete(sessionId)
    await refreshSessions({ broadcast: true })
    if (currentSessionIdRef.current === sessionId) {
      setScheduledTasksOpen(false)
      await startNewGlobalChat()
    }
  }, [currentSessionIdRef, refreshSessions, setScheduledTasksOpen, startNewGlobalChat, storageRef, taskMapRef])

  const startNewGlobalSession = useCallback(() => {
    setScheduledTasksOpen(false)
    void startNewGlobalChat()
  }, [setScheduledTasksOpen, startNewGlobalChat])

  return {
    loadSession,
    renameSession,
    deleteSession,
    startNewGlobalSession,
  }
}
