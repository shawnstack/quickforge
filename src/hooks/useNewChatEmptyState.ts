import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createTaskLauncherVisibility } from '@/components/chat/task-launcher-visibility'
import { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import { isBotProject } from '@/lib/bot-project'
import { t } from '@/lib/i18n'
import { pickNewChatGreetingKey } from '@/lib/new-chat-greeting'
import type { ProjectInfo } from '@/lib/types'

export type StartNewChatResult = 'cancelled' | 'reused' | 'created'

type NewChatAgentLike = {
  state: { isStreaming?: boolean; messages: unknown[] }
  subscribe: (listener: (event: { type?: string }) => void) => () => void
} | null

/** 「新对话」空态与新建会话路由（原 MainApp 内联块）。
 *
 *  - 「新对话空态」= 真的没有会话（currentSessionId 为空且无消息）：回滚把已有
 *    会话截断成空消息不是新对话，把它当空态会触发「自动切到项目会话」；
 *  - taskLauncher：显式新建意图的可见性跟踪（begin/complete/invalidate 世代号），
 *    只有从空态真正新建且尚未发言时才显示任务启动器；
 *  - startNew* 三个入口按「默认项目优先、显式全局其次」路由，bot 项目永远
 *    不作为新建对话的落点。
 */
export function useNewChatEmptyState<TAgent extends NewChatAgentLike>(context: {
  needsModelSetup: boolean
  agent: TAgent
  agentRef: RefObject<TAgent>
  currentSessionIdRef: RefObject<string | undefined>
  currentSessionId: string | undefined
  chatScope: 'global' | 'project'
  activeProject: ProjectInfo | undefined
  startNewGlobalChat: () => Promise<StartNewChatResult>
  startNewProjectChat: (project?: ProjectInfo) => Promise<StartNewChatResult>
  selectProjectDirectory: () => void
  createProjectInWorkspace: (name: string) => Promise<ProjectInfo | undefined>
}) {
  const {
    needsModelSetup,
    agent,
    agentRef,
    currentSessionIdRef,
    currentSessionId,
    chatScope,
    activeProject,
    startNewGlobalChat,
    startNewProjectChat,
    selectProjectDirectory,
    createProjectInWorkspace,
  } = context

  const [taskLauncherIntent] = useState(() => createTaskLauncherVisibility<TAgent>())
  const [taskLauncherAgent, setTaskLauncherAgent] = useState<TAgent | null>(null)
  const invalidateTaskLauncher = useCallback(() => {
    taskLauncherIntent.invalidate()
    setTaskLauncherAgent(null)
  }, [taskLauncherIntent])
  const runNewChatWithLauncher = useCallback(async (start: () => Promise<StartNewChatResult>, explicit = true) => {
    const version = taskLauncherIntent.begin()
    const result = await start()
    const startedAgent = agentRef.current
    if (taskLauncherIntent.complete(version, startedAgent, explicit && result !== 'cancelled'
      && startedAgent instanceof DeferredSessionAgent && !currentSessionIdRef.current
      && !startedAgent.state.isStreaming && startedAgent.state.messages.length === 0)) {
      setTaskLauncherAgent(startedAgent)
    }
    return result
  }, [agentRef, currentSessionIdRef, taskLauncherIntent])

  const startNewGlobalChatWithInspectorReset = useCallback(async (...args: Parameters<typeof startNewGlobalChat>) => {
    return startNewGlobalChat(...args)
  }, [startNewGlobalChat])

  const startNewProjectChatWithInspectorReset = useCallback(async (...args: Parameters<typeof startNewProjectChat>) => {
    return runNewChatWithLauncher(() => startNewProjectChat(...args))
  }, [runNewChatWithLauncher, startNewProjectChat])

  useEffect(() => {
    if (currentSessionId) taskLauncherIntent.invalidate()
    return agent?.subscribe((event) => {
      if (event.type === 'message_start' || event.type === 'agent_start') invalidateTaskLauncher()
    })
  }, [agent, currentSessionId, invalidateTaskLauncher, taskLauncherIntent])

  // 用户在新对话空状态主动清除项目预选后，本次空状态内不再默认预选上次激活的项目。
  const [emptyStateProjectDismissed, setEmptyStateProjectDismissed] = useState(false)
  const wasNewChatEmptyStateRef = useRef(false)

  const showNewChatEmptyState = !needsModelSetup
    && Boolean(agent)
    && !agent?.state.isStreaming
    && (agent?.state.messages.length ?? 0) === 0
    && !currentSessionId

  // 随机只在进入新对话空状态时锁定一次，避免重渲染导致文案抖动。
  const newChatGreeting = useMemo(
    () => (showNewChatEmptyState ? t(pickNewChatGreetingKey()) : ''),
    [showNewChatEmptyState],
  )

  // 清除标记只在离开当前新对话空状态后复位，显式 global 新建在本次空状态内保持生效。
  useEffect(() => {
    if (!showNewChatEmptyState && wasNewChatEmptyStateRef.current) {
      setEmptyStateProjectDismissed(false)
    }
    wasNewChatEmptyStateRef.current = showNewChatEmptyState
  }, [showNewChatEmptyState])

  // 默认项目必须进入真实会话状态，不能只在选择器中显示为已选。
  useEffect(() => {
    if (!showNewChatEmptyState || emptyStateProjectDismissed || !activeProject || isBotProject(activeProject) || chatScope !== 'global') return
    if (taskLauncherAgent && taskLauncherAgent === agent) {
      void runNewChatWithLauncher(() => startNewProjectChat(activeProject))
    } else {
      void startNewProjectChat(activeProject)
    }
  }, [activeProject, agent, chatScope, emptyStateProjectDismissed, runNewChatWithLauncher, showNewChatEmptyState, startNewProjectChat, taskLauncherAgent])

  const startNewDefaultSession = useCallback(() => {
    setEmptyStateProjectDismissed(false)
    // bot 目录也注册成了项目，但它不是用户可以「新建对话到这儿」的项目：
    // 否则打开过一次 bot，之后每次点新对话都会落进 bot 的目录里。
    if (activeProject && !isBotProject(activeProject)) {
      void startNewProjectChatWithInspectorReset(activeProject)
      return
    }
    void runNewChatWithLauncher(startNewGlobalChat)
  }, [activeProject, runNewChatWithLauncher, startNewGlobalChat, startNewProjectChatWithInspectorReset])

  const startNewExplicitGlobalSession = useCallback(() => {
    setEmptyStateProjectDismissed(true)
    void runNewChatWithLauncher(startNewGlobalChat)
  }, [runNewChatWithLauncher, startNewGlobalChat])

  const handleSelectEmptyStateProject = useCallback((project: ProjectInfo) => {
    void runNewChatWithLauncher(() => startNewProjectChat(project), taskLauncherAgent === agent)
  }, [agent, runNewChatWithLauncher, startNewProjectChat, taskLauncherAgent])

  const handleClearEmptyStateProject = useCallback(() => {
    setEmptyStateProjectDismissed(true)
    void runNewChatWithLauncher(startNewGlobalChat, taskLauncherAgent === agent)
  }, [agent, runNewChatWithLauncher, startNewGlobalChat, taskLauncherAgent])

  const handleSelectEmptyStateNewProject = useCallback(() => {
    selectProjectDirectory()
  }, [selectProjectDirectory])

  const handleCreateEmptyStateProject = useCallback(
    (name: string) => createProjectInWorkspace(name),
    [createProjectInWorkspace],
  )

  return {
    showNewChatEmptyState,
    newChatGreeting,
    startNewDefaultSession,
    startNewExplicitGlobalSession,
    startNewGlobalChatWithInspectorReset,
    startNewProjectChatWithInspectorReset,
    handleSelectEmptyStateProject,
    handleClearEmptyStateProject,
    handleSelectEmptyStateNewProject,
    handleCreateEmptyStateProject,
    taskLauncherAgent,
    invalidateTaskLauncher,
  }
}
