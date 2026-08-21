import { useCallback } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import { initializePiStorage, loadDefaultOptions } from '@/lib/pi-chat'
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
import { disposeAgentTask } from '@/lib/agent-task-retention'
import { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import { ServerAgent } from '@/lib/server-agent'
import { resolveBlankDeferredSessionForNewChat } from '@/lib/deferred-session-harness'

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
  setNeedsModelSetup: React.Dispatch<React.SetStateAction<boolean>>
  switchActiveProject: (projectId: string) => Promise<ProjectInfo>
  closeWorkspacePage: () => void
  setRestoredDraft: React.Dispatch<React.SetStateAction<RestoredDraft | undefined>>
}

function clearSessionQueryParam() {
  const url = new URL(window.location.href)
  url.searchParams.delete('session')
  window.history.replaceState({}, '', url)
}

export type StartNewChatResult = 'created' | 'reused' | 'cancelled'

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
  setNeedsModelSetup,
  switchActiveProject,
  closeWorkspacePage,
  setRestoredDraft,
}: UseChatActionsOptions) {
  const startNewGlobalChat = useCallback(async (): Promise<StartNewChatResult> => {
    if (needsModelSetup) {
      const defaultOptions = storageRef.current ? await loadDefaultOptions(storageRef.current) : {}
      if ((defaultOptions.harness ?? 'quickforge') !== 'opencode') {
        void showAlert(t('modelSetupRequired'))
        return 'cancelled'
      }
      setNeedsModelSetup(false)
    }

    closeWorkspacePage()
    const currentAgent = agentRef.current
    const blankSession = await resolveBlankDeferredSessionForNewChat({
      isDeferredSession: currentAgent instanceof DeferredSessionAgent,
      isStreaming: currentAgent?.state.isStreaming ?? false,
      messageCount: currentAgent?.state.messages.length ?? 0,
      currentScope: currentChatScopeRef.current,
      targetScope: 'global',
      currentHarness: currentAgent?.harness ?? 'quickforge',
    }, async () => {
      const defaultOptions = storageRef.current ? await loadDefaultOptions(storageRef.current) : {}
      return defaultOptions.harness ?? 'quickforge'
    })
    if (blankSession.action === 'reuse') return 'reused'
    if (blankSession.action === 'replace') {
      setRestoredDraft(undefined)
      clearSessionQueryParam()
      await startDeferredSession({ scope: 'global', harness: blankSession.defaultHarness })
      return 'created'
    }
    setRestoredDraft(undefined)
    clearSessionQueryParam()

    await startDeferredSession({ scope: 'global' })
    return 'created'
  }, [agentRef, currentChatScopeRef, needsModelSetup, setNeedsModelSetup, setRestoredDraft, closeWorkspacePage, startDeferredSession, storageRef])

  const startNewProjectChat = useCallback(async (targetProject?: ProjectInfo): Promise<StartNewChatResult> => {
    if (needsModelSetup) {
      const defaultOptions = storageRef.current ? await loadDefaultOptions(storageRef.current) : {}
      if ((defaultOptions.harness ?? 'quickforge') !== 'opencode') {
        void showAlert(t('modelSetupRequired'))
        return 'cancelled'
      }
      setNeedsModelSetup(false)
    }

    closeWorkspacePage()

    const nextProject = targetProject ?? activeProjectRef.current
    if (!nextProject) return 'cancelled'

    const currentAgent = agentRef.current
    const blankSession = await resolveBlankDeferredSessionForNewChat({
      isDeferredSession: currentAgent instanceof DeferredSessionAgent,
      isStreaming: currentAgent?.state.isStreaming ?? false,
      messageCount: currentAgent?.state.messages.length ?? 0,
      currentScope: currentChatScopeRef.current,
      targetScope: 'project',
      currentHarness: currentAgent?.harness ?? 'quickforge',
    }, async () => {
      const defaultOptions = storageRef.current ? await loadDefaultOptions(storageRef.current) : {}
      return defaultOptions.harness ?? 'quickforge'
    })
    const matchesCurrentProject = activeProjectRef.current?.id === nextProject.id
    if (matchesCurrentProject && blankSession.action === 'reuse') return 'reused'
    if (matchesCurrentProject && blankSession.action === 'replace') {
      setRestoredDraft(undefined)
      clearSessionQueryParam()
      await startDeferredSession({ scope: 'project', project: nextProject, harness: blankSession.defaultHarness })
      return 'created'
    }

    if (!matchesCurrentProject) {
      await switchActiveProject(nextProject.id)
    }

    setRestoredDraft(undefined)
    clearSessionQueryParam()

    await startDeferredSession({ scope: 'project', project: nextProject })
    return 'created'
  }, [activeProjectRef, agentRef, currentChatScopeRef, needsModelSetup, setNeedsModelSetup, setRestoredDraft, closeWorkspacePage, startDeferredSession, storageRef, switchActiveProject])

  const rollbackFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.harness === 'opencode') {
      void showAlert(t('openCodeMessageHistoryActionUnavailable'))
      return
    }

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
      disposeAgentTask(taskMapRef.current, previousSessionId)
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
        harness: currentAgent.harness,
        sourceHarnessSessionId: undefined,
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

  /**
   * Fork the entire current OpenCode session (not per-message). The server
   * performs the ACP whole-session fork, persists the new session and announces
   * it through `session_forked`, which switches the view to the new session.
   */
  const forkCurrentSession = useCallback(async () => {
    const currentAgent = agentRef.current
    if (!currentAgent || !(currentAgent instanceof ServerAgent)) return
    if (currentAgent.harness !== 'opencode') return

    if (currentAgent.state.isStreaming) {
      void showAlert(t('generationAlreadyRunning'))
      return
    }
    if (!currentAgent.harnessSessionId) {
      void showAlert(t('openCodeForkUnavailable'))
      return
    }

    try {
      await currentAgent.forkSession()
    } catch (error) {
      logger.error('Failed to fork current conversation:', error)
      void showAlert(error instanceof Error ? error.message : t('openCodeForkFailed'))
      return
    }

    const storage = storageRef.current
    if (storage) {
      refreshSessions({ broadcast: true }).catch((error) => logger.error('Failed to refresh sessions:', error))
    }
  }, [agentRef, refreshSessions, storageRef])

  const forkFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.harness === 'opencode') {
      void showAlert(t('openCodeMessageHistoryActionUnavailable'))
      return
    }

    if (currentAgent.state.isStreaming) {
      void showAlert(t('generationAlreadyRunning'))
      return
    }

    const messages = currentAgent.state.messages.slice(0, messageIndex + 1)
    if (!hasUserMessage(messages)) return

    const scope = currentChatScopeRef.current
    const project = scope === 'project' ? activeProjectRef.current : undefined
    const newSessionId = randomId()
    const title = generateTitle(messages)
    const sourceHarnessSessionId = undefined

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
        harness: currentAgent.harness,
        sourceHarnessSessionId,
      },
    )

    if (storage) {
      refreshSessions({ broadcast: true }).catch((error) => logger.error('Failed to refresh sessions:', error))
    }
  }, [activeModelRef, activeProjectRef, agentRef, createAgent, currentChatScopeRef, refreshSessions, storageRef])

  const retryFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.harness === 'opencode') {
      void showAlert(t('openCodeMessageHistoryActionUnavailable'))
      return
    }

    if (currentAgent.state.isStreaming) {
      void showAlert(t('generationAlreadyRunning'))
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
    forkCurrentSession,
  }
}
