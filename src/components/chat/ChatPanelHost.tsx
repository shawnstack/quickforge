import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChatSurface, promptApiKey } from './surface'
import type { ChatSurfaceProps } from './surface'
import type { WindowedChatSurfaceHandle } from './surface/ChatSurface'
import type { ServerAgent, ServerAgentAskAnswer, ServerAgentContextCompaction, ServerAgentContextUsage, ServerAgentPendingAsk, ServerAgentPendingAutoCompactApproval, ServerAgentPendingToolApproval, FileContextReference } from '@/lib/server-agent'
import type { GoalAction, GoalActionOptions, GoalState } from '@/lib/goal'
import type { SharedServerAgent } from '@/lib/shared-server-agent'
import type { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import type { SideChatAgent } from '@/components/workspace/side-chat-agent'
import { getLocalWorkspaceTools } from '@/lib/local-tools'
import type { ComposerDraft, CustomCommandSummary, MessageWithUsage } from './chat-utils'
import { emptyDraft, hasDraft } from './chat-utils'
import { createScrollSync } from './scroll-sync'
import { createCommandSuggestions } from './command-suggestions'
import { fetchSlashCatalog } from '@/lib/slash-catalog'
import { createCapabilitySuggestions } from './capability-suggestions'
import { createTaskLauncher } from './task-launcher'
import { createFileReferenceSuggestions, canUseFileReferenceSuggestions } from './file-reference-suggestions'
import { removeComposerPlusPopover } from './panel-decoration/composer-plus-menu'
import { createContextUsageIndicator, type ContextUsageDisplayInfo } from './context-usage'
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
  syncAssistantWaitingBubble,
  syncContextCompactionNotice,
  createScrollToBottomButton,
  createTodoWriteSummaryController,
  createMessageQueuePanelController,
  createReconnectNoticeController,
  createUnreachableStripController,
  createModelRetryNoticeController,
  createTurnErrorTracker,
  removeSubagentRunningIndicator,
  createGoalControlStripController,
  type ComposerDraftRestoreHandle,
} from './panel-decoration'
import {
  getGoalUiState,
  requestOpenGoalSummary,
  runGoalUiAction,
  subscribeGoalUi,
} from '@/lib/goal-ui'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { scheduleAfterPaint } from '@/lib/schedule-after-paint'
import { markSessionOpen, recordFirstDecorateTiming } from '@/lib/session-open-timing'
import { subscribeSessionViewActivity, isInsideHiddenView } from '@/lib/session-view-activity'
import { readMessageRows } from './panel-decoration/message-rows'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { extractSessionArtifacts, type AiTurnArtifact } from '@/lib/tool-artifacts'
import { getGitStatus } from '../workspace/workspace-api'
import type { WorkspaceExternalOpenTarget } from '../workspace/workspace-api'
import { requestAndroidRemoteSystemNotificationPermissionOnce } from '@/lib/system-notifications'
import type { ChatCapabilities } from '@/lib/chat-capabilities'
import { applyChatPagePolicy, QUICKFORGE_CHAT_CAPABILITIES, SIDE_CHAT_UI_CAPABILITIES } from '@/lib/chat-capabilities'
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
import {
  loadStoredMessageQueueState,
  saveStoredMessageQueueState,
  type QueuedMessage,
} from '@/lib/message-queue'
import { drainStoredMessageQueue } from '@/lib/message-queue-drainer'

type AgentLike = ServerAgent | SharedServerAgent | DeferredSessionAgent | SideChatAgent

type AgentWithContextCompaction = AgentLike & {
  state: AgentLike['state'] & {
    contextCompaction?: ServerAgentContextCompaction | null
    contextUsage?: ServerAgentContextUsage | null
    pendingToolApproval?: ServerAgentPendingToolApproval | null
    pendingAutoCompactApproval?: ServerAgentPendingAutoCompactApproval | null
  }
}

type AgentWithCapabilityPrompt = AgentLike & {
  setNextPromptCapabilities?: (capabilities: unknown[]) => void
  setNextPromptContextReferences?: (references: FileContextReference[], onConsumed?: () => void) => void
  setPlanMode?: (mode: boolean, onConsumed?: () => void) => void
}

type AgentWithGoal = AgentLike & {
  state: AgentLike['state'] & { goal?: GoalState | null }
  updateGoal?: (action: GoalAction, objective?: string, options?: GoalActionOptions) => Promise<GoalState | null>
  /** `'acp'` for OpenCode/ACP sessions, where the server disables goal mode. */
  sessionSource?: string
}

// 对话区 icon-only 紧凑模式阈值：控件行极限宽度约 530px + 余量取 640px；
// 释放阈值比进入阈值大 32px 形成滞回，避免拖动侧栏过程中反复切换。
const CHAT_COMPACT_WIDTH_THRESHOLD = 640
const CHAT_COMPACT_WIDTH_RELEASE = 672

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
 *
 * The per-array memo below relies on the established invariant that
 * `agent.state.messages` is never mutated in place — every writer swaps in a
 * fresh array (see `readAgentSnapshot`'s identity-reuse contract). Same array
 * identity therefore means same contents, so the key can be reused verbatim.
 */
const artifactsKeyByMessages = new WeakMap<readonly unknown[], string>()

function computeArtifactsInputKey(messages: ReadonlyArray<{ role?: string; toolCallId?: string; toolName?: string }>): string {
  let key = String(messages.length)
  for (const message of messages) {
    if (message.role !== 'toolResult') continue
    key += `|${message.toolCallId ?? ''}:${message.toolName ?? ''}`
  }
  return key
}

function artifactsInputKey(messages: ReadonlyArray<{ role?: string; toolCallId?: string; toolName?: string }>): string {
  const cached = artifactsKeyByMessages.get(messages)
  if (cached !== undefined) return cached
  const key = computeArtifactsInputKey(messages)
  artifactsKeyByMessages.set(messages, key)
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
  /**
   * 稳定 React key 来源（useAgentManager 的 runtimeScopeId）：Deferred→Real
   * 会话提升时 sessionId 从 `pending-*` 变成真实 id，但 runtimeScopeId 不变——
   * ChatSurface 用它作 key 即可避免提升瞬间整树 remount（首条消息「重新加载」
   * 观感、DOM/编辑器状态/滚动位置全部保留）。会话切换时 runtimeScopeId 跟随
   * 目标会话 id 变化，仍保证整树重建。未传时回退 agent.sessionId（分享页/
   * 侧聊等单 agent 场景语义不变）。
   */
  agentRuntimeScopeId?: string
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
  onOpenFilePreview?: (relativePath: string) => void
  /** artifact 卡片「撤销」：按该轮全部 turnId（原 run + 重试 run）撤销文件改动（readOnly 面板不传）。 */
  onRollbackTurn?: (turnIds: string[]) => void
  /** 已撤销的轮（轮键集合）：对应轮卡片按钮置灰为「已撤销」。 */
  rolledBackTurns?: ReadonlySet<string>
  /** artifact 卡片「审查」：打开工作区 Review 面板并直达该文件 diff。 */
  onReviewFileChanges?: (relativePath: string) => void
  /** artifact 卡片「打开 ▾ → 在文件管理器中显示」。 */
  onRevealFile?: (relativePath: string, target?: WorkspaceExternalOpenTarget) => void
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
  /** Opt-in only for App's main conversation; shared and Side Chat stay unchanged. */
  taskLauncherEnabled?: boolean
  /**
   * 发送消息后把该条用户消息锚定到滚动可视区顶部（仅主聊天页开启；
   * 侧边聊天 / 分享页不传，维持原贴底跟随行为）。
   */
  anchorSentUserMessage?: boolean
  taskLauncherVisible?: boolean
  onTaskLauncherDismiss?: () => void
  showTurnNavigation?: boolean
  rollbackConfirmTitle?: string
  rollbackConfirmDescription?: string
  capabilities?: ChatCapabilities
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
  onOpenFilePreview?: (relativePath: string) => void
  /** artifact 卡片「撤销」：按该轮全部 turnId（原 run + 重试 run）撤销文件改动（readOnly 面板不传）。 */
  onRollbackTurn?: (turnIds: string[]) => void
  /** 已撤销的轮（轮键集合）：对应轮卡片按钮置灰为「已撤销」。 */
  rolledBackTurns?: ReadonlySet<string>
  /** artifact 卡片「审查」：打开工作区 Review 面板并直达该文件 diff。 */
  onReviewFileChanges?: (relativePath: string) => void
  /** artifact 卡片「打开 ▾ → 在文件管理器中显示」。 */
  onRevealFile?: (relativePath: string, target?: WorkspaceExternalOpenTarget) => void
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
  capabilities: ChatCapabilities
  gitBranch?: string
}

export function ChatPanelHost({
  mode = 'main',
  agent,
  sideChatInputMemory,
  onModelSelect,
  revision,
  agentAccessMode,
  agentRuntimeScopeId,
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
  onOpenFilePreview,
  onRollbackTurn,
  rolledBackTurns,
  onReviewFileChanges,
  onRevealFile,
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
  taskLauncherEnabled = false,
  anchorSentUserMessage = false,
  taskLauncherVisible = false,
  onTaskLauncherDismiss,
  showTurnNavigation = true,
  rollbackConfirmTitle,
  rollbackConfirmDescription,
  capabilities = QUICKFORGE_CHAT_CAPABILITIES,
}: ChatPanelHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<WindowedChatSurfaceHandle | null>(null)
  const surfaceSendHooksRef = useRef<{
    onBeforeSend?: () => void | Promise<void>
    /** Dismiss an open `@`/`/` popover. Bound in the panel effect, which owns `cmdSuggestions`. */
    dismissSuggestions?: () => void
  } | null>(null)
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
  /**
   * Streaming with no assistant output yet (drives the stop button's waiting
   * ring). State, not a closure variable: the ring is rendered by React inside
   * `MessageEditor` now, so the host must cause a render when it flips.
   */
  const [replyWaiting, setReplyWaiting] = useState(false)
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
    onOpenFilePreview,
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
      onOpenFilePreview,
      onRollbackTurn,
      rolledBackTurns,
      onReviewFileChanges,
      onRevealFile,
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

    const controller = new AbortController()

    queueMicrotask(() => {
      if (disposed) return
      if (!gitProjectId) {
        setGitBranch(undefined)
        return
      }

      // 此处只消费 isGitRepository/branch，走 light（独立缓存键，跳过 numstat/行数统计）
      getGitStatus(gitProjectId, controller.signal, { light: true })
        .then((status) => {
          if (disposed) return
          setGitBranch(status.isGitRepository ? status.branch : undefined)
        })
        .catch((err: unknown) => {
          if (disposed || controller.signal.aborted) return
          logger.warn('Failed to load git branch:', err)
          setGitBranch(undefined)
        })
    })

    return () => {
      disposed = true
      controller.abort()
    }
  }, [sideChatMode, gitProjectId, revision])

  // --- Refs that let the decoration trigger effect call into the active panel ---
  const decorateFnRef = useRef<(() => void) | null>(null)
  const restoreSideChatDraftRef = useRef<(() => void) | null>(null)
  const scrollSyncRef = useRef<ReturnType<typeof createScrollSync> | null>(null)
  const scheduleDecorateRef = useRef<(() => void) | null>(null)
  /** Set while a synchronous decorate pass owns the DOM (see `runDecorate`). */
  const decorateInFlightRef = useRef(false)
  /**
   * Coalesced re-decoration requests that come from the React surface instead of
   * the mutation observer: window pagination.
   */
  const requestSurfaceDecorate = useCallback(() => scheduleDecorateRef.current?.(), [])
  /**
   * Same-frame re-decoration for the process-fold ownership hand-back
   * (`ProcessGroupReleaseBoundary`), which requests it from `componentDidUpdate`.
   *
   * The commit just released the folded nodes back to their natural position and
   * the re-fold must land before the browser paints, otherwise that single frame
   * shows the unfolded content — the flicker right after the thinking phase ends. So the host
   * decorate pass runs synchronously here instead of through the rAF schedule;
   * the scheduled pass stays as the fallback while the panel has no decorate
   * function yet (early mount) or is already being decorated.
   */
  const requestSurfaceDecorateNow = useCallback(() => {
    const decorateNow = decorateFnRef.current
    if (!decorateNow || decorateInFlightRef.current) {
      scheduleDecorateRef.current?.()
      return
    }
    decorateNow()
  }, [])
  const taskLauncherStateRef = useRef({ visible: taskLauncherVisible, dismiss: onTaskLauncherDismiss })
  useLayoutEffect(() => {
    taskLauncherStateRef.current = { visible: taskLauncherVisible, dismiss: onTaskLauncherDismiss }
    scheduleDecorateRef.current?.()
  }, [taskLauncherVisible, onTaskLauncherDismiss])
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

    const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('.qf-message-editor')
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
    })
  }, [cancelRestoredDraftRestore, consumeRestoredDraft])

  // =========================================================================
  // Main effect: wire up all subsystems against the React ChatSurface DOM.
  // ONLY re-runs when `agent` changes — all other prop changes are picked up
  // via propsRef or the decoration trigger effect below. The ChatSurface
  // itself is keyed by `agentRuntimeScopeId ?? agent.sessionId` in JSX, so a
  // session switch mounts a fresh DOM subtree (equivalent to the old per-agent
  // `new ChatPanel()`), while the Deferred→Real promotion keeps the runtime
  // scope id (`pending-*`) and therefore updates the surface in place instead
  // of remounting it mid first message.
  // =========================================================================
  useEffect(() => {
    const host = hostRef.current
    if (!host || !agent) return
    const panel = host.querySelector<HTMLElement>('.qf-chat-panel')
    if (!panel) return
    const draftRestoreGuard = draftRestoreGuardRef.current
    const readyComposerPanels = readyComposerPanelsRef.current
    setPlanMode(false)
    const sessionId = agent.sessionId
    // 回合错误重试循环状态机（计数 / 重试中 / 升级态）：随主 effect 重建即换
    // agent/会话重置；revision 触发的面板 DOM 重建不影响（重试后裁剪重生成正
    // 依赖计数跨重建存活）。
    const turnErrorTracker = createTurnErrorTracker()
    const currentDraftKey = draftKeyRef.current
    const currentDraftContext = draftContextRef.current
    let disposed = false
    let observer: MutationObserver | undefined
    let composerClearedForSend = false
    let initialComposerStateReady = false
    let composerInteracted = false
    let assistantWaitingActive = agent.state.isStreaming
    setReplyWaiting(agent.state.isStreaming)
    let toolUpdateScheduled = false
    let processHandoffGeneration = 0
    let cancelInitialRenderReady: (() => void) | undefined
    /** 后台补齐历史的取消句柄（idle callback 或 timeout），与首帧通知分开管理。 */
    let cancelHydration: (() => void) | undefined
    let idleHandle: number | undefined
    let hydrationTimer: number | undefined

    /**
     * Capture / persist (or clear) this session's composer draft.
     *
     * Session views are kept mounted while hidden, so the unmount cleanup below
     * no longer runs on every session switch. The draft must still be flushed at
     * that moment: while typing it is only persisted on a 400ms debounce, so
     * without this the last keystrokes before a switch would be lost.
     *
     * Extracted (rather than inlined in cleanup) so deactivation and unmount go
     * through exactly the same rules — anything else would let the two paths
     * disagree about when a draft is cleared.
     */
    const flushComposerDraft = () => {
      if (sideChatMode) {
        sideChatInputMemory?.set(readComposerDraft(panel).text)
      } else if (composerClearedForSend) {
        composerDraftsRef.current.delete(currentDraftKey)
        void clearComposerDraft(currentDraftKey).catch((err) => logger.error('Failed to clear composer draft:', err))
      } else if (initialComposerStateReady || composerInteracted || readyComposerPanels.has(panel)) {
        captureComposerDraft(panel, composerDraftsRef.current, currentDraftKey)
        persistCurrentComposerDraft(panel, currentDraftKey, currentDraftContext)
      }
    }

    /**
     * Publish "this view's content is on screen" to the host.
     *
     * Two callers, and the second one is load-bearing:
     *
     * 1. Panel initialization, after the surface's first paint. Also schedules
     *    the background full-history hydration (the read-only view only carries
     *    a tail window).
     * 2. Reactivation of a **kept** view (see the activity subscription below).
     *
     * Caller 2 exists because a kept view never re-runs this effect. When the
     * session's task is still resident — the case for a session that is
     * actively streaming — switching back leaves `agent` and the runtime scope
     * id untouched, so all that happens is `SessionViewPool` flipping
     * `display`. The host's conversation transition overlay (`useAppLoadingTransitions`)
     * only lowers on this signal, so without re-publishing it would wait for a
     * ready that only the initial mount ever sent: the overlay sticks on
     * "loading conversation" for a session whose content is right behind it.
     *
     * Safe to call more than once: `handleSessionInitialRenderReady` ignores any
     * session that is not the one currently transitioning, so a late or racing
     * publish cannot dismiss someone else's overlay.
     */
    let pendingHistoryHydration = false
    let historyHydrated = false
    const publishViewReady = () => {
      if (disposed) return
      // A newer publish supersedes one that has not painted yet. It must not
      // drop the hydration request: the flag below is read at paint time.
      cancelInitialRenderReady?.()
      cancelInitialRenderReady = scheduleAfterPaint(() => {
        cancelInitialRenderReady = undefined
        if (disposed) return
        // 埋点：会话内容首帧已上屏（遮罩开始淡出的时刻）。
        markSessionOpen(sessionId, 'first-paint')
        propsRef.current.onInitialRenderReady?.(sessionId)
        if (!pendingHistoryHydration || historyHydrated) return
        historyHydrated = true
        pendingHistoryHydration = false

        // 只读视图只带回尾部窗口，首帧之后补齐更早的历史，界面才能滚到开头。
        // 补齐是在头部插入内容：锚点在真正替换的前一刻由 `hydrateFullHistory`
        // 回调捕获（不是现在），否则用户在这几秒内滚动就用的是过期位置。
        //
        // 必须延到空闲时再拉：实测这条全量请求有 10MB / 186ms，直接在
        // first-paint 回调里发起会与用户首次交互抢主线程。`requestIdleCallback`
        // 让浏览器先处理输入和绘制；`timeout` 兜底保证补齐最终一定发生。
        // 注意用独立句柄：`cancelInitialRenderReady` 是首帧通知的取消函数，
        // 覆盖它会让就绪通知无法在卸载时取消。
        const hydrate = (agent as { hydrateFullHistory?: (beforeReplace?: () => (() => void) | void) => Promise<void> }).hydrateFullHistory
        if (typeof hydrate !== 'function') return
        const runHydration = () => {
          if (disposed) return
          void hydrate.call(agent, () => surfaceRef.current?.captureScrollAnchor())
            .catch((error: unknown) => logger.debug('Background history hydration failed:', error))
        }
        if (typeof window.requestIdleCallback === 'function') {
          cancelHydration = () => {
            // `cancelIdleCallback` 判定 pending 无效，重复取消是安全的。
            if (idleHandle !== undefined) window.cancelIdleCallback?.(idleHandle)
          }
          idleHandle = window.requestIdleCallback(runHydration, { timeout: 2000 })
        } else {
          hydrationTimer = window.setTimeout(runHydration, 300)
          cancelHydration = () => {
            if (hydrationTimer !== undefined) window.clearTimeout(hydrationTimer)
          }
        }
      })
    }

    // Keep-alive: this view stays mounted while another session is active, so
    // the unmount cleanup no longer fires on every switch. Flush the draft the
    // moment this view leaves the screen instead, using the same rules.
    // `agentRuntimeScopeId ?? sessionId` mirrors the ChatSurface key, so the
    // activity signal and the rendered identity cannot drift apart.
    const activityKey = agentRuntimeScopeId ?? agent.sessionId
    const unsubscribeActivity = subscribeSessionViewActivity(
      activityKey,
      (active) => {
        if (disposed) return
        if (!active) {
          flushComposerDraft()
          return
        }
        // Returning to this view must behave exactly like the remount it used
        // to get: the reading position resets and the panel follows the tail
        // again (contract: "scroll position resets and sticks to bottom").
        // A kept subtree keeps its old `scrollTop`, and when the agent object is
        // unchanged (task still resident, so no `[agent]` effect re-run) nothing
        // else would move it. `setAutoScroll(true)` runs the same `resumeTail`
        // path the surface uses for this, which also drains any in-flight page
        // request via the resulting window commit.
        surfaceRef.current?.setAutoScroll(true)
        // Decoration is DOM-derived and only re-scans in a decorate pass. A kept
        // view was hidden (`display: none`, zero-size layout) while it was away,
        // so measurements taken in that window are meaningless — and if the agent
        // object did not change, the main effect does not re-run to rebuild the
        // decorators. Re-run one pass now that the subtree is visible again.
        // Without this the turn-navigation rail stays empty on the active view.
        decorateFnRef.current?.()
        // Re-publish readiness. A kept view never re-runs the main effect, so
        // when the session's task is still resident (the normal case for a
        // session that is actively streaming) nothing else would ever send this
        // signal again — and the host's conversation transition only lowers on
        // it. Without this, switching away from a running session and back
        // leaves "loading conversation" on screen until a page reload.
        publishViewReady()
      },
    )

    // Expose the panel-level send hooks to the ChatSurface props (defined in
    // the component body). Props are bound at render time, the effect runs
    // after mount, and user-triggered sends always happen later — so the ref
    // handoff is always populated before the first send.
    surfaceSendHooksRef.current = {
      dismissSuggestions: () => {
        cmdSuggestions.remove()
        capabilitySuggestions.remove()
        fileReferenceSuggestions.remove()
      },
      onBeforeSend: () => {
        taskLauncher?.hide()
        taskLauncherStateRef.current.dismiss?.()
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
        // 锚定开启时改为「用户消息置顶 + spacer 补偿跟随」（DOM 提交后定位，
        // 找不到用户消息时内部回退贴底）；否则维持原贴底行为。
        if (anchorSentUserMessage) scrollSync.enableWithAnchor()
        else scrollSync.enable()
      },
    }

    // --- Scroll sync subsystem ---
    const scrollSync = createScrollSync({
      panel,
      setAutoScroll: (enabled) => surfaceRef.current?.setAutoScroll(enabled),
      onReachTop: () => {
        // End the guard after loadMoreMessages restores scrollTop in the
        // window-commit layout callback, or immediately if it no-ops.
        // beginProgrammaticScroll is refcounted, so a no-op loadMore that
        // resolves immediately still pairs begin/end correctly even if
        // another page is in flight.
        const endProgrammaticScroll = scrollSync.beginProgrammaticScroll()
        void Promise.resolve(surfaceRef.current?.loadMoreMessages()).finally(endProgrammaticScroll)
      },
    })
    scrollSyncRef.current = scrollSync

    const scrollBottomButton = createScrollToBottomButton({
      panel,
      onJumpSettled: () => {
        // Only resume tail-following when the jump actually landed near the
        // bottom; anything else means the user redirected the scroll.
        const container = panel.querySelector<HTMLElement>('.qf-chat-panel .qf-scroll-container')
        if (!container) return
        const distance = container.scrollHeight - container.scrollTop - container.clientHeight
        if (distance <= 120) scrollSync.enable()
      },
    })
    const todoWriteSummary = createTodoWriteSummaryController({
      panel,
      getMessages: () => agent.state.messages as import('./panel-decoration').TodoWriteMessage[],
    })
    // Goal mode control strip: QuickForge main chat only. Side Chat, shared and
    // read-only pages gate it out through capabilities. ACP sessions
    // (OpenCode) are excluded by the authoritative session source — the server
    // rejects goal actions there (`isGoalModeAvailable`), so the strip must not
    // offer them just because the page is not read-only. The strip is purely a
    // view over the authoritative ServerAgent goal state; actions post to the
    // server and the returned/streamed goal re-renders it. The shared goal-ui
    // module owns the request lock/dirty guard and the open-summary request.
    const goalStrip = !sideChatMode
      ? createGoalControlStripController({
          panel,
          enabled: () => effectiveCapabilities.goal
            && !('shareId' in agent)
            && (agent as AgentWithGoal).sessionSource !== 'acp',
          getGoal: () => (agent as AgentWithGoal).state.goal ?? null,
          getSessionId: () => agent.sessionId,
          goalUi: { getGoalUiState, requestOpenGoalSummary, runGoalUiAction, subscribeGoalUi },
          onAction: async (action, objective) => {
            const target = agent as AgentWithGoal
            if (typeof target.updateGoal !== 'function') throw new Error(t('goalUnavailable'))
            await target.updateGoal(action, objective)
            scheduleDecorateRef.current?.()
          },
        })
      : null
    // 全局 Agent SSE 弱网重连提示（消息流末尾居中轻量行）；Side Chat 使用
    // 独立的 NDJSON 流、不共享该连接，因此不挂此装饰。
    const reconnectNotice = sideChatMode ? null : createReconnectNoticeController({ panel })
    // 后端持续不可达 ≥30s 时升级为 composer 上方常驻琥珀状态条（Tier2）。
    const unreachableStrip = sideChatMode ? null : createUnreachableStripController({ panel })
    // 模型上游流重试提示（model_stream_retry SSE 事件驱动，与 SSE 连接层提示并列）。
    const modelRetryNotice = sideChatMode ? null : createModelRetryNoticeController({ panel })
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

    const taskLauncher = taskLauncherEnabled && !sideChatMode && !readOnly && !('shareId' in agent)
      ? createTaskLauncher({
          panel,
          visible: () => taskLauncherStateRef.current.visible && !agent.state.isStreaming && agent.state.messages.length === 0,
          read: () => readComposerDraft(panel),
          restore: restoreSuggestionDraft,
          interact: () => handleComposerInteraction(),
          ready: () => !disposed && (initialComposerStateReady || composerInteracted || readyComposerPanels.has(panel)),
          capabilities: capabilitySuggestions,
          capabilitiesEnabled: effectiveCapabilities.capabilitySuggestions,
        })
      : null

    // --- @ current-project file reference subsystem ---
    const fileReferenceSuggestions = createFileReferenceSuggestions({
      panel,
      projectId: project?.id ?? projectId,
      enabled: !sideChatMode && canUseFileReferenceSuggestions({
        projectId: project?.id ?? projectId,
        readOnly,
        shared: 'shareId' in agent,
      }),
      restoreDraftIntoComposer: restoreSuggestionDraft,
      removeCommandSuggestions: cmdSuggestions.remove,
      removeCapabilitySuggestions: capabilitySuggestions.remove,
      removePlusMenu: () => removeComposerPlusPopover(panel),
    })

    // --- Queued composer messages (Enter during streaming enqueues) ---
    const messageQueueActive = () => (
      !sideChatMode
      && !readOnly
      && typeof (agent as ServerAgent).prompt === 'function'
    )
    let queuedPromptTimer: number | undefined
    let queuedPromptInFlight: QueuedMessage | undefined
    const cancelQueuedPrompt = () => {
      if (queuedPromptTimer === undefined) return
      window.clearTimeout(queuedPromptTimer)
      queuedPromptTimer = undefined
    }
    const submitQueuedPrompt = (item: QueuedMessage) => {
      queuedPromptTimer = undefined
      if (disposed) return
      if (agent.state.isStreaming) {
        // Keep the head in the queue until a prompt is actually accepted.
        return
      }
      queuedPromptInFlight = item
      void Promise.resolve()
        .then(() => (agent as ServerAgent).prompt(item.text))
        .then(() => {
          if (disposed) return
          queuedPromptInFlight = undefined
          messageQueue.removeItem(item.id)
          saveStoredMessageQueueState(sessionId, messageQueue.getState())
        })
        .catch((error) => {
          if (disposed) return
          queuedPromptInFlight = undefined
          logger.warn('Failed to auto-send queued message:', error)
          messageQueue.setPaused(true)
          saveStoredMessageQueueState(sessionId, messageQueue.getState())
        })
    }
    let messageQueuePersistTimer: number | undefined
    const cancelMessageQueuePersist = () => {
      if (messageQueuePersistTimer === undefined) return
      window.clearTimeout(messageQueuePersistTimer)
      messageQueuePersistTimer = undefined
    }
    const schedulePersistMessageQueue = () => {
      if (!messageQueueActive()) return
      cancelMessageQueuePersist()
      messageQueuePersistTimer = window.setTimeout(() => {
        messageQueuePersistTimer = undefined
        saveStoredMessageQueueState(sessionId, messageQueue.getState())
      }, 300)
    }
    const messageQueue = createMessageQueuePanelController({
      panel,
      enabled: messageQueueActive(),
      isStreaming: () => agent.state.isStreaming,
      steeringEnabled: () => propsRef.current.capabilities.messageSteering
        && typeof (agent as ServerAgent).steer === 'function',
      onChange: () => schedulePersistMessageQueue(),
      onComposerCleared: () => {
        taskLauncher?.cancel()
        cmdSuggestions.remove()
        capabilitySuggestions.remove()
        fileReferenceSuggestions.remove()
        handleEditorInput('')
      },
      submitJump: async (item) => {
        if (!propsRef.current.capabilities.messageSteering || typeof (agent as ServerAgent).steer !== 'function' || !agent.state.isStreaming) {
          // Steering unavailable right now — send it as the next normal prompt.
          messageQueue.moveItemToHead(item.id)
          messageQueue.setPaused(false)
          const head = messageQueue.consumeHead()
          if (head) submitQueuedPrompt(head)
          return
        }
        try {
          await (agent as ServerAgent).steer({ role: 'user', content: item.text, timestamp: Date.now() })
          if (!disposed) messageQueue.removeItem(item.id)
        } catch (error) {
          logger.warn('Failed to steer queued message:', error)
        }
      },
      resumeQueue: () => {
        const head = messageQueue.consumeHead()
        if (head) submitQueuedPrompt(head)
      },
    })

    const restoreSideChatDraft = () => {
      if (!sideChatMode) return
      const text = sideChatInputMemory?.get() ?? ''
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('.qf-message-editor')
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
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('.qf-message-editor')
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
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('.qf-message-editor')
      const attachments = editor?.attachments ? [...editor.attachments] : []
      const contextReferences = editor?.contextReferences ? [...editor.contextReferences] : []
      const selectedCapabilities = capabilitySuggestions.snapshotSelectedCapabilities()
      updateComposerDraft({ text: value, attachments, contextReferences, selectedCapabilities })
    }
    const handleEditorFilesChange = (files: unknown[]) => {
      handleComposerInteraction()
      composerClearedForSend = false
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('.qf-message-editor')
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

      window.requestAnimationFrame(() => scheduleDecorateRef.current?.())
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

      // Read the committed React window, not a newer SSE snapshot whose DOM
      // has not committed yet. Extras are lookup-only toolResults.
      const displayMessages = (): MessageWithUsage[] => (surfaceRef.current?.getWindowMessages() ?? []) as MessageWithUsage[]
      const messageIndexOffset = surfaceRef.current?.getWindowStart() ?? 0

      const props = propsRef.current
      // Enumerate the message rows ONCE per decoration pass and share the result
      // across decorators. Several of them (message actions, compaction notice,
      // approval boundary, waiting bubble) each used to run their own full-table
      // `querySelectorAll` on the same list within a single pass.
      const messageRows = readMessageRows(panel)
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
          messageRows,
          isStreaming: () => agent.state.isStreaming,
          onCopyAnswer: props.onCopyAnswer,
          onRollbackFromMessage: props.onRollbackFromMessage,
          onRetryFromMessage: props.onRetryFromMessage,
          onForkFromMessage: props.onForkFromMessage,
          onRetryAfterError: (errorMessage, fallbackRetry) => {
            const serverAgent = agent as ServerAgent
            // 发送失败的错误消息带原始消息 stash：原样重发；其余走裁剪重生成
            // （fallbackRetry = retryFromMessage(最后一条用户消息)）。
            if (typeof serverAgent.retryFailedPrompt === 'function') {
              void serverAgent.retryFailedPrompt(errorMessage as import('@earendil-works/pi-agent-core').AgentMessage).then((retried) => {
                if (retried) return
                fallbackRetry()
              })
              return
            }
            fallbackRetry()
          },
          onSwitchModel: sideChatMode ? undefined : (anchor) => {
            propsRef.current.onModelSelect?.(anchor)
          },
          turnErrorTracker,
          onOpenLocalFilePath: props.onOpenLocalFilePath,
          onOpenFilePreview: props.onOpenFilePreview,
          onRollbackTurn: props.readOnly ? undefined : props.onRollbackTurn,
          rolledBackTurns: props.rolledBackTurns,
          getArtifactMessages: () => agent.state.messages as MessageWithUsage[],
          onReviewFileChanges: props.onReviewFileChanges,
          onRevealFile: props.readOnly ? undefined : props.onRevealFile,
          disableFork: !props.capabilities.forkFromMessage,
          allowRollback: props.capabilities.rollback,
          allowRetry: props.capabilities.retry,
          historyActionsDisabled: sideChatMode,
          readOnly: props.readOnly,
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
            messageRows,
          })
        }
        syncAssistantWaitingBubble({
          panel,
          getMessages: displayMessages,
          isStreaming: () => agent.state.isStreaming,
          isActive: assistantWaitingActive,
          messageRows,
        })
        reconnectNotice?.sync()
        unreachableStrip?.sync()
        modelRetryNotice?.sync()
      } catch (error) {
        logger.warn('Failed to decorate chat messages:', error)
      }

      try {
        decorateEditor({
          panel,
          agentAccessMode: props.agentAccessMode,
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
          subagentRunningIndicatorEnabled: !sideChatMode && !props.readOnly,
          getPendingToolCalls: () => agent.state.pendingToolCalls,
          getBackgroundCommands: () => (agent as ServerAgent).state.backgroundCommands ?? [],
          disabledControls: sideChatMode,
          onAccessModeChange: props.onAccessModeChange,
          onTogglePlanMode: props.onTogglePlanMode,
          onThinkingLevelChange: (level) => {
            const currentAgent = agent as ServerAgent | SharedServerAgent
            currentAgent.state.thinkingLevel = level
            if (typeof currentAgent.updateThinkingLevel === 'function') {
              void currentAgent.updateThinkingLevel(level).catch((error) => {
                logger.error('Failed to sync thinking level to server:', error)
              })
            }
            decorateFnRef.current?.()
          },
          onInput: handleEditorInput,
          onFilesChange: handleEditorFilesChange,
          sessionId,
          onOpenLocalFilePath: props.onOpenLocalFilePath,
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
            taskLauncher?.hide()
            taskLauncherStateRef.current.dismiss?.()
            if (sideChatMode) return
            requestAndroidRemoteSystemNotificationPermissionOnce()
            const capabilities = props.capabilities.capabilitySuggestions
              ? capabilitySuggestions.consumeSelectedCapabilities()
              : []
            const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('.qf-message-editor')
            const contextReferences = editor?.contextReferences ? [...editor.contextReferences] : []
            const promptAgent = agent as AgentWithCapabilityPrompt
            promptAgent.setNextPromptCapabilities?.(capabilities)
            promptAgent.setNextPromptContextReferences?.(contextReferences, () => {
              const currentEditor = panel.querySelector<import('./chat-utils').MessageEditorElement>('.qf-message-editor')
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
        // The native thinking selector stays hidden in the React surface
        // (enableThinkingSelector=false); the QuickForge thinking control is
        // injected by the decoration layer (thinking-level-controls), exactly
        // like the previous patch-thinking-selector({hideSelector:true}) setup.
      } catch { /* continue to todo summary */ }

      try {
        taskLauncher?.sync()
        todoWriteSummary.update()
      } catch (error) {
        logger.warn('Failed to update TodoWrite summary:', error)
      }

      try {
        messageQueue.update()
      } catch (error) {
        logger.warn('Failed to update queued messages panel:', error)
      }

      try {
        goalStrip?.update()
      } catch (error) {
        logger.warn('Failed to update goal control strip:', error)
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
                risk: t('autoCompactApprovalRisk', { keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 0 }),
                approve: t('autoCompactApprovalAccept'),
                reject: t('autoCompactApprovalReject'),
              },
              disabled: autoCompactDisabled,
              disabledReason: autoCompactDisabledReason,
              getMessages: displayMessages,
              keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 0,
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
              keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 0,
              summary: t('autoCompactApprovalWaiting', {
                percent: pendingAutoCompact.usage?.percent ?? 0,
                threshold: pendingAutoCompact.thresholdPercent ?? 0,
              }),
              description: t('autoCompactApprovalPreview', { keepRecentTurns: pendingAutoCompact.keepRecentTurns ?? 0 }),
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
      turnNavigation?.update()
      scrollSync.setup()
      scrollBottomButton.setup()
      if (scrollSync.isEnabled) {
        // Auto-scroll is active → follow the tail again.
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
      // A kept (hidden) view must not decorate: its layout box is `display:none`,
      // so every `getBoundingClientRect`/`offsetHeight` it reads is 0 and the
      // results it would write back (compact class, fold state, scroll position)
      // are meaningless. It also has no user to serve. Decoration resumes from
      // the activity subscription below when the view becomes visible again.
      // Judged from the DOM rather than the activity signal: the signal is
      // published in a layout effect, so on the commit that reveals this view the
      // signal may still name the previous one and the first (authoritative) pass
      // would be skipped.
      if (isInsideHiddenView(host)) return
      // Single-flight: `decorate` moves nodes around, so a nested pass must not
      // interleave with the one that owns the DOM (same guard as SubagentTrace).
      if (decorateInFlightRef.current) return
      decorateInFlightRef.current = true
      suppressObserverMutations = true
      const decorateStartedAt = performance.now()
      try {
        decorate()
      } finally {
        clearObserverSuppression()
        decorateInFlightRef.current = false
        // 第一轮装饰在 ready 之后才跑（它在 `scheduleAfterPaint` 之后由 rAF 触发），
        // 但它决定按钮/折叠何时可用，属于用户感知成本，单独记一次。
        recordFirstDecorateTiming(sessionId, performance.now() - decorateStartedAt)
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
    const scheduleToolInterfaceUpdate = () => {
      if (toolUpdateScheduled) return
      toolUpdateScheduled = true
      window.requestAnimationFrame(() => {
        toolUpdateScheduled = false
        if (disposed) return
        syncProcessStreamingState()
        // The React surface re-renders from agent snapshots on its own; the
        // rAF gives that commit time to land before decoration re-aligns.
        runDecorate()
        if (scrollSync.isEnabled) scrollSync.scheduleScrollToBottom()
      })
    }
    scheduleDecorateRef.current = scheduleDecorate
    const scheduleProcessHandoff = () => {
      const generation = ++processHandoffGeneration
      panel.dataset.quickforgeProcessHandoff = String(generation)
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
      window.requestAnimationFrame(finishProcessHandoff)
    }

    // --- Initialize panel ---
    // Register MCP tool renderers for this session's tool list (the side
    // effect of getLocalWorkspaceTools); the React ToolMessage resolves
    // renderers through the same registry. Display metadata comes straight
    // from agent.state.tools, so there is no toolsFactory equivalent.
    getLocalWorkspaceTools(agent.state.tools)
    // Barrier replacing the legacy `await agentInterface.updateComplete`:
    // the surface's DOM is committed by the time this effect runs, and the
    // nested rAF pair waits for the first paint to settle before the
    // initialization body (and the `scheduleAfterPaint`-based
    // onInitialRenderReady notify below) runs — semantically aligned with
    // updateComplete + afterPaint. `Promise.resolve()` fired the notify on a
    // bare microtask, before the surface had painted.
    const initializePanel = new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve())
      })
    })

    void initializePanel.then(() => {
      if (disposed) return

      // Restore queued messages persisted for this session (reload mid-turn).
      const storedQueue = loadStoredMessageQueueState(sessionId)
      if (storedQueue.items.length > 0 || storedQueue.paused) {
        messageQueue.hydrate(storedQueue)
      }
      // Switch-back fallback: a turn settled while this session was in the
      // background leaves a non-empty queue with no agent_end to come — reuse
      // the regular 250ms auto-send scheduling for the restored head.
      if (messageQueueActive() && !agent.state.isStreaming
        && storedQueue.items.length > 0 && !storedQueue.paused
        && queuedPromptTimer === undefined && queuedPromptInFlight === undefined) {
        queuedPromptTimer = window.setTimeout(() => {
          const head = messageQueue.getState().items[0]
          if (head) submitQueuedPrompt(head)
        }, 250)
      }

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
          if (!hasDraft(draftToRestore)) {
            initialComposerStateReady = true
            taskLauncher?.sync()
          }
          cancelRestoredDraftRestore()
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
              taskLauncher?.sync()
            },
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
            .catch((err) => {
              logger.error('Failed to load composer draft:', err)
              restoreStoredDraft()
            })
        }
      }

      // Observe DOM changes for re-decoration
      observer = new MutationObserver(() => {
        if (suppressObserverMutations) return
        scheduleDecorate()
      })
      observer.observe(panel, { childList: true, subtree: true })

      // Defer initial decoration to the next animation frame so the React
      // surface's first paint has settled. Without this the approval card
      // (and other decorations) may be injected into a DOM that is not yet
      // fully laid out, causing style discrepancies.
      window.requestAnimationFrame(() => {
        if (disposed) return
        runDecorate()
      })

      const notifyInitialRenderReady = () => {
        if (disposed) return
        // Panel initialization is the first occasion this view needs the full
        // history; reactivation reuses the same publish path but must not
        // hydrate twice.
        pendingHistoryHydration = true
        publishViewReady()
      }
      notifyInitialRenderReady()
    }, (error: unknown) => {
      if (disposed) return
      logger.error('Failed to initialize chat panel:', error)
      propsRef.current.onInitialRenderError?.(sessionId, error)
    })

    if (showTurnNavigation) {
      turnNavigation = createTurnNavigation({
        host,
        panel,
        getMessages: () => agent.state.messages as import('@earendil-works/pi-agent-core').AgentMessage[],
        isStreaming: () => agent.state.isStreaming,
        beginProgrammaticScroll: scrollSync.beginProgrammaticScroll,
        showMessageIndex: (index) => surfaceRef.current?.showMessageIndex(index) ?? Promise.resolve(),
        onWindowChanged: () => scheduleDecorateRef.current?.(),
      })
    }

    // --- Subscribe to agent events for auto-scroll and tool approvals ---
    const unsubscribeScrollEvents = agent.subscribe((event) => {
      if (event.type === 'agent_start') {
        processHandoffGeneration += 1
        delete panel.dataset.quickforgeProcessHandoff
        assistantWaitingActive = true
        setReplyWaiting(true)
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
          setReplyWaiting(false)
          // 模型流重试后新流的第一个增量到达即视为恢复。
          modelRetryNotice?.hide()
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
      if (eventType === 'background_commands' || eventType === 'tool_execution_start' || eventType === 'tool_execution_update' || eventType === 'tool_execution_end') {
        scheduleToolInterfaceUpdate()
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'error') {
        modelRetryNotice?.hide()
      }
      if (eventType === 'persist_degraded') {
        // Persist degradation flag changed — show/hide the warning banner.
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'goal_updated') {
        // Authoritative goal snapshot changed — re-render the goal card.
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'model_stream_retry') {
        // 服务端正在内部重建模型上游流 — 显示/更新重试进度；恢复或回合
        // 终止由 message_update / agent_end / error 分支移除。
        const retryEvent = event as { attempt?: number; maxAttempts?: number; recovered?: boolean }
        if (retryEvent.recovered === true) modelRetryNotice?.hide()
        else if (typeof retryEvent.attempt === 'number' && typeof retryEvent.maxAttempts === 'number') {
          modelRetryNotice?.show(retryEvent.attempt, retryEvent.maxAttempts)
        }
      }
      if (event.type === 'agent_end') {
        assistantWaitingActive = false
        setReplyWaiting(false)
        modelRetryNotice?.hide()
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
        // Queue drain: a settled turn auto-sends the next queued message;
        // aborted / errored turns pause the queue so the user stays in control.
        if (messageQueueActive()) {
          const endedStatus = (event as { status?: string }).status
          const queueSnapshot = messageQueue.getState()
          if ((endedStatus === 'aborted' || endedStatus === 'error') && queueSnapshot.items.length > 0) {
            if (!queueSnapshot.paused) messageQueue.setPaused(true)
          } else if (!queueSnapshot.paused && queueSnapshot.items.length > 0 && queuedPromptTimer === undefined && queuedPromptInFlight === undefined) {
            queuedPromptTimer = window.setTimeout(() => {
              const head = messageQueue.getState().items[0]
              if (head) submitQueuedPrompt(head)
            }, 250)
          }
        }
      }
      if (eventType === 'auto_compact_completed' || eventType === 'auto_compact_failed') {
        if (pendingAutoCompactApprovalRef.current?.sessionId === agent.sessionId) {
          pendingAutoCompactApprovalRef.current = null
        }
        ;(agent as AgentWithContextCompaction).state.pendingAutoCompactApproval = null
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'auto_compact_completed' || eventType === 'messages_replaced' || eventType === 'message_metadata_updated') {
        // 结构性释放由 React 表面内的 ProcessGroupReleaseBoundary 拥有：它先释放
        // 折叠组、再在同一提交（componentDidUpdate）内同步重折叠，不产生「已释放
        // 未重折叠」的绘制帧。这里不再预先 releaseStreamingProcessGroups——预释放
        // 会让 boundary 找不到组、跳过同步重折叠，重折叠退到下一帧 rAF（历史
        // 闪帧根因）。auto_compact_completed 服务端必跟 messages_replaced
        //（server/auto-compaction.mjs），结构提交仍走 boundary；此处只负责补排
        // 两次 decorate 兜底（指纹未变时为 no-op）。metadata 事件不改行结构，
        // 也不触发上面的 messages_replaced 草稿恢复分支。
        scheduleDecorateRef.current?.()
        window.requestAnimationFrame(() => scheduleDecorateRef.current?.())
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
      cancelHydration?.()
      unsubscribeActivity()
      flushComposerDraft()
      cmdSuggestions.remove()
      cmdSuggestions.cleanupTextareaHandler()
      capabilitySuggestions.remove()
      capabilitySuggestions.cleanupTextareaHandler()
      fileReferenceSuggestions.remove()
      fileReferenceSuggestions.cleanupTextareaHandler()
      contextUsage.cleanup()
      turnNavigation?.cleanup()
      scrollSync.cleanup()
      scrollSyncRef.current = null
      scrollBottomButton.cleanup()
      taskLauncher?.dispose()
      todoWriteSummary.cleanup()
      goalStrip?.cleanup()
      reconnectNotice?.destroy()
      unreachableStrip?.destroy()
      modelRetryNotice?.destroy()
      removeSubagentRunningIndicator(panel)
      cancelMessageQueuePersist()
      cancelQueuedPrompt()
      if (messageQueueActive()) {
        if (queuedPromptInFlight) messageQueue.restoreHead(queuedPromptInFlight)
        queuedPromptInFlight = undefined
        saveStoredMessageQueueState(sessionId, messageQueue.getState())
        // agent_end fired but the 250ms auto-send timer was just cancelled by
        // this cleanup — hand the persisted queue (saved above, incl. the
        // restored head) to the background drainer so it still auto-sends.
        const savedQueue = messageQueue.getState()
        if (savedQueue.items.length > 0 && !savedQueue.paused && !agent.state.isStreaming) {
          void drainStoredMessageQueue(sessionId, agent as ServerAgent)
        }
      }
      messageQueue.cleanup()
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
      surfaceSendHooksRef.current = null
      // The ChatSurface DOM itself is owned by React (keyed by runtime scope /
      // session id) and unmounts on its own; decorations injected into it are
      // dropped with the subtree.
    }
  }, [agent, agentRuntimeScopeId, sideChatMode, project?.id, projectId, readOnly, showTurnNavigation, taskLauncherEnabled, anchorSentUserMessage, effectiveCapabilities.capabilitySuggestions, effectiveCapabilities.goal, cancelPendingDraftSave, cancelRestoredDraftRestore, consumeRestoredDraft, persistCurrentComposerDraft, restoreDraftForSession, schedulePersistDraft, sideChatInputMemory]) // Recreate only when the agent, the scope id (the activity channel is keyed by it), explicit host mode, project reference scope, or host-level navigation mode changes; callback deps are stable

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.classList.toggle('quickforge-chat-panel-empty-host', newChatEmptyState)
    host.dataset.quickforgeEmptyChat = newChatEmptyState ? 'true' : 'false'
  }, [newChatEmptyState])

  // 对话区被左右侧栏拖宽挤压变窄时（视口宽度不变，@media 视口查询不会触发），
  // 由 ResizeObserver 监听宿主内容宽度并挂/摘 quickforge-chat-compact class，
  // 让 index.css 中的紧凑段把 Composer 控件收成 icon-only 形态。
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? host.getBoundingClientRect().width
      if (width > 0 && width < CHAT_COMPACT_WIDTH_THRESHOLD) host.classList.add('quickforge-chat-compact')
      else if (width >= CHAT_COMPACT_WIDTH_RELEASE) host.classList.remove('quickforge-chat-compact')
      // 介于两者之间时保持现状（滞回，避免拖动侧栏时抖动）
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // =========================================================================
  // Decoration trigger: re-run decoration when UI props change (without
  // recreating the entire panel). This is the key improvement — previously
  // all 16 dependencies caused a full panel rebuild.
  // =========================================================================
  useEffect(() => {
    decorateFnRef.current?.()
    if (sideChatMode) restoreSideChatDraftRef.current?.()
  }, [sideChatMode, agentAccessMode, planMode, workspaceToolsEnabled, gitBranch, disableFork, readOnly, approvalReadOnly, approvalReadOnlyMessage, allowModelControls, capabilities, revision, rolledBackTurns])

  // Draft restoration trigger
  useEffect(() => {
    if (sideChatMode) return
    const draft = restoredDraftRef.current
    if (!draft || !hostRef.current) return
    const sessionId = (agent as ServerAgent | SharedServerAgent | null)?.sessionId ?? ''
    if (draft.sessionId && draft.sessionId !== sessionId) return
    if (consumedRestoredDraftIdsRef.current.has(draft.id)) return
    const panel = hostRef.current.querySelector('.qf-chat-panel')
    if (!panel) return
    restoreDraftForSession(panel as HTMLElement, draft, sessionId, draftKeyRef.current)
  }, [sideChatMode, restoredDraft, agent, restoreDraftForSession])

  return (
    <div ref={hostRef} className="quickforge-chat-panel-host min-h-0 flex-1 overflow-hidden">
      {agent ? (
        <ChatSurface
          key={agentRuntimeScopeId ?? agent.sessionId}
          ref={surfaceRef}
          onWindowChanged={requestSurfaceDecorate}
          onProcessGroupsReleased={requestSurfaceDecorateNow}
          agent={agent as unknown as ChatSurfaceProps['agent']}
          enableAttachments={effectiveCapabilities.attachments}
          // Side Chat keeps the model trigger rendered (the shared decoration
          // renders it in a native disabled state) — mirrors HEAD's
          // `allowModelControls: sideChatMode || (...)` contract.
          enableModelSelector={sideChatMode || (allowModelControls && effectiveCapabilities.modelSelection)}
          enableThinkingSelector={false}
          readOnly={readOnly}
          // Host-driven snapshot refresh (model switch without agent events).
          chatPanelRevision={revision}
          // Terminal command actions on code blocks: legacy
          // `enableTerminalCommandActions` gate — never in Side Chat or
          // read-only views.
          commandActionsEnabled={!sideChatMode && !readOnly}
          onApiKeyRequired={
            sideChatMode || !effectiveCapabilities.clientApiKeyCheck || bypassClientApiKeyCheck
              ? undefined
              : (provider: string) => promptApiKey(provider)
          }
          onBeforeSend={() => surfaceSendHooksRef.current?.onBeforeSend?.()}
          isReplyWaiting={replyWaiting}
          onBeforeAbort={() => surfaceSendHooksRef.current?.dismissSuggestions?.()}
          onModelSelect={sideChatMode ? undefined : () => {
            const anchor = hostRef.current?.querySelector<HTMLElement>('.quickforge-model-trigger') ?? undefined
            propsRef.current.onModelSelect?.(anchor)
          }}
        />
      ) : null}
    </div>
  )
}
