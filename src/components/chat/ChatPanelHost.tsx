import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppStorage } from '@mariozechner/pi-web-ui'
import {
  ApiKeyPromptDialog,
  ChatPanel,
} from '@mariozechner/pi-web-ui'
import type { ServerAgent, ServerAgentContextCompaction, ServerAgentContextUsage } from '@/lib/server-agent'
import type { SharedServerAgent } from '@/lib/shared-server-agent'
import type { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import { getLocalWorkspaceTools } from '@/lib/local-tools'
import type { ComposerDraft, CustomCommandSummary, MessageWithUsage } from './chat-utils'
import { emptyDraft, hasDraft } from './chat-utils'
import { createScrollSync } from './scroll-sync'
import { createCommandSuggestions } from './command-suggestions'
import { createContextUsageIndicator } from './context-usage'
import { decorateMessages, decorateEditor, captureComposerDraft, readComposerDraft, restoreComposerDraft, injectApprovalCard, removeApprovalCard, syncAssistantWaitingBubble, syncContextCompactionNotice } from './panel-decoration'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { getGitStatus } from '../workspace/workspace-api'
import type { ChatScope, ProjectInfo, RestoredDraft } from '@/lib/types'
import {
  buildComposerDraftKey,
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
  type ComposerDraftContext,
} from '@/lib/composer-drafts'

type AgentLike = ServerAgent | SharedServerAgent | DeferredSessionAgent

type AgentWithContextCompaction = AgentLike & {
  state: AgentLike['state'] & {
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
  }
}

function effectiveContextMessages(agent: AgentLike): MessageWithUsage[] {
  const state = (agent as AgentWithContextCompaction).state
  const compaction = state.contextCompaction
  if (!compaction?.summaryMessage) return agent.state.messages as MessageWithUsage[]
  const messages = agent.state.messages as MessageWithUsage[]
  const compactedUpToIndex = Math.min(messages.length, Math.max(0, Number(compaction.compactedUpToIndex) || 0))
  return [compaction.summaryMessage as MessageWithUsage, ...messages.slice(compactedUpToIndex)]
}

type ChatPanelHostProps = {
  agent: AgentLike | null
  onModelSelect?: () => void
  revision: number
  yoloMode: boolean
  workspaceToolsEnabled: boolean
  project?: ProjectInfo
  projectId?: string
  chatScope?: ChatScope
  storage?: AppStorage | null
  onToggleYoloMode: () => void
  onRollbackFromMessage: (messageIndex: number) => void
  onRetryFromMessage: (messageIndex: number) => void
  onCopyAnswer: (text: string) => Promise<void> | void
  onForkFromMessage: (messageIndex: number) => void
  onApproveToolCall: (toolCallId: string) => Promise<void> | void
  onRejectToolCall: (toolCallId: string) => Promise<void> | void
  onApproveAutoCompact?: (approvalId: string) => Promise<void> | void
  onRejectAutoCompact?: (approvalId: string) => Promise<void> | void
  onOpenWorkspaceGitChanges?: () => void
  onOpenLocalFilePath?: (path: string) => void
  restoredDraft?: RestoredDraft
  disableFork?: boolean
  readOnly?: boolean
  bypassClientApiKeyCheck?: boolean
  allowModelControls?: boolean
}

/**
 * Stable ref container for props that should NOT trigger panel recreation.
 * Updated synchronously every render so the latest value is always available
 * inside closures (e.g. MutationObserver callbacks, event handlers).
 */
type PropsRef = {
  onCopyAnswer: (text: string) => Promise<void> | void
  onRollbackFromMessage: (messageIndex: number) => void
  onRetryFromMessage: (messageIndex: number) => void
  onForkFromMessage: (messageIndex: number) => void
  onToggleYoloMode: () => void
  onApproveToolCall: (toolCallId: string) => Promise<void> | void
  onRejectToolCall: (toolCallId: string) => Promise<void> | void
  onApproveAutoCompact?: (approvalId: string) => Promise<void> | void
  onRejectAutoCompact?: (approvalId: string) => Promise<void> | void
  onOpenWorkspaceGitChanges?: () => void
  onOpenLocalFilePath?: (path: string) => void
  onModelSelect?: () => void
  yoloMode: boolean
  workspaceToolsEnabled: boolean
  disableFork: boolean
  readOnly: boolean
  allowModelControls: boolean
  bypassClientApiKeyCheck: boolean
  gitBranch?: string
}

export function ChatPanelHost({
  agent,
  onModelSelect,
  revision,
  yoloMode,
  workspaceToolsEnabled,
  project,
  projectId,
  chatScope = 'global',
  storage = null,
  onToggleYoloMode,
  onRollbackFromMessage,
  onRetryFromMessage,
  onCopyAnswer,
  onForkFromMessage,
  onApproveToolCall,
  onRejectToolCall,
  onApproveAutoCompact,
  onRejectAutoCompact,
  onOpenWorkspaceGitChanges,
  onOpenLocalFilePath,
  restoredDraft,
  disableFork = false,
  readOnly = false,
  bypassClientApiKeyCheck = false,
  allowModelControls = true,
}: ChatPanelHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const restoredDraftIdRef = useRef<number | undefined>(undefined)
  const restoredDraftRef = useRef<RestoredDraft | undefined>(undefined)
  const composerDraftsRef = useRef<Map<string, ComposerDraft>>(new Map())
  const storageRef = useRef<AppStorage | null>(storage)
  const customCommandsRef = useRef<CustomCommandSummary[]>([])
  const lastAppliedRestoredDraftRef = useRef<{ id: number; text: string } | undefined>(undefined)
  const consumedRestoredDraftIdsRef = useRef<Set<number>>(new Set())
  const saveDraftTimerRef = useRef<number | undefined>(undefined)
  const [gitBranch, setGitBranch] = useState<string>()

  const cancelPendingDraftSave = useCallback(() => {
    if (!saveDraftTimerRef.current) return
    window.clearTimeout(saveDraftTimerRef.current)
    saveDraftTimerRef.current = undefined
  }, [])

  useEffect(() => {
    storageRef.current = storage
  }, [storage])

  const draftContext: ComposerDraftContext = useMemo(() => ({
    sessionId: agent?.sessionId,
    scope: chatScope,
    projectId,
  }), [agent?.sessionId, chatScope, projectId])
  const draftKey = buildComposerDraftKey(draftContext)
  const draftContextRef = useRef(draftContext)
  const draftKeyRef = useRef(draftKey)

  useEffect(() => {
    draftContextRef.current = draftContext
    draftKeyRef.current = draftKey
  }, [draftContext, draftKey])

  useEffect(() => {
    return () => {
      cancelPendingDraftSave()
    }
  }, [cancelPendingDraftSave])

  const persistDraft = useCallback((key: string, draft: ComposerDraft, context: ComposerDraftContext) => {
    const storage = storageRef.current
    if (!storage) return
    if (draft.text.length === 0) {
      void clearComposerDraft(storage, key).catch((err) => logger.error('Failed to clear composer draft:', err))
      return
    }
    void saveComposerDraft(storage, key, draft, context).catch((err) => logger.error('Failed to save composer draft:', err))
  }, [])

  const schedulePersistDraft = useCallback((key: string, draft: ComposerDraft, context: ComposerDraftContext) => {
    if (saveDraftTimerRef.current) window.clearTimeout(saveDraftTimerRef.current)
    saveDraftTimerRef.current = window.setTimeout(() => {
      saveDraftTimerRef.current = undefined
      persistDraft(key, draft, context)
    }, 400)
  }, [persistDraft])

  const persistCurrentComposerDraft = useCallback((panel: HTMLElement, key = draftKeyRef.current, context = draftContextRef.current) => {
    const draft = readComposerDraft(panel)
    if (hasDraft(draft)) {
      composerDraftsRef.current.set(key, draft)
    } else {
      composerDraftsRef.current.delete(key)
    }
    persistDraft(key, draft, context)
  }, [persistDraft])

  // --- Stable ref for props (avoids re-creating panel on callback changes) ---
  const propsRef = useRef<PropsRef>({
    onCopyAnswer,
    onRollbackFromMessage,
    onRetryFromMessage,
    onForkFromMessage,
    onToggleYoloMode,
    onApproveToolCall,
    onRejectToolCall,
    onApproveAutoCompact,
    onRejectAutoCompact,
    onOpenWorkspaceGitChanges,
    onOpenLocalFilePath,
    onModelSelect,
    yoloMode,
    workspaceToolsEnabled,
    disableFork,
    readOnly,
    allowModelControls,
    bypassClientApiKeyCheck,
    gitBranch,
  })
  // Keep ref in sync with the latest props so closures always read fresh values.
  // Using useEffect (instead of render-time assignment) satisfies the
  // react-hooks/refs lint rule while still being synchronous enough.
  useEffect(() => {
    propsRef.current = {
      onCopyAnswer,
      onRollbackFromMessage,
      onRetryFromMessage,
      onForkFromMessage,
      onToggleYoloMode,
      onApproveToolCall,
      onRejectToolCall,
      onApproveAutoCompact,
      onRejectAutoCompact,
      onOpenWorkspaceGitChanges,
      onOpenLocalFilePath,
      onModelSelect,
      yoloMode,
      workspaceToolsEnabled,
      disableFork,
      readOnly,
      allowModelControls,
      bypassClientApiKeyCheck,
      gitBranch,
    }
    restoredDraftRef.current = restoredDraft
  })

  const gitProjectId = project?.id ?? projectId

  useEffect(() => {
    let disposed = false

    queueMicrotask(() => {
      if (disposed) return
      if (!gitProjectId) {
        setGitBranch(undefined)
        return
      }

      getGitStatus(gitProjectId)
        .then((status) => {
          if (disposed) return
          setGitBranch(status.isGitRepository ? status.branch : undefined)
        })
        .catch((err: unknown) => {
          if (disposed) return
          logger.warn('Failed to load git branch:', err)
          setGitBranch(undefined)
        })
    })

    return () => { disposed = true }
  }, [gitProjectId, revision])

  // --- Refs that let the decoration trigger effect call into the active panel ---
  const decorateFnRef = useRef<(() => void) | null>(null)
  const scrollSyncRef = useRef<ReturnType<typeof createScrollSync> | null>(null)
  const scheduleDecorateRef = useRef<(() => void) | null>(null)
  const pendingApprovalRef = useRef<{ toolCallId: string; toolName: string; args: Record<string, unknown>; sessionId: string; source?: import('./panel-decoration').ToolApprovalSource } | null>(null)
  const pendingAutoCompactApprovalRef = useRef<{ approvalId: string; usage?: { percent?: number }; thresholdPercent?: number; keepRecentTurns?: number; sessionId: string } | null>(null)

  // --- Load custom commands for the current project ---
  useEffect(() => {
    let disposed = false

    if (!project?.id) {
      customCommandsRef.current = []
      return () => { disposed = true }
    }

    fetch(`/api/project/commands?projectId=${encodeURIComponent(project.id)}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { commands: [] })
      .then((payload: { commands?: CustomCommandSummary[] }) => {
        if (disposed) return
        customCommandsRef.current = Array.isArray(payload.commands) ? payload.commands : []
      })
      .catch(() => {
        if (!disposed) customCommandsRef.current = []
      })

    return () => { disposed = true }
  }, [project?.id, revision])

  const restoreDraftForSession = (panel: HTMLElement, draft: RestoredDraft, sessionId: string, key: string, force = false) => {
    if (draft.sessionId && draft.sessionId !== sessionId) return
    if (!hasDraft(draft)) return
    if (!force && consumedRestoredDraftIdsRef.current.has(draft.id)) return

    const apply = () => {
      if (!force && consumedRestoredDraftIdsRef.current.has(draft.id)) return
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
      const currentDraft = editor
        ? {
            text: editor.value ?? editor.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '',
            attachments: editor.attachments ? [...editor.attachments] : [],
          }
        : composerDraftsRef.current.get(key)
      const lastApplied = lastAppliedRestoredDraftRef.current
      const isFirstApplyForDraft = lastApplied?.id !== draft.id
      const canApply = isFirstApplyForDraft || !hasDraft(currentDraft ?? emptyDraft()) || currentDraft?.text === lastApplied.text
      if (!canApply) return

      restoreComposerDraft(panel, draft, composerDraftsRef.current, key)
      lastAppliedRestoredDraftRef.current = { id: draft.id, text: draft.text }
    }

    apply()
    window.requestAnimationFrame(apply)
    for (const delay of [0, 50, 150, 300, 600]) {
      window.setTimeout(apply, delay)
    }

    const agentInterface = panel.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>('agent-interface')
    void agentInterface?.updateComplete?.then(apply)
  }

  // =========================================================================
  // Main effect: create the ChatPanel and wire up all subsystems.
  // ONLY re-runs when `agent` changes — all other prop changes are picked up
  // via propsRef or the decoration trigger effect below.
  // =========================================================================
  useEffect(() => {
    if (!hostRef.current || !agent) return

    const panel = new ChatPanel()
    const sessionId = agent.sessionId
    const currentDraftKey = draftKeyRef.current
    const currentDraftContext = draftContextRef.current
    let disposed = false
    let observer: MutationObserver | undefined
    let composerClearedForSend = false
    let assistantWaitingStartedAt: number | undefined
    let assistantWaitingTimer: number | undefined

    const stopAssistantWaitingTimer = () => {
      if (!assistantWaitingTimer) return
      window.clearInterval(assistantWaitingTimer)
      assistantWaitingTimer = undefined
    }

    const startAssistantWaitingTimer = () => {
      if (assistantWaitingTimer) return
      assistantWaitingTimer = window.setInterval(() => {
        scheduleDecorateRef.current?.()
      }, 160)
    }

    // --- Scroll sync subsystem ---
    const scrollSync = createScrollSync({ panel })
    scrollSyncRef.current = scrollSync

    // --- Command suggestions subsystem ---
    const cmdSuggestions = createCommandSuggestions({
      panel,
      getCustomCommands: () => customCommandsRef.current,
      getComposerDrafts: () => composerDraftsRef.current,
      sessionId: currentDraftKey,
      setComposerDrafts: (drafts) => { composerDraftsRef.current = drafts },
      restoreDraftIntoComposer: (draft) => {
        restoreComposerDraft(panel, draft, composerDraftsRef.current, currentDraftKey)
        schedulePersistDraft(currentDraftKey, draft, currentDraftContext)
      },
    })

    // --- Context usage subsystem ---
    const contextUsage = createContextUsageIndicator({
      panel,
      getSystemPrompt: () => agent.state.systemPrompt,
      getMessages: () => agent.state.messages as MessageWithUsage[],
      getEffectiveMessages: () => effectiveContextMessages(agent),
      getContextWindow: () => agent.state.model?.contextWindow ?? 0,
      getTools: () => agent.state.tools,
      getMaxTokens: () => agent.state.model?.maxTokens,
      getServerContextUsage: () => (agent as AgentWithContextCompaction).state.contextUsage ?? null,
      getGitBranch: () => propsRef.current.gitBranch,
      onGitBranchClick: () => propsRef.current.onOpenWorkspaceGitChanges?.(),
    })

    // --- Composer input/file-change handlers (update draft map) ---
    const handleEditorInput = (value: string) => {
      composerClearedForSend = false
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
      const attachments = editor?.attachments ? [...editor.attachments] : []
      const draft = { text: value, attachments }
      if (hasDraft(draft)) {
        composerDraftsRef.current.set(currentDraftKey, draft)
      } else {
        composerDraftsRef.current.delete(currentDraftKey)
      }
      schedulePersistDraft(currentDraftKey, draft, currentDraftContext)
    }
    const handleEditorFilesChange = (files: unknown[]) => {
      composerClearedForSend = false
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
      const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
      const text = editor?.value ?? textarea?.value ?? ''
      const draft = { text, attachments: files ? [...files] : [] }
      if (hasDraft(draft)) {
        composerDraftsRef.current.set(currentDraftKey, draft)
      } else {
        composerDraftsRef.current.delete(currentDraftKey)
      }
      schedulePersistDraft(currentDraftKey, draft, currentDraftContext)
    }

    // --- The core decoration function (called on DOM changes & prop changes) ---
    const decorate = () => {
      if (disposed) return
      if (!panel.isConnected) return

      const props = propsRef.current

      // Wrap message/editor decoration so a failure in one does not block
      // the approval card from rendering — the approval card is critical UI
      // that must always appear when a tool call is pending.
      try {
        decorateMessages({
          panel,
          getMessages: () => agent.state.messages as import('./chat-utils').MessageWithUsage[],
          isStreaming: () => agent.state.isStreaming,
          onCopyAnswer: props.onCopyAnswer,
          onRollbackFromMessage: props.onRollbackFromMessage,
          onRetryFromMessage: props.onRetryFromMessage,
          onForkFromMessage: props.onForkFromMessage,
          onOpenLocalFilePath: props.onOpenLocalFilePath,
          disableFork: props.disableFork,
          enableTerminalCommandActions: !props.readOnly,
        })
        syncContextCompactionNotice({
          panel,
          getMessages: () => agent.state.messages as MessageWithUsage[],
          getContextCompaction: () => (agent as AgentWithContextCompaction).state.contextCompaction ?? null,
        })
        syncAssistantWaitingBubble({
          panel,
          getMessages: () => agent.state.messages as MessageWithUsage[],
          isStreaming: () => agent.state.isStreaming,
          startedAt: assistantWaitingStartedAt,
        })
      } catch { /* continue to editor & approval card */ }

      try {
        decorateEditor({
          panel,
          isStreaming: () => agent.state.isStreaming,
          abort: () => agent.abort(),
          yoloMode: props.yoloMode,
          workspaceToolsEnabled: props.workspaceToolsEnabled,
          readOnly: props.readOnly,
          allowModelControls: props.allowModelControls,
          onToggleYoloMode: props.onToggleYoloMode,
          onInput: handleEditorInput,
          onFilesChange: handleEditorFilesChange,
          removeCommandSuggestions: cmdSuggestions.remove,
          updateCommandSuggestions: cmdSuggestions.update,
          setupCommandTextareaHandler: cmdSuggestions.setupTextareaHandler,
        })
      } catch { /* continue to approval card */ }

      // Render or remove approval card based on pending state.
      // Must match the current session — otherwise a pending approval from a
      // different session would leak into this panel.
      const pending = pendingApprovalRef.current
      if (pending && pending.sessionId === agent.sessionId) {
        // Capture the toolCallId now — propsRef.current may change by click time
        const capturedToolCallId = pending.toolCallId
        injectApprovalCard(
          {
            panel,
            onApprove: async () => { await propsRef.current.onApproveToolCall(capturedToolCallId); pendingApprovalRef.current = null; removeApprovalCard(panel) },
            onReject: async () => { await propsRef.current.onRejectToolCall(capturedToolCallId); pendingApprovalRef.current = null; removeApprovalCard(panel) },
          },
          pending.toolName,
          capturedToolCallId,
          pending.args,
          pending.source,
        )
      } else {
        const pendingAutoCompact = pendingAutoCompactApprovalRef.current
        if (pendingAutoCompact && pendingAutoCompact.sessionId === agent.sessionId) {
          const capturedApprovalId = pendingAutoCompact.approvalId
          injectApprovalCard(
            {
              panel,
              onApprove: async () => { await propsRef.current.onApproveAutoCompact?.(capturedApprovalId); pendingAutoCompactApprovalRef.current = null; removeApprovalCard(panel) },
              onReject: async () => { await propsRef.current.onRejectAutoCompact?.(capturedApprovalId); pendingAutoCompactApprovalRef.current = null; removeApprovalCard(panel) },
            },
            t('contextManagement'),
            capturedApprovalId,
            {
              percent: pendingAutoCompact.usage?.percent ?? 0,
              threshold: pendingAutoCompact.thresholdPercent ?? 0,
              keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 2,
              summary: t('autoCompactApprovalWaiting', {
                percent: pendingAutoCompact.usage?.percent ?? 0,
                threshold: pendingAutoCompact.thresholdPercent ?? 0,
              }),
              description: t('autoCompactApprovalPreview', { keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 2 }),
            },
          )
        } else {
          removeApprovalCard(panel)
        }
      }

      contextUsage.update()
      scrollSync.setup()
      if (scrollSync.isEnabled) scrollSync.scheduleScrollToBottom()
    }

    // Expose for the decoration trigger effect
    decorateFnRef.current = decorate

    // --- Schedule decoration via rAF to batch DOM mutations ---
    let decorateScheduled = false
    const scheduleDecorate = () => {
      if (decorateScheduled) return
      decorateScheduled = true
      window.requestAnimationFrame(() => {
        decorateScheduled = false
        decorate()
      })
    }
    scheduleDecorateRef.current = scheduleDecorate

    // --- Initialize panel ---
    void panel.setAgent(agent as unknown as Parameters<typeof panel.setAgent>[0], {
      onApiKeyRequired: propsRef.current.bypassClientApiKeyCheck
        ? async () => true
        : (provider: string) => ApiKeyPromptDialog.prompt(provider),
      onBeforeSend: () => {
        const draft = restoredDraftRef.current
        if (draft) consumedRestoredDraftIdsRef.current.add(draft.id)
        cancelPendingDraftSave()
        composerClearedForSend = true
        cmdSuggestions.remove()
        composerDraftsRef.current.delete(currentDraftKey)
        const storage = storageRef.current
        if (storage) {
          void clearComposerDraft(storage, currentDraftKey).catch((err) => logger.error('Failed to clear composer draft:', err))
        }
        scrollSync.enable()
      },
      onModelSelect: propsRef.current.onModelSelect,
      toolsFactory: () => getLocalWorkspaceTools(agent.state.tools),
    }).then(() => {
      if (disposed) return

      // Restore draft
      const draft = restoredDraftRef.current
      const restoreStoredDraft = (storedDraft?: ComposerDraft) => {
        if (disposed) return
        if (draft && restoredDraftIdRef.current !== draft.id) {
          restoredDraftIdRef.current = draft.id
          restoreDraftForSession(panel, draft, sessionId, currentDraftKey)
        } else {
          restoreComposerDraft(panel, storedDraft ?? composerDraftsRef.current.get(currentDraftKey) ?? emptyDraft(), composerDraftsRef.current, currentDraftKey)
        }
      }
      if (draft && restoredDraftIdRef.current !== draft.id) {
        restoreStoredDraft()
      } else {
        const memoryDraft = composerDraftsRef.current.get(currentDraftKey)
        if (memoryDraft) {
          restoreStoredDraft(memoryDraft)
        } else if (storageRef.current) {
          void loadComposerDraft(storageRef.current, currentDraftKey)
            .then((storedDraft) => restoreStoredDraft(storedDraft))
            .catch((err) => logger.error('Failed to load composer draft:', err))
        } else {
          restoreStoredDraft()
        }
      }

      // Observe DOM changes for re-decoration
      observer = new MutationObserver(scheduleDecorate)
      observer.observe(panel, { childList: true, subtree: true })

      // Defer initial decoration to the next animation frame so the Lit
      // component has time to finish its first render. Without this the
      // approval card (and other decorations) may be injected into a DOM
      // that is not yet fully laid out, causing style discrepancies.
      window.requestAnimationFrame(() => {
        if (disposed) return
        decorate()
      })
    })

    hostRef.current.replaceChildren(panel)

    // --- Subscribe to agent events for auto-scroll and tool approvals ---
    const unsubscribeScrollEvents = agent.subscribe((event) => {
      if (event.type === 'agent_start') {
        assistantWaitingStartedAt = Date.now()
        startAssistantWaitingTimer()
        scheduleDecorateRef.current?.()
        scrollSync.enable()
        // A new run started — clear any pending approval for this session
        if (pendingApprovalRef.current?.sessionId === agent.sessionId) {
          pendingApprovalRef.current = null
        }
        if (pendingAutoCompactApprovalRef.current?.sessionId === agent.sessionId) {
          pendingAutoCompactApprovalRef.current = null
        }
      }
      if (event.type === 'message_start' || event.type === 'message_update' || event.type === 'message_end' || event.type === 'turn_end' || event.type === 'agent_end') {
        const eventMessage = (event as { message?: { role?: string } }).message
        if (event.type === 'message_update' || eventMessage?.role === 'assistant') {
          assistantWaitingStartedAt = undefined
          stopAssistantWaitingTimer()
        }
        scheduleDecorateRef.current?.()
        if (scrollSync.isEnabled) scrollSync.scheduleScrollToBottom()
      }
      if ((event as { type: string }).type === 'messages_replaced') {
        const draft = restoredDraftRef.current
        if (draft && restoredDraftIdRef.current === draft.id) {
          restoreDraftForSession(panel, draft, sessionId, currentDraftKey)
        }
      }
      const eventType = (event as { type: string }).type
      if (eventType === 'tool_execution_start' || eventType === 'tool_execution_update' || eventType === 'tool_execution_end') {
        const agentInterface = panel.querySelector('agent-interface') as { requestUpdate?: () => void } | null
        agentInterface?.requestUpdate?.()
        if (scrollSync.isEnabled) scrollSync.scheduleScrollToBottom()
      }
      if (event.type === 'agent_end') {
        assistantWaitingStartedAt = undefined
        stopAssistantWaitingTimer()
        scheduleDecorateRef.current?.()
        // Run finished (or aborted) — clear pending approval for this session
        if (pendingApprovalRef.current?.sessionId === agent.sessionId) {
          pendingApprovalRef.current = null
          scheduleDecorateRef.current?.()
        }
        if (pendingAutoCompactApprovalRef.current?.sessionId === agent.sessionId) {
          pendingAutoCompactApprovalRef.current = null
          scheduleDecorateRef.current?.()
        }
      }
      if (eventType === 'auto_compact_completed' || eventType === 'messages_replaced') {
        const agentInterface = panel.querySelector('agent-interface') as { requestUpdate?: () => void; updateComplete?: Promise<unknown> } | null
        agentInterface?.requestUpdate?.()
        scheduleDecorateRef.current?.()
        window.requestAnimationFrame(() => scheduleDecorateRef.current?.())
        void agentInterface?.updateComplete?.then(() => scheduleDecorateRef.current?.())
      }
      if (eventType === 'auto_compact_failed') {
        // Keep the failure visible in diagnostics without interrupting the current answer.
        logger.warn(t('autoCompactFailed'))
      }
      // Store pending approval and trigger re-decoration
      if ((event as Record<string, unknown>).type === 'tool_approval_required') {
        const approvalEvent = event as unknown as { toolCallId: string; toolName: string; args: Record<string, unknown>; sessionId: string; source?: import('./panel-decoration').ToolApprovalSource }
        pendingApprovalRef.current = { toolCallId: approvalEvent.toolCallId, toolName: approvalEvent.toolName, args: approvalEvent.args, sessionId: approvalEvent.sessionId, source: approvalEvent.source }
        scheduleDecorateRef.current?.()
      }
      if ((event as Record<string, unknown>).type === 'auto_compact_approval_required') {
        const approvalEvent = event as unknown as { approvalId: string; usage?: { percent?: number }; thresholdPercent?: number; keepRecentTurns?: number; sessionId: string }
        pendingAutoCompactApprovalRef.current = {
          approvalId: approvalEvent.approvalId,
          usage: approvalEvent.usage,
          thresholdPercent: approvalEvent.thresholdPercent,
          keepRecentTurns: approvalEvent.keepRecentTurns,
          sessionId: approvalEvent.sessionId,
        }
        scheduleDecorateRef.current?.()
      }
    })

    return () => {
      if (composerClearedForSend) {
        cancelPendingDraftSave()
        composerDraftsRef.current.delete(currentDraftKey)
        const storage = storageRef.current
        if (storage) {
          void clearComposerDraft(storage, currentDraftKey).catch((err) => logger.error('Failed to clear composer draft:', err))
        }
      } else {
        captureComposerDraft(panel, composerDraftsRef.current, currentDraftKey)
        persistCurrentComposerDraft(panel, currentDraftKey, currentDraftContext)
      }
      cmdSuggestions.remove()
      cmdSuggestions.cleanupTextareaHandler()
      disposed = true
      stopAssistantWaitingTimer()
      scrollSync.cleanup()
      scrollSyncRef.current = null
      unsubscribeScrollEvents()
      observer?.disconnect()
      decorateFnRef.current = null
      panel.remove()
    }
  }, [agent, cancelPendingDraftSave, persistCurrentComposerDraft, schedulePersistDraft]) // ← ONLY agent triggers panel recreation; callback deps are stable

  // =========================================================================
  // Decoration trigger: re-run decoration when UI props change (without
  // recreating the entire panel). This is the key improvement — previously
  // all 16 dependencies caused a full panel rebuild.
  // =========================================================================
  useEffect(() => {
    decorateFnRef.current?.()
    // model/thinkingLevel 等状态已通过 agent.state 写入，但 Lit 组件不会自动感知
    // 外部对 state.model 的直接赋值，需要手动触发重渲染才能刷新模型名称等 UI。
    const ai = hostRef.current?.querySelector('agent-interface') as { requestUpdate?: () => void } | null
    ai?.requestUpdate?.()
  }, [yoloMode, workspaceToolsEnabled, gitBranch, disableFork, readOnly, allowModelControls, revision])

  // Draft restoration trigger
  useEffect(() => {
    const draft = restoredDraftRef.current
    if (!draft || !hostRef.current) return
    const sessionId = (agent as ServerAgent | SharedServerAgent | null)?.sessionId ?? ''
    if (draft.sessionId && draft.sessionId !== sessionId) return
    const panel = hostRef.current.querySelector('pi-chat-panel')
    if (!panel) return
    restoredDraftIdRef.current = draft.id
    restoreDraftForSession(panel as HTMLElement, draft, sessionId, draftKeyRef.current, true)
  }, [restoredDraft, agent])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
}
