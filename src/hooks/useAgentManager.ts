import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentState } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { logger } from '@/lib/logger'
import { ServerAgent, type ServerAgentContextCompaction } from '@/lib/server-agent'
import { DeferredSessionAgent } from '@/lib/deferred-session-agent'
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
  AgentAccessMode,
  BackgroundTask,
  BackgroundTaskStatus,
  ChatScope,
  ProjectInfo,
  QuickForgeSessionMetadata,
} from '@/lib/types'
import { agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/types'
import { randomId } from '@/lib/random-id'
import { disposeAgentTask, selectAgentTaskEvictions, touchAgentTask } from '@/lib/agent-task-retention'
import { showAlert } from '@/components/ui/confirm-dialog'
import { t } from '@/lib/i18n'

export interface AgentManagerDeps {
  storageRef: React.MutableRefObject<Awaited<ReturnType<typeof import('@/lib/pi-chat').initializePiStorage>> | null>
  activeModelRef: React.MutableRefObject<Model<Api>>
  agentAccessModeRef: React.MutableRefObject<AgentAccessMode>
  activeProjectRef: React.MutableRefObject<ProjectInfo | undefined>
  defaultWorkspaceRef: React.MutableRefObject<ProjectInfo | undefined>
  setAgentAccessMode: React.Dispatch<React.SetStateAction<AgentAccessMode>>
  switchActiveProject: (projectId: string) => Promise<ProjectInfo>
  sessions: QuickForgeSessionMetadata[]
  refreshSessions: (opts?: { broadcast?: boolean }) => Promise<void>
  updateSessionTitle: (sessionId: string, title: string) => void
  onTaskComplete?: (sessionId: string, title: string, status: BackgroundTaskStatus) => void
}

export interface AgentManager {
  // Refs (stable across renders)
  agentRef: React.MutableRefObject<ServerAgent | DeferredSessionAgent | null>
  taskMapRef: React.MutableRefObject<Map<string, BackgroundTask>>
  currentSessionIdRef: React.MutableRefObject<string | undefined>
  currentChatScopeRef: React.MutableRefObject<ChatScope>

  // State (may change each render)
  agent: ServerAgent | DeferredSessionAgent | null
  currentSessionId: string | undefined
  currentTitle: string
  chatScope: ChatScope
  currentToolProject: ProjectInfo | undefined
  taskStatuses: Record<string, BackgroundTaskStatus>
  chatPanelRevision: number
  loadingSessionId: string | undefined

  // Stable callbacks
  createAgent: (
    initialState?: Partial<AgentState> & { contextCompaction?: ServerAgentContextCompaction | null },
    sessionId?: string,
    options?: { scope?: ChatScope; project?: ProjectInfo; attachToView?: boolean; shouldAttachToView?: () => boolean; createdAt?: string; title?: string; accessMode?: AgentAccessMode; yoloMode?: boolean; refreshSessions?: boolean },
  ) => Promise<ServerAgent>
  startDeferredSession: (options: { scope: ChatScope; project?: ProjectInfo }) => Promise<DeferredSessionAgent>
  loadSession: (
    sessionId: string,
    hints?: { title?: string; createdAt?: string; scope?: ChatScope; projectId?: string; source?: 'acp'; channelId?: string; channelName?: string },
  ) => Promise<boolean>
  syncSessionUI: (task: BackgroundTask) => Promise<void>
  setCurrentAgentMessages: (messages: AgentState['messages']) => void
  updateCurrentAgentModel: (model: Model<Api>) => void
  setCurrentTitleRef: (title: string) => void

  // Stable state setters
  setChatPanelRevision: React.Dispatch<React.SetStateAction<number>>
}

export function useAgentManager(deps: AgentManagerDeps): AgentManager {
  const {
    storageRef,
    activeModelRef,
    agentAccessModeRef,
    activeProjectRef,
    defaultWorkspaceRef,
    setAgentAccessMode,
    switchActiveProject,
    refreshSessions,
    updateSessionTitle,
  } = deps

  // --- Refs (stable) ---
  const agentRef = useRef<ServerAgent | DeferredSessionAgent | null>(null)
  const taskMapRef = useRef<Map<string, BackgroundTask>>(new Map())
  const currentChatScopeRef = useRef<ChatScope>('global')
  const currentSessionIdRef = useRef<string | undefined>(undefined)
  const currentTitleRef = useRef('New chat')
  const currentCreatedAtRef = useRef<string | undefined>(undefined)
  const loadSessionRef = useRef<AgentManager['loadSession'] | null>(null)
  const loadSessionRequestRef = useRef(0)
  const loadSessionAbortRef = useRef<AbortController | null>(null)
  const onTaskCompleteRef = useRef(deps.onTaskComplete)

  useEffect(() => {
    onTaskCompleteRef.current = deps.onTaskComplete
  })

  useEffect(() => () => {
    loadSessionAbortRef.current?.abort()
  }, [])

  // --- State ---
  const [agent, setAgent] = useState<ServerAgent | DeferredSessionAgent | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>()
  const [currentTitle, setCurrentTitle] = useState('New chat')
  const [chatScope, setChatScope] = useState<ChatScope>('global')
  const [currentToolProject, setCurrentToolProject] = useState<ProjectInfo>()
  const [taskStatuses, setTaskStatuses] = useState<Record<string, BackgroundTaskStatus>>({})
  const [chatPanelRevision, setChatPanelRevision] = useState(0)
  const [loadingSessionId, setLoadingSessionId] = useState<string>()

  const removeTaskStatuses = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) return
    setTaskStatuses((current) => {
      const next = { ...current }
      let changed = false
      for (const sessionId of sessionIds) {
        if (!Object.prototype.hasOwnProperty.call(next, sessionId)) continue
        delete next[sessionId]
        changed = true
      }
      return changed ? next : current
    })
  }, [])

  const pruneIdleTasks = useCallback((currentSessionId?: string) => {
    const sessionIds = selectAgentTaskEvictions(taskMapRef.current.values(), currentSessionId)
    for (const sessionId of sessionIds) disposeAgentTask(taskMapRef.current, sessionId)
    removeTaskStatuses(sessionIds)
  }, [removeTaskStatuses])

  const disposeDetachedAgent = useCallback((currentAgent: ServerAgent | DeferredSessionAgent | null, nextAgent?: ServerAgent | DeferredSessionAgent | null) => {
    if (!currentAgent || currentAgent === nextAgent) return
    const isTrackedTaskAgent = [...taskMapRef.current.values()].some((task) => task.agent === currentAgent)
    if (!isTrackedTaskAgent) currentAgent.dispose()
  }, [taskMapRef])

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
    disposeDetachedAgent(agentRef.current, task.agent)
    touchAgentTask(task)
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
  }, [disposeDetachedAgent])

  // --- Create or retrieve an agent ---
  const createAgent = useCallback(
    async (
      initialState?: Partial<AgentState> & { contextCompaction?: ServerAgentContextCompaction | null },
      sessionId: string = randomId(),
      options?: { scope?: ChatScope; project?: ProjectInfo; attachToView?: boolean; shouldAttachToView?: () => boolean; createdAt?: string; title?: string; source?: 'acp'; channelId?: string; channelName?: string; accessMode?: AgentAccessMode; yoloMode?: boolean; refreshSessions?: boolean },
    ) => {
      const previousAgent = agentRef.current
      const existingTask = taskMapRef.current.get(sessionId)
      if (existingTask) {
        if (options?.attachToView !== false && options?.shouldAttachToView?.() !== false) {
          disposeDetachedAgent(previousAgent, existingTask.agent)
          attachTaskToView(existingTask)
        }
        return existingTask.agent
      }

      const scope = options?.scope ?? currentChatScopeRef.current
      const project = scope === 'project'
        ? (options?.project ?? activeProjectRef.current)
        : (options?.project ?? defaultWorkspaceRef.current)
      if (scope === 'project' && !project?.id) {
        throw new Error('Cannot create project chat without an active project.')
      }
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
      const resolvedAccessMode = normalizeAgentAccessMode(options?.accessMode, options?.yoloMode ?? agentAccessModeRef.current)
      agentAccessModeRef.current = resolvedAccessMode
      setAgentAccessMode(resolvedAccessMode)

      const nextAgent = await ServerAgent.create(sessionId, {
        scope,
        projectId: scope === 'project' ? project?.id : undefined,
        source: options?.source,
        channelId: options?.channelId,
        channelName: options?.channelName,
        accessMode: resolvedAccessMode,
        yoloMode: agentAccessModeToYoloMode(resolvedAccessMode),
        model: resolvedModel,
        thinkingLevel: resolvedThinkingLevel,
        messages: (restInitialState as { messages?: AgentState['messages'] }).messages ?? [],
        title: options?.title,
        contextCompaction: restInitialState.contextCompaction,
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
        lastAccessedAt: Date.now(),
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
          const endEvent = event as { status?: unknown; errorMessage?: unknown }
          task.status = endEvent.status === 'aborted'
            ? 'aborted'
            : endEvent.errorMessage || nextAgent.state.errorMessage
              ? 'error'
              : 'idle'
          task.finishedAt = new Date().toISOString()
          touchAgentTask(task)
          setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))
          // NOTE: Do NOT bump chatPanelRevision here — the ChatPanel is already
          // showing the latest messages via the agent state.  Destroying /
          // recreating the panel on every agent_end causes a visual flash where
          // messages disappear then reappear.
          syncSessionUI(task).catch((err) => logger.error('Failed to sync session UI:', err))
          if (wasRunning) {
            onTaskCompleteRef.current?.(task.sessionId, task.title, task.status)
          }
          pruneIdleTasks(currentSessionIdRef.current)
        }

        if ((event as { type: string }).type === 'title_updated') {
          const titleEvent = event as unknown as { type: 'title_updated'; title: string }
          if (titleEvent.title) task.title = titleEvent.title
          if (task.sessionId === currentSessionIdRef.current && titleEvent.title) {
            currentTitleRef.current = titleEvent.title
            setCurrentTitle(titleEvent.title)
          }
          if (titleEvent.title) updateSessionTitle(task.sessionId, titleEvent.title)
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

      if (options?.attachToView !== false && options?.shouldAttachToView?.() !== false) {
        if (previousAgent instanceof DeferredSessionAgent) previousAgent.promoteTo(task.agent)
        else if (agentRef.current === previousAgent) disposeDetachedAgent(previousAgent, task.agent)
        attachTaskToView(task)
      }
      pruneIdleTasks(currentSessionIdRef.current)
      if (options?.refreshSessions !== false && nextAgent.state.messages.length > 0) {
        await refreshSessions({ broadcast: true })
      }
      return nextAgent
    },
    [attachTaskToView, disposeDetachedAgent, pruneIdleTasks, refreshSessions, syncSessionUI, updateSessionTitle, storageRef, activeModelRef, agentAccessModeRef, activeProjectRef, defaultWorkspaceRef, setAgentAccessMode],
  )

  const startDeferredSession = useCallback(async (options: { scope: ChatScope; project?: ProjectInfo }) => {
    const storage = storageRef.current
    const defaultOptions = storage ? await loadDefaultOptions(storage) : {}
    const requestedOrDefaultModel = defaultOptions.model ?? activeModelRef.current
    const resolvedModel = storage
      ? await resolveConfiguredModel(storage, requestedOrDefaultModel as Model<Api>)
      : normalizeModelForProvider(requestedOrDefaultModel as Model<Api>)
    const resolvedThinkingLevel = defaultOptions.thinkingLevel ?? defaultThinkingLevelForModel(resolvedModel)
    activeModelRef.current = resolvedModel

    const scope = options.scope
    const project = scope === 'project' ? options.project : (options.project ?? defaultWorkspaceRef.current)
    const deferredAgent = new DeferredSessionAgent({
      scope,
      project,
      model: resolvedModel,
      thinkingLevel: resolvedThinkingLevel,
      accessMode: agentAccessModeRef.current,
      yoloMode: agentAccessModeToYoloMode(agentAccessModeRef.current),
      createAgent,
    })
    deferredAgent.subscribe((event) => {
      if (agentRef.current !== deferredAgent) return
      if (event.type === 'message_start' || event.type === 'agent_end') {
        setChatPanelRevision((current) => current + 1)
      }
    })

    disposeDetachedAgent(agentRef.current)
    currentChatScopeRef.current = scope
    currentSessionIdRef.current = undefined
    currentCreatedAtRef.current = undefined
    currentTitleRef.current = 'New chat'
    setChatScope(scope)
    setCurrentSessionId(undefined)
    setCurrentTitle('New chat')
    setCurrentToolProject(project)
    agentRef.current = deferredAgent
    setAgent(deferredAgent)

    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url)
    return deferredAgent
  }, [activeModelRef, createAgent, defaultWorkspaceRef, disposeDetachedAgent, storageRef, agentAccessModeRef])

  // --- Load a persisted session ---
  const loadSession = useCallback(
    async (
      sessionId: string,
      hints?: { title?: string; createdAt?: string; scope?: ChatScope; projectId?: string; source?: 'acp'; channelId?: string; channelName?: string },
    ) => {
      const requestId = ++loadSessionRequestRef.current
      loadSessionAbortRef.current?.abort()
      const controller = new AbortController()
      loadSessionAbortRef.current = controller
      const isLatestRequest = () => loadSessionRequestRef.current === requestId && !controller.signal.aborted
      setLoadingSessionId(sessionId)

      try {
        if (!isLatestRequest()) return false

        const runningTask = taskMapRef.current.get(sessionId)
        if (runningTask) {
          if (runningTask.scope === 'project' && runningTask.project?.id && activeProjectRef.current?.id !== runningTask.project.id) {
            try {
              await switchActiveProject(runningTask.project.id)
            } catch (error) {
              logger.error('Failed to switch project for running session:', error)
            }
          }
          if (isLatestRequest()) {
            attachTaskToView(runningTask)
            pruneIdleTasks(runningTask.sessionId)
            return true
          }
          return false
        }

        let restoredAgent: ServerAgent
        let snapshot: Awaited<ReturnType<typeof ServerAgent.restore>>['snapshot']
        try {
          const restored = await ServerAgent.restore(sessionId, { signal: controller.signal })
          restoredAgent = restored.agent
          snapshot = restored.snapshot
        } catch (error) {
          if (controller.signal.aborted || !isLatestRequest()) return false
          logger.error('Failed to restore session:', error)
          return false
        }

        if (!isLatestRequest()) {
          restoredAgent.dispose()
          return false
        }

        const scope = hints?.scope ?? snapshot.scope ?? 'global'
        const scopedProjectId = hints?.projectId ?? snapshot.projectId ?? undefined
        let project: ProjectInfo | undefined
        if (scope === 'project' && scopedProjectId) {
          if (activeProjectRef.current?.id !== scopedProjectId) {
            try {
              project = await switchActiveProject(scopedProjectId)
            } catch (error) {
              restoredAgent.dispose()
              logger.error('Failed to switch project for session:', error)
              if (isLatestRequest()) void showAlert(t('projectSwitchFailed'))
              return false
            }
          } else {
            project = activeProjectRef.current
          }
        }
        if (!isLatestRequest()) {
          restoredAgent.dispose()
          return false
        }

        activeModelRef.current = restoredAgent.state.model
        const sessionAccessMode = normalizeAgentAccessMode(restoredAgent.state.accessMode, restoredAgent.state.yoloMode)
        agentAccessModeRef.current = sessionAccessMode
        setAgentAccessMode(sessionAccessMode)

        const task: BackgroundTask = {
          sessionId,
          agent: restoredAgent,
          scope,
          project: scope === 'project' ? project : defaultWorkspaceRef.current,
          title: snapshot.title ?? hints?.title ?? 'New chat',
          createdAt: snapshot.createdAt ?? hints?.createdAt ?? new Date().toISOString(),
          status: snapshot.status === 'running' || restoredAgent.state.isStreaming
            ? 'running'
            : restoredAgent.state.errorMessage
              ? 'error'
              : snapshot.status === 'aborted'
                ? 'aborted'
                : 'idle',
          startedAt: snapshot.startedAt ?? undefined,
          finishedAt: snapshot.finishedAt ?? undefined,
          lastAccessedAt: Date.now(),
          unsubscribe: () => undefined,
        }
        task.unsubscribe = restoredAgent.subscribe((event) => {
          if (event.type === 'agent_start') {
            task.status = 'running'
            task.startedAt = task.startedAt ?? new Date().toISOString()
            task.finishedAt = undefined
            setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))
          }
          if (event.type === 'message_end') restoredAgent.state.messages = [...restoredAgent.state.messages]
          if (event.type === 'agent_end') {
            const wasRunning = task.status === 'running'
            const endEvent = event as { status?: unknown; errorMessage?: unknown }
            task.status = endEvent.status === 'aborted'
              ? 'aborted'
              : endEvent.errorMessage || restoredAgent.state.errorMessage
                ? 'error'
                : 'idle'
            task.finishedAt = new Date().toISOString()
            touchAgentTask(task)
            setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))
            syncSessionUI(task).catch((err) => logger.error('Failed to sync session UI:', err))
            if (wasRunning) onTaskCompleteRef.current?.(task.sessionId, task.title, task.status)
            pruneIdleTasks(currentSessionIdRef.current)
          }
          if ((event as { type: string }).type === 'title_updated') {
            const titleEvent = event as unknown as { type: 'title_updated'; title: string }
            if (titleEvent.title) task.title = titleEvent.title
            if (task.sessionId === currentSessionIdRef.current && titleEvent.title) {
              currentTitleRef.current = titleEvent.title
              setCurrentTitle(titleEvent.title)
            }
            if (titleEvent.title) updateSessionTitle(task.sessionId, titleEvent.title)
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
        if (task.status !== 'idle') setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))
        attachTaskToView(task)
        pruneIdleTasks(sessionId)
        return true
      } finally {
        if (loadSessionAbortRef.current === controller) loadSessionAbortRef.current = null
        if (loadSessionRequestRef.current === requestId) setLoadingSessionId(undefined)
      }
    },
    [activeModelRef, activeProjectRef, agentAccessModeRef, attachTaskToView, defaultWorkspaceRef, pruneIdleTasks, refreshSessions, setAgentAccessMode, switchActiveProject, syncSessionUI, updateSessionTitle],
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
    setCurrentTitle(title)
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
    loadingSessionId,

    createAgent,
    startDeferredSession,
    loadSession,
    syncSessionUI,
    setChatPanelRevision,

    setCurrentAgentMessages,
    updateCurrentAgentModel,
    setCurrentTitleRef,
  }
}
