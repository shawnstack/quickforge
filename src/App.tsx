import { useCallback, useEffect, useRef, useState } from 'react'
import { Agent, type AgentMessage, type AgentState } from '@mariozechner/pi-agent-core'
import {
  ApiKeyPromptDialog,
  ChatPanel,
  defaultConvertToLlm,
  ProxyTab,
  SettingsDialog,
  type SessionData,
  type SessionMetadata,
} from '@mariozechner/pi-web-ui'
import type { Api, Model } from '@mariozechner/pi-ai'
import {
  Folder,
  FolderOpen,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  buildConnectionModel,
  DEFAULT_CONNECTION,
  initializePiStorage,
  loadActiveModel,
  loadYoloMode,
  saveActiveModel,
  saveYoloMode,
} from '@/lib/pi-chat'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { createCustomProvidersOnlyTab } from '@/lib/custom-providers-only-tab'
import { getDateLocale, t } from '@/lib/i18n'
import { createLanguageSettingsTab } from '@/lib/language-settings-tab'
import { openCustomOnlyModelSelector } from '@/lib/custom-model-selector'
import { getLocalWorkspaceTools } from '@/lib/local-tools'
import { restoreReasoningContentInPayload } from '@/lib/reasoning-content-cache'

// Main chat behavior prompt.
const SYSTEM_PROMPT =
  'You are a helpful AI assistant. Answer clearly and pragmatically. If the user asks for code, prefer concise working examples. When YOLO mode is enabled, you may use the local workspace tools to inspect files, edit files, and run commands in the current project.'

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

function textFromContentBlocks(content: unknown, separator = ' ') {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } => {
      return (
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string'
      )
    })
    .map((block) => block.text)
    .join(separator)
}

function assistantText(message: AgentMessage) {
  if (message.role !== 'assistant') return ''
  return textFromContentBlocks(message.content, '\n\n').trim()
}

function rollbackStartIndexFromMessage(messages: AgentMessage[], messageIndex: number) {
  let rollbackIndex = messageIndex

  if (messages[messageIndex]?.role === 'assistant') {
    for (let index = messageIndex - 1; index >= 0; index--) {
      if (messages[index].role === 'user' || messages[index].role === 'user-with-attachments') {
        rollbackIndex = index
        break
      }
    }
  }

  const message = messages[rollbackIndex]
  if (!message || (message.role !== 'user' && message.role !== 'user-with-attachments')) return -1
  return rollbackIndex
}

function rollbackConversationFromMessage(messages: AgentMessage[], messageIndex: number) {
  const rollbackIndex = rollbackStartIndexFromMessage(messages, messageIndex)
  if (rollbackIndex < 0) return messages
  return messages.slice(0, rollbackIndex)
}

function draftTextFromUserMessage(message: AgentMessage) {
  if (message.role !== 'user' && message.role !== 'user-with-attachments') return ''
  return typeof message.content === 'string'
    ? message.content
    : textFromContentBlocks(message.content, '\n\n')
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function generateTitle(messages: AgentMessage[]) {
  const firstUser = messages.find(
    (message) => message.role === 'user' || message.role === 'user-with-attachments',
  )

  if (!firstUser || (firstUser.role !== 'user' && firstUser.role !== 'user-with-attachments')) {
    return 'New chat'
  }

  const content = firstUser.content
  const text = typeof content === 'string' ? content : textFromContentBlocks(content)

  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'New chat'
  return normalized.length > 46 ? `${normalized.slice(0, 43)}...` : normalized
}

function hasUserMessage(messages: AgentMessage[]) {
  return messages.some((message) => message.role === 'user' || message.role === 'user-with-attachments')
}

function shouldSaveSession(messages: AgentMessage[]) {
  return hasUserMessage(messages) && messages.some((message) => message.role === 'assistant')
}

function summarizePreview(messages: AgentMessage[]) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      if (message.role === 'user') return typeof message.content === 'string' ? message.content : ''
      return message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(' ')
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2048)
}

function calculateUsage(messages: AgentMessage[]): SessionMetadata['usage'] {
  return messages.reduce(
    (usage, message) => {
      if (message.role !== 'assistant') return usage
      usage.input += message.usage.input
      usage.output += message.usage.output
      usage.cacheRead += message.usage.cacheRead
      usage.cacheWrite += message.usage.cacheWrite
      usage.totalTokens += message.usage.totalTokens
      usage.cost.input += message.usage.cost.input
      usage.cost.output += message.usage.cost.output
      usage.cost.cacheRead += message.usage.cost.cacheRead
      usage.cost.cacheWrite += message.usage.cost.cacheWrite
      usage.cost.total += message.usage.cost.total
      return usage
    },
    structuredClone(EMPTY_USAGE),
  )
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat(getDateLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

type RestoredDraft = {
  id: number
  text: string
  attachments?: unknown[]
}

type ProjectInfo = {
  id: string
  name: string
  path: string
  lastOpenedAt: string
}

type ChatScope = 'global' | 'project'

type BackgroundTaskStatus = 'running' | 'idle' | 'error' | 'aborted'

type QuickForgeSessionMetadata = SessionMetadata & {
  scope?: ChatScope
  projectId?: string
  projectName?: string
  projectPath?: string
  taskStatus?: BackgroundTaskStatus
  taskStartedAt?: string
  taskFinishedAt?: string
}

type QuickForgeSessionData = SessionData & {
  scope?: ChatScope
  projectId?: string
  projectName?: string
  projectPath?: string
  taskStatus?: BackgroundTaskStatus
  taskStartedAt?: string
  taskFinishedAt?: string
}

type BackgroundTask = {
  sessionId: string
  agent: Agent
  scope: ChatScope
  project?: ProjectInfo
  title: string
  createdAt?: string
  status: BackgroundTaskStatus
  startedAt?: string
  finishedAt?: string
  unsubscribe: () => void
}

function sessionScope(session: QuickForgeSessionMetadata | QuickForgeSessionData | null | undefined): ChatScope {
  return session?.scope === 'project' ? 'project' : 'global'
}

function sessionTitle(title: string) {
  return title === 'New chat' ? t('newChat') : title
}

function ChatPanelHost({
  agent,
  onModelSelect,
  revision,
  yoloMode,
  workspaceToolsEnabled,
  projectId,
  onToggleYoloMode,
  onRollbackFromMessage,
  onCopyAnswer,
  onForkFromMessage,
  restoredDraft,
}: {
  agent: Agent | null
  onModelSelect?: () => void
  revision: number
  yoloMode: boolean
  workspaceToolsEnabled: boolean
  projectId?: string
  onToggleYoloMode: () => void
  onRollbackFromMessage: (messageIndex: number) => void
  onCopyAnswer: (text: string) => void
  onForkFromMessage: (messageIndex: number) => void
  restoredDraft?: RestoredDraft
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const restoredDraftIdRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!hostRef.current || !agent) return

    const panel = new ChatPanel()
    let disposed = false
    let observer: MutationObserver | undefined

    const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
    const rollbackIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>'
    const forkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><path d="M12 12v3"/></svg>'

    const createIconActionButton = (action: string, title: string, icon: string, onClick: () => void) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.quickforgeAction = action
      button.title = title
      button.setAttribute('aria-label', title)
      button.innerHTML = icon
      button.className = 'pointer-events-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
      button.onclick = (event) => {
        event.stopPropagation()
        onClick()
      }
      return button
    }

    const decorateMessages = () => {
      const displayEntries = agent.state.messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => {
          return message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant'
        })

      const messageElements = Array.from(
        panel.querySelectorAll<HTMLElement>('message-list user-message, message-list assistant-message'),
      )

      messageElements.forEach((element, displayIndex) => {
        const entry = displayEntries[displayIndex]
        if (!entry) return

        element.classList.add('group', 'relative')

        const actionsClass = `quickforge-message-actions pointer-events-none mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${entry.message.role === 'assistant' ? 'px-4 justify-start' : 'mx-4 justify-start'}`
        const existingActions = element.querySelector<HTMLElement>('.quickforge-message-actions')
        if (existingActions?.dataset.quickforgeLayout === 'message-bottom') {
          existingActions.className = actionsClass
          existingActions.querySelectorAll<HTMLButtonElement>('button[data-quickforge-action="rollback"], button[data-quickforge-action="fork"]').forEach((button) => {
            button.disabled = agent.state.isStreaming
          })
          return
        }
        existingActions?.remove()

        const actions = document.createElement('div')
        actions.dataset.quickforgeLayout = 'message-bottom'
        actions.className = actionsClass

        if (entry.message.role === 'assistant') {
          const text = assistantText(entry.message)
          if (!text) return

          const copyButton = createIconActionButton('copy', t('copy'), copyIcon, () => {
            const currentMessage = agent.state.messages[entry.index]
            const currentText = currentMessage ? assistantText(currentMessage) : text
            if (currentText) onCopyAnswer(currentText)
          })
          actions.append(copyButton)

          const forkButton = createIconActionButton('fork', t('forkConversation'), forkIcon, () => {
            onForkFromMessage(entry.index)
          })
          forkButton.disabled = agent.state.isStreaming
          actions.append(forkButton)
        } else {
          const rollbackButton = createIconActionButton('rollback', t('rollback'), rollbackIcon, () => {
            onRollbackFromMessage(entry.index)
          })
          rollbackButton.disabled = agent.state.isStreaming
          actions.append(rollbackButton)
        }

        element.append(actions)
      })
    }

    const decorateEditor = () => {
      const editor = panel.querySelector('message-editor')
      const editorRows = editor?.querySelectorAll<HTMLElement>('.flex.gap-2.items-center')
      const rightControls = editorRows?.[editorRows.length - 1]
      if (!rightControls) return

      if (!workspaceToolsEnabled) {
        rightControls.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')?.remove()
        return
      }

      const yoloIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 8 4 4-4 4"/><path d="M13 16h4"/><rect width="18" height="14" x="3" y="5" rx="2"/></svg>'
      const yoloLabel = `${yoloIcon}<span>YOLO</span><span class="ml-0.5 size-1.5 rounded-full ${yoloMode ? 'bg-emerald-500' : 'bg-muted-foreground/45'}"></span>`
      const yoloClass = `quickforge-yolo-inline inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium ${yoloMode ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`
      const yoloTitle = yoloMode ? t('yoloEnabledTitle') : t('yoloDisabledTitle')

      const handleYoloToggle = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggleYoloMode()
      }

      const handleYoloKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        handleYoloToggle(event)
      }

      const existingButton = rightControls.querySelector<HTMLButtonElement>('.quickforge-yolo-inline')
      if (existingButton) {
        existingButton.innerHTML = yoloLabel
        existingButton.title = yoloTitle
        existingButton.setAttribute('aria-label', yoloTitle)
        existingButton.setAttribute('aria-pressed', String(yoloMode))
        existingButton.className = yoloClass
        existingButton.onpointerdown = handleYoloToggle
        existingButton.onclick = (event) => {
          event.preventDefault()
          event.stopPropagation()
        }
        existingButton.onkeydown = handleYoloKeyDown
        return
      }

      const button = document.createElement('button')
      button.type = 'button'
      button.innerHTML = yoloLabel
      button.title = yoloTitle
      button.setAttribute('aria-label', yoloTitle)
      button.setAttribute('aria-pressed', String(yoloMode))
      button.className = yoloClass
      button.onpointerdown = handleYoloToggle
      button.onclick = (event) => {
        event.preventDefault()
        event.stopPropagation()
      }
      button.onkeydown = handleYoloKeyDown
      rightControls.prepend(button)
    }

    const decorate = () => {
      if (disposed) return
      decorateMessages()
      decorateEditor()
    }

    void panel.setAgent(agent, {
      onApiKeyRequired: (provider) => ApiKeyPromptDialog.prompt(provider),
      onModelSelect,
      toolsFactory: () => getLocalWorkspaceTools(workspaceToolsEnabled && yoloMode, projectId),
    }).then(() => {
      if (restoredDraft && restoredDraftIdRef.current !== restoredDraft.id) {
        restoredDraftIdRef.current = restoredDraft.id
        const agentInterface = panel.querySelector<HTMLElement>('agent-interface') as HTMLElement & {
          setInput?: (text: string, attachments?: unknown[]) => void
        }
        agentInterface?.setInput?.(restoredDraft.text, restoredDraft.attachments)
      }

      decorate()
      observer = new MutationObserver(() => window.requestAnimationFrame(decorate))
      observer.observe(panel, { childList: true, subtree: true })
    })

    hostRef.current.replaceChildren(panel)
    return () => {
      disposed = true
      observer?.disconnect()
      panel.remove()
    }
  }, [agent, onCopyAnswer, onForkFromMessage, onModelSelect, onRollbackFromMessage, onToggleYoloMode, projectId, restoredDraft, revision, workspaceToolsEnabled, yoloMode])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
}

function App() {
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

  const [agent, setAgent] = useState<Agent | null>(null)
  const [sessions, setSessions] = useState<QuickForgeSessionMetadata[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>()
  const [currentTitle, setCurrentTitle] = useState('New chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [ready, setReady] = useState(false)
  const [chatPanelRevision, setChatPanelRevision] = useState(0)
  const [yoloMode, setYoloMode] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft>()
  const [taskStatuses, setTaskStatuses] = useState<Record<string, BackgroundTaskStatus>>({})
  const [chatScope, setChatScope] = useState<ChatScope>('global')
  const [currentToolProject, setCurrentToolProject] = useState<ProjectInfo>()
  const [activeProject, setActiveProject] = useState<ProjectInfo>()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set())
  const [selectingProject, setSelectingProject] = useState(false)

  const loadProject = useCallback(async () => {
    try {
      const response = await fetch('/api/project')
      if (!response.ok) return
      const payload = await response.json()
      activeProjectRef.current = payload.project
      setActiveProject(payload.project)
      setProjects(Array.isArray(payload.projects) ? payload.projects : [])
      setExpandedProjectIds((current) => {
        const next = new Set(current)
        for (const project of Array.isArray(payload.projects) ? payload.projects : []) next.add(project.id)
        return next
      })
    } catch (error) {
      console.error('Failed to load project:', error)
    }
  }, [])

  const switchActiveProject = useCallback(async (projectId: string) => {
    const response = await fetch('/api/project/active', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || `Project switch failed with HTTP ${response.status}`)

    activeProjectRef.current = payload.project
    setActiveProject(payload.project)
    setProjects(Array.isArray(payload.projects) ? payload.projects : [])
    setExpandedProjectIds((current) => {
      const next = new Set(current)
      for (const project of Array.isArray(payload.projects) ? payload.projects : []) next.add(project.id)
      return next
    })
    setChatPanelRevision((value) => value + 1)
    return payload.project as ProjectInfo
  }, [])

  const selectProjectDirectory = useCallback(async () => {
    if (selectingProject) return
    setSelectingProject(true)
    try {
      const response = await fetch('/api/project/select-directory', { method: 'POST' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Project selection failed with HTTP ${response.status}`)
      if (!payload?.cancelled && payload?.project) {
        activeProjectRef.current = payload.project
        setActiveProject(payload.project)
        setProjects(Array.isArray(payload.projects) ? payload.projects : [])
        setExpandedProjectIds((current) => {
          const next = new Set(current)
          for (const project of Array.isArray(payload.projects) ? payload.projects : []) next.add(project.id)
          return next
        })
        setChatPanelRevision((value) => value + 1)
      }
    } catch (error) {
      console.error('Failed to select project:', error)
      alert(error instanceof Error ? error.message : t('failedToSelectProjectDirectory'))
    } finally {
      setSelectingProject(false)
    }
  }, [selectingProject])

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
      const title = task.title === 'New chat' ? generateTitle(messages) : task.title
      const finishedAt = task.status === 'running' ? undefined : (task.finishedAt ?? now)

      task.createdAt = createdAt
      task.title = title
      task.finishedAt = finishedAt

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
        projectId: task.project?.id,
        projectName: task.project?.name,
        projectPath: task.project?.path,
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
        projectId: task.project?.id,
        projectName: task.project?.name,
        projectPath: task.project?.path,
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
      const project = options?.project ?? activeProjectRef.current
      const startedAt = new Date().toISOString()

      const agentForPayload: { current?: Agent } = {}
      const nextAgent = new Agent({
        initialState: {
          systemPrompt: SYSTEM_PROMPT,
          model: activeModelRef.current,
          thinkingLevel: 'off',
          messages: [],
          ...initialState,
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
          window.setTimeout(() => setChatPanelRevision((value) => value + 1), 0)
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

  const startNewGlobalChat = useCallback(async () => {
    const project = activeProjectRef.current
    const sessionId = crypto.randomUUID()

    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url)

    await createAgent(
      { tools: getLocalWorkspaceTools(yoloModeRef.current, project?.id) },
      sessionId,
      { scope: 'global', project, attachToView: true },
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
      let project = activeProjectRef.current
      if (metadata?.projectId || session.projectId) {
        const projectId = (metadata?.projectId ?? session.projectId)!
        if (activeProjectRef.current?.id !== projectId) {
          try {
            project = await switchActiveProject(projectId)
          } catch (error) {
            console.error('Failed to switch project for session:', error)
            if (scope === 'project') {
              alert(t('projectSwitchFailed'))
              return
            }
          }
        }
      }

      activeModelRef.current = session.model as Model<Api>

      await createAgent(
        {
          systemPrompt: SYSTEM_PROMPT,
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

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const storage = storageRef.current
      if (!storage) return

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
      setTaskStatuses((current) => {
        const next = { ...current }
        delete next[sessionId]
        return next
      })
      await storage.sessions.delete(sessionId)
      await refreshSessions()
      if (currentSessionIdRef.current === sessionId) {
        await startNewGlobalChat()
      }
    },
    [refreshSessions, startNewGlobalChat],
  )

  const deleteProject = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId)
      const projectName = project?.name ?? projectId

      const confirmed = await showConfirm({
        title: t('deleteProject'),
        description: t('deleteProjectConfirm').replace('{name}', projectName),
        confirmLabel: t('confirmDelete'),
        cancelLabel: t('cancel'),
      })
      if (!confirmed) return

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
    [projects, refreshSessions],
  )

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const storage = await initializePiStorage()
      if (cancelled) return

      storageRef.current = storage
      await Promise.all([refreshSessions(), loadProject()])

      const savedYoloMode = await loadYoloMode(storage)
      yoloModeRef.current = savedYoloMode
      setYoloMode(savedYoloMode)

      const initialModel = (await loadActiveModel(storage)) ?? buildConnectionModel(DEFAULT_CONNECTION)

      activeModelRef.current = initialModel

      const sessionId = new URLSearchParams(window.location.search).get('session')
      if (sessionId) {
        const existing = await storage.sessions.get(sessionId)
        if (existing) {
          const metadata = (await storage.sessions.getMetadata(existing.id)) as QuickForgeSessionMetadata | null
          const scope = sessionScope(metadata ?? (existing as QuickForgeSessionData))
          let project = activeProjectRef.current
          if (metadata?.projectId || (existing as QuickForgeSessionData).projectId) {
            const projectId = (metadata?.projectId ?? (existing as QuickForgeSessionData).projectId)!
            if (activeProjectRef.current?.id !== projectId) {
              try {
                project = await switchActiveProject(projectId)
              } catch (error) {
                console.error('Failed to switch project for initial session:', error)
                if (scope === 'project') {
                  alert(t('projectSwitchFailed'))
                  await createAgent(
                    { model: initialModel, tools: getLocalWorkspaceTools(yoloModeRef.current, activeProjectRef.current?.id) },
                    crypto.randomUUID(),
                    { scope: 'global', project: activeProjectRef.current, attachToView: true },
                  )
                  setReady(true)
                  return
                }
              }
            }
          }
          activeModelRef.current = existing.model as Model<Api>
          await createAgent(
            {
              systemPrompt: SYSTEM_PROMPT,
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
            { model: initialModel, tools: getLocalWorkspaceTools(yoloModeRef.current, activeProjectRef.current?.id) },
            crypto.randomUUID(),
            { scope: 'global', project: activeProjectRef.current, attachToView: true },
          )
        }
      } else {
        await createAgent(
          { model: initialModel, tools: getLocalWorkspaceTools(yoloModeRef.current, activeProjectRef.current?.id) },
          crypto.randomUUID(),
          { scope: 'global', project: activeProjectRef.current, attachToView: true },
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
  }, [createAgent, loadProject, refreshSessions, switchActiveProject])

  const toggleYoloMode = useCallback(() => {
    const storage = storageRef.current
    const nextMode = !yoloModeRef.current

    yoloModeRef.current = nextMode
    setYoloMode(nextMode)

    if (agentRef.current) {
      setChatPanelRevision((value) => value + 1)
    }

    if (storage) {
      void saveYoloMode(storage, nextMode).catch((error) => {
        console.error('Failed to save YOLO mode:', error)
      })
    }
  }, [])

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
    const project = activeProjectRef.current
    const newSessionId = crypto.randomUUID()
    const title = generateTitle(messages)

    const storage = storageRef.current

    await createAgent(
      {
        systemPrompt: SYSTEM_PROMPT,
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

  const openCustomModelSelector = useCallback(async () => {
    const storage = storageRef.current
    const currentAgent = agentRef.current
    if (!storage || !currentAgent) return

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
      setChatPanelRevision((value) => value + 1)
      void saveActiveModel(storage, nextModel).catch((error) => {
        console.error('Failed to save active model:', error)
      })
    })
  }, [])

  const globalSessions = sessions.filter((session) => sessionScope(session) === 'global')
  const sessionsForProject = (projectId: string) => {
    return sessions.filter((session) => sessionScope(session) === 'project' && session.projectId === projectId)
  }
  const sessionTaskStatus = (session: QuickForgeSessionMetadata) => {
    return taskStatuses[session.id] ?? session.taskStatus ?? 'idle'
  }
  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  if (!ready || !agent) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">{t('loadingChatWorkspace')}</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <aside
        className={cn(
          'hidden min-h-0 shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col',
          sidebarOpen ? 'w-80' : 'w-0 overflow-hidden border-r-0',
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="text-sm font-medium text-muted-foreground">{t('projects')}</div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={selectProjectDirectory}
                disabled={selectingProject}
                aria-label={t('addProject')}
              >
                <Plus className="size-4" />
              </Button>
            </div>

            <div className="space-y-1">
              {projects.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">{t('noProjects')}</div>
              ) : (
                projects.map((item) => {
                  const projectSessions = sessionsForProject(item.id)
                  const expanded = expandedProjectIds.has(item.id)
                  const active = activeProject?.id === item.id

                  return (
                    <div key={item.id}>
                      <div
                        className={cn(
                          'group flex items-center gap-1 rounded-md px-1 py-1.5',
                          active ? 'bg-secondary' : 'hover:bg-secondary/70',
                        )}
                      >
                        <button
                          type="button"
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                          onClick={() => toggleProjectExpanded(item.id)}
                          aria-label={expanded ? t('collapseProject') : t('expandProject')}
                        >
                          {expanded ? (
                            <FolderOpen className="size-4 text-muted-foreground" />
                          ) : (
                            <Folder className="size-4 text-muted-foreground" />
                          )}
                        </button>
                        <button
                          className="flex min-w-0 flex-1 items-center text-left"
                          type="button"
                          title={item.path}
                          onClick={() => toggleProjectExpanded(item.id)}
                        >
                          <span className="truncate text-sm font-medium">{item.name}</span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
                          onClick={() => startNewProjectChat(item)}
                          aria-label={t('newProjectChat')}
                        >
                          <MessageSquarePlus className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
                          onClick={() => deleteProject(item.id)}
                          aria-label={t('deleteProject')}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      {expanded ? (
                        <div className="ml-4 mt-1 border-l-2 border-border pl-4 space-y-0.5">
                          {projectSessions.length === 0 ? (
                            <div className="py-1.5 text-sm text-muted-foreground/70">{t('noConversations')}</div>
                          ) : (
                            projectSessions.map((session) => (
                              <div
                                key={session.id}
                                className={cn(
                                  'group flex items-start gap-1 rounded-md px-2 py-1.5',
                                  currentSessionId === session.id ? 'bg-secondary' : 'hover:bg-secondary/70',
                                )}
                              >
                                <button className="min-w-0 flex-1 text-left" type="button" onClick={() => loadSession(session.id)}>
                                  <div className="flex items-center gap-1 truncate text-sm">
                                    {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                                    <span className="truncate">{sessionTitle(session.title)}</span>
                                  </div>
                                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{formatSessionTime(session.lastModified)}</div>
                                </button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                                  onClick={() => deleteSession(session.id)}
                                  aria-label={t('deleteSession')}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <div className="text-sm font-medium text-muted-foreground">{t('conversations')}</div>
              <Button variant="ghost" size="icon" className="size-7" onClick={startNewGlobalChat} aria-label={t('newChat')}>
                <MessageSquarePlus className="size-4" />
              </Button>
            </div>

            {globalSessions.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">{t('noSavedConversations')}</div>
            ) : (
              <div className="space-y-1">
                {globalSessions.map((session) => (
                  <div
                    key={session.id}
                    className={cn(
                      'group flex items-start gap-2 rounded-md px-2 py-2 text-left',
                      currentSessionId === session.id ? 'bg-secondary' : 'hover:bg-secondary/70',
                    )}
                  >
                    <button className="min-w-0 flex-1 text-left" type="button" onClick={() => loadSession(session.id)}>
                      <div className="flex items-center gap-1 truncate text-sm font-medium">
                        {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                        <span className="truncate">{sessionTitle(session.title)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{formatSessionTime(session.lastModified)}</div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 opacity-0 group-hover:opacity-100"
                      onClick={() => deleteSession(session.id)}
                      aria-label={t('deleteSession')}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

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
              {chatScope === 'project' ? (currentToolProject?.name ?? t('projectChat')) : `${t('normalChat')}${currentToolProject ? ` · ${currentToolProject.name}` : ''}`}
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
  )
}

export default App
