import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentState } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { logger } from '@/lib/logger'
import { ServerAgent, type ServerAgentContextCompaction } from '@/lib/server-agent'
import {
  defaultThinkingLevelForModel,
  loadDefaultOptions,
  normalizeModelForProvider,
  resolveConfiguredModel,
} from '@/lib/pi-chat'
import {
  generateTitle,
  titleNeedsGeneration,
} from '@/lib/message-utils'
import type {
  BackgroundTask,
  BackgroundTaskStatus,
  ChatScope,
  ProjectInfo,
  QuickForgeSessionData,
  QuickForgeSessionMetadata,
} from '@/lib/types'
import { sessionScope } from '@/lib/types'
import { randomId } from '@/lib/random-id'

export interface AgentManagerDeps {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof import('@/lib/pi-chat').initializePiStorage>> | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  yoloModeRef: React.MutableRefObject<boolean>
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
  setYoloMode: React.Dispatch<React.SetStateAction<boolean>>
  switchActiveProject: (projectId: string) => Promise<ProjectInfo>
  sessions: QuickForgeSessionMetadata[]
  refreshSessions: (opts?: { broadcast?: boolean }) => Promise<void>
  onTaskComplete?: (sessionId: string, title: string, status: BackgroundTaskStatus) => void
}

export interface AgentManager {
  // Refs (stable across renders)
  agentRef: React.MutableRefObject<ServerAgent | null>
  taskMapRef: React.MutableRefObject<Map<string, BackgroundTask>>
  currentSessionIdRef: React.MutableRefObject<string | undefined>
  currentChatScopeRef: React.MutableRefObject<ChatScope>

  // State (may change each render)
  agent: ServerAgent | null
  currentSessionId: string | undefined
  currentTitle: string
  chatScope: ChatScope
  currentToolProject: ProjectInfo | undefined
  taskStatuses: Record<string, BackgroundTaskStatus>
  chatPanelRevision: number

  // Stable callbacks
  createAgent: (
    initialState?: Partial<AgentState> & { contextCompaction?: ServerAgentContextCompaction | null },
    sessionId?: string,
    options?: { scope?: ChatScope; project?: ProjectInfo; attachToView?: boolean; createdAt?: string; title?: string; yoloMode?: boolean },
  ) => Promise<ServerAgent>
  loadSession: (
    sessionId: string,
    hints?: { title?: string; createdAt?: string; scope?: ChatScope; projectId?: string },
  ) => Promise<void>
  syncSessionUI: (task: BackgroundTask) => Promise<void>
  setCurrentAgentMessages: (messages: AgentState['messages']) => void
  updateCurrentAgentModel: (model: Model<Api>) => void
  setCurrentTitleRef: (title: string) => void

  // Stable state setters
  setChatPanelRevision: React.Dispatch<React.SetStateAction<number>>
}

function isCompactSummaryMessage(message: unknown) {
  const typed = message as { role?: string; content?: unknown } | undefined
  if (typed?.role !== 'user') return false
  const content = typed.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((block) => (block as { type?: string })?.type === 'text').map((block) => String((block as { text?: unknown }).text ?? '')).join('\n')
      : ''
  return text.includes('<compact_summary>')
}

function manualCompactionFromMessages(messages: AgentState['messages']): ServerAgentContextCompaction | null {
  const summaryIndex = messages.findIndex(isCompactSummaryMessage)
  if (summaryIndex < 0) return null
  return {
    summaryMessage: messages[summaryIndex] as ServerAgentContextCompaction['summaryMessage'],
    compactedUpToIndex: Math.min(messages.length, summaryIndex + 2),
  }
}

export function useAgentManager(deps: AgentManagerDeps): AgentManager {
  const {
    storageRef,
    activeModelRef,
    yoloModeRef,
    activeProjectRef,
    setYoloMode,
    switchActiveProject,
    sessions,
    refreshSessions,
  } = deps

  // --- Refs (stable) ---
  const agentRef = useRef<ServerAgent | null>(null)
  const taskMapRef = useRef<Map<string, BackgroundTask>>(new Map())
  const currentChatScopeRef = useRef<ChatScope>('global')
  const currentSessionIdRef = useRef<string | undefined>(undefined)
  const currentTitleRef = useRef('New chat')
  const currentCreatedAtRef = useRef<string | undefined>(undefined)
  const loadSessionRef = useRef<AgentManager['loadSession'] | null>(null)
  const onTaskCompleteRef = useRef(deps.onTaskComplete)

  useEffect(() => {
    onTaskCompleteRef.current = deps.onTaskComplete
  })

  // --- State ---
  const [agent, setAgent] = useState<ServerAgent | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>()
  const [currentTitle, setCurrentTitle] = useState('New chat')
  const [chatScope, setChatScope] = useState<ChatScope>('global')
  const [currentToolProject, setCurrentToolProject] = useState<ProjectInfo>()
  const [taskStatuses, setTaskStatuses] = useState<Record<string, BackgroundTaskStatus>>({})
  const [chatPanelRevision, setChatPanelRevision] = useState(0)

  // --- Sync session UI after agent events ---
  const syncSessionUI = useCallback(
    async (task: BackgroundTask) => {
      if (currentSessionIdRef.current === task.sessionId) {
        const messages = task.agent.state.messages
        let title = task.title
        if (titleNeedsGeneration(title)) {
          title = generateTitle(messages)
        }
        currentCreatedAtRef.current = task.createdAt ?? new Date().toISOString()
        currentTitleRef.current = title
        setCurrentTitle(title)
      }
      await refreshSessions({ broadcast: true })
    },
    [refreshSessions],
  )

  // --- Attach a task to the current view ---
  const attachTaskToView = useCallback((task: BackgroundTask) => {
    currentChatScopeRef.current = task.scope
    currentSessionIdRef.current = task.sessionId
    currentCreatedAtRef.current = task.createdAt
    currentTitleRef.current = task.title
    setChatScope(task.scope)
    setCurrentSessionId(task.sessionId)
    setCurrentTitle(task.title)
    setCurrentToolProject(task.project)
    agentRef.current = task.agent
    setAgent(task.agent)

    const url = new URL(window.location.href)
    url.searchParams.set('session', task.sessionId)
    window.history.replaceState({}, '', url)
  }, [])

  // --- Create or retrieve an agent ---
  const createAgent = useCallback(
    async (
      initialState?: Partial<AgentState> & { contextCompaction?: ServerAgentContextCompaction | null },
      sessionId: string = randomId(),
      options?: { scope?: ChatScope; project?: ProjectInfo; attachToView?: boolean; createdAt?: string; title?: string; yoloMode?: boolean },
    ) => {
      const existingTask = taskMapRef.current.get(sessionId)
      if (existingTask) {
        if (options?.attachToView !== false) attachTaskToView(existingTask)
        return existingTask.agent
      }

      const scope = options?.scope ?? currentChatScopeRef.current
      const project = scope === 'project' ? (options?.project ?? activeProjectRef.current) : undefined
      const startedAt = new Date().toISOString()

      const {
        model: requestedModel,
        thinkingLevel: requestedThinkingLevel,
        tools: _requestedTools,
        ...restInitialState
      } = initialState ?? {}
      void _requestedTools
      const storage = storageRef.current
      const defaultOptions = storage ? await loadDefaultOptions(storage) : {}
      const requestedOrDefaultModel = requestedModel ?? defaultOptions.model ?? activeModelRef.current
      const resolvedModel = storage
        ? await resolveConfiguredModel(storage, requestedOrDefaultModel as Model<Api>)
        : normalizeModelForProvider(requestedOrDefaultModel as Model<Api>)
      const resolvedThinkingLevel = requestedThinkingLevel ?? defaultOptions.thinkingLevel ?? defaultThinkingLevelForModel(resolvedModel)
      activeModelRef.current = resolvedModel
      const resolvedYoloMode = options?.yoloMode ?? yoloModeRef.current
      yoloModeRef.current = resolvedYoloMode
      setYoloMode(resolvedYoloMode)

      const nextAgent = await ServerAgent.create(sessionId, {
        scope,
        projectId: project?.id,
        yoloMode: resolvedYoloMode,
        model: resolvedModel,
        thinkingLevel: resolvedThinkingLevel,
        messages: (restInitialState as { messages?: AgentState['messages'] }).messages ?? [],
        title: options?.title,
      })

      if (restInitialState.contextCompaction && !nextAgent.state.contextCompaction) {
        nextAgent.state.contextCompaction = restInitialState.contextCompaction
      }

      const initialStatus: BackgroundTaskStatus = nextAgent.state.isStreaming
        ? 'running'
        : nextAgent.state.errorMessage
          ? 'error'
          : 'idle'

      const task: BackgroundTask = {
        sessionId: nextAgent.sessionId,
        agent: nextAgent,
        scope,
        project,
        title: options?.title ?? 'New chat',
        createdAt: options?.createdAt ?? startedAt,
        status: initialStatus,
        startedAt,
        unsubscribe: () => undefined,
      }

      task.unsubscribe = nextAgent.subscribe((event) => {
        if (event.type === 'agent_start') {
          task.status = 'running'
          task.startedAt = task.startedAt ?? new Date().toISOString()
          task.finishedAt = undefined
          setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))
        }

        if (event.type === 'message_end') {
          nextAgent.state.messages = [...nextAgent.state.messages]
        }

        if (event.type === 'agent_end') {
          const wasRunning = task.status === 'running'
          task.status = nextAgent.state.errorMessage ? 'error' : 'idle'
          task.finishedAt = new Date().toISOString()
          setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))
          // NOTE: Do NOT bump chatPanelRevision here — the ChatPanel is already
          // showing the latest messages via the agent state.  Destroying /
          // recreating the panel on every agent_end causes a visual flash where
          // messages disappear then reappear.
          syncSessionUI(task).catch((err) => logger.error('Failed to sync session UI:', err))
          if (wasRunning) {
            onTaskCompleteRef.current?.(task.sessionId, task.title, task.status)
          }
        }

        if ((event as { type: string }).type === 'title_updated') {
          const titleEvent = event as unknown as { type: 'title_updated'; title: string }
          if (titleEvent.title) task.title = titleEvent.title
          if (task.sessionId === currentSessionIdRef.current && titleEvent.title) {
            currentTitleRef.current = titleEvent.title
            setCurrentTitle(titleEvent.title)
          }
          refreshSessions({ broadcast: true }).catch((err) => logger.error('Failed to refresh sessions:', err))
        }

        if ((event as { type: string }).type === 'session_forked') {
          const forkEvent = event as unknown as {
            type: 'session_forked'
            targetSessionId?: string
            title?: string
            createdAt?: string
            scope?: ChatScope
            projectId?: string | null
          }
          if (!forkEvent.targetSessionId) return
          refreshSessions({ broadcast: true }).catch((err) => logger.error('Failed to refresh sessions:', err))
          void loadSessionRef.current?.(forkEvent.targetSessionId, {
            title: forkEvent.title,
            createdAt: forkEvent.createdAt,
            scope: forkEvent.scope,
            projectId: forkEvent.projectId ?? undefined,
          })
        }
      })

      taskMapRef.current.set(sessionId, task)
      if (task.status !== 'idle') {
        setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))
      }

      if (options?.attachToView !== false) attachTaskToView(task)
      if (nextAgent.state.messages.length > 0) {
        await refreshSessions({ broadcast: true })
      }
      return nextAgent
    },
    [attachTaskToView, refreshSessions, syncSessionUI, storageRef, activeModelRef, yoloModeRef, activeProjectRef, setYoloMode],
  )

  // --- Load a persisted session ---
  const loadSession = useCallback(
    async (
      sessionId: string,
      hints?: { title?: string; createdAt?: string; scope?: ChatScope; projectId?: string },
    ) => {
      const runningTask = taskMapRef.current.get(sessionId)
      if (runningTask) {
        if (runningTask.scope === 'project' && runningTask.project?.id && activeProjectRef.current?.id !== runningTask.project.id) {
          try {
            await switchActiveProject(runningTask.project.id)
          } catch (error) {
            logger.error('Failed to switch project for running session:', error)
          }
        }
        attachTaskToView(runningTask)
        return
      }

      const storage = storageRef.current
      if (!storage) {
        await createAgent(
          { tools: [] },
          sessionId,
          {
            scope: hints?.scope ?? 'global',
            attachToView: true,
            createdAt: hints?.createdAt,
            title: hints?.title,
          },
        )
        return
      }

      const session = (await storage.sessions.get(sessionId)) as QuickForgeSessionData | null
      if (!session) return

      const metadata = sessions.find((item) => item.id === sessionId) ?? ((await storage.sessions.getMetadata(sessionId)) as QuickForgeSessionMetadata | null)
      const scope = hints?.scope ?? sessionScope(metadata ?? session)
      const scopedProjectId = hints?.projectId ?? metadata?.projectId ?? session.projectId
      let project: ProjectInfo | undefined
      if (scope === 'project' && scopedProjectId) {
        const projectId = scopedProjectId
        if (activeProjectRef.current?.id !== projectId) {
          try {
            project = await switchActiveProject(projectId)
          } catch (error) {
            logger.error('Failed to switch project for session:', error)
            alert('Failed to switch project')
            return
          }
        } else {
          project = activeProjectRef.current
        }
      }

      activeModelRef.current = session.model as Model<Api>

      await createAgent(
        {
          model: session.model,
          thinkingLevel: session.thinkingLevel,
          messages: session.messages,
          contextCompaction: manualCompactionFromMessages(session.messages),
        },
        session.id,
        {
          scope,
          project,
          attachToView: true,
          createdAt: session.createdAt ?? hints?.createdAt,
          title: session.title ?? hints?.title,
          yoloMode: session.yoloMode === true,
        },
      )
    },
    [attachTaskToView, createAgent, sessions, switchActiveProject, storageRef, activeModelRef, activeProjectRef],
  )

  useEffect(() => {
    loadSessionRef.current = loadSession
  }, [loadSession])

  // --- Mutations (exposed for App.tsx callbacks) ---
  const setCurrentAgentMessages = useCallback((messages: AgentState['messages']) => {
    if (agentRef.current) {
      agentRef.current.state.messages = messages
    }
  }, [])

  const updateCurrentAgentModel = useCallback((model: Model<Api>) => {
    if (agentRef.current) {
      agentRef.current.state.model = model
      void agentRef.current.updateModel(model).catch((error) => {
        logger.error('Failed to sync model to server:', error)
      })
    }
  }, [])

  const setCurrentTitleRef = useCallback((title: string) => {
    currentTitleRef.current = title
  }, [])

  return {
    agentRef,
    taskMapRef,
    currentSessionIdRef,
    currentChatScopeRef,

    agent,
    currentSessionId,
    currentTitle,
    chatScope,
    currentToolProject,
    taskStatuses,
    chatPanelRevision,

    createAgent,
    loadSession,
    syncSessionUI,
    setChatPanelRevision,

    setCurrentAgentMessages,
    updateCurrentAgentModel,
    setCurrentTitleRef,
  }
}
