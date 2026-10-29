import { useCallback } from 'react'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import { initializePiStorage } from '@/lib/pi-chat'
import { showAlert } from '@/components/ui/confirm-dialog'
import { t } from '@/lib/i18n'
import {
  copyTextToClipboard,
  draftTextFromUserMessage,
  turnEndedWithError,
  rollbackStartIndexFromMessage,
  shouldSaveSession,
  generateForkTitle,
  hasUserMessage,
} from '@/lib/message-utils'
import type { ProjectInfo, RestoredDraft } from '@/lib/types'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { disposeAgentTask } from '@/lib/agent-task-retention'
import { DeferredSessionAgent } from '@/lib/deferred-session-agent'

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

type StartNewChatResult = 'created' | 'reused' | 'cancelled'

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
  const startNewGlobalChat = useCallback(async (): Promise<StartNewChatResult> => {
    if (needsModelSetup) {
      void showAlert(t('modelSetupRequired'))
      return 'cancelled'
    }

    closeWorkspacePage()
    const currentAgent = agentRef.current
    const reusableBlankSession = currentAgent instanceof DeferredSessionAgent
      && !currentAgent.state.isStreaming
      && currentAgent.state.messages.length === 0
      && currentChatScopeRef.current === 'global'
    if (reusableBlankSession) return 'reused'
    setRestoredDraft(undefined)
    clearSessionQueryParam()

    await startDeferredSession({ scope: 'global' })
    return 'created'
  }, [agentRef, currentChatScopeRef, needsModelSetup, setRestoredDraft, closeWorkspacePage, startDeferredSession])

  const startNewProjectChat = useCallback(async (targetProject?: ProjectInfo): Promise<StartNewChatResult> => {
    if (needsModelSetup) {
      void showAlert(t('modelSetupRequired'))
      return 'cancelled'
    }

    closeWorkspacePage()

    const nextProject = targetProject ?? activeProjectRef.current
    if (!nextProject) return 'cancelled'

    const currentAgent = agentRef.current
    const matchesCurrentProject = activeProjectRef.current?.id === nextProject.id
    const reusableBlankSession = matchesCurrentProject
      && currentAgent instanceof DeferredSessionAgent
      && currentAgent.project?.id === nextProject.id
      && !currentAgent.state.isStreaming
      && currentAgent.state.messages.length === 0
      && currentChatScopeRef.current === 'project'
    if (reusableBlankSession) return 'reused'

    if (!matchesCurrentProject) {
      await switchActiveProject(nextProject.id)
    }

    setRestoredDraft(undefined)
    clearSessionQueryParam()

    await startDeferredSession({ scope: 'project', project: nextProject })
    return 'created'
  }, [activeProjectRef, agentRef, currentChatScopeRef, needsModelSetup, setRestoredDraft, closeWorkspacePage, startDeferredSession, switchActiveProject])

  /**
   * 回滚的公共实现。
   *
   * `restoreDraft` 区分两种入口：
   * - true：传统「回滚」——把原文案回填到输入框，等用户自己再发；
   * - false：就地编辑「发送」——只截断历史，新文案由 composer 立即发出
   *   （见 ChatPanelHost 的 onEditMessageAndResend）。
   *
   * 返回是否成功；失败时调用方保持 UI 原状。
   */
  const performRollback = useCallback(async (messageIndex: number, restoreDraft: boolean): Promise<boolean> => {
    const currentAgent = agentRef.current
    if (!currentAgent) return false

    if (currentAgent.state.isStreaming) {
      void showAlert(t('generationStillRunning'))
      return false
    }

    const rollbackIndex = rollbackStartIndexFromMessage(currentAgent.state.messages, messageIndex)
    // -1 仅在空会话时出现：没有可删的消息，静默失败（不弹「没有可回滚」）。
    if (rollbackIndex < 0) return false
    const rollbackMessage = currentAgent.state.messages[rollbackIndex]

    const restoredRollbackDraft = {
      id: Date.now(),
      sessionId: currentAgent.sessionId,
      text: rollbackMessage ? draftTextFromUserMessage(rollbackMessage) : '',
      attachments: rollbackMessage?.role === 'user-with-attachments' ? rollbackMessage.attachments : undefined,
    }

    let nextMessages = currentAgent.state.messages.slice(0, rollbackIndex)
    try {
      const result = await currentAgent.rollback(messageIndex)
      nextMessages = result.session.messages ?? nextMessages
    } catch (error) {
      logger.error('Failed to rollback conversation:', error)
      void showAlert(error instanceof Error ? error.message : t('rollbackFailed'))
      return false
    }

    setCurrentAgentMessages(nextMessages)

    const currentTask = currentSessionIdRef.current
      ? taskMapRef.current.get(currentSessionIdRef.current)
      : undefined

    if (shouldSaveSession(nextMessages) && currentTask) {
      if (restoreDraft) setRestoredDraft(restoredRollbackDraft)
      setChatPanelRevision((value) => value + 1)
      syncSessionUI(currentTask).catch((err) => logger.error('Failed to sync session UI:', err))
      return true
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
      },
    )

    if (restoreDraft) setRestoredDraft({ ...restoredRollbackDraft, sessionId: newSessionId })
    setChatPanelRevision((value) => value + 1)
    return true
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

  const rollbackFromMessage = useCallback(async (messageIndex: number) => {
    await performRollback(messageIndex, true)
  }, [performRollback])

  /**
   * 就地编辑「发送」的截断半步：只移除该条及之后的历史，不回填输入框，
   * 新文案由 ChatPanelHost 立刻交给 composer 发送。
   */
  const rollbackForResend = useCallback(
    (messageIndex: number) => performRollback(messageIndex, false),
    [performRollback],
  )

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
      void showAlert(t('generationAlreadyRunning'))
      return
    }

    const messages = currentAgent.state.messages.slice(0, messageIndex + 1)
    if (!hasUserMessage(messages)) return

    const scope = currentChatScopeRef.current
    const project = scope === 'project' ? activeProjectRef.current : undefined
    const newSessionId = randomId()
    const title = generateForkTitle(messages)

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
        // The new session is persisted by createAgent itself, so the list
        // refresh at the end of createAgent already includes it. Asking for a
        // second round here would only duplicate a refreshSessions round.
        refreshSessions: false,
      },
    )

    // Refresh independently of the storage handle: the server write that makes
    // the fork visible in the session index does not depend on the client's
    // local storage being initialized.
    refreshSessions({ broadcast: true }).catch((error) => logger.error('Failed to refresh sessions:', error))
  }, [activeModelRef, activeProjectRef, agentRef, createAgent, currentChatScopeRef, refreshSessions])

  const retryFromMessage = useCallback(async (messageIndex: number) => {
    const currentAgent = agentRef.current
    if (!currentAgent) return

    if (currentAgent.state.isStreaming) {
      void showAlert(t('generationAlreadyRunning'))
      return
    }

    const messages = currentAgent.state.messages
    if (messageIndex < 0 || messageIndex >= messages.length) return

    const message = messages[messageIndex]
    if (message.role !== 'user' && message.role !== 'user-with-attachments') return

    // A turn that ended with an error may already have run tools: trimming it would
    // erase those tool calls from the model transcript, so the model would redo side
    // effects (file edits, commands) it already performed. Failed turns are retried
    // by keeping the whole history and appending a short continuation message, while
    // successfully completed turns are trimmed and the original message is resent.
    const turnFailed = turnEndedWithError(messages, messageIndex)

    try {
      if (turnFailed) {
        const continueMessage = {
          role: 'user',
          content: t('errorContinueMessage'),
          timestamp: Date.now(),
        } as unknown as AgentMessage
        // `continue` appends the optimistic copy itself (see ServerAgent.continue).
        await currentAgent.continue(continueMessage)
        setChatPanelRevision((value) => value + 1)
      } else {
        // Trim local messages to keep the user message (server will do the same)
        setCurrentAgentMessages(messages.slice(0, messageIndex + 1))
        setChatPanelRevision((value) => value + 1)

        // Continue generation from the user message (server trims + regenerates in place)
        await currentAgent.continue()
      }
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
    rollbackForResend,
    retryFromMessage,
    copyAnswer,
    forkFromMessage,
  }
}
