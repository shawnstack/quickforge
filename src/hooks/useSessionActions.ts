import { useCallback } from 'react'
import type { AgentManager } from '@/hooks/useAgentManager'
import type { QuickForgeSessionData, QuickForgeSessionMetadata } from '@/lib/types'
import { initializePiStorage } from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import { showPrompt } from '@/components/ui/prompt-dialog'

type UseSessionActionsOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  taskMapRef: AgentManager['taskMapRef']
  currentSessionIdRef: AgentManager['currentSessionIdRef']
  loadAgentSession: AgentManager['loadSession']
  setCurrentTitleRef: AgentManager['setCurrentTitleRef']
  refreshSessions: (opts?: { broadcast?: boolean }) => Promise<void>
  closeWorkspacePage: () => void
  startNewGlobalChat: () => Promise<void>
}

export function useSessionActions({
  storageRef,
  taskMapRef,
  currentSessionIdRef,
  loadAgentSession,
  setCurrentTitleRef,
  refreshSessions,
  closeWorkspacePage,
  startNewGlobalChat,
}: UseSessionActionsOptions) {
  const loadSession = useCallback((sessionId: string) => {
    closeWorkspacePage()
    void loadAgentSession(sessionId)
  }, [loadAgentSession, closeWorkspacePage])

  const renameSession = useCallback(async (sessionId: string, currentTitle: string) => {
    const storage = storageRef.current
    if (!storage) return
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

  const togglePinSession = useCallback(async (sessionId: string) => {
    const storage = storageRef.current
    if (!storage) return
    const session = await storage.sessions.get(sessionId) as QuickForgeSessionData | null
    if (!session) return
    const metadata = await storage.sessions.getMetadata(sessionId) as QuickForgeSessionMetadata | null
    if (!metadata) return

    const pinnedAt = metadata.pinnedAt ? undefined : new Date().toISOString()
    const nextSession = { ...session, pinnedAt }
    const nextMetadata = { ...metadata, pinnedAt }
    await storage.sessions.save(nextSession, nextMetadata)
    await refreshSessions({ broadcast: true })
  }, [refreshSessions, storageRef])

  const deleteSession = useCallback(async (sessionId: string) => {
    const storage = storageRef.current
    if (!storage) return
    const task = taskMapRef.current.get(sessionId)
    task?.unsubscribe()
    task?.agent.dispose()
    taskMapRef.current.delete(sessionId)
    await storage.sessions.delete(sessionId)
    await refreshSessions({ broadcast: true })
    if (currentSessionIdRef.current === sessionId) {
      closeWorkspacePage()
      await startNewGlobalChat()
    }
  }, [currentSessionIdRef, refreshSessions, closeWorkspacePage, startNewGlobalChat, storageRef, taskMapRef])

  const startNewGlobalSession = useCallback(() => {
    closeWorkspacePage()
    void startNewGlobalChat()
  }, [closeWorkspacePage, startNewGlobalChat])

  return {
    loadSession,
    renameSession,
    togglePinSession,
    deleteSession,
    startNewGlobalSession,
  }
}
