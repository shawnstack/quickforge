import { useCallback } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import { initializePiStorage } from '@/lib/pi-chat'
import { showAlert } from '@/components/ui/confirm-dialog'
import { t } from '@/lib/i18n'
import {
  copyTextToClipboard,
  draftTextFromUserMessage,
  rollbackStartIndexFromMessage,
  shouldSaveSession,
  generateTitle,
  hasUserMessage,
} from '@/lib/message-utils'
import type { ProjectInfo, RestoredDraft } from '@/lib/types'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'

type UseChatActionsOptions = {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof initializePiStorage>> | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
  currentChatScopeRef: AgentManager['currentChatScopeRef']
  currentSessionIdRef: AgentManager['currentSessionIdRef']
  taskMapRef: AgentManager['taskMapRef']
  agentRef: AgentManager['agentRef']
  startDeferredSession: AgentManager['startDeferredSession']
  createAgent: AgentManager['createAgent']
  syncSessionUI: AgentManager['syncSessionUI']
  setCurrentAgentMessages: AgentManager['setCurrentAgentMessages']
  setChatPanelRevision: AgentManager['setChatPanelRevision']
  refreshSessions: (opts?: { broadcast?: boolean }) => Promise<void>
  needsModelSetup: boolean
  switchActiveProject: (projectId: string) => Promise<ProjectInfo>
  closeWorkspacePage: () => void
  setRestoredDraft: React.Dispatch<React.SetStateAction<RestoredDraft | undefined>>
}

function clearSessionQueryParam() {
  const url = new URL(window.location.href)
  url.searchParams.delete('session')
  window.history.replaceState({}, '', url)
}

function isIdleEmptyAgent(agent: AgentManager['agentRef']['current']) {
  return Boolean(agent && !agent.state.isStreaming && agent.state.messages.length === 0)
}

export function useChatActions({
  storageRef,
  activeModelRef,
  activeProjectRef,
  currentChatScopeRef,
  currentSessionIdRef,
  taskMapRef,
  agentRef,
  startDeferredSession,
  createAgent,
  syncSessionUI,
  setCurrentAgentMessages,
  setChatPanelRevision,
  refreshSessions,
  needsModelSetup,
  switchActiveProject,
  closeWorkspacePage,
  setRestoredDraft,
}: UseChatActionsOptions) {
  const startNewGlobalChat = useCallback(async () => {
    if (needsModelSetup) {
      void showAlert(t('modelSetupRequired'))
      return
    }

    closeWorkspacePage()
    if (isIdleEmptyAgent(agentRef.current) && currentChatScopeRef.current === 'global') {
      return
    }
    setRestoredDraft(undefined)
    clearSessionQueryParam()

    await startDeferredSession({ scope: 'global' })
  }, [agentRef, currentChatScopeRef, needsModelSetup, setRestoredDraft, closeWorkspacePage, startDeferredSession])

  const startNewProjectChat = useCallback(async (targetProject?: ProjectInfo) => {
    if (needsModelSetup) {
      void showAlert(t('modelSetupRequired'))
      return
    }

    closeWorkspacePage()

    const nextProject = targetProject ?? activeProjectRef.current
    if (!nextProject) return

    if (isIdleEmptyAgent(agentRef.current) && currentChatScopeRef.current === 'project' && activeProjectRef.current?.id === nextProject.id) {
      return
    }

    if (activeProjectRef.current?.id !== nextProject.id) {
      await switchActiveProject(nextProject.id)
    }

    setRestoredDraft(undefined)
    clearSessionQueryParam()

    await startDeferredSession({ scope: 'project', project: nextProject })
  }, [activeProjectRef, agentRef, currentChatScopeRef, needsModelSetup, setRestoredDraft, closeWorkspacePage, startDeferredSession, switchActiveProject])

  const rollbackFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.state.isStreaming) {
      void showAlert(t('generationStillRunning'))
      return
    }

    const rollbackIndex = rollbackStartIndexFromMessage(currentAgent.state.messages, messageIndex)
    const rollbackMessage = rollbackIndex >= 0 ? currentAgent.state.messages[rollbackIndex] : undefined
    if (rollbackIndex < 0 || !rollbackMessage) {
      void showAlert(t('noConversationTurnToRollback'))
      return
    }

    const restoredRollbackDraft = {
      id: Date.now(),
      sessionId: currentAgent.sessionId,
      text: draftTextFromUserMessage(rollbackMessage),
      attachments: rollbackMessage.role === 'user-with-attachments' ? rollbackMessage.attachments : undefined,
    }

    let nextMessages = currentAgent.state.messages.slice(0, rollbackIndex)
    try {
      const result = await currentAgent.rollback(messageIndex)
      nextMessages = result.session.messages ?? nextMessages
    } catch (error) {
      logger.error('Failed to rollback conversation:', error)
      void showAlert(error instanceof Error ? error.message : t('rollbackFailed'))
      return
    }

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

    const newSessionId = randomId()
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

    setRestoredDraft({ ...restoredRollbackDraft, sessionId: newSessionId })
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
      void showAlert(t('copyFailed'))
      throw error
    }
  }, [])

  const forkFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.state.isStreaming) {
      void showAlert(t('generationStillRunning'))
      return
    }

    const messages = currentAgent.state.messages.slice(0, messageIndex + 1)
    if (!hasUserMessage(messages)) return

    const scope = currentChatScopeRef.current
    const project = scope === 'project' ? activeProjectRef.current : undefined
    const newSessionId = randomId()
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

  const retryFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.state.isStreaming) {
      void showAlert(t('generationStillRunning'))
      return
    }

    const messages = currentAgent.state.messages
    if (messageIndex < 0 || messageIndex >= messages.length) return

    const message = messages[messageIndex]
    if (message.role !== 'user' && message.role !== 'user-with-attachments') return

    // Trim local messages to keep the user message (server will do the same)
    const nextMessages = messages.slice(0, messageIndex + 1)
    setCurrentAgentMessages(nextMessages)
    setChatPanelRevision((value) => value + 1)

    // Continue generation from the user message (server trims + regenerates in place)
    try {
      await currentAgent.continue()
    } catch (error) {
      logger.error('Failed to retry:', error)
      void showAlert(error instanceof Error ? error.message : t('retryFailed'))
      return
    }

    // Sync session UI after regeneration
    const currentTask = currentSessionIdRef.current
      ? taskMapRef.current.get(currentSessionIdRef.current)
      : undefined
    if (currentTask) {
      syncSessionUI(currentTask).catch((err) => logger.error('Failed to sync session UI after retry:', err))
      setChatPanelRevision((value) => value + 1)
    }
  }, [agentRef, currentSessionIdRef, setChatPanelRevision, setCurrentAgentMessages, syncSessionUI, taskMapRef])

  return {
    startNewGlobalChat,
    startNewProjectChat,
    rollbackFromMessage,
    retryFromMessage,
    copyAnswer,
    forkFromMessage,
  }
}
