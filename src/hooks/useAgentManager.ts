import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentState } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { ServerAgent } from '@/lib/server-agent'
import {
  normalizeModelForProvider,
  resolveConfiguredModel,
} from '@/lib/pi-chat'
import {
  buildSystemPrompt,
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
  RestoredDraft,
} from '@/lib/types'
import { sessionScope } from '@/lib/types'

export interface AgentManagerDeps {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof import('@/lib/pi-chat').initializePiStorage>> | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  yoloModeRef: React.MutableRefObject<boolean>
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
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
  currentTitleRef: React.MutableRefObject<string>
  currentChatScopeRef: React.MutableRefObject<ChatScope>

  // State (may change each render)
  agent: ServerAgent | null
  currentSessionId: string | undefined
  currentTitle: string
  chatScope: ChatScope
  currentToolProject: ProjectInfo | undefined
  taskStatuses: Record<string, BackgroundTaskStatus>
  chatPanelRevision: number
  restoredDraft: RestoredDraft | undefined

  // Stable callbacks
  createAgent: (
    initialState?: Partial<AgentState>,
    sessionId?: string,
    options?: { scope?: ChatScope; project?: ProjectInfo; attachToView?: boolean; createdAt?: string; title?: string },
  ) => Promise<ServerAgent>
  loadSession: (sessionId: string) => Promise<void>
  attachTaskToView: (task: BackgroundTask) => void
  syncSessionUI: (task: BackgroundTask) => Promise<void>
  setCurrentAgentMessages: (messages: AgentState['messages']) => void
  updateCurrentAgentModel: (model: Model<Api>) => void
  setCurrentTitleRef: (title: string) => void

  // Stable state setters
  setChatPanelRevision: React.Dispatch<React.SetStateAction<number>>
  setRestoredDraft: React.Dispatch<React.SetStateAction<RestoredDraft | undefined>>
}

export function useAgentManager(deps: AgentManagerDeps): AgentManager {
  const {
    storageRef,
    activeModelRef,
    yoloModeRef,
    activeProjectRef,
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
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()

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
      initialState?: Partial<AgentState>,
      sessionId: string = crypto.randomUUID(),
      options?: { scope?: ChatScope; project?: ProjectInfo; attachToView?: boolean; createdAt?: string; title?: string },
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
      const resolvedModel = storage
        ? await resolveConfiguredModel(storage, (requestedModel ?? activeModelRef.current) as Model<Api>)
        : normalizeModelForProvider((requestedModel ?? activeModelRef.current) as Model<Api>)
      const resolvedThinkingLevel = requestedThinkingLevel ?? (resolvedModel.reasoning ? 'medium' : 'off')
      activeModelRef.current = resolvedModel

      const nextAgent = await ServerAgent.create(sessionId, {
        scope,
        projectId: project?.id,
        yoloMode: yoloModeRef.current,
        model: resolvedModel,
        thinkingLevel: resolvedThinkingLevel,
        messages: (restInitialState as { messages?: AgentState['messages'] }).messages ?? [],
        title: options?.title,
      })

      const task: BackgroundTask = {
        sessionId,
        agent: nextAgent,
        scope,
        project,
        title: options?.title ?? 'New chat',
        createdAt: options?.createdAt,
        status: 'idle',
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
          if (task.sessionId === currentSessionIdRef.current) {
            window.setTimeout(() => setChatPanelRevision((value) => value + 1), 0)
          }
          syncSessionUI(task).catch((err) => console.error('Failed to sync session UI:', err))
          if (wasRunning) {
            onTaskCompleteRef.current?.(task.sessionId, task.title, task.status)
          }
        }

        if ((event as { type: string }).type === 'title_updated') {
          const titleEvent = event as unknown as { type: 'title_updated'; title: string }
          if (task.sessionId === currentSessionIdRef.current && titleEvent.title) {
            currentTitleRef.current = titleEvent.title
            setCurrentTitle(titleEvent.title)
          }
          refreshSessions({ broadcast: true }).catch((err) => console.error('Failed to refresh sessions:', err))
        }
      })

      taskMapRef.current.set(sessionId, task)
      setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))

      if (options?.attachToView !== false) attachTaskToView(task)
      await refreshSessions({ broadcast: true })
      return nextAgent
    },
    [attachTaskToView, refreshSessions, syncSessionUI, storageRef, activeModelRef, yoloModeRef, activeProjectRef],
  )

  // --- Load a persisted session ---
  const loadSession = useCallback(
    async (sessionId: string) => {
      const runningTask = taskMapRef.current.get(sessionId)
      if (runningTask) {
        if (runningTask.scope === 'project' && runningTask.project?.id && activeProjectRef.current?.id !== runningTask.project.id) {
          try {
            await switchActiveProject(runningTask.project.id)
          } catch (error) {
            console.error('Failed to switch project for running session:', error)
          }
        }
        attachTaskToView(runningTask)
        return
      }

      const storage = storageRef.current
      if (!storage) return

      const session = (await storage.sessions.get(sessionId)) as QuickForgeSessionData | null
      if (!session) return

      const metadata = sessions.find((item) => item.id === sessionId) ?? ((await storage.sessions.getMetadata(sessionId)) as QuickForgeSessionMetadata | null)
      const scope = sessionScope(metadata ?? session)
      let project: ProjectInfo | undefined
      if (scope === 'project' && (metadata?.projectId || session.projectId)) {
        const projectId = (metadata?.projectId ?? session.projectId)!
        if (activeProjectRef.current?.id !== projectId) {
          try {
            project = await switchActiveProject(projectId)
          } catch (error) {
            console.error('Failed to switch project for session:', error)
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
          systemPrompt: await buildSystemPrompt(),
          model: session.model,
          thinkingLevel: session.thinkingLevel,
          messages: session.messages,
          tools: [],
        },
        session.id,
        {
          scope,
          project,
          attachToView: true,
          createdAt: session.createdAt,
          title: session.title,
        },
      )
    },
    [attachTaskToView, createAgent, sessions, switchActiveProject, storageRef, activeModelRef, activeProjectRef],
  )

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
        console.error('Failed to sync model to server:', error)
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
    currentTitleRef,
    currentChatScopeRef,

    agent,
    currentSessionId,
    currentTitle,
    chatScope,
    currentToolProject,
    taskStatuses,
    chatPanelRevision,
    restoredDraft,

    createAgent,
    loadSession,
    attachTaskToView,
    syncSessionUI,
    setChatPanelRevision,
    setRestoredDraft,

    setCurrentAgentMessages,
    updateCurrentAgentModel,
    setCurrentTitleRef,
  }
}
