import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiKeyPromptDialog,
  ChatPanel,
} from '@earendil-works/pi-web-ui'
import type { ServerAgent, ServerAgentAskAnswer, ServerAgentContextCompaction, ServerAgentContextUsage, ServerAgentPendingAsk, ServerAgentPendingAutoCompactApproval, ServerAgentPendingToolApproval, OpenCodeAcpSession, FileContextReference } from '@/lib/server-agent'
import type { SharedServerAgent } from '@/lib/shared-server-agent'
import type { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import type { SideChatAgent } from '@/components/workspace/side-chat-agent'
import { getLocalWorkspaceTools } from '@/lib/local-tools'
import { isManagedQuickForgeCloudModel } from '@/lib/managed-cloud-model'
import type { AgentInterfaceElement, ComposerDraft, CustomCommandSummary, MessageWithUsage } from './chat-utils'
import { emptyDraft, hasDraft } from './chat-utils'
import { createScrollSync } from './scroll-sync'
import {
  createMessageWindow,
  installMessageListWindow,
  uninstallMessageListWindow,
} from './windowed-messages'
import { createCommandSuggestions } from './command-suggestions'
import { fetchSlashCatalog } from '@/lib/slash-catalog'
import { createCapabilitySuggestions } from './capability-suggestions'
import { createFileReferenceSuggestions, canUseFileReferenceSuggestions } from './file-reference-suggestions'
import { removeComposerPlusPopover } from './panel-decoration/composer-plus-menu'
import { createContextUsageIndicator, type ContextUsageDisplayInfo } from './context-usage'
import { createOpenCodeUsageIndicator } from './panel-decoration'
import { createTurnNavigation } from './turn-navigation'
import {
  decorateMessages,
  decorateEditor,
  captureComposerDraft,
  readComposerDraft,
  restoreComposerDraft,
  scheduleComposerDraftRestore,
  injectApprovalCard,
  removeApprovalCard,
  injectAskUserCard,
  removeAskUserCard,
  releaseStreamingProcessGroups,
  syncAssistantWaitingBubble,
  syncContextCompactionNotice,
  syncPersistDegradedNotice,
  createScrollToBottomButton,
  createTodoWriteSummaryController,
  type ComposerDraftRestoreHandle,
} from './panel-decoration'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { scheduleAfterPaint } from '@/lib/schedule-after-paint'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { extractSessionArtifacts, type AiTurnArtifact } from '@/lib/tool-artifacts'
import { getGitStatus } from '../workspace/workspace-api'
import { requestAndroidRemoteSystemNotificationPermissionOnce } from '@/lib/system-notifications'
import type { ChatHarnessCapabilities } from '@/lib/chat-harness-capabilities'
import { applyChatPagePolicy, QUICKFORGE_CHAT_HARNESS_CAPABILITIES, SIDE_CHAT_UI_CAPABILITIES } from '@/lib/chat-harness-capabilities'
import { withPreservedArtifactsRenderer } from './side-chat-renderer-isolation'
import type { ChatScope, ProjectInfo, RestoredDraft, AgentAccessMode } from '@/lib/types'
import {
  buildComposerDraftKey,
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
  createComposerDraftRestoreGuard,
  rememberConsumedRestoredDraftId,
  type ComposerDraftContext,
} from '@/lib/composer-drafts'

type AgentLike = ServerAgent | SharedServerAgent | DeferredSessionAgent | SideChatAgent

type MessageListElement = HTMLElement & {
  messages: unknown[]
  updateComplete?: Promise<unknown>
}

type AgentWithContextCompaction = AgentLike & {
  state: AgentLike['state'] & {
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
    pendingToolApproval?: ServerAgentPendingToolApproval | null
    pendingAutoCompactApproval?: ServerAgentPendingAutoCompactApproval | null
  }
}

type AgentWithAcpSession = AgentLike & {
  state: AgentLike['state'] & {
    acpSession?: OpenCodeAcpSession | null
  }
}

type AgentWithPersistDegraded = AgentLike & {
  state: AgentLike['state'] & {
    persistDegraded?: boolean
  }
}

type AgentWithCapabilityPrompt = AgentLike & {
  setNextPromptCapabilities?: (capabilities: unknown[]) => void
  setNextPromptContextReferences?: (references: FileContextReference[], onConsumed?: () => void) => void
  setPlanMode?: (mode: boolean, onConsumed?: () => void) => void
}

function effectiveContextMessages(agent: AgentLike): MessageWithUsage[] {
  const state = (agent as AgentWithContextCompaction).state
  const compaction = state.contextCompaction
  if (!compaction?.summaryMessage) return agent.state.messages as MessageWithUsage[]
  const messages = agent.state.messages as MessageWithUsage[]
  const compactedUpToIndex = Math.min(messages.length, Math.max(0, Number(compaction.compactedUpToIndex) || 0))
  return [compaction.summaryMessage as MessageWithUsage, ...messages.slice(compactedUpToIndex)]
}

/**
 * Lightweight fingerprint of the messages that contribute session artifacts.
 *
 * `extractSessionArtifacts` (+ the signature string it derives) scans every
 * message and JSON.parses present_files payloads — expensive to repeat on each
 * animation frame. Artifacts only originate from `toolResult` messages, which
 * are stable during streaming (only the trailing assistant message grows), so
 * this key lets the decorate hot-path skip recomputation until something
 * relevant actually changes. Rollback / compaction change the message set, so
 * the key naturally invalidates in those cases.
 */
function artifactsInputKey(messages: ReadonlyArray<{ role?: string; toolCallId?: string; toolName?: string }>): string {
  let key = String(messages.length)
  for (const message of messages) {
    if (message.role !== 'toolResult') continue
    key += `|${message.toolCallId ?? ''}:${message.toolName ?? ''}`
  }
  return key
}

export type SideChatComposerDraftMemory = {
  get: () => string
  set: (text: string) => void
}

type ChatPanelHostProps = {
  mode?: 'main' | 'side-chat'
  agent: AgentLike | null
  sideChatInputMemory?: SideChatComposerDraftMemory
  onModelSelect?: (anchor?: HTMLElement) => void
  revision: number
  agentAccessMode: AgentAccessMode
  workspaceToolsEnabled: boolean
  project?: ProjectInfo
  projectId?: string
  chatScope?: ChatScope
  onAccessModeChange: (mode: AgentAccessMode) => void
  onRollbackFromMessage: (messageIndex: number) => Promise<void> | void
  onRetryFromMessage: (messageIndex: number) => void
  onCopyAnswer: (text: string) => Promise<void> | void
  onForkFromMessage: (messageIndex: number) => void
  onApproveToolCall: (toolCallId: string) => Promise<void> | void
  onRejectToolCall: (toolCallId: string) => Promise<void> | void
  onAnswerAsk?: (askId: string, answers: ServerAgentAskAnswer[], skipped: boolean) => Promise<void> | void
  onApproveAutoCompact?: (approvalId: string) => Promise<void> | void
  onRejectAutoCompact?: (approvalId: string) => Promise<void> | void
  onOpenWorkspaceGitChanges?: () => void
  onOpenLocalFilePath?: (path: string) => void
  onArtifactsChange?: (artifacts: AiTurnArtifact[]) => void
  onContextUsageDisplayChange?: (sessionId: string, info: ContextUsageDisplayInfo) => void
  onInitialRenderReady?: (sessionId: string) => void
  onInitialRenderError?: (sessionId: string, error: unknown) => void
  restoredDraft?: RestoredDraft
  onRestoredDraftConsumed?: (id: number) => void
  disableFork?: boolean
  readOnly?: boolean
  approvalReadOnly?: boolean
  approvalReadOnlyMessage?: string
  bypassClientApiKeyCheck?: boolean
  allowModelControls?: boolean
  newChatEmptyState?: boolean
  showTurnNavigation?: boolean
  rollbackConfirmTitle?: string
  rollbackConfirmDescription?: string
  capabilities?: ChatHarnessCapabilities
}

/**
 * Stable ref container for props that should NOT trigger panel recreation.
 * Updated synchronously every render so the latest value is always available
 * inside closures (e.g. MutationObserver callbacks, event handlers).
 */
type PropsRef = {
  onCopyAnswer: (text: string) => Promise<void> | void
  onRollbackFromMessage: (messageIndex: number) => Promise<void> | void
  onRetryFromMessage: (messageIndex: number) => void
  onForkFromMessage: (messageIndex: number) => void
  onAccessModeChange: (mode: AgentAccessMode) => void
  onTogglePlanMode: () => void
  onApproveToolCall: (toolCallId: string) => Promise<void> | void
  onRejectToolCall: (toolCallId: string) => Promise<void> | void
  onAnswerAsk?: (askId: string, answers: ServerAgentAskAnswer[], skipped: boolean) => Promise<void> | void
  onApproveAutoCompact?: (approvalId: string) => Promise<void> | void
  onRejectAutoCompact?: (approvalId: string) => Promise<void> | void
  onOpenWorkspaceGitChanges?: () => void
  onOpenLocalFilePath?: (path: string) => void
  onArtifactsChange?: (artifacts: AiTurnArtifact[]) => void
  onContextUsageDisplayChange?: (sessionId: string, info: ContextUsageDisplayInfo) => void
  onInitialRenderReady?: (sessionId: string) => void
  onInitialRenderError?: (sessionId: string, error: unknown) => void
  onModelSelect?: (anchor?: HTMLElement) => void
  agentAccessMode: AgentAccessMode
  planMode: boolean
  workspaceToolsEnabled: boolean
  disableFork: boolean
  readOnly: boolean
  approvalReadOnly: boolean
  approvalReadOnlyMessage?: string
  allowModelControls: boolean
  newChatEmptyState: boolean
  bypassClientApiKeyCheck: boolean
  rollbackConfirmTitle?: string
  rollbackConfirmDescription?: string
  capabilities: ChatHarnessCapabilities
  gitBranch?: string
}

export function ChatPanelHost({
  mode = 'main',
  agent,
  sideChatInputMemory,
  onModelSelect,
  revision,
  agentAccessMode,
  workspaceToolsEnabled,
  project,
  projectId,
  chatScope = 'global',
  onAccessModeChange,
  onRollbackFromMessage,
  onRetryFromMessage,
  onCopyAnswer,
  onForkFromMessage,
  onApproveToolCall,
  onRejectToolCall,
  onAnswerAsk,
  onApproveAutoCompact,
  onRejectAutoCompact,
  onOpenWorkspaceGitChanges,
  onOpenLocalFilePath,
  onArtifactsChange,
  onContextUsageDisplayChange,
  onInitialRenderReady,
  onInitialRenderError,
  restoredDraft,
  onRestoredDraftConsumed,
  disableFork = false,
  readOnly = false,
  approvalReadOnly = false,
  approvalReadOnlyMessage,
  bypassClientApiKeyCheck = false,
  allowModelControls = true,
  newChatEmptyState = false,
  showTurnNavigation = true,
  rollbackConfirmTitle,
  rollbackConfirmDescription,
  capabilities = QUICKFORGE_CHAT_HARNESS_CAPABILITIES,
}: ChatPanelHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const restoredDraftIdRef = useRef<number | undefined>(undefined)
  const restoredDraftRef = useRef<RestoredDraft | undefined>(undefined)
  const composerDraftsRef = useRef<Map<string, ComposerDraft>>(new Map())
  const customCommandsRef = useRef<CustomCommandSummary[]>([])
  const lastAppliedRestoredDraftRef = useRef<{ id: number; text: string } | undefined>(undefined)
  const consumedRestoredDraftIdsRef = useRef<Set<number>>(new Set())
  const saveDraftTimerRef = useRef<number | undefined>(undefined)
  const restoredDraftRestoreRef = useRef<ComposerDraftRestoreHandle | null>(null)
  const applyingRestoredDraftRef = useRef(false)
  const readyComposerPanelsRef = useRef<WeakSet<HTMLElement>>(new WeakSet())
  const artifactsSignatureRef = useRef('')
  const artifactsInputKeyRef = useRef('')
  const draftRestoreGuardRef = useRef(createComposerDraftRestoreGuard())
  const [gitBranch, setGitBranch] = useState<string>()
  const [planMode, setPlanMode] = useState(false)
  const sideChatMode = mode === 'side-chat'
  const effectiveCapabilities = useMemo(
    () => applyChatPagePolicy(sideChatMode ? SIDE_CHAT_UI_CAPABILITIES : capabilities, {
      readOnly,
      disableFork: sideChatMode ? false : disableFork,
    }),
    [sideChatMode, capabilities, readOnly, disableFork],
  )
  const togglePlanMode = useCallback(() => setPlanMode((mode) => !mode), [])
  const clearPlanMode = useCallback(() => setPlanMode(false), [])

  // Sync plan mode to the agent as a persistent flag. The /plan command is then
  // derived inside `agent.prompt()` (which always runs when a message is sent)
  // rather than via the editor decoration's wrapped onSend. This keeps the
  // command marker from being lost during panel rebuild / promotion races,
  // where the bare editor onSend bypasses the decoration layer entirely.
  useEffect(() => {
    const promptAgent = agent as AgentWithCapabilityPrompt | null
    const enabled = effectiveCapabilities.planMode && planMode
    promptAgent?.setPlanMode?.(enabled, enabled ? clearPlanMode : undefined)
    if (!effectiveCapabilities.planMode && planMode) queueMicrotask(clearPlanMode)
  }, [agent, planMode, clearPlanMode, effectiveCapabilities.planMode])

  const cancelPendingDraftSave = useCallback(() => {
    if (!saveDraftTimerRef.current) return
    window.clearTimeout(saveDraftTimerRef.current)
    saveDraftTimerRef.current = undefined
  }, [])

  const cancelRestoredDraftRestore = useCallback(() => {
    restoredDraftRestoreRef.current?.cancel()
    restoredDraftRestoreRef.current = null
    applyingRestoredDraftRef.current = false
  }, [])

  const consumeRestoredDraft = useCallback((draftId: number) => {
    rememberConsumedRestoredDraftId(consumedRestoredDraftIdsRef.current, draftId)
    onRestoredDraftConsumed?.(draftId)
  }, [onRestoredDraftConsumed])

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
      cancelRestoredDraftRestore()
    }
  }, [cancelPendingDraftSave, cancelRestoredDraftRestore])

  const persistDraft = useCallback((key: string, draft: ComposerDraft, context: ComposerDraftContext) => {
    if (!hasDraft({ ...draft, attachments: [] })) {
      void clearComposerDraft(key).catch((err) => logger.error('Failed to clear composer draft:', err))
      return
    }
    void saveComposerDraft(key, draft, context).catch((err) => logger.error('Failed to save composer draft:', err))
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
    onAccessModeChange,
    onTogglePlanMode: togglePlanMode,
    onApproveToolCall,
    onRejectToolCall,
    onAnswerAsk,
    onApproveAutoCompact,
    onRejectAutoCompact,
    onOpenWorkspaceGitChanges,
    onOpenLocalFilePath,
    onArtifactsChange,
    onContextUsageDisplayChange,
    onInitialRenderReady,
    onInitialRenderError,
    onModelSelect,
    agentAccessMode,
    planMode,
    workspaceToolsEnabled,
    disableFork,
    readOnly,
    approvalReadOnly,
    approvalReadOnlyMessage,
    allowModelControls,
    newChatEmptyState,
    bypassClientApiKeyCheck,
    rollbackConfirmTitle,
    rollbackConfirmDescription,
    capabilities: effectiveCapabilities,
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
      onAccessModeChange,
      onTogglePlanMode: togglePlanMode,
      onApproveToolCall,
      onRejectToolCall,
      onAnswerAsk,
      onApproveAutoCompact,
      onRejectAutoCompact,
      onOpenWorkspaceGitChanges,
      onOpenLocalFilePath,
      onArtifactsChange,
      onContextUsageDisplayChange,
      onInitialRenderReady,
      onInitialRenderError,
      onModelSelect,
      agentAccessMode,
      planMode,
      workspaceToolsEnabled,
      disableFork,
      readOnly,
      approvalReadOnly,
      approvalReadOnlyMessage,
      allowModelControls,
      newChatEmptyState,
      bypassClientApiKeyCheck,
      rollbackConfirmTitle,
      rollbackConfirmDescription,
      capabilities: effectiveCapabilities,
      gitBranch,
    }
    restoredDraftRef.current = restoredDraft
  })

  const gitProjectId = project?.id ?? projectId

  useEffect(() => {
    let disposed = false

    if (sideChatMode) {
      return () => { disposed = true }
    }

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
  }, [sideChatMode, gitProjectId, revision])

  // --- Refs that let the decoration trigger effect call into the active panel ---
  const decorateFnRef = useRef<(() => void) | null>(null)
  const restoreSideChatDraftRef = useRef<(() => void) | null>(null)
  const scrollSyncRef = useRef<ReturnType<typeof createScrollSync> | null>(null)
  const scheduleDecorateRef = useRef<(() => void) | null>(null)
  // Current project id for lazy slash-catalog loads. Read at call time because
  // the command-suggestions subsystem is created once per panel while the
  // project prop may change (same source as the /api/project/commands fetch).
  const slashCatalogProjectIdRef = useRef<string | undefined>(project?.id)
  const pendingApprovalRef = useRef<{ toolCallId: string; toolName: string; args: Record<string, unknown>; sessionId: string; source?: import('./panel-decoration').ToolApprovalSource } | null>(null)
  const pendingAutoCompactApprovalRef = useRef<{ approvalId: string; usage?: { percent?: number }; thresholdPercent?: number; keepRecentTurns?: number; sessionId: string } | null>(null)
  const pendingAskRef = useRef<(ServerAgentPendingAsk & { sessionId: string }) | null>(null)

  // Keep the slash-catalog project source in sync with the latest props.
  useEffect(() => {
    slashCatalogProjectIdRef.current = project?.id
  }, [project?.id])

  // --- Load custom commands for the current project ---
  useEffect(() => {
    let disposed = false

    if (!effectiveCapabilities.commands || !project?.id) {
      customCommandsRef.current = []
      return () => { disposed = true }
    }

    fetch(`/api/project/commands?projectId=${encodeURIComponent(project.id)}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { commands: [] })
      .then((payload: { commands?: CustomCommandSummary[] }) => {
        if (disposed) return
        customCommandsRef.current = Array.isArray(payload.commands) ? payload.commands : []
        scheduleDecorateRef.current?.()
      })
      .catch(() => {
        if (!disposed) {
          customCommandsRef.current = []
          scheduleDecorateRef.current?.()
        }
      })

    return () => { disposed = true }
  }, [project?.id, revision, effectiveCapabilities.commands])

  const restoreDraftForSession = useCallback((panel: HTMLElement, draft: RestoredDraft, sessionId: string, key: string) => {
    if (draft.sessionId && draft.sessionId !== sessionId) return
    if (!hasDraft(draft)) return
    if (consumedRestoredDraftIdsRef.current.has(draft.id)) return

    const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
    const currentDraft = editor
      ? {
          text: editor.value ?? editor.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '',
          attachments: editor.attachments ? [...editor.attachments] : [],
          contextReferences: editor.contextReferences ? [...editor.contextReferences] : [],
          selectedCapabilities: editor.selectedCapabilities ? [...editor.selectedCapabilities] : [],
        }
      : composerDraftsRef.current.get(key)
    const lastApplied = lastAppliedRestoredDraftRef.current
    const isFirstApplyForDraft = lastApplied?.id !== draft.id
    const canApply = isFirstApplyForDraft || !hasDraft(currentDraft ?? emptyDraft()) || currentDraft?.text === lastApplied.text
    if (!canApply) return

    draftRestoreGuardRef.current.invalidate()
    cancelRestoredDraftRestore()
    const agentInterface = panel.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>('agent-interface')
    restoredDraftRestoreRef.current = scheduleComposerDraftRestore(panel, draft, composerDraftsRef.current, key, {
      shouldApply: () => (
        !consumedRestoredDraftIdsRef.current.has(draft.id)
        && panel.isConnected
        && Boolean(hostRef.current?.contains(panel))
      ),
      onApplyStart: () => { applyingRestoredDraftRef.current = true },
      onApplyEnd: () => { applyingRestoredDraftRef.current = false },
      onApplied: () => {
        readyComposerPanelsRef.current.add(panel)
        restoredDraftIdRef.current = draft.id
        lastAppliedRestoredDraftRef.current = { id: draft.id, text: draft.text }
        consumeRestoredDraft(draft.id)
      },
      updateComplete: agentInterface?.updateComplete,
    })
  }, [cancelRestoredDraftRestore, consumeRestoredDraft])

  // =========================================================================
  // Main effect: create the ChatPanel and wire up all subsystems.
  // ONLY re-runs when `agent` changes — all other prop changes are picked up
  // via propsRef or the decoration trigger effect below.
  // =========================================================================
  useEffect(() => {
    const host = hostRef.current
    if (!host || !agent) return
    const draftRestoreGuard = draftRestoreGuardRef.current
    const readyComposerPanels = readyComposerPanelsRef.current
    const panel = new ChatPanel()
    setPlanMode(false)
    const sessionId = agent.sessionId
    const currentDraftKey = draftKeyRef.current
    const currentDraftContext = draftContextRef.current
    let disposed = false
    let observer: MutationObserver | undefined
    let composerClearedForSend = false
    let initialComposerStateReady = false
    let composerInteracted = false
    let assistantWaitingActive = agent.state.isStreaming
    let toolUpdateScheduled = false
    let processHandoffGeneration = 0
    let cancelInitialRenderReady: (() => void) | undefined

    // Render the complete conversation up front so turn navigation can scroll
    // directly to existing DOM nodes without replacing the message window.
    const windowLayer = createMessageWindow({ enabled: false })
    installMessageListWindow(() => windowLayer)

    // --- Scroll sync subsystem ---
    let loadMoreInFlight = false
    const loadMoreMessages = () => {
      if (disposed || loadMoreInFlight) return
      if (!windowLayer.hasMore()) return
      const list = panel.querySelector<MessageListElement>('message-list')
      const scrollContainer = panel.querySelector<HTMLElement>('agent-interface .overflow-y-auto')
      if (!list || !scrollContainer) return

      // Anchor: the first user/assistant message at or above the viewport top.
      // After the window shifts, the same ordinal element is used to restore
      // the scroll position so the user's reading spot does not jump.
      const items = Array.from(list.querySelectorAll<HTMLElement>('user-message, assistant-message'))
        .filter((element) => element.closest('message-list') === list)
      const containerTop = scrollContainer.getBoundingClientRect().top
      let anchorIndex = -1
      let anchorTop = 0
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect()
        if (rect.bottom > containerTop) {
          anchorIndex = i
          anchorTop = rect.top
          break
        }
      }

      const scrollTopBefore = scrollContainer.scrollTop
      const nextWindow = windowLayer.loadMore()
      if (!nextWindow) return
      loadMoreInFlight = true
      list.messages = nextWindow

      const restoreScroll = () => {
        window.requestAnimationFrame(() => {
          loadMoreInFlight = false
          if (disposed) return
          if (anchorIndex >= 0) {
            const newItems = Array.from(list.querySelectorAll<HTMLElement>('user-message, assistant-message'))
            const anchor = newItems[anchorIndex]
            if (anchor) {
              scrollContainer.scrollTop = scrollTopBefore + (anchor.getBoundingClientRect().top - anchorTop)
            }
          }
          scheduleDecorateRef.current?.()
        })
      }
      void (list.updateComplete ?? Promise.resolve()).then(restoreScroll, restoreScroll)
    }

    const scrollSync = createScrollSync({
      panel,
      onReachTop: () => {
        loadMoreMessages()
      },
      onAutoScrollEnabled: () => {
        // Back at the bottom → the window should follow the tail again.
        windowLayer.resetToTail()
      },
    })
    scrollSyncRef.current = scrollSync

    const scrollBottomButton = createScrollToBottomButton({
      panel,
      onJumpSettled: () => {
        // Only resume tail-following when the jump actually landed near the
        // bottom; anything else means the user redirected the scroll.
        const container = panel.querySelector<HTMLElement>('agent-interface .overflow-y-auto')
        if (!container) return
        const distance = container.scrollHeight - container.scrollTop - container.clientHeight
        if (distance <= 120) scrollSync.enable()
      },
    })
    const todoWriteSummary = createTodoWriteSummaryController({
      panel,
      getMessages: () => agent.state.messages as import('./panel-decoration').TodoWriteMessage[],
    })

    let turnNavigation: ReturnType<typeof createTurnNavigation> | null = null

    const restoreSuggestionDraft = (draft: ComposerDraft) => {
      restoreComposerDraft(panel, draft, composerDraftsRef.current, currentDraftKey)
      schedulePersistDraft(currentDraftKey, draft, currentDraftContext)
    }
    // --- Command suggestions subsystem ---
    const cmdSuggestions = createCommandSuggestions({
      panel,
      getCustomCommands: () => customCommandsRef.current,
      getComposerDrafts: () => composerDraftsRef.current,
      sessionId: currentDraftKey,
      setComposerDrafts: (drafts) => { composerDraftsRef.current = drafts },
      restoreDraftIntoComposer: restoreSuggestionDraft,
      loadSlashCatalog: () => fetchSlashCatalog(slashCatalogProjectIdRef.current),
    })

    // --- Plugin capability selection subsystem (+ menu only; never inferred from @ text) ---
    const capabilitySuggestions = createCapabilitySuggestions({
      panel,
      enabled: effectiveCapabilities.capabilitySuggestions,
      restoreDraftIntoComposer: restoreSuggestionDraft,
    })

    // --- @ current-project file reference subsystem ---
    const fileReferenceSuggestions = createFileReferenceSuggestions({
      panel,
      projectId: project?.id ?? projectId,
      enabled: !sideChatMode && canUseFileReferenceSuggestions({
        projectId: project?.id ?? projectId,
        readOnly,
        harness: agent.harness,
        shared: 'shareId' in agent,
      }),
      restoreDraftIntoComposer: restoreSuggestionDraft,
      removeCommandSuggestions: cmdSuggestions.remove,
      removeCapabilitySuggestions: capabilitySuggestions.remove,
      removePlusMenu: () => removeComposerPlusPopover(panel),
    })

    const restoreSideChatDraft = () => {
      if (!sideChatMode) return
      const text = sideChatInputMemory?.get() ?? ''
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
      const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
      if (editor) {
        editor.value = text
        editor.attachments = []
        editor.contextReferences = []
        editor.selectedCapabilities = []
        editor.requestUpdate?.()
      }
      if (textarea) textarea.value = text
    }
    restoreSideChatDraftRef.current = sideChatMode ? restoreSideChatDraft : null

    // --- Context usage subsystem ---
    const contextUsage = createContextUsageIndicator({
      panel,
      getSystemPrompt: () => agent.state.systemPrompt,
      getMessages: () => agent.state.messages as MessageWithUsage[],
      getEffectiveMessages: () => effectiveContextMessages(agent),
      getContextWindow: () => agent.state.model?.contextWindow ?? 0,
      getTools: () => agent.state.tools,
      getServerContextUsage: () => (agent as AgentWithContextCompaction).state.contextUsage ?? null,
      getIsCompacted: () => Boolean((agent as AgentWithContextCompaction).state.contextCompaction?.summaryMessage),
      getGitBranch: () => propsRef.current.gitBranch,
      onGitBranchClick: () => {
        if (!sideChatMode) propsRef.current.onOpenWorkspaceGitChanges?.()
      },
      renderInline: false,
      renderModelRing: !sideChatMode && getCachedToolDisplaySettings().showContextUsage,
      onDisplayChange: (info) => {
        if (!sideChatMode) propsRef.current.onContextUsageDisplayChange?.(agent.sessionId, info)
      },
    })

    // --- OpenCode harness usage badge (independent of QuickForge contextUsage) ---
    const openCodeUsage = createOpenCodeUsageIndicator({
      panel,
      getAcpSession: () => (agent as AgentWithAcpSession).state.acpSession ?? null,
    })

    // --- Composer input/file-change handlers (update draft map) ---
    const handleComposerInteraction = () => {
      if (applyingRestoredDraftRef.current) return
      composerInteracted = true
      draftRestoreGuard.invalidate()
      cancelRestoredDraftRestore()
      const draft = restoredDraftRef.current
      if (draft && (!draft.sessionId || draft.sessionId === sessionId)) {
        consumeRestoredDraft(draft.id)
      }
    }
    const updateSideChatInputMemory = (text?: string) => {
      if (!sideChatMode) return
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
      const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
      sideChatInputMemory?.set(text ?? editor?.value ?? textarea?.value ?? '')
    }
    const updateComposerDraft = (draft: ComposerDraft) => {
      if (sideChatMode) {
        updateSideChatInputMemory(draft.text)
        return
      }
      if (hasDraft(draft)) {
        composerDraftsRef.current.set(currentDraftKey, draft)
        schedulePersistDraft(currentDraftKey, draft, currentDraftContext)
      } else {
        composerDraftsRef.current.delete(currentDraftKey)
        cancelPendingDraftSave()
        void clearComposerDraft(currentDraftKey).catch((err) => logger.error('Failed to clear composer draft:', err))
      }
    }
    const handleEditorInput = (value: string) => {
      handleComposerInteraction()
      composerClearedForSend = false
      if (sideChatMode) {
        updateSideChatInputMemory(value)
        return
      }
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
      const attachments = editor?.attachments ? [...editor.attachments] : []
      const contextReferences = editor?.contextReferences ? [...editor.contextReferences] : []
      const selectedCapabilities = capabilitySuggestions.snapshotSelectedCapabilities()
      updateComposerDraft({ text: value, attachments, contextReferences, selectedCapabilities })
    }
    const handleEditorFilesChange = (files: unknown[]) => {
      handleComposerInteraction()
      composerClearedForSend = false
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
      if (sideChatMode) {
        if (editor) {
          editor.attachments = []
          editor.contextReferences = []
          editor.selectedCapabilities = []
          editor.requestUpdate?.()
        }
        updateSideChatInputMemory()
        return
      }
      const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
      const text = editor?.value ?? textarea?.value ?? ''
      const contextReferences = editor?.contextReferences ? [...editor.contextReferences] : []
      const selectedCapabilities = capabilitySuggestions.snapshotSelectedCapabilities()
      updateComposerDraft({ text, attachments: files ? [...files] : [], contextReferences, selectedCapabilities })

      const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
      agentInterface?.requestUpdate?.()
      window.requestAnimationFrame(() => scheduleDecorateRef.current?.())
      void agentInterface?.updateComplete?.then(() => scheduleDecorateRef.current?.())
    }

    const syncProcessStreamingState = () => {
      if (agent.state.isStreaming) {
        panel.dataset.quickforgeAgentStreaming = 'true'
      } else {
        delete panel.dataset.quickforgeAgentStreaming
      }
    }

    // --- Artifact extraction, deferred to idle time ---------------------------
    // `extractSessionArtifacts` JSON.parses the file payload of every
    // toolResult, which on a huge session can block the first paint for
    // hundreds of milliseconds. Run it via requestIdleCallback and always read
    // the latest full state when it fires; the signature check still decides
    // whether to notify. Falls back to a synchronous run when idle callbacks
    // are unavailable.
    let artifactsExtractionScheduled = false
    const scheduleArtifactsExtraction = () => {
      if (disposed || artifactsExtractionScheduled) return
      artifactsExtractionScheduled = true
      const run = () => {
        artifactsExtractionScheduled = false
        if (disposed) return
        const artifacts = extractSessionArtifacts(agent.state.messages as import('@earendil-works/pi-agent-core').AgentMessage[])
        const artifactsSignature = JSON.stringify(artifacts.map((artifact) => [artifact.source, artifact.path, artifact.command, artifact.outputFile, artifact.confidence, artifact.preview, artifact.defaultPreview, artifact.addedLines, artifact.removedLines]))
        if (artifactsSignature !== artifactsSignatureRef.current) {
          artifactsSignatureRef.current = artifactsSignature
          propsRef.current.onArtifactsChange?.(artifacts)
        }
      }
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 500 })
      } else {
        run()
      }
    }

    // --- The core decoration function (called on DOM changes & prop changes) ---
    const decorate = () => {
      if (disposed) return
      if (!panel.isConnected) return

      syncProcessStreamingState()

      // Windowed view of the conversation for decoration alignment: when the
      // message list renders only a tail window, the decoration must align
      // against the same window (full-array indices are restored via offset).
      const displayMessages = (): MessageWithUsage[] => {
        if (windowLayer.isEnabled()) {
          return windowLayer.getWindowMessages() as unknown as MessageWithUsage[]
        }
        return agent.state.messages as MessageWithUsage[]
      }
      const messageIndexOffset = windowLayer.isEnabled() ? windowLayer.getWindowStart() : 0

      const props = propsRef.current
      if (!sideChatMode) {
        const inputKey = artifactsInputKey(agent.state.messages as MessageWithUsage[])
        if (inputKey !== artifactsInputKeyRef.current) {
          artifactsInputKeyRef.current = inputKey
          scheduleArtifactsExtraction()
        }
      }

      // Wrap message/editor decoration so a failure in one does not block
      // the approval card from rendering — the approval card is critical UI
      // that must always appear when a tool call is pending.
      try {
        decorateMessages({
          panel,
          getMessages: displayMessages,
          messageIndexOffset,
          isStreaming: () => agent.state.isStreaming,
          onCopyAnswer: props.onCopyAnswer,
          onRollbackFromMessage: props.onRollbackFromMessage,
          onRetryFromMessage: props.onRetryFromMessage,
          onForkFromMessage: props.onForkFromMessage,
          onOpenLocalFilePath: props.onOpenLocalFilePath,
          disableFork: !props.capabilities.forkFromMessage,
          allowRollback: props.capabilities.rollback,
          allowRetry: props.capabilities.retry,
          historyActionsDisabled: sideChatMode,
          readOnly: props.readOnly,
          enableTerminalCommandActions: !sideChatMode && !props.readOnly,
          rollbackConfirmTitle: props.rollbackConfirmTitle,
          rollbackConfirmDescription: props.rollbackConfirmDescription,
        })
        if (!sideChatMode) {
          syncContextCompactionNotice({
            panel,
            getMessages: displayMessages,
            getContextCompaction: () => props.capabilities.compaction
              ? (agent as AgentWithContextCompaction).state.contextCompaction ?? null
              : null,
            messageIndexOffset,
          })
          syncPersistDegradedNotice({
            panel,
            isDegraded: () => (agent as AgentWithPersistDegraded).state.persistDegraded === true,
          })
        }
        syncAssistantWaitingBubble({
          panel,
          getMessages: displayMessages,
          isStreaming: () => agent.state.isStreaming,
          isActive: assistantWaitingActive,
        })
      } catch (error) {
        logger.warn('Failed to decorate chat messages:', error)
      }

      try {
        decorateEditor({
          panel,
          isStreaming: () => agent.state.isStreaming,
          isWaiting: () => assistantWaitingActive,
          abort: () => agent.abort(),
          agentAccessMode: props.agentAccessMode,
          harness: agent.harness,
          getAcpSession: () => (agent as AgentWithAcpSession).state.acpSession ?? null,
          onOpenCodeConfigOptionChange: (configId, value) => {
            void (agent as ServerAgent).setConfigOption(configId, value).catch((error) => {
              logger.error('Failed to update OpenCode config option:', error)
            })
          },
          onOpenCodeModeChange: (modeId) => {
            void (agent as ServerAgent).setMode(modeId).catch((error) => {
              logger.error('Failed to update OpenCode mode:', error)
            })
          },
          planMode: props.planMode,
          workspaceToolsEnabled: props.workspaceToolsEnabled,
          readOnly: props.readOnly,
          allowModelControls: sideChatMode || (props.allowModelControls && props.capabilities.modelSelection),
          planModeEnabled: props.capabilities.planMode,
          accessModeEnabled: props.capabilities.accessMode,
          commandSuggestionsEnabled: props.capabilities.commands,
          capabilitySuggestionsEnabled: props.capabilities.capabilitySuggestions,
          attachmentsEnabled: props.capabilities.attachments,
          fileReferenceSuggestionsEnabled: !sideChatMode,
          disabledControls: sideChatMode,
          onAccessModeChange: props.onAccessModeChange,
          onTogglePlanMode: props.onTogglePlanMode,
          onInput: handleEditorInput,
          onFilesChange: handleEditorFilesChange,
          removeCommandSuggestions: cmdSuggestions.remove,
          updateCommandSuggestions: cmdSuggestions.update,
          setupCommandTextareaHandler: cmdSuggestions.setupTextareaHandler,
          removeCapabilitySuggestions: capabilitySuggestions.remove,
          updateCapabilitySuggestions: capabilitySuggestions.update,
          setupCapabilityTextareaHandler: capabilitySuggestions.setupTextareaHandler,
          removeFileReferenceSuggestions: fileReferenceSuggestions.remove,
          updateFileReferenceSuggestions: fileReferenceSuggestions.update,
          setupFileReferenceTextareaHandler: fileReferenceSuggestions.setupTextareaHandler,
          syncContextChips: () => {
            capabilitySuggestions.syncChips()
            fileReferenceSuggestions.syncChips()
          },
          selectPluginCapability: capabilitySuggestions.selectPlugin,
          availablePluginRows: capabilitySuggestions.availablePluginRows,
          onBeforeSend: () => {
            if (sideChatMode) return
            requestAndroidRemoteSystemNotificationPermissionOnce()
            const capabilities = props.capabilities.capabilitySuggestions
              ? capabilitySuggestions.consumeSelectedCapabilities()
              : []
            const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
            const contextReferences = editor?.contextReferences ? [...editor.contextReferences] : []
            const promptAgent = agent as AgentWithCapabilityPrompt
            promptAgent.setNextPromptCapabilities?.(capabilities)
            promptAgent.setNextPromptContextReferences?.(contextReferences, () => {
              const currentEditor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
              if (!currentEditor) return
              currentEditor.contextReferences = (currentEditor.contextReferences ?? []).filter((reference) => !contextReferences.some(
                (sent) => sent.projectId === reference.projectId && sent.path === reference.path,
              ))
              currentEditor.requestUpdate?.()
              fileReferenceSuggestions.syncChips()
              updateSideChatInputMemory()
            })
          },
        })
        if (props.allowModelControls && props.capabilities.thinkingSelection && !props.onModelSelect) {
          const agentInterface = panel.querySelector<AgentInterfaceElement>('agent-interface')
          if (agentInterface && agentInterface.enableThinkingSelector !== true) {
            agentInterface.enableThinkingSelector = true
            agentInterface.requestUpdate?.()
          }
        }
      } catch { /* continue to todo summary */ }

      try {
        todoWriteSummary.update()
      } catch (error) {
        logger.warn('Failed to update TodoWrite summary:', error)
      }

      if (sideChatMode) {
        removeApprovalCard(panel)
        removeAskUserCard(panel)
      } else {
      // Render or remove approval card based on pending state.
      // Must match the current session — otherwise a pending approval from a
      // different session would leak into this panel.
      const pending = pendingApprovalRef.current ?? (() => {
        const statePending = (agent as AgentWithContextCompaction).state.pendingToolApproval
        return statePending ? { ...statePending, sessionId: agent.sessionId } : null
      })()
      if (pending && pending.sessionId === agent.sessionId && typeof pending.toolCallId === 'string' && typeof pending.toolName === 'string') {
        // Capture the toolCallId now — propsRef.current may change by click time
        const capturedToolCallId = pending.toolCallId
        injectApprovalCard(
          {
            panel,
            tone: 'warning',
            disabled: props.approvalReadOnly,
            disabledReason: props.approvalReadOnlyMessage,
            onApprove: async () => { await propsRef.current.onApproveToolCall(capturedToolCallId); pendingApprovalRef.current = null; (agent as AgentWithContextCompaction).state.pendingToolApproval = null; removeApprovalCard(panel) },
            onReject: async () => { await propsRef.current.onRejectToolCall(capturedToolCallId); pendingApprovalRef.current = null; (agent as AgentWithContextCompaction).state.pendingToolApproval = null; removeApprovalCard(panel) },
          },
          pending.toolName,
          capturedToolCallId,
          pending.args,
          pending.source,
        )
      } else {
        const pendingAutoCompact = pendingAutoCompactApprovalRef.current ?? (() => {
          const statePending = (agent as AgentWithContextCompaction).state.pendingAutoCompactApproval
          return statePending ? { ...statePending, sessionId: agent.sessionId } : null
        })()
        if (pendingAutoCompact && pendingAutoCompact.sessionId === agent.sessionId) {
          const capturedApprovalId = pendingAutoCompact.approvalId
          const autoCompactCallbacksMissing = !props.onApproveAutoCompact || !props.onRejectAutoCompact
          const autoCompactDisabled = props.approvalReadOnly || autoCompactCallbacksMissing
          const autoCompactDisabledReason = props.approvalReadOnly
            ? props.approvalReadOnlyMessage
            : autoCompactCallbacksMissing
              ? t('autoCompactApprovalUnavailable')
              : undefined
          injectApprovalCard(
            {
              panel,
              tone: 'info',
              copy: {
                status: t('autoCompactApprovalStatus'),
                title: t('autoCompactApprovalTitle'),
                risk: t('autoCompactApprovalRisk', { keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 3 }),
                approve: t('autoCompactApprovalAccept'),
                reject: t('autoCompactApprovalReject'),
              },
              disabled: autoCompactDisabled,
              disabledReason: autoCompactDisabledReason,
              getMessages: displayMessages,
              keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 3,
              onApprove: async () => {
                const callback = propsRef.current.onApproveAutoCompact
                if (!callback) throw new Error(t('autoCompactApprovalUnavailable'))
                await callback(capturedApprovalId)
                pendingAutoCompactApprovalRef.current = null
                ;(agent as AgentWithContextCompaction).state.pendingAutoCompactApproval = null
                removeApprovalCard(panel)
              },
              onReject: async () => {
                const callback = propsRef.current.onRejectAutoCompact
                if (!callback) throw new Error(t('autoCompactApprovalUnavailable'))
                await callback(capturedApprovalId)
                pendingAutoCompactApprovalRef.current = null
                ;(agent as AgentWithContextCompaction).state.pendingAutoCompactApproval = null
                removeApprovalCard(panel)
              },
            },
            t('contextManagement'),
            capturedApprovalId,
            {
              percent: pendingAutoCompact.usage?.percent ?? 0,
              threshold: pendingAutoCompact.thresholdPercent ?? 0,
              keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 3,
              summary: t('autoCompactApprovalWaiting', {
                percent: pendingAutoCompact.usage?.percent ?? 0,
                threshold: pendingAutoCompact.thresholdPercent ?? 0,
              }),
              description: t('autoCompactApprovalPreview', { keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 3 }),
            },
          )
        } else {
          removeApprovalCard(panel)
        }
      }

      // Render or remove the ask-user card based on pending state. Same
      // session guard as the approval card.
      const pendingAsk = pendingAskRef.current ?? (() => {
        const statePending = (agent as AgentWithContextCompaction & { state: { pendingAsk?: ServerAgentPendingAsk | null } }).state.pendingAsk
        return statePending ? { ...statePending, sessionId: agent.sessionId } : null
      })()
      if (pendingAsk && pendingAsk.sessionId === agent.sessionId && typeof pendingAsk.askId === 'string' && Array.isArray(pendingAsk.questions) && pendingAsk.questions.length > 0) {
        const capturedAskId = pendingAsk.askId
        const askDisabled = props.approvalReadOnly || !propsRef.current.onAnswerAsk
        injectAskUserCard(
          {
            panel,
            disabled: askDisabled,
            disabledReason: props.approvalReadOnly ? props.approvalReadOnlyMessage : undefined,
            onSubmit: async (answers) => {
              await propsRef.current.onAnswerAsk?.(capturedAskId, answers, false)
              pendingAskRef.current = null
              removeAskUserCard(panel)
            },
            onSkip: async () => {
              await propsRef.current.onAnswerAsk?.(capturedAskId, [], true)
              pendingAskRef.current = null
              removeAskUserCard(panel)
            },
          },
          pendingAsk,
        )
      } else {
        removeAskUserCard(panel)
      }
      }

      if (props.capabilities.contextUsage) contextUsage.update()
      else contextUsage.cleanup()
      if (agent.harness === 'opencode') openCodeUsage.update()
      turnNavigation?.update()
      scrollSync.setup()
      scrollBottomButton.setup()
      if (scrollSync.isEnabled) {
        // Auto-scroll is active → the window should follow the tail again.
        windowLayer.resetToTail()
        scrollSync.scheduleScrollToBottom()
      }
    }

    // --- Schedule decoration once per frame to coalesce mutation bursts in long chats ---
    let decorateScheduled = false
    let decorateFrame: number | undefined
    let suppressObserverMutations = false
    let clearSuppressObserverFrame: number | undefined
    const clearObserverSuppression = () => {
      if (clearSuppressObserverFrame !== undefined) return
      clearSuppressObserverFrame = window.requestAnimationFrame(() => {
        clearSuppressObserverFrame = undefined
        suppressObserverMutations = false
      })
    }
    const runDecorate = () => {
      if (disposed) return
      suppressObserverMutations = true
      try {
        decorate()
      } finally {
        clearObserverSuppression()
      }
    }
    const scheduleDecorate = () => {
      if (decorateScheduled) return
      decorateScheduled = true
      decorateFrame = window.requestAnimationFrame(() => {
        decorateFrame = undefined
        decorateScheduled = false
        runDecorate()
      })
    }
    // Expose for the decoration trigger effect
    decorateFnRef.current = runDecorate
    const getAgentInterface = () => panel.querySelector<AgentInterfaceElement>('agent-interface')
    const scheduleToolInterfaceUpdate = () => {
      if (toolUpdateScheduled) return
      toolUpdateScheduled = true
      window.requestAnimationFrame(() => {
        toolUpdateScheduled = false
        if (disposed) return
        syncProcessStreamingState()
        const agentInterface = getAgentInterface()
        agentInterface?.requestUpdate?.()
        void (agentInterface?.updateComplete ?? Promise.resolve()).then(() => {
          if (!disposed) runDecorate()
        })
        if (scrollSync.isEnabled) scrollSync.scheduleScrollToBottom()
      })
    }
    scheduleDecorateRef.current = scheduleDecorate
    const scheduleProcessHandoff = () => {
      const generation = ++processHandoffGeneration
      panel.dataset.quickforgeProcessHandoff = String(generation)
      const agentInterface = getAgentInterface()
      agentInterface?.requestUpdate?.()
      scheduleDecorateRef.current?.()
      window.requestAnimationFrame(() => {
        if (!disposed && processHandoffGeneration === generation) scheduleDecorateRef.current?.()
      })
      const finishProcessHandoff = () => {
        if (disposed || processHandoffGeneration !== generation) return
        delete panel.dataset.quickforgeProcessHandoff
        scheduleDecorateRef.current?.()
        window.requestAnimationFrame(() => {
          if (!disposed && processHandoffGeneration === generation) scheduleDecorateRef.current?.()
        })
      }
      void (agentInterface?.updateComplete ?? Promise.resolve()).then(finishProcessHandoff, finishProcessHandoff)
    }

    // --- Initialize panel ---
    const setPanelAgent = () => panel.setAgent(agent as unknown as Parameters<typeof panel.setAgent>[0], {
      onApiKeyRequired: sideChatMode
        ? async () => true
        : !propsRef.current.capabilities.clientApiKeyCheck || propsRef.current.bypassClientApiKeyCheck
        ? async () => true
        : (provider: string) => (
            isManagedQuickForgeCloudModel(agent.state.model)
              ? Promise.resolve(true)
              : ApiKeyPromptDialog.prompt(provider)
          ),
      onBeforeSend: () => {
        if (sideChatMode) {
          sideChatInputMemory?.set('')
          scrollSync.enable()
          return
        }
        draftRestoreGuard.invalidate()
        cancelRestoredDraftRestore()
        const draft = restoredDraftRef.current
        if (draft && (!draft.sessionId || draft.sessionId === sessionId)) {
          consumeRestoredDraft(draft.id)
        }
        cancelPendingDraftSave()
        composerClearedForSend = true
        cmdSuggestions.remove()
        composerDraftsRef.current.delete(currentDraftKey)
        void clearComposerDraft(currentDraftKey).catch((err) => logger.error('Failed to clear composer draft:', err))
        scrollSync.enable()
      },
      onModelSelect: sideChatMode ? undefined : () => {
        const anchor = panel.querySelector<HTMLElement>('.quickforge-model-trigger')
        propsRef.current.onModelSelect?.(anchor ?? undefined)
      },
      toolsFactory: () => sideChatMode ? [] : getLocalWorkspaceTools(agent.state.tools),
    })
    const initializePanel = sideChatMode
      ? withPreservedArtifactsRenderer(setPanelAgent)
      : setPanelAgent()

    void initializePanel.then(() => {
      if (disposed) return

      // Restore draft
      const draft = restoredDraftRef.current
      const restoreVersion = draftRestoreGuard.version()
      const restoreStoredDraft = (storedDraft?: ComposerDraft) => {
        if (sideChatMode) {
          restoreSideChatDraft()
          initialComposerStateReady = true
          readyComposerPanels.add(panel)
          return
        }
        if (disposed || !draftRestoreGuard.isCurrent(restoreVersion)) return
        capabilitySuggestions.restoreSelectedCapabilities(storedDraft?.selectedCapabilities ?? [])
        if (draft && restoredDraftIdRef.current !== draft.id) {
          restoreDraftForSession(panel, draft, sessionId, currentDraftKey)
        } else {
          const draftToRestore = storedDraft ?? composerDraftsRef.current.get(currentDraftKey) ?? emptyDraft()
          if (!hasDraft(draftToRestore)) initialComposerStateReady = true
          cancelRestoredDraftRestore()
          const agentInterface = panel.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>('agent-interface')
          restoredDraftRestoreRef.current = scheduleComposerDraftRestore(panel, draftToRestore, composerDraftsRef.current, currentDraftKey, {
            shouldApply: () => (
              !disposed
              && draftRestoreGuard.isCurrent(restoreVersion)
              && panel.isConnected
              && Boolean(hostRef.current?.contains(panel))
            ),
            onApplyStart: () => { applyingRestoredDraftRef.current = true },
            onApplyEnd: () => { applyingRestoredDraftRef.current = false },
            onApplied: () => {
              initialComposerStateReady = true
              readyComposerPanelsRef.current.add(panel)
            },
            updateComplete: agentInterface?.updateComplete,
          })
        }
      }
      if (sideChatMode) {
        restoreStoredDraft()
      } else if (draft && restoredDraftIdRef.current !== draft.id) {
        restoreStoredDraft()
      } else {
        const memoryDraft = composerDraftsRef.current.get(currentDraftKey)
        if (memoryDraft) {
          restoreStoredDraft(memoryDraft)
        } else {
          void loadComposerDraft(currentDraftKey)
            .then((storedDraft) => restoreStoredDraft(storedDraft))
            .catch((err) => logger.error('Failed to load composer draft:', err))
        }
      }

      if (sideChatMode) {
        panel.artifactsPanel?.remove()
        panel.artifactsPanel = undefined
        panel.requestUpdate()
      }

      // Observe DOM changes for re-decoration
      observer = new MutationObserver(() => {
        if (suppressObserverMutations) return
        scheduleDecorate()
      })
      observer.observe(panel, { childList: true, subtree: true })

      // Defer initial decoration to the next animation frame so the Lit
      // component has time to finish its first render. Without this the
      // approval card (and other decorations) may be injected into a DOM
      // that is not yet fully laid out, causing style discrepancies.
      window.requestAnimationFrame(() => {
        if (disposed) return
        runDecorate()
      })

      const agentInterface = getAgentInterface()
      const notifyInitialRenderReady = () => {
        if (disposed) return
        cancelInitialRenderReady = scheduleAfterPaint(() => {
          if (!disposed) propsRef.current.onInitialRenderReady?.(sessionId)
        })
      }
      void (agentInterface?.updateComplete ?? Promise.resolve()).then(notifyInitialRenderReady, notifyInitialRenderReady)
    }, (error: unknown) => {
      if (disposed) return
      logger.error('Failed to initialize chat panel:', error)
      propsRef.current.onInitialRenderError?.(sessionId, error)
    })

    host.replaceChildren(panel)
    if (showTurnNavigation) {
      turnNavigation = createTurnNavigation({
        host,
        panel,
        getMessages: () => agent.state.messages as import('@earendil-works/pi-agent-core').AgentMessage[],
        isStreaming: () => agent.state.isStreaming,
        windowLayer,
        beginProgrammaticScroll: scrollSync.beginProgrammaticScroll,
        onWindowChanged: () => scheduleDecorateRef.current?.(),
      })
    }

    // --- Subscribe to agent events for auto-scroll and tool approvals ---
    const unsubscribeScrollEvents = agent.subscribe((event) => {
      if (event.type === 'agent_start') {
        processHandoffGeneration += 1
        delete panel.dataset.quickforgeProcessHandoff
        assistantWaitingActive = true
        syncProcessStreamingState()
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
        syncProcessStreamingState()
        const eventMessage = (event as { message?: { role?: string } }).message
        if (event.type === 'message_start' && eventMessage?.role === 'assistant') {
          processHandoffGeneration += 1
          delete panel.dataset.quickforgeProcessHandoff
          // Away from the tail → surface the arrival on the back-to-bottom badge.
          scrollBottomButton.notifyNewAssistantMessage()
        }
        if (event.type === 'message_update' || eventMessage?.role === 'assistant') {
          assistantWaitingActive = false
        }
        scheduleDecorateRef.current?.()
        if (event.type === 'message_end' && eventMessage?.role === 'assistant') {
          scheduleProcessHandoff()
        }
        if (scrollSync.isEnabled) scrollSync.scheduleScrollToBottom()
      }
      if ((event as { type: string }).type === 'messages_replaced') {
        const draft = restoredDraftRef.current
        if (draft && restoredDraftIdRef.current === draft.id) {
          restoreDraftForSession(panel, draft, sessionId, currentDraftKey)
        }
      }
      const eventType = (event as { type: string }).type
      if (eventType === 'tool_execution_start') {
        const toolEvent = event as unknown as { toolCallId?: string; sessionId?: string }
        const pendingApproval = pendingApprovalRef.current
        const eventSessionId = toolEvent.sessionId ?? agent.sessionId
        if (pendingApproval
          && pendingApproval.sessionId === agent.sessionId
          && eventSessionId === agent.sessionId
          && toolEvent.toolCallId === pendingApproval.toolCallId) {
          pendingApprovalRef.current = null
          const statePending = (agent as AgentWithContextCompaction).state.pendingToolApproval
          if (statePending?.toolCallId === toolEvent.toolCallId) {
            ;(agent as AgentWithContextCompaction).state.pendingToolApproval = null
          }
          scheduleDecorateRef.current?.()
        }
      }
      if (eventType === 'tool_execution_start' || eventType === 'tool_execution_update' || eventType === 'tool_execution_end') {
        scheduleToolInterfaceUpdate()
      }
      if (eventType === 'acp_session_update' || eventType === 'acp_session_usage_update') {
        // OpenCode runtime config/mode/usage changed — refresh composer controls
        // and the usage badge without disturbing the conversation.
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'persist_degraded') {
        // Persist degradation flag changed — show/hide the warning banner.
        scheduleDecorateRef.current?.()
      }
      if (event.type === 'agent_end') {
        assistantWaitingActive = false
        syncProcessStreamingState()
        scheduleProcessHandoff()
        // Run finished (or aborted) — clear pending approval for this session
        if (pendingApprovalRef.current?.sessionId === agent.sessionId) {
          pendingApprovalRef.current = null
          scheduleDecorateRef.current?.()
        }
        if (pendingAskRef.current?.sessionId === agent.sessionId) {
          pendingAskRef.current = null
          scheduleDecorateRef.current?.()
        }
        if (pendingAutoCompactApprovalRef.current?.sessionId === agent.sessionId) {
          pendingAutoCompactApprovalRef.current = null
          scheduleDecorateRef.current?.()
        }
      }
      if (eventType === 'auto_compact_completed' || eventType === 'auto_compact_failed') {
        if (pendingAutoCompactApprovalRef.current?.sessionId === agent.sessionId) {
          pendingAutoCompactApprovalRef.current = null
        }
        ;(agent as AgentWithContextCompaction).state.pendingAutoCompactApproval = null
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'auto_compact_completed' || eventType === 'messages_replaced') {
        releaseStreamingProcessGroups(panel)
        const agentInterface = getAgentInterface()
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
      if (!sideChatMode && (event as Record<string, unknown>).type === 'tool_approval_required') {
        const approvalEvent = event as unknown as { toolCallId: string; toolName: string; args: Record<string, unknown>; sessionId: string; source?: import('./panel-decoration').ToolApprovalSource }
        pendingApprovalRef.current = { toolCallId: approvalEvent.toolCallId, toolName: approvalEvent.toolName, args: approvalEvent.args, sessionId: approvalEvent.sessionId, source: approvalEvent.source }
        scheduleDecorateRef.current?.()
      }
      if (!sideChatMode && (event as Record<string, unknown>).type === 'ask_user_required') {
        const askEvent = event as unknown as ServerAgentPendingAsk & { sessionId: string }
        if (typeof askEvent.askId === 'string' && Array.isArray(askEvent.questions)) {
          pendingAskRef.current = { ...askEvent, sessionId: askEvent.sessionId ?? agent.sessionId }
          scheduleDecorateRef.current?.()
        }
      }
      if ((event as Record<string, unknown>).type === 'ask_user_answered') {
        const answeredEvent = event as unknown as { askId?: string }
        if (!answeredEvent.askId || pendingAskRef.current?.askId === answeredEvent.askId) {
          pendingAskRef.current = null
          scheduleDecorateRef.current?.()
        }
      }
      if (!sideChatMode && (event as Record<string, unknown>).type === 'auto_compact_approval_required') {
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
      disposed = true
      draftRestoreGuard.invalidate()
      cancelRestoredDraftRestore()
      cancelPendingDraftSave()
      cancelInitialRenderReady?.()
      if (sideChatMode) {
        sideChatInputMemory?.set(readComposerDraft(panel).text)
      } else if (composerClearedForSend) {
        composerDraftsRef.current.delete(currentDraftKey)
        void clearComposerDraft(currentDraftKey).catch((err) => logger.error('Failed to clear composer draft:', err))
      } else if (initialComposerStateReady || composerInteracted || readyComposerPanels.has(panel)) {
        captureComposerDraft(panel, composerDraftsRef.current, currentDraftKey)
        persistCurrentComposerDraft(panel, currentDraftKey, currentDraftContext)
      }
      cmdSuggestions.remove()
      cmdSuggestions.cleanupTextareaHandler()
      capabilitySuggestions.remove()
      capabilitySuggestions.cleanupTextareaHandler()
      fileReferenceSuggestions.remove()
      fileReferenceSuggestions.cleanupTextareaHandler()
      contextUsage.cleanup()
      openCodeUsage.cleanup()
      turnNavigation?.cleanup()
      scrollSync.cleanup()
      scrollSyncRef.current = null
      scrollBottomButton.cleanup()
      todoWriteSummary.cleanup()
      uninstallMessageListWindow(windowLayer)
      unsubscribeScrollEvents()
      observer?.disconnect()
      if (decorateFrame !== undefined) {
        window.cancelAnimationFrame(decorateFrame)
      }
      if (clearSuppressObserverFrame !== undefined) {
        window.cancelAnimationFrame(clearSuppressObserverFrame)
      }
      decorateFnRef.current = null
      restoreSideChatDraftRef.current = null
      panel.remove()
    }
  }, [agent, sideChatMode, project?.id, projectId, readOnly, showTurnNavigation, effectiveCapabilities.capabilitySuggestions, cancelPendingDraftSave, cancelRestoredDraftRestore, consumeRestoredDraft, persistCurrentComposerDraft, restoreDraftForSession, schedulePersistDraft, sideChatInputMemory]) // Recreate only when the agent, explicit host mode, project reference scope, or host-level navigation mode changes; callback deps are stable

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.classList.toggle('quickforge-chat-panel-empty-host', newChatEmptyState)
    host.dataset.quickforgeEmptyChat = newChatEmptyState ? 'true' : 'false'
  }, [newChatEmptyState])

  // =========================================================================
  // Decoration trigger: re-run decoration when UI props change (without
  // recreating the entire panel). This is the key improvement — previously
  // all 16 dependencies caused a full panel rebuild.
  // =========================================================================
  useEffect(() => {
    decorateFnRef.current?.()
    if (sideChatMode) restoreSideChatDraftRef.current?.()
    // model/thinkingLevel 等状态已通过 agent.state 写入，但 Lit 组件不会自动感知
    // 外部对 state.model 的直接赋值，需要手动触发重渲染才能刷新模型名称等 UI。
    const ai = hostRef.current?.querySelector('agent-interface') as { requestUpdate?: () => void } | null
    ai?.requestUpdate?.()
  }, [sideChatMode, agentAccessMode, planMode, workspaceToolsEnabled, gitBranch, disableFork, readOnly, approvalReadOnly, approvalReadOnlyMessage, allowModelControls, capabilities, revision])

  // Draft restoration trigger
  useEffect(() => {
    if (sideChatMode) return
    const draft = restoredDraftRef.current
    if (!draft || !hostRef.current) return
    const sessionId = (agent as ServerAgent | SharedServerAgent | null)?.sessionId ?? ''
    if (draft.sessionId && draft.sessionId !== sessionId) return
    if (consumedRestoredDraftIdsRef.current.has(draft.id)) return
    const panel = hostRef.current.querySelector('pi-chat-panel')
    if (!panel) return
    restoreDraftForSession(panel as HTMLElement, draft, sessionId, draftKeyRef.current)
  }, [sideChatMode, restoredDraft, agent, restoreDraftForSession])

  return <div ref={hostRef} className="quickforge-chat-panel-host min-h-0 flex-1 overflow-hidden" />
}
