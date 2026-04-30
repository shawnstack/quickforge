import { useCallback, useEffect, useRef, useState } from 'react'
import { Agent, type AgentState } from '@mariozechner/pi-agent-core'
import {
  defaultConvertToLlm,
  ProxyTab,
  SettingsDialog,
} from '@mariozechner/pi-web-ui'
import type { Api, Model } from '@mariozechner/pi-ai'
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectDirectoryPicker } from '@/components/project-directory-picker'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  initializePiStorage,
  loadActiveModel,
  normalizeModelForProvider,
  resolveConfiguredModel,
} from '@/lib/pi-chat'
import { createCustomProvidersOnlyTab } from '@/lib/custom-providers-only-tab'
import { t } from '@/lib/i18n'
import { createLanguageSettingsTab } from '@/lib/language-settings-tab'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
import { getLocalWorkspaceTools } from '@/lib/local-tools'
import { restoreReasoningContentInPayload } from '@/lib/reasoning-content-cache'
import {
  buildSystemPrompt,
  copyTextToClipboard,
  draftTextFromUserMessage,
  generateAiTitle,
  generateTitle,
  hasUserMessage,
  rollbackConversationFromMessage,
  rollbackStartIndexFromMessage,
  shouldSaveSession,
  summarizePreview,
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
import { calculateUsage, sessionScope, sessionTitle } from '@/lib/types'
import { ChatPanelHost } from '@/components/chat/ChatPanelHost'
import { ChatSidebar } from '@/components/sidebar/ChatSidebar'
import { useProject } from '@/hooks/useProject'
import { useYoloMode } from '@/hooks/useYoloMode'
import { saveActiveModel, saveYoloMode } from '@/lib/pi-chat'

function App() {
  // --- Refs (non-reactive shared state) ---
  const storageRef = useRef<Awaited<ReturnType<typeof initializePiStorage>> | null>(null)
  const agentRef = useRef<Agent | null>(null)
  const activeModelRef = useRef<Model<Api>>(buildConnectionModel(DEFAULT_CONNECTION))
  const taskMapRef = useRef<Map<string, BackgroundTask>>(new Map())
  const persistQueueRef = useRef(Promise.resolve())
  const yoloModeRef = useRef(false)
  const currentChatScopeRef = useRef<ChatScope>('global')
  const activeProjectRef = useRef<ProjectInfo | undefined>(undefined)
  const currentSessionIdRef = useRef<string | undefined>(undefined)
  const currentTitleRef = useRef('New chat')
  const currentCreatedAtRef = useRef<string | undefined>(undefined)
  const titleGeneratedRef = useRef<Set<string>>(new Set())
  const pendingAiTitleRef = useRef<Set<string>>(new Set())

  // --- Project hook ---
  const {
    activeProject,
    projects,
    expandedProjectIds,
    selectingProject,
    projectPickerOpen,
    loadProject,
    switchActiveProject,
    handleSelectProjectPath,
    selectProjectDirectory,
    setProjectPickerOpen,
    toggleProjectExpanded,
    setActiveProject,
    setProjects,
    setExpandedProjectIds,
  } = useProject()

  // --- YOLO hook ---
  const { yoloMode, setYoloMode, initialize: initYoloMode } = useYoloMode()

  // --- UI state ---
  const [agent, setAgent] = useState<Agent | null>(null)
  const [sessions, setSessions] = useState<QuickForgeSessionMetadata[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>()
  const [currentTitle, setCurrentTitle] = useState('New chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false)
  const [ready, setReady] = useState(false)
  const [chatPanelRevision, setChatPanelRevision] = useState(0)
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()
  const [taskStatuses, setTaskStatuses] = useState<Record<string, BackgroundTaskStatus>>({})
  const [chatScope, setChatScope] = useState<ChatScope>('global')
  const [currentToolProject, setCurrentToolProject] = useState<ProjectInfo>()

  // --- Sync refs ---
  useEffect(() => {
    yoloModeRef.current = yoloMode
  }, [yoloMode])

  useEffect(() => {
    activeProjectRef.current = activeProject
  }, [activeProject])

  // --- Session helpers ---
  const refreshSessions = useCallback(async () => {
    const storage = storageRef.current
    if (!storage) return
    setSessions((await storage.sessions.getAllMetadata()) as QuickForgeSessionMetadata[])
  }, [])

  const persistTaskSession = useCallback(
    async (task: BackgroundTask) => {
      const storage = storageRef.current
      const messages = task.agent.state.messages
      if (!storage || !hasUserMessage(messages)) return

      const now = new Date().toISOString()
      const createdAt = task.createdAt ?? now

      if (!titleGeneratedRef.current.has(task.sessionId)) {
        titleGeneratedRef.current.add(task.sessionId)
        if (titleNeedsGeneration(task.title)) {
          pendingAiTitleRef.current.add(task.sessionId)
        }
      }

      let title = task.title
      if (titleNeedsGeneration(title)) {
        title = generateTitle(messages)
      }

      const finishedAt = task.status === 'running' ? undefined : (task.finishedAt ?? now)

      task.createdAt = createdAt
      task.title = title
      task.finishedAt = finishedAt

      // Fire-and-forget AI title generation
      if (pendingAiTitleRef.current.has(task.sessionId) && messages.some((m) => m.role === 'assistant')) {
        pendingAiTitleRef.current.delete(task.sessionId)
        const model = task.agent.state.model ?? activeModelRef.current
        const apiKey: string | undefined = (await storage.providerKeys.get(model.provider).catch(() => undefined)) || undefined
        const getProxyUrl = async () => {
          const enabled = await storage.settings.get<boolean>('proxy.enabled')
          return enabled ? ((await storage.settings.get<string>('proxy.url')) || undefined) : undefined
        }
        generateAiTitle(messages, model, apiKey, getProxyUrl).then(async (aiTitle) => {
          if (aiTitle && aiTitle !== 'New chat') {
            task.title = aiTitle
            const latestMessages = task.agent.state.messages
            const latestSessionData: QuickForgeSessionData = {
              id: task.sessionId,
              title: aiTitle,
              model: task.agent.state.model!,
              thinkingLevel: task.agent.state.thinkingLevel,
              messages: latestMessages,
              createdAt,
              lastModified: new Date().toISOString(),
              scope: task.scope,
              projectId: task.scope === 'project' ? task.project?.id : undefined,
              projectName: task.scope === 'project' ? task.project?.name : undefined,
              projectPath: task.scope === 'project' ? task.project?.path : undefined,
              taskStatus: task.status,
              taskStartedAt: task.startedAt,
              taskFinishedAt: task.finishedAt,
            }
            const latestMetadata: QuickForgeSessionMetadata = {
              id: task.sessionId,
              title: aiTitle,
              createdAt,
              lastModified: new Date().toISOString(),
              messageCount: latestMessages.length,
              usage: calculateUsage(latestMessages),
              thinkingLevel: task.agent.state.thinkingLevel,
              preview: summarizePreview(latestMessages),
              scope: task.scope,
              projectId: task.scope === 'project' ? task.project?.id : undefined,
              projectName: task.scope === 'project' ? task.project?.name : undefined,
              projectPath: task.scope === 'project' ? task.project?.path : undefined,
              taskStatus: task.status,
              taskStartedAt: task.startedAt,
              taskFinishedAt: task.finishedAt,
            }
            await storage.sessions.save(latestSessionData, latestMetadata)
            await refreshSessions()
            if (currentSessionIdRef.current === task.sessionId) {
              currentTitleRef.current = aiTitle
              setCurrentTitle(aiTitle)
            }
          }
        }).catch(() => {
          // Silently ignore AI title generation failures
        })
      }

      if (currentSessionIdRef.current === task.sessionId) {
        currentCreatedAtRef.current = createdAt
        currentTitleRef.current = title
        setCurrentTitle(title)
      }

      const sessionData: QuickForgeSessionData = {
        id: task.sessionId,
        title,
        model: task.agent.state.model!,
        thinkingLevel: task.agent.state.thinkingLevel,
        messages,
        createdAt,
        lastModified: now,
        scope: task.scope,
        projectId: task.scope === 'project' ? task.project?.id : undefined,
        projectName: task.scope === 'project' ? task.project?.name : undefined,
        projectPath: task.scope === 'project' ? task.project?.path : undefined,
        taskStatus: task.status,
        taskStartedAt: task.startedAt,
        taskFinishedAt: finishedAt,
      }

      const metadata: QuickForgeSessionMetadata = {
        id: task.sessionId,
        title,
        createdAt,
        lastModified: now,
        messageCount: messages.length,
        usage: calculateUsage(messages),
        thinkingLevel: task.agent.state.thinkingLevel,
        preview: summarizePreview(messages),
        scope: task.scope,
        projectId: task.scope === 'project' ? task.project?.id : undefined,
        projectName: task.scope === 'project' ? task.project?.name : undefined,
        projectPath: task.scope === 'project' ? task.project?.path : undefined,
        taskStatus: task.status,
        taskStartedAt: task.startedAt,
        taskFinishedAt: finishedAt,
      }

      await storage.sessions.save(sessionData, metadata)
      await refreshSessions()
    },
    [refreshSessions],
  )

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

      const systemPrompt = await buildSystemPrompt(project?.id)
      const {
        model: requestedModel,
        thinkingLevel: requestedThinkingLevel,
        tools: _requestedTools,
        ...restInitialState
      } = initialState ?? {}
      const storage = storageRef.current
      const resolvedModel = storage
        ? await resolveConfiguredModel(storage, (requestedModel ?? activeModelRef.current) as Model<Api>)
        : normalizeModelForProvider((requestedModel ?? activeModelRef.current) as Model<Api>)
      const resolvedThinkingLevel = requestedThinkingLevel ?? (resolvedModel.reasoning ? 'medium' : 'off')
      activeModelRef.current = resolvedModel

      const agentForPayload: { current?: Agent } = {}
      const nextAgent = new Agent({
        initialState: {
          systemPrompt,
          model: resolvedModel,
          thinkingLevel: resolvedThinkingLevel,
          messages: [],
          ...restInitialState,
          tools: getLocalWorkspaceTools(yoloModeRef.current, project?.id),
        },
        convertToLlm: defaultConvertToLlm,
        sessionId,
        maxRetryDelayMs: 60000,
        onPayload: (payload) => restoreReasoningContentInPayload(payload, agentForPayload.current?.state.messages ?? []),
        beforeToolCall: async (context) => {
          if (!project?.id) {
            return {
              block: true,
              reason: t('noActiveProjectToolBlockedReason', { name: context.toolCall.name }),
            }
          }
          if (!yoloModeRef.current) {
            return {
              block: true,
              reason: t('yoloBlockedReason', { name: context.toolCall.name }),
            }
          }
          return undefined
        },
      })
      agentForPayload.current = nextAgent

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
          task.status = nextAgent.state.errorMessage ? 'error' : 'idle'
          task.finishedAt = new Date().toISOString()
          setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))
          if (task.sessionId === currentSessionIdRef.current) {
            window.setTimeout(() => setChatPanelRevision((value) => value + 1), 0)
          }
        }

        if (
          event.type === 'message_end' ||
          event.type === 'agent_start' ||
          event.type === 'agent_end' ||
          event.type === 'turn_end'
        ) {
          persistQueueRef.current = persistQueueRef.current
            .catch(() => undefined)
            .then(() => persistTaskSession(task))
            .catch((error) => console.error('Failed to persist session:', error))
        }
      })

      taskMapRef.current.set(sessionId, task)
      setTaskStatuses((current) => ({ ...current, [task.sessionId]: task.status }))

      if (options?.attachToView !== false) attachTaskToView(task)
      return nextAgent
    },
    [attachTaskToView, persistTaskSession],
  )

  // --- Chat actions ---
  const startNewGlobalChat = useCallback(async () => {
    const sessionId = crypto.randomUUID()
    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url)

    await createAgent(
      { tools: [] },
      sessionId,
      { scope: 'global', attachToView: true },
    )
  }, [createAgent])

  const startNewProjectChat = useCallback(async (targetProject?: ProjectInfo) => {
    const nextProject = targetProject ?? activeProjectRef.current
    if (!nextProject) return

    if (activeProjectRef.current?.id !== nextProject.id) {
      await switchActiveProject(nextProject.id)
    }

    const sessionId = crypto.randomUUID()
    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url)

    await createAgent(
      { tools: getLocalWorkspaceTools(yoloModeRef.current, nextProject.id) },
      sessionId,
      { scope: 'project', project: nextProject, attachToView: true },
    )
  }, [createAgent, switchActiveProject])

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
            alert(t('projectSwitchFailed'))
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
          tools: getLocalWorkspaceTools(yoloModeRef.current, project?.id),
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
    [attachTaskToView, createAgent, sessions, switchActiveProject],
  )

  const deleteProjectInline = useCallback(
    async (projectId: string) => {
      const response = await fetch(`/api/project/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Failed to delete project`)
      setActiveProject(payload.project)
      setProjects(payload.projects)
      setExpandedProjectIds((current) => {
        const next = new Set(current)
        next.delete(projectId)
        return next
      })
      await refreshSessions()
      if (activeProjectRef.current?.id === projectId) {
        activeProjectRef.current = payload.project
        setChatPanelRevision((value) => value + 1)
      }
    },
    [refreshSessions, setActiveProject, setProjects, setExpandedProjectIds],
  )

  // --- Bootstrap ---
  useEffect(() => {
    let cancelled = false

    async function boot() {
      const storage = await initializePiStorage()
      if (cancelled) return

      storageRef.current = storage
      await Promise.all([refreshSessions(), loadProject()])

      const savedYoloMode = await initYoloMode(storage)
      yoloModeRef.current = savedYoloMode

      const initialModel = (await loadActiveModel(storage)) ?? buildConnectionModel(DEFAULT_CONNECTION)
      activeModelRef.current = initialModel

      const sessionId = new URLSearchParams(window.location.search).get('session')
      if (sessionId) {
        const existing = await storage.sessions.get(sessionId)
        if (existing) {
          const metadata = (await storage.sessions.getMetadata(existing.id)) as QuickForgeSessionMetadata | null
          const scope = sessionScope(metadata ?? (existing as QuickForgeSessionData))
          let project: ProjectInfo | undefined
          if (scope === 'project' && (metadata?.projectId || (existing as QuickForgeSessionData).projectId)) {
            const projectId = (metadata?.projectId ?? (existing as QuickForgeSessionData).projectId)!
            if (activeProjectRef.current?.id !== projectId) {
              try {
                project = await switchActiveProject(projectId)
              } catch (error) {
                console.error('Failed to switch project for initial session:', error)
                alert(t('projectSwitchFailed'))
                await createAgent(
                  { model: initialModel, tools: [] },
                  crypto.randomUUID(),
                  { scope: 'global', attachToView: true },
                )
                setReady(true)
                return
              }
            } else {
              project = activeProjectRef.current
            }
          }
          activeModelRef.current = existing.model as Model<Api>
          await createAgent(
            {
              systemPrompt: await buildSystemPrompt(),
              model: existing.model,
              thinkingLevel: existing.thinkingLevel,
              messages: existing.messages,
              tools: getLocalWorkspaceTools(yoloModeRef.current, project?.id),
            },
            existing.id,
            {
              scope,
              project,
              attachToView: true,
              createdAt: existing.createdAt,
              title: existing.title,
            },
          )
        } else {
          await createAgent(
            { model: initialModel, tools: [] },
            crypto.randomUUID(),
            { scope: 'global', attachToView: true },
          )
        }
      } else {
        await createAgent(
          { model: initialModel, tools: [] },
          crypto.randomUUID(),
          { scope: 'global', attachToView: true },
        )
      }

      setReady(true)
    }

    boot()
    const taskMap = taskMapRef.current
    return () => {
      cancelled = true
      for (const task of taskMap.values()) task.unsubscribe()
      taskMap.clear()
    }
  }, [createAgent, loadProject, refreshSessions, switchActiveProject, initYoloMode])

  // --- YOLO ---
  const toggleYoloMode = useCallback(() => {
    const storage = storageRef.current
    setYoloMode((prev) => {
      const next = !prev
      yoloModeRef.current = next
      if (storage) {
        void saveYoloMode(storage, next).catch((error) => {
          console.error('Failed to save YOLO mode:', error)
        })
      }
      return next
    })
    if (agentRef.current) {
      setChatPanelRevision((value) => value + 1)
    }
  }, [setYoloMode])

  // --- Message actions ---
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

    currentAgent.state.messages = nextMessages

    if (rollbackMessage) {
      setRestoredDraft({
        id: Date.now(),
        text: draftTextFromUserMessage(rollbackMessage),
        attachments: rollbackMessage.role === 'user-with-attachments' ? rollbackMessage.attachments : undefined,
      })
    }

    setChatPanelRevision((value) => value + 1)

    const currentTask = currentSessionIdRef.current ? taskMapRef.current.get(currentSessionIdRef.current) : undefined

    if (shouldSaveSession(nextMessages) && currentTask) {
      persistQueueRef.current = persistQueueRef.current
        .catch(() => undefined)
        .then(() => persistTaskSession(currentTask))
        .catch((error) => console.error('Failed to persist rolled back session:', error))
      return
    }

    const storage = storageRef.current
    const previousSessionId = currentSessionIdRef.current

    currentSessionIdRef.current = undefined
    currentCreatedAtRef.current = undefined
    currentTitleRef.current = 'New chat'
    setCurrentSessionId(undefined)
    setCurrentTitle('New chat')

    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url)

    if (previousSessionId) {
      const task = taskMapRef.current.get(previousSessionId)
      task?.unsubscribe()
      taskMapRef.current.delete(previousSessionId)
      setTaskStatuses((current) => {
        const next = { ...current }
        delete next[previousSessionId]
        return next
      })
    }

    if (storage && previousSessionId) {
      try {
        await storage.sessions.delete(previousSessionId)
        await refreshSessions()
      } catch (error) {
        console.error('Failed to delete rolled back empty session:', error)
      }
    }
  }, [persistTaskSession, refreshSessions])

  const copyAnswer = useCallback(async (text: string) => {
    try {
      await copyTextToClipboard(text)
    } catch (error) {
      console.error('Failed to copy answer:', error)
      alert(t('copyFailed'))
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
        systemPrompt: await buildSystemPrompt(),
        model: currentAgent.state.model ?? activeModelRef.current,
        thinkingLevel: currentAgent.state.thinkingLevel,
        messages,
        tools: getLocalWorkspaceTools(yoloModeRef.current, project?.id),
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
      persistQueueRef.current = persistQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const task = taskMapRef.current.get(newSessionId)
          if (task) await persistTaskSession(task)
        })
        .catch((error) => console.error('Failed to persist forked session:', error))
    }
  }, [createAgent, persistTaskSession])

  // --- Model selection ---
  const openCustomModelSelector = useCallback(async () => {
    const storage = storageRef.current
    const currentAgent = agentRef.current
    if (!storage || !currentAgent) return

    const textarea = document.querySelector<HTMLTextAreaElement>(
      'agent-interface message-editor textarea',
    )
    const currentInput = textarea?.value ?? ''

    const customProviders = await storage.customProviders.getAll()

    for (const provider of customProviders) {
      if (provider.apiKey) {
        await storage.providerKeys.set(provider.name, provider.apiKey)
      }
    }

    const customModels = customProviders.flatMap((provider) => provider.models ?? [])

    if (customModels.length === 0) {
      alert(t('addCustomModelFirst'))
      return
    }

    openCustomOnlyModelSelector(currentAgent.state.model ?? activeModelRef.current, customModels, (model) => {
      const nextModel = model as Model<Api>
      currentAgent.state.model = nextModel
      activeModelRef.current = nextModel

      if (currentInput) {
        setRestoredDraft({
          id: Date.now(),
          text: currentInput,
        })
      }

      setChatPanelRevision((value) => value + 1)
      void saveActiveModel(storage, nextModel).catch((error) => {
        console.error('Failed to save active model:', error)
      })
    })
  }, [])

  // --- Derived data ---
  const globalSessions = sessions.filter((session) => sessionScope(session) === 'global')
  const sessionsForProject = (projectId: string) => {
    return sessions.filter((session) => sessionScope(session) === 'project' && session.projectId === projectId)
  }
  const sessionTaskStatus = (session: QuickForgeSessionMetadata) => {
    return taskStatuses[session.id] ?? session.taskStatus ?? 'idle'
  }

  // --- Loading state ---
  if (!ready || !agent) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">{t('loadingChatWorkspace')}</div>
      </div>
    )
  }

  return (
    <>
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <ChatSidebar
        sidebarOpen={sidebarOpen}
        projectsCollapsed={projectsCollapsed}
        conversationsCollapsed={conversationsCollapsed}
        projects={projects}
        expandedProjectIds={expandedProjectIds}
        activeProject={activeProject}
        currentSessionId={currentSessionId}
        globalSessions={globalSessions}
        sessionsForProject={sessionsForProject}
        sessionTaskStatus={sessionTaskStatus}
        selectingProject={selectingProject}
        onToggleProjectsCollapsed={() => setProjectsCollapsed((v) => !v)}
        onToggleConversationsCollapsed={() => setConversationsCollapsed((v) => !v)}
        onToggleProjectExpanded={toggleProjectExpanded}
        onSelectProjectDirectory={selectProjectDirectory}
        onStartNewProjectChat={startNewProjectChat}
        onDeleteProject={deleteProjectInline}
        onLoadSession={loadSession}
        onRenameSession={async (sessionId, currentTitle) => {
          // Inline rename logic
          const storage = storageRef.current
          if (!storage) return
          const { showPrompt } = await import('@/components/ui/prompt-dialog')
          const newTitle = await showPrompt({
            title: t('renameSession'),
            description: t('sessionName'),
            defaultValue: currentTitle,
            confirmLabel: t('save'),
            cancelLabel: t('cancel'),
          })
          if (!newTitle || newTitle === currentTitle) return
          const session = await storage.sessions.get(sessionId)
          if (!session) return
          const metadata = await storage.sessions.getMetadata(sessionId)
          if (!metadata) return
          await storage.sessions.save(session, { ...metadata, title: newTitle })
          await refreshSessions()
          if (currentSessionIdRef.current === sessionId) {
            currentTitleRef.current = newTitle
            setCurrentTitle(newTitle)
          }
        }}
        onDeleteSession={async (sessionId) => {
          const storage = storageRef.current
          if (!storage) return
          const { showConfirm } = await import('@/components/ui/confirm-dialog')
          const confirmed = await showConfirm({
            title: t('deleteSession'),
            description: t('deleteSessionConfirm'),
            confirmLabel: t('confirmDelete'),
            cancelLabel: t('cancel'),
          })
          if (!confirmed) return
          const task = taskMapRef.current.get(sessionId)
          task?.unsubscribe()
          taskMapRef.current.delete(sessionId)
          setTaskStatuses((current) => { const next = { ...current }; delete next[sessionId]; return next })
          await storage.sessions.delete(sessionId)
          await refreshSessions()
          if (currentSessionIdRef.current === sessionId) {
            await startNewGlobalChat()
          }
        }}
        onStartNewGlobalChat={startNewGlobalChat}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label={t('toggleSidebar')}
          >
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={startNewGlobalChat} aria-label={t('newChat')}>
            <Plus className="size-4" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-muted-foreground">
              {chatScope === 'project' ? (currentToolProject?.name ?? t('projectChat')) : t('normalChat')}
            </div>
            <div className="truncate text-sm font-semibold">{sessionTitle(currentTitle)}</div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => SettingsDialog.open([createLanguageSettingsTab(), createCustomProvidersOnlyTab(), new ProxyTab()])}
            aria-label={t('settings')}
          >
            <Settings className="size-4" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">
            <ChatPanelHost
              agent={agent}
              onModelSelect={openCustomModelSelector}
              revision={chatPanelRevision}
              yoloMode={yoloMode}
              workspaceToolsEnabled={Boolean(currentToolProject?.id)}
              projectId={currentToolProject?.id}
              onToggleYoloMode={toggleYoloMode}
              onRollbackFromMessage={rollbackFromMessage}
              onCopyAnswer={copyAnswer}
              onForkFromMessage={forkFromMessage}
              restoredDraft={restoredDraft}
            />
          </section>
        </div>
      </main>
    </div>
    <ProjectDirectoryPicker
      open={projectPickerOpen}
      initialPath={activeProject?.path}
      disabled={selectingProject}
      onOpenChange={setProjectPickerOpen}
      onSelect={handleSelectProjectPath}
    />
    </>
  )
}

export default App
