import { useCallback } from 'react'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentManager } from '@/hooks/useAgentManager'
import { showAlert } from '@/components/ui/confirm-dialog'
import { t } from '@/lib/i18n'
import {
  copyTextToClipboard,
  draftTextFromUserMessage,
  turnEndedWithError,
  rollbackStartIndexFromMessage,
  generateForkTitle,
  hasUserMessage,
} from '@/lib/message-utils'
import type { ProjectInfo, RestoredDraft } from '@/lib/types'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import { resolveAttachmentsForDraft, resolveMessagesForUpload } from '@/components/chat/surface/attachment-client'

type UseChatActionsOptions = {
  activeModelRef: React.MutableRefObject<Model<Api>>
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
  currentChatScopeRef: AgentManager['currentChatScopeRef']
  currentSessionIdRef: AgentManager['currentSessionIdRef']
  taskMapRef: AgentManager['taskMapRef']
  agentRef: AgentManager['agentRef']
  startDeferredSession: AgentManager['startDeferredSession']
  createAgent: AgentManager['createAgent']
  syncSessionUI: AgentManager['syncSessionUI']
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
  activeModelRef,
  activeProjectRef,
  currentChatScopeRef,
  currentSessionIdRef,
  taskMapRef,
  agentRef,
  startDeferredSession,
  createAgent,
  syncSessionUI,
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

    // Projected history carries attachment references, not bytes; rehydrate
    // before handing the draft back to the composer.
    let rollbackAttachments
    try {
      rollbackAttachments = rollbackMessage?.role === 'user-with-attachments'
        ? await resolveAttachmentsForDraft(rollbackMessage.attachments)
        : undefined
    } catch (error) {
      logger.error('Failed to resolve rollback attachments:', error)
      void showAlert(error instanceof Error ? error.message : t('rollbackFailed'))
      return false
    }

    const restoredRollbackDraft = {
      id: Date.now(),
      sessionId: currentAgent.sessionId,
      text: rollbackMessage ? draftTextFromUserMessage(rollbackMessage) : '',
      attachments: rollbackAttachments,
    }

    try {
      // 服务端返回的全量历史已由 agent 自己按「全量坐标」采纳（见
      // `ServerAgent.rollback`）：这里只关心是否成功，绝不另写消息数组——
      // 那条旁路会把「数组」和「窗口起点」拆开。
      await currentAgent.rollback(messageIndex)
    } catch (error) {
      logger.error('Failed to rollback conversation:', error)
      void showAlert(error instanceof Error ? error.message : t('rollbackFailed'))
      return false
    }

    const currentTask = currentSessionIdRef.current
      ? taskMapRef.current.get(currentSessionIdRef.current)
      : undefined

    // 回滚只截断历史，会话原地保留——「回滚填回输入框」与「就地编辑重发」两种
    // 入口走同一条收尾路径。
    //
    // 旧实现对传统回滚额外做了「删旧会话 + createAgent 新会话」：`shouldSaveSession`
    // 为 false（截断后没有 user+assistant）就重建一个空会话。这会带来三个连锁问题：
    // 1. 会话 id 变更，分享链接、引用、外部记录全部失效；
    // 2. 列表项先删后插，任务/项目列表都会抖一下；
    // 3. `attachToView` 会 replaceState 写入新的 `?session=`，表现为「跳回新对话页」；
    //    在 global scope 下还会触发「空态自动切项目会话」，看起来像被弹走。
    //
    // 会话去留不再由 scope 决定：project 与 global 都保留原会话，行为一致。
    if (restoreDraft) setRestoredDraft(restoredRollbackDraft)
    setChatPanelRevision((value) => value + 1)
    if (currentTask) {
      syncSessionUI(currentTask).catch((err) => logger.error('Failed to sync session UI:', err))
    }
    return true
  }, [
    agentRef,
    currentSessionIdRef,
    setChatPanelRevision,
    setRestoredDraft,
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

    // The fork payload becomes the new session's stored history, so projected
    // attachment references must be materialized before the upload.
    const forkMessages = await resolveMessagesForUpload(messages)
    const scope = currentChatScopeRef.current
    const project = scope === 'project' ? activeProjectRef.current : undefined
    const newSessionId = randomId()
    const title = generateForkTitle(messages)

    await createAgent(
      {
        model: currentAgent.state.model ?? activeModelRef.current,
        thinkingLevel: currentAgent.state.thinkingLevel,
        messages: forkMessages,
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
        // Trim local messages to keep the user message (server will do the same).
        // 走 agent 的截断入口而不是直接写数组：`baseSeq` 必须跟着数组一起成立。
        currentAgent.trimTrailingMessages(messageIndex + 1)
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
  }, [agentRef, currentSessionIdRef, setChatPanelRevision, syncSessionUI, taskMapRef])

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
