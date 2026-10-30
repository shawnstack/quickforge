import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ChatSurface, promptApiKey } from './surface'
import type { ChatSurfaceProps } from './surface'
import type { WindowedChatSurfaceHandle } from './surface/ChatSurface'
import type { ServerAgent, ServerAgentAskAnswer, ServerAgentContextCompaction, ServerAgentContextUsage, ServerAgentPendingAsk, ServerAgentPendingAutoCompactApproval, ServerAgentPendingToolApproval, FileContextReference } from '@/lib/server-agent'
import type { SessionLeaseSnapshot } from '@/lib/session-lease-client'
import type { GoalAction, GoalActionOptions, GoalState } from '@/lib/goal'
import type { SharedServerAgent } from '@/lib/shared-server-agent'
import type { DeferredSessionAgent } from '@/lib/deferred-session-agent'
import type { SideChatAgent } from '@/components/workspace/side-chat-agent'
import { getLocalWorkspaceTools } from '@/lib/local-tools'
import type { ComposerDraft, CustomCommandSummary, MessageWithUsage } from './chat-utils'
import { emptyDraft, hasDraft } from './chat-utils'
import { createScrollSync } from './scroll-sync'
import { type CapabilitySuggestion } from './capability-suggestions'
import { createContextUsageIndicator, type ContextUsageDisplayInfo } from './context-usage'
import { createTurnNavigation } from './turn-navigation'
import {
  decorateMessages,
  decorateStreamingMessages,
  decorateEditor,
  readComposerDraft,
  scheduleComposerDraftRestore,
  createScrollToBottomButton,
  createTurnErrorTracker,
  removeSubagentRunningIndicator,
  submitAskTextToPendingAsk,
  type ComposerDraftRestoreHandle,
} from './panel-decoration'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { scheduleAfterPaint } from '@/lib/schedule-after-paint'
import { markSessionOpen } from '@/lib/session-open-timing'
import { subscribeSessionViewActivity, isSessionViewActive } from '@/lib/session-view-activity'
import { createMessageRowSnapshot } from './panel-decoration/message-rows'
import type { ChatDecorateMode } from './panel-decoration/decorate-scheduler'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { extractSessionArtifacts, extractToolExecutionArtifacts, type AiTurnArtifact } from '@/lib/tool-artifacts'
import type { ToolExecutionEvent } from '@/lib/tool-execution-events'
import { getGitStatus } from '../workspace/workspace-api'
import type { WorkspaceExternalOpenTarget } from '../workspace/workspace-api'

/**
 * 等一帧再读 composer 绑定：就地编辑提交时，回滚可能重建会话（回滚到第一条
 * 消息会删掉旧会话并新建 agent），新的 `.qf-message-editor` bridge 要等 React
 * 提交后才存在。非 DOM 环境（单测）直接放行。
 */
function nextAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

type ComposerSendBridge = HTMLElement & {
  onSend?: (input: string, attachments: unknown[]) => void
}

/**
 * 等 composer 的发送桥就绪后返回一个发送函数。
 *
 * 回滚到第一条消息会删掉旧会话并新建 agent，ChatSurface 随之重挂载，
 * `.qf-message-editor` 上的 onSend 要等 React 提交后才可用；这里轮询几帧
 * 而不是死等一帧，避免在重建路径上偶发「回滚成功但没发出去」。
 */
async function waitForComposerSend(
  panel: HTMLElement,
  maxFrames = 12,
): Promise<((text: string) => void) | null> {
  const read = () => {
    const editor = panel.querySelector<ComposerSendBridge>('.qf-message-editor')
    return typeof editor?.onSend === 'function' ? editor : null
  }

  const immediate = read()
  if (immediate) return (text: string) => immediate.onSend?.(text, [])

  for (let frame = 0; frame < maxFrames; frame += 1) {
    await nextAnimationFrame()
    const editor = read()
    if (editor) return (text: string) => editor.onSend?.(text, [])
  }
  return null
}
import { requestAndroidRemoteSystemNotificationPermissionOnce } from '@/lib/system-notifications'
import type { ChatCapabilities } from '@/lib/chat-capabilities'
import { applyChatPagePolicy, QUICKFORGE_CHAT_CAPABILITIES, SIDE_CHAT_UI_CAPABILITIES } from '@/lib/chat-capabilities'
import type { ChatScope, ProjectInfo, RestoredDraft, AgentAccessMode } from '@/lib/types'
import {
  buildComposerDraftKey,
  clearComposerDraft,
  saveComposerDraft,
  createComposerDraftRestoreGuard,
  rememberConsumedRestoredDraftId,
  type ComposerDraftContext,
} from '@/lib/composer-drafts'
import { createComposerInputWiring } from './panel-wiring/composer-input'
import { setupComposerSuggestions } from './panel-wiring/composer-suggestions'
import { setupMessageQueueWiring } from './panel-wiring/message-queue'
import { setupDecoratePipeline } from './panel-wiring/decorate-pipeline'
import { syncPendingApprovalCards, type ApprovalCardsAgent } from './panel-wiring/approval-cards'

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

// --- ChatPanelHostProps 按职责分组的子接口 ---
// 运行时 props 仍是同一层平铺结构（App / 分享页 / 侧聊传参不变）；分组只用于
// 让接口可读、可导航：会话身份 / 消息操作 / 审批应答 / 产物跳转 / 视图状态。

/** 会话与工作区身份：渲染哪个 agent、key 如何稳定、工具域挂在哪个项目上。 */
type ChatPanelHostSessionProps = {
  mode?: 'main' | 'side-chat'
  agent: AgentLike | null
  sideChatInputMemory?: SideChatComposerDraftMemory
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
  capabilities?: ChatCapabilities
}

/** 消息级操作：回滚 / 重试 / 复制 / fork（发给当前 agent 的会话内动作）。 */
type ChatPanelHostMessageActionProps = {
  onRollbackFromMessage: (messageIndex: number) => Promise<void> | void
  /**
   * 就地编辑提交的「截断」半步：移除该条消息及之后的会话历史（不回填输入框），
   * 返回 true 后面板会把新文本交给 composer 重新发送。
   * 缺省时不启用就地编辑，回滚按钮退回二次确认弹窗。
   */
  onRollbackForResend?: (messageIndex: number) => Promise<boolean>
  onRetryFromMessage: (messageIndex: number) => void
  onCopyAnswer: (text: string) => Promise<void> | void
  onForkFromMessage: (messageIndex: number) => void
  disableFork?: boolean
  rollbackConfirmTitle?: string
  rollbackConfirmDescription?: string
}

/** 工具审批与 ask_user / auto-compact 应答（写入型，readOnly 面板由调用方不传）。 */
type ChatPanelHostApprovalProps = {
  onApproveToolCall: (toolCallId: string) => Promise<void> | void
  onRejectToolCall: (toolCallId: string) => Promise<void> | void
  onAnswerAsk?: (askId: string, answers: ServerAgentAskAnswer[], skipped: boolean, remark?: string) => Promise<void> | void
  onApproveAutoCompact?: (approvalId: string) => Promise<void> | void
  onRejectAutoCompact?: (approvalId: string) => Promise<void> | void
}

/** 产物 / 文件 / 外部跳转：把对话里的产出引导到 Workspace Inspector 或系统应用。 */
type ChatPanelHostArtifactProps = {
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
  /**
   * 本次工具执行刚刚产出的文件（live 口径，仅当前活跃视图上报）。
   * 自动预览只认这个来源：它不是状态差分，不会被历史补齐 / 缓存校准 /
   * SSE 重连 / 回滚改写过的消息列表影响。
   */
  onLivePresentArtifacts?: (sessionId: string, artifacts: AiTurnArtifact[]) => void
}

/** 视图状态与能力开关：模型入口、草稿恢复、只读形态、任务启动器与轮次导航。 */
type ChatPanelHostViewProps = {
  onModelSelect?: (anchor?: HTMLElement) => void
  onAccessModeChange: (mode: AgentAccessMode) => void
  onContextUsageDisplayChange?: (sessionId: string, info: ContextUsageDisplayInfo) => void
  onInitialRenderReady?: (sessionId: string) => void
  onInitialRenderError?: (sessionId: string, error: unknown) => void
  restoredDraft?: RestoredDraft
  onRestoredDraftConsumed?: (id: number) => void
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
  /**
   * Runtime visibility switch for the turn-navigation rail (unlike
   * `showTurnNavigation`, which is structural and rebuilds the panel effect).
   * The main chat passes `true` while the trace view covers the conversation:
   * the rail is an absolutely positioned child of this host with a higher
   * z-index than the trace layer, so it would otherwise float above it.
   */
  hideTurnNavigation?: boolean
}

type ChatPanelHostProps = ChatPanelHostSessionProps &
  ChatPanelHostMessageActionProps &
  ChatPanelHostApprovalProps &
  ChatPanelHostArtifactProps &
  ChatPanelHostViewProps

/**
 * Stable ref container for props that should NOT trigger panel recreation.
 * Updated synchronously every render so the latest value is always available
 * inside closures (e.g. MutationObserver callbacks, event handlers).
 */
type PropsRef = {
  onCopyAnswer: (text: string) => Promise<void> | void
  onRollbackFromMessage: (messageIndex: number) => Promise<void> | void
  onRollbackForResend?: (messageIndex: number) => Promise<boolean>
  onRetryFromMessage: (messageIndex: number) => void
  onForkFromMessage: (messageIndex: number) => void
  onAccessModeChange: (mode: AgentAccessMode) => void
  onTogglePlanMode: () => void
  onApproveToolCall: (toolCallId: string) => Promise<void> | void
  onRejectToolCall: (toolCallId: string) => Promise<void> | void
  onAnswerAsk?: (askId: string, answers: ServerAgentAskAnswer[], skipped: boolean, remark?: string) => Promise<void> | void
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
  onLivePresentArtifacts?: (sessionId: string, artifacts: AiTurnArtifact[]) => void
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
  onRollbackForResend,
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
  onLivePresentArtifacts,
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
  hideTurnNavigation = false,
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
    /**
     * Composer "+" menu data. The capability-suggestion subsystem lives in the
     * panel effect, but the menu is rendered by the surface, so the effect
     * publishes the two handlers here.
     */
    availablePluginRows?: () => CapabilitySuggestion[]
    selectPluginCapability?: (pluginName: string) => void
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
  /**
   * Active model upstream retry (`model_stream_retry`). Owned here because it
   * arrives as an agent event, but rendered by the surface: the retry row used
   * to be injected into the message list by a decoration controller.
   */
  const [modelRetryInfo, setModelRetryInfo] = useState<{ attempt: number; maxAttempts: number } | null>(null)
  /**
   * 会话写入租约（`src/lib/session-lease-client.ts`）：本页是否为唯一写入者。
   *
   * 主聊天页在挂载时向 `ServerAgent` 申领租约；这里把「非持有者」翻译成
   * 作曲区只读 + 提示条。只读视图、分享页与 Side Chat 从不启用租约
   * （`enableSessionLease` 不存在），因此 `leaseObserver` 恒为 false，
   * 行为与升级前一致。
   */
  const leaseSupported = typeof (agent as { enableSessionLease?: unknown } | null)?.enableSessionLease === 'function'
  /**
   * 租约状态通过 `useSyncExternalStore` 读取，而不是镜像进本地 state：
   * 变化源既有 SSE 帧（别的窗口接管）也有本页心跳结果，二者都会触发
   * `ServerAgent` 的 `session_lease` 事件；镜像进 state 需要在 effect 里
   * 同步 setState，会触发级联渲染。
   */
  const agentWithLease = agent as unknown as { subscribeSessionLease?: (listener: () => void) => () => void } | null
  const sessionLease = useSyncExternalStore(
    useCallback((listener: () => void) => agentWithLease?.subscribeSessionLease?.(listener) ?? (() => {}), [agentWithLease]),
    () => (agent?.state as { sessionLease?: SessionLeaseSnapshot } | undefined)?.sessionLease,
    () => undefined,
  )
  const leaseObserver = leaseSupported && sessionLease !== undefined && sessionLease.isOwner === false
  const leaseDegraded = leaseSupported && sessionLease?.degraded === true

  const sideChatMode = mode === 'side-chat'
  const effectiveCapabilities = useMemo(
    () => applyChatPagePolicy(sideChatMode ? SIDE_CHAT_UI_CAPABILITIES : capabilities, {
      readOnly,
      disableFork: sideChatMode ? false : disableFork,
    }),
    [sideChatMode, capabilities, readOnly, disableFork],
  )

  /**
   * 主会话挂载即申领写入租约。`readOnly` / Side Chat / 分享页不申领：它们本就
   * 不该写，申领反而会抢走真正的写入者。
   *
   * 申领结果不在此处同步 setState：`enableSessionLease()` 会经 `session_lease`
   * 事件广播，`useSyncExternalStore` 的订阅随之刷新（effect 只负责与外部系统
   * 握手，不在体内派生渲染状态）。
   */
  useEffect(() => {
    if (!leaseSupported || readOnly || sideChatMode) return
    ;(agent as unknown as { enableSessionLease: () => void }).enableSessionLease()
  }, [agent, leaseSupported, readOnly, sideChatMode])

  /**
   * 「在此窗口接管」：强制拿到租约，成功后本页恢复可写。状态更新由
   * `ServerAgent.applySessionLease` 通过 `session_lease` 事件广播回来。
   */
  const takeOverLease = useCallback(async (): Promise<boolean> => {
    const withLease = agent as unknown as { takeOverSessionLease?: () => Promise<boolean> }
    if (typeof withLease.takeOverSessionLease !== 'function') return false
    return withLease.takeOverSessionLease()
  }, [agent])

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
    onRollbackForResend,
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
    onLivePresentArtifacts,
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
      onRollbackForResend,
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
      onLivePresentArtifacts,
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
  const scheduleDecorateRef = useRef<((mode?: ChatDecorateMode) => void) | null>(null)
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
    setReplyWaiting(agent.state.isStreaming)
    let cancelInitialRenderReady: (() => void) | undefined
    /** 后台补齐历史的取消句柄（idle callback 或 timeout），与首帧通知分开管理。 */
    let cancelHydration: (() => void) | undefined
    let idleHandle: number | undefined
    let hydrationTimer: number | undefined

    // Draft capture/flush (including the "kept view left the screen" rule) is
    // owned by `composerInput`; see `panel-wiring/composer-input.ts`.

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
    /**
     * 页面重新可见 / 网络恢复时再收敛一次。
     *
     * 手机被系统挂起后，退避重试的定时器可能已经跑完并放弃，也可能根本没跑；
     * 但窗口仍然是尾部 200 条。`ensureFullHistory` 是幂等的（`baseSeq === 0`
     * 直接返回），所以这里可以无脑触发，不会重复拉取。
     */
    const rehydrateOnVisible = () => {
      if (disposed) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const ensure = (agent as { ensureFullHistory?: (beforeReplace?: () => (() => void) | void) => Promise<boolean> }).ensureFullHistory
      if (typeof ensure !== 'function') return
      void ensure.call(agent, () => surfaceRef.current?.captureScrollAnchor()).catch(() => {})
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', rehydrateOnVisible)
      window.addEventListener('online', rehydrateOnVisible)
    }
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
        //
        // 走 `ensureFullHistory`（幂等 + 退避重试），不再直接调一次
        // `hydrateFullHistory`：手机经 Tailscale 拉全量经常超时/被挂起，一次性
        // 调用失败就等于该端永久停在尾部 200 条。
        const hydrate = (agent as { ensureFullHistory?: (beforeReplace?: () => (() => void) | void) => Promise<boolean> }).ensureFullHistory
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
          composerInput.flushComposerDraft()
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
        composerInput.markComposerClearedForSend()
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
      // The surface owns the follow flag and the window's right edge; scroll-sync
      // only detects intent. Two copies of either fact drifted apart before and
      // produced both reported symptoms (up-paging bouncing to the bottom, and
      // down-paging running straight to the newest message).
      getFollowing: () => surfaceRef.current?.isFollowing() ?? true,
      canFollowTail: () => surfaceRef.current?.coversTail() ?? true,
      onReachTop: () => {
        // End the guard after loadMoreMessages restores scrollTop in the
        // window-commit layout callback, or immediately if it no-ops.
        // beginProgrammaticScroll is refcounted, so a no-op loadMore that
        // resolves immediately still pairs begin/end correctly even if
        // another page is in flight.
        const endProgrammaticScroll = scrollSync.beginProgrammaticScroll()
        void Promise.resolve(surfaceRef.current?.loadMoreMessages()).finally(endProgrammaticScroll)
      },
      onReachBottom: () => {
        // Mirror of onReachTop: the window's right edge stops where the reader
        // started, so reaching the bottom has to mount the next page. The surface
        // appends it BELOW the viewport (nothing moves) and guards re-entry, so
        // this needs no programmatic-scroll guard.
        void surfaceRef.current?.loadNewerMessages()
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
    // 目标控制条由 surface 渲染（surface/GoalControlStrip），宿主只提供
    // 能力门禁与动作回调：它原来的 find-or-create 注入器每次装饰 pass 都要
    // 重排子节点、恢复焦点并重新订阅 goal-ui。
    // 全局 Agent SSE 弱网重连提示与模型重试提示由 surface 渲染（surface/ConnectionNotices）：
    // 它们原来的 find-or-create 注入器每次装饰 pass 都要重新挂回消息列表末尾。
    // Side Chat 使用独立 NDJSON 流、不共享该连接，surface 那边通过
    // `enableConnectionNotices={!sideChatMode}` 关掉。
    let turnNavigation: ReturnType<typeof createTurnNavigation> | null = null

    // Composer draft lifecycle is created before the suggestion wiring because
    // the task launcher asks for its readiness flag synchronously when it
    // renders for the first time.
    const composerInput = createComposerInputWiring({
      panel,
      hostRef,
      sideChatMode,
      sideChatInputMemory,
      sessionId,
      currentDraftKey,
      currentDraftContext,
      composerDraftsRef,
      readyComposerPanels,
      draftRestoreGuard,
      restoredDraftRef,
      restoredDraftIdRef,
      restoredDraftRestoreRef,
      applyingRestoredDraftRef,
      isDisposed: () => disposed,
      cancelRestoredDraftRestore,
      cancelPendingDraftSave,
      schedulePersistDraft,
      persistCurrentComposerDraft,
      consumeRestoredDraft,
      restoreDraftForSession,
      getSelectedCapabilities: () => capabilitySuggestions.snapshotSelectedCapabilities(),
      restoreSelectedCapabilities: (capabilities) => capabilitySuggestions.restoreSelectedCapabilities(capabilities),
      syncTaskLauncher: () => taskLauncher?.sync(),
      scheduleDecorate: () => scheduleDecorateRef.current?.(),
    })

    // --- Command / capability / file-reference suggestions + task launcher ---
    const {
      cmdSuggestions,
      capabilitySuggestions,
      taskLauncher,
      fileReferenceSuggestions,
      cleanup: cleanupSuggestions,
    } = setupComposerSuggestions({
      panel,
      currentDraftKey,
      currentDraftContext,
      composerDraftsRef,
      customCommandsRef,
      slashCatalogProjectIdRef,
      schedulePersistDraft,
      surfaceSendHooksRef,
      taskLauncherStateRef,
      handleComposerInteraction: composerInput.handleComposerInteraction,
      isComposerReady: composerInput.isReady,
      isDisposed: () => disposed,
      taskLauncherEnabled,
      sideChatMode,
      readOnly,
      capabilitiesEnabled: effectiveCapabilities.capabilitySuggestions,
      agent,
      projectId: project?.id ?? projectId,
    })

    // --- Queued composer messages (Enter during streaming enqueues) ---
    const messageQueueWiring = setupMessageQueueWiring({
      panel,
      sessionId,
      agent,
      sideChatMode,
      readOnly,
      isDisposed: () => disposed,
      getCapabilities: () => propsRef.current.capabilities,
      // A pending ask_user owns the composer while it waits: its text is the
      // answer to the card, not a steer message (steering is drained at the
      // next turn boundary, which the blocked tool call never reaches).
      isAskPending: () => Boolean(pendingAskRef.current
        ?? (agent as unknown as { state: { pendingAsk?: unknown } }).state.pendingAsk),
      submitAskText: (text) => submitAskTextToPendingAsk(panel, text),
      onComposerCleared: () => {
        taskLauncher?.cancel()
        cmdSuggestions.remove()
        capabilitySuggestions.remove()
        fileReferenceSuggestions.remove()
        composerInput.handleEditorInput('')
      },
    })
    const messageQueue = messageQueueWiring.controller

    restoreSideChatDraftRef.current = sideChatMode ? composerInput.restoreSideChatDraft : null

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

    // Composer input / file-change handlers and the draft write rules live in
    // `panel-wiring/composer-input.ts` (`composerInput` above).

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

    // Committed rows are stable for the whole streaming turn; the snapshot lets
    // the streaming pass reuse them without re-running the full-table scan.
    // Every full pass invalidates it, and full passes are what handle structural
    // row changes (message/tool boundaries and MutationObserver records).
    const messageRowSnapshot = createMessageRowSnapshot(panel)

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
      messageRowSnapshot.invalidate()
      const messageRows = messageRowSnapshot.rows()
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
          onEditMessageAndResend: propsRef.current.onRollbackForResend
            ? async (messageIndex, text) => {
                const rolledBack = await propsRef.current.onRollbackForResend!(messageIndex)
                if (!rolledBack) return false
                // 走 composer 既有的 onSend：复用 plan-mode 包装、发送前检查、
                // 乐观消息与滚动锚定，避免在装饰层另起一条发送链路。
                const send = await waitForComposerSend(panel)
                if (!send) return false
                send(text)
                return true
              }
            : undefined,
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
      } catch (error) {
        logger.warn('Failed to decorate chat messages:', error)
      }

      try {
        decorateEditor({
          panel,
          planMode: props.planMode,
          onTogglePlanMode: props.onTogglePlanMode,
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
          onInput: composerInput.handleEditorInput,
          onFilesChange: composerInput.handleEditorFilesChange,
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
              composerInput.updateSideChatInputMemory()
            })
          },
        })
        // The native thinking selector stays hidden in the React surface
        // (enableThinkingSelector=false); the QuickForge thinking control is
        // injected by the decoration layer (thinking-level-controls), exactly
        // like the previous patch-thinking-selector({hideSelector:true}) setup.
      } catch { /* continue to todo summary */ }

      // The TodoWrite capsule is React-rendered inside the composer
      // (surface/TodoWriteSummary); there is no decoration pass left for it.
      // The task launcher stays command-driven: it owns a floating panel.
      try {
        taskLauncher?.sync()
      } catch (error) {
        logger.warn('Failed to sync task launcher:', error)
      }

      try {
        messageQueue.update()
      } catch (error) {
        logger.warn('Failed to update queued messages panel:', error)
      }

      // The goal strip is React-rendered inside the composer
      // (surface/GoalControlStrip); no decoration pass remains for it.

      // Pending approval / auto-compact / ask-user cards (see
      // `panel-wiring/approval-cards.ts`). The approval card is critical UI, so
      // it is reconciled every pass regardless of the message decorations.
      syncPendingApprovalCards({
        panel,
        agent: agent as unknown as ApprovalCardsAgent,
        sideChatMode,
        props,
        propsRef,
        pendingApprovalRef,
        pendingAskRef,
      })

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

    // --- Decoration scheduling (rAF coalescing, streaming fast path, handoff) ---
    const decoratePipeline = setupDecoratePipeline({
      panel,
      host,
      sessionId,
      decorate,
      decorateStreaming: () => {
        decorateStreamingMessages(panel, messageRowSnapshot.rows(), agent.state.isStreaming)
        // Content growth can cross the back-to-bottom threshold while the user
        // is scrolled up (no scroll event fires in that case).
        scrollBottomButton.setup()
      },
      decorateFnRef,
      decorateInFlightRef,
      isDisposed: () => disposed,
      syncProcessStreamingState,
      isScrollFollowing: () => scrollSync.isEnabled,
      scheduleScrollToBottom: () => scrollSync.scheduleScrollToBottom(),
    })
    // Expose for the decoration trigger effect
    scheduleDecorateRef.current = decoratePipeline.schedule

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

      // Restore queued messages persisted for this session (reload mid-turn)
      // and, when a turn settled while the session was in the background,
      // resume auto-sending the restored head.
      messageQueueWiring.hydrate()

      // Restore the composer draft (restored draft, memory draft, or the
      // persisted draft for this scope).
      composerInput.restoreInitialDraft()

      // Observe the message area for re-decoration (the observer targets
      // `.qf-scroll-container`, see `panel-wiring/decorate-pipeline.ts`).
      observer = decoratePipeline.startObserver()

      // Defer initial decoration to the next animation frame so the React
      // surface's first paint has settled. Without this the approval card
      // (and other decorations) may be injected into a DOM that is not yet
      // fully laid out, causing style discrepancies.
      window.requestAnimationFrame(() => {
        if (disposed) return
        decoratePipeline.runDecorate()
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
        decoratePipeline.resetProcessHandoff()
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
          decoratePipeline.resetProcessHandoff()
          // Away from the tail → surface the arrival on the back-to-bottom badge.
          scrollBottomButton.notifyNewAssistantMessage()
        }
        if (event.type === 'message_update' || eventMessage?.role === 'assistant') {
          setReplyWaiting(false)
          // 模型流重试后新流的第一个增量到达即视为恢复。
          setModelRetryInfo(null)
        }
        scheduleDecorateRef.current?.(event.type === 'message_update' && agent.state.isStreaming ? 'streaming' : 'full')
        if (event.type === 'message_end' && eventMessage?.role === 'assistant') {
          decoratePipeline.scheduleProcessHandoff()
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
        decoratePipeline.scheduleToolInterfaceUpdate()
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'tool_execution_end' && !sideChatMode) {
        // 自动预览的唯一来源：本次工具执行刚刚产出的文件（live 口径）。
        // 只有当前在屏幕上的会话才上报——后台会话（被 SessionViewPool 保活的
        // 隐藏视图）跑完 present_files 不应该抢走用户正看着的面板。
        // 历史文件的 present_files 走消息状态，永远不进入这条路径。
        const liveArtifacts = extractToolExecutionArtifacts(event as ToolExecutionEvent)
        if (liveArtifacts.length > 0 && isSessionViewActive(activityKey)) {
          propsRef.current.onLivePresentArtifacts?.(sessionId, liveArtifacts)
        }
      }
      if (eventType === 'error') {
        setModelRetryInfo(null)
      }
      if (eventType === 'persist_degraded') {
        // Persist degradation flag changed — show/hide the warning banner.
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'goal_updated') {
        // Authoritative goal snapshot changed — re-render the goal card.
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'session_lease') {
        // 租约易主（另一个窗口接管/释放，或本页心跳拿到/丢掉）：只影响作曲区
        // 可用性与提示条，不改消息结构。重渲染由 `subscribeSessionLease` 的
        // `useSyncExternalStore` 订阅承担，这里不做任何事。
      }
      if (eventType === 'model_stream_retry') {
        // 服务端正在内部重建模型上游流 — 显示/更新重试进度；恢复或回合
        // 终止由 message_update / agent_end / error 分支移除。
        const retryEvent = event as { attempt?: number; maxAttempts?: number; recovered?: boolean }
        if (retryEvent.recovered === true) setModelRetryInfo(null)
        else if (typeof retryEvent.attempt === 'number' && typeof retryEvent.maxAttempts === 'number') {
          setModelRetryInfo({ attempt: retryEvent.attempt, maxAttempts: retryEvent.maxAttempts })
        }
      }
      if (event.type === 'agent_end') {
        setReplyWaiting(false)
        setModelRetryInfo(null)
        syncProcessStreamingState()
        decoratePipeline.scheduleProcessHandoff()
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
        messageQueueWiring.onAgentEnd((event as { status?: string }).status)
      }
      if (eventType === 'auto_compact_completed' || eventType === 'auto_compact_failed') {
        if (pendingAutoCompactApprovalRef.current?.sessionId === agent.sessionId) {
          pendingAutoCompactApprovalRef.current = null
        }
        ;(agent as AgentWithContextCompaction).state.pendingAutoCompactApproval = null
        scheduleDecorateRef.current?.()
      }
      if (eventType === 'auto_compact_approval_settled') {
        // The server dropped its pending approval (declined / timed out /
        // cancelled). Clearing the local ref keeps the decoration pass from
        // re-rendering a card whose request no longer exists — the click would
        // only return 404. The decision row itself is React-owned and clears via
        // `state.compactionNotice`.
        const settledEvent = event as unknown as { approvalId?: string }
        const pending = pendingAutoCompactApprovalRef.current
        if (!settledEvent.approvalId || pending?.approvalId === settledEvent.approvalId) {
          pendingAutoCompactApprovalRef.current = null
          ;(agent as AgentWithContextCompaction).state.pendingAutoCompactApproval = null
          scheduleDecorateRef.current?.()
        }
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
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', rehydrateOnVisible)
        window.removeEventListener('online', rehydrateOnVisible)
      }
      draftRestoreGuard.invalidate()
      cancelRestoredDraftRestore()
      cancelPendingDraftSave()
      cancelInitialRenderReady?.()
      cancelHydration?.()
      unsubscribeActivity()
      composerInput.flushComposerDraft()
      cleanupSuggestions()
      contextUsage.cleanup()
      turnNavigation?.cleanup()
      scrollSync.cleanup()
      scrollSyncRef.current = null
      scrollBottomButton.cleanup()
      taskLauncher?.dispose()
      removeSubagentRunningIndicator(panel)
      messageQueueWiring.cleanup()
      unsubscribeScrollEvents()
      observer?.disconnect()
      decoratePipeline.cleanup()
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
  // 让 src/styles/chat/compact.css 中的紧凑段把 Composer 控件收成 icon-only 形态。
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
    <div
      ref={hostRef}
      className="quickforge-chat-panel-host min-h-0 flex-1 overflow-hidden"
      // 轨迹视图盖在对话上时把轮次导航条一并藏掉。用 data 属性 + CSS 而不是
      // 命令式调用：rail 是这个 host 的绝对定位子节点、z-index 高于轨迹层，
      // 靠属性让 CSS 直接 display:none，不依赖两个 effect 的先后顺序。
      data-turn-navigation={hideTurnNavigation ? 'hidden' : undefined}
    >
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
          // Context-compaction timeline divider: same gate the decoration layer
          // used (`capabilities.compaction` and never in Side Chat).
          enableCompactionDivider={!sideChatMode && effectiveCapabilities.compaction}
          // Compaction decision row: React renders it inside the message list and
          // calls the same agent methods the decoration card used to call. It is
          // never actionable in Side Chat or when the request lacks a handler
          // (the row then explains why instead of showing dead buttons).
          onApproveCompaction={
            !sideChatMode && !approvalReadOnly && onApproveAutoCompact
              ? (approvalId: string) => { void onApproveAutoCompact(approvalId) }
              : undefined
          }
          onRejectCompaction={
            !sideChatMode && !approvalReadOnly && onRejectAutoCompact
              ? (approvalId: string) => { void onRejectAutoCompact(approvalId) }
              : undefined
          }
          compactionDecisionReadOnly={approvalReadOnly || sideChatMode}
          compactionDecisionDisabledReason={approvalReadOnly ? approvalReadOnlyMessage : undefined}
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
          enableConnectionNotices={!sideChatMode}
          onOpenLocalFilePath={readOnly ? undefined : onOpenLocalFilePath}
          // The "+" menu and the thinking selector are rendered by the surface
          // now; the panel effect publishes their data through the same ref the
          // other composer hooks use.
          enableComposerPlusMenu={Boolean(
            !readOnly
            && (effectiveCapabilities.attachments || effectiveCapabilities.capabilitySuggestions || sideChatMode),
          )}
          availablePluginRows={() => surfaceSendHooksRef.current?.availablePluginRows?.() ?? []}
          selectPluginCapability={(pluginName) => surfaceSendHooksRef.current?.selectPluginCapability?.(pluginName)}
          onDismissComposerSuggestions={() => surfaceSendHooksRef.current?.dismissSuggestions?.()}
          // Plan mode + agent access: React renders both triggers into the
          // editor's left control row (they used to be injected on every pass).
          // Side Chat keeps every QuickForge composer control visible but inert,
          // matching `disableComposerControls` in the decoration layer.
          planMode={planMode}
          onTogglePlanMode={() => propsRef.current.onTogglePlanMode()}
          // Plan mode: the trigger exists only while plan mode is ON (the
          // decoration created it on enable and removed it on disable).
          showPlanModeControl={effectiveCapabilities.planMode}
          agentAccessMode={agentAccessMode}
          onAccessModeChange={(mode) => propsRef.current.onAccessModeChange(mode)}
          // Access mode: also requires workspace tools (without them the server
          // rejects full access). Side Chat keeps the trigger visible but
          // disabled, matching the old `disableComposerControls` path.
          showAgentAccessControl={sideChatMode || (effectiveCapabilities.accessMode && workspaceToolsEnabled)}
          composerControlsDisabled={sideChatMode}
          leaseObserver={leaseObserver}
          leaseDegraded={leaseDegraded}
          onTakeOverLease={takeOverLease}
          // 思考等级滑杆随模型选择弹层一起渲染（见 useModelActions →
          // openCustomOnlyModelSelector 的 thinkingLevel/onThinkingLevelChange），
          // composer 行里不再有独立控件，所以这里也不再透传控件开关。
          // Goal strip: same gate the decoration controller used (main chat
          // only, goal capability, no shared page, never ACP sessions where the
          // server rejects goal actions).
          enableGoalStrip={!sideChatMode
            && effectiveCapabilities.goal
            && !('shareId' in agent)
            && (agent as AgentWithGoal).sessionSource !== 'acp'}
          sessionId={agent.sessionId}
          onGoalAction={async (action, objective) => {
            const target = agent as AgentWithGoal
            if (typeof target.updateGoal !== 'function') throw new Error(t('goalUnavailable'))
            await target.updateGoal(action, objective)
          }}
          modelRetryInfo={modelRetryInfo}
          onModelSelect={sideChatMode ? undefined : () => {
            const anchor = hostRef.current?.querySelector<HTMLElement>('.quickforge-model-trigger') ?? undefined
            propsRef.current.onModelSelect?.(anchor)
          }}
        />
      ) : null}
    </div>
  )
}
