import { useCallback } from 'react'
import type { Api, Model } from '@mariozechner/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import { initializePiStorage } from '@/lib/pi-chat'
import { t } from '@/lib/i18n'
import {
  copyTextToClipboard,
  draftTextFromUserMessage,
  rollbackConversationFromMessage,
  rollbackStartIndexFromMessage,
  shouldSaveSession,
  generateTitle,
  hasUserMessage,
} from '@/lib/message-utils'
import type { ProjectInfo, RestoredDraft } from '@/lib/types'
import { logger } from '@/lib/logger'

type UseChatActionsOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
  currentChatScopeRef: AgentManager['currentChatScopeRef']
  currentSessionIdRef: AgentManager['currentSessionIdRef']
  taskMapRef: AgentManager['taskMapRef']
  agentRef: AgentManager['agentRef']
  createAgent: AgentManager['createAgent']
  syncSessionUI: AgentManager['syncSessionUI']
  setCurrentAgentMessages: AgentManager['setCurrentAgentMessages']
  setChatPanelRevision: AgentManager['setChatPanelRevision']
  refreshSessions: (opts?: { broadcast?: boolean }) => Promise<void>
  needsModelSetup: boolean
  switchActiveProject: (projectId: string) => Promise<ProjectInfo>
  setScheduledTasksOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRestoredDraft: React.Dispatch<React.SetStateAction<RestoredDraft | undefined>>
}

function clearSessionQueryParam() {
  const url = new URL(window.location.href)
  url.searchParams.delete('session')
  window.history.replaceState({}, '', url)
}

export function useChatActions({
  storageRef,
  activeModelRef,
  activeProjectRef,
  currentChatScopeRef,
  currentSessionIdRef,
  taskMapRef,
  agentRef,
  createAgent,
  syncSessionUI,
  setCurrentAgentMessages,
  setChatPanelRevision,
  refreshSessions,
  needsModelSetup,
  switchActiveProject,
  setScheduledTasksOpen,
  setRestoredDraft,
}: UseChatActionsOptions) {
  const startNewGlobalChat = useCallback(async () => {
    if (needsModelSetup) {
      alert(t('modelSetupRequired'))
      return
    }

    setScheduledTasksOpen(false)

    const sessionId = crypto.randomUUID()
    clearSessionQueryParam()

    await createAgent(
      { tools: [] },
      sessionId,
      { scope: 'global', attachToView: true },
    )
  }, [createAgent, needsModelSetup, setScheduledTasksOpen])

  const startNewProjectChat = useCallback(async (targetProject?: ProjectInfo) => {
    if (needsModelSetup) {
      alert(t('modelSetupRequired'))
      return
    }

    setScheduledTasksOpen(false)

    const nextProject = targetProject ?? activeProjectRef.current
    if (!nextProject) return

    if (activeProjectRef.current?.id !== nextProject.id) {
      await switchActiveProject(nextProject.id)
    }

    const sessionId = crypto.randomUUID()
    clearSessionQueryParam()

    await createAgent(
      { tools: [] },
      sessionId,
      { scope: 'project', project: nextProject, attachToView: true },
    )
  }, [activeProjectRef, createAgent, needsModelSetup, setScheduledTasksOpen, switchActiveProject])

  const rollbackFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.state.isStreaming) {
      alert(t('generationStillRunning'))
      return
    }

    const rollbackIndex = rollbackStartIndexFromMessage(currentAgent.state.messages, messageIndex)
    const rollbackMessage = rollbackIndex >= 0 ? currentAgent.state.messages[rollbackIndex] : undefined
    const nextMessages = rollbackConversationFromMessage(currentAgent.state.messages, messageIndex)
    if (nextMessages.length === currentAgent.state.messages.length) {
      alert(t('noConversationTurnToRollback'))
      return
    }

    const restoredRollbackDraft = rollbackMessage
      ? {
          id: Date.now(),
          text: draftTextFromUserMessage(rollbackMessage),
          attachments: rollbackMessage.role === 'user-with-attachments' ? rollbackMessage.attachments : undefined,
        }
      : undefined

    setCurrentAgentMessages(nextMessages)

    const currentTask = currentSessionIdRef.current
      ? taskMapRef.current.get(currentSessionIdRef.current)
      : undefined

    if (shouldSaveSession(nextMessages) && currentTask) {
      if (restoredRollbackDraft) setRestoredDraft(restoredRollbackDraft)
      setChatPanelRevision((value) => value + 1)
      syncSessionUI(currentTask).catch((err) => logger.error('Failed to sync session UI:', err))
      return
    }

    const storage = storageRef.current
    const previousSessionId = currentSessionIdRef.current
    const scope = currentChatScopeRef.current
    const project = scope === 'project' ? activeProjectRef.current : undefined
    const model = currentAgent.state.model ?? activeModelRef.current
    const thinkingLevel = currentAgent.state.thinkingLevel

    if (previousSessionId) {
      const task = taskMapRef.current.get(previousSessionId)
      task?.unsubscribe()
      task?.agent.dispose()
      taskMapRef.current.delete(previousSessionId)
    }

    if (storage && previousSessionId) {
      try {
        await storage.sessions.delete(previousSessionId)
        await refreshSessions({ broadcast: true })
      } catch (error) {
        logger.error('Failed to delete rolled back empty session:', error)
      }
    }

    const newSessionId = crypto.randomUUID()
    await createAgent(
      {
        model,
        thinkingLevel,
        messages: [],
        tools: [],
      },
      newSessionId,
      {
        scope,
        project,
        attachToView: true,
        title: 'New chat',
      },
    )

    if (restoredRollbackDraft) setRestoredDraft(restoredRollbackDraft)
    setChatPanelRevision((value) => value + 1)
  }, [
    activeModelRef,
    activeProjectRef,
    agentRef,
    createAgent,
    currentChatScopeRef,
    currentSessionIdRef,
    refreshSessions,
    setChatPanelRevision,
    setCurrentAgentMessages,
    setRestoredDraft,
    storageRef,
    syncSessionUI,
    taskMapRef,
  ])

  const copyAnswer = useCallback(async (text: string) => {
    try {
      await copyTextToClipboard(text)
    } catch (error) {
      logger.error('Failed to copy answer:', error)
      alert(t('copyFailed'))
      throw error
    }
  }, [])

  const forkFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.state.isStreaming) {
      alert(t('generationStillRunning'))
      return
    }

    const messages = currentAgent.state.messages.slice(0, messageIndex + 1)
    if (!hasUserMessage(messages)) return

    const scope = currentChatScopeRef.current
    const project = scope === 'project' ? activeProjectRef.current : undefined
    const newSessionId = crypto.randomUUID()
    const title = generateTitle(messages)

    const storage = storageRef.current

    await createAgent(
      {
        model: currentAgent.state.model ?? activeModelRef.current,
        thinkingLevel: currentAgent.state.thinkingLevel,
        messages,
        tools: [],
      },
      newSessionId,
      {
        scope,
        project,
        attachToView: true,
        title,
      },
    )

    if (storage) {
      refreshSessions({ broadcast: true }).catch((error) => logger.error('Failed to refresh sessions:', error))
    }
  }, [activeModelRef, activeProjectRef, agentRef, createAgent, currentChatScopeRef, refreshSessions, storageRef])

  return {
    startNewGlobalChat,
    startNewProjectChat,
    rollbackFromMessage,
    copyAnswer,
    forkFromMessage,
  }
}
