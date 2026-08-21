import { useCallback } from 'react'
import type { AgentManager } from '@/hooks/useAgentManager'
import type { QuickForgeSessionData, QuickForgeSessionMetadata } from '@/lib/types'
import { initializePiStorage } from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import { showPrompt } from '@/components/ui/prompt-dialog'
import { disposeAgentTask } from '@/lib/agent-task-retention'

type UseSessionActionsOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  taskMapRef: AgentManager['taskMapRef']
  currentSessionIdRef: AgentManager['currentSessionIdRef']
  loadAgentSession: AgentManager['loadSession']
  setCurrentTitleRef: AgentManager['setCurrentTitleRef']
  refreshSessions: (opts?: { broadcast?: boolean }) => Promise<void>
  removeSession: (sessionId: string) => void
  notifySessionsChanged: () => void
  updateSessionTitle: (sessionId: string, title: string) => void
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
  removeSession,
  notifySessionsChanged,
  updateSessionTitle,
  closeWorkspacePage,
  startNewGlobalChat,
}: UseSessionActionsOptions) {
  const loadSession = useCallback((sessionId: string) => {
    closeWorkspacePage()
    return loadAgentSession(sessionId)
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
    const response = await fetch(`/api/agents/${encodeURIComponent(sessionId)}/title`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    })
    if (!response.ok) throw new Error(`Failed to rename session: HTTP ${response.status}`)
    updateSessionTitle(sessionId, newTitle)
    if (currentSessionIdRef.current === sessionId) {
      setCurrentTitleRef(newTitle)
    }
  }, [currentSessionIdRef, setCurrentTitleRef, storageRef, updateSessionTitle])

  const togglePinSession = useCallback(async (sessionId: string) => {
    const storage = storageRef.current
    if (!storage) return
    const metadata = await storage.sessions.getMetadata(sessionId) as QuickForgeSessionMetadata | null
    if (!metadata) return

    const pinnedAt = metadata.pinnedAt ? null : new Date().toISOString()
    const nextMetadata = { ...metadata, pinnedAt }
    await storage.backend.set('sessions-metadata', sessionId, nextMetadata)
    await refreshSessions({ broadcast: true })
  }, [refreshSessions, storageRef])

  const archiveSession = useCallback(async (sessionId: string) => {
    const storage = storageRef.current
    if (!storage) return
    disposeAgentTask(taskMapRef.current, sessionId)

    const session = await storage.sessions.get(sessionId) as QuickForgeSessionData | null
    if (!session) return
    const metadata = await storage.sessions.getMetadata(sessionId) as QuickForgeSessionMetadata | null
    if (!metadata) return

    const archivedAt = new Date().toISOString()
    const nextSession: QuickForgeSessionData = { ...session, archivedAt }
    const nextMetadata: QuickForgeSessionMetadata = { ...metadata, archivedAt }
    await storage.sessions.save(nextSession, nextMetadata)
    removeSession(sessionId)
    notifySessionsChanged()
    if (currentSessionIdRef.current === sessionId) {
      closeWorkspacePage()
      await startNewGlobalChat()
    }
  }, [currentSessionIdRef, removeSession, notifySessionsChanged, closeWorkspacePage, startNewGlobalChat, storageRef, taskMapRef])

  const startNewGlobalSession = useCallback(() => {
    closeWorkspacePage()
    void startNewGlobalChat()
  }, [closeWorkspacePage, startNewGlobalChat])

  return {
    loadSession,
    renameSession,
    togglePinSession,
    archiveSession,
    startNewGlobalSession,
  }
}
