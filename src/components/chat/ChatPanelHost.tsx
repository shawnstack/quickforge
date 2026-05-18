import { useEffect, useRef } from 'react'
import {
  ApiKeyPromptDialog,
  ChatPanel,
} from '@mariozechner/pi-web-ui'
import type { ServerAgent } from '@/lib/server-agent'
import type { SharedServerAgent } from '@/lib/shared-server-agent'
import { getLocalWorkspaceTools } from '@/lib/local-tools'
import type { ComposerDraft, CustomCommandSummary } from './chat-utils'
import { emptyDraft, hasDraft } from './chat-utils'
import { createScrollSync } from './scroll-sync'
import { createCommandSuggestions } from './command-suggestions'
import { createContextUsageIndicator } from './context-usage'
import { decorateMessages, decorateEditor, captureComposerDraft, restoreComposerDraft, injectApprovalCard, removeApprovalCard } from './panel-decoration'
import type { ProjectInfo, RestoredDraft } from '@/lib/types'

type AgentLike = ServerAgent | SharedServerAgent

type ChatPanelHostProps = {
  agent: AgentLike | null
  onModelSelect?: () => void
  revision: number
  yoloMode: boolean
  workspaceToolsEnabled: boolean
  project?: ProjectInfo
  projectId?: string
  onToggleYoloMode: () => void
  onRollbackFromMessage: (messageIndex: number) => void
  onCopyAnswer: (text: string) => Promise<void> | void
  onForkFromMessage: (messageIndex: number) => void
  onApproveToolCall: (toolCallId: string) => Promise<void> | void
  onRejectToolCall: (toolCallId: string) => Promise<void> | void
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
  onForkFromMessage: (messageIndex: number) => void
  onToggleYoloMode: () => void
  onApproveToolCall: (toolCallId: string) => Promise<void> | void
  onRejectToolCall: (toolCallId: string) => Promise<void> | void
  onModelSelect?: () => void
  yoloMode: boolean
  workspaceToolsEnabled: boolean
  disableFork: boolean
  readOnly: boolean
  allowModelControls: boolean
  bypassClientApiKeyCheck: boolean
}

export function ChatPanelHost({
  agent,
  onModelSelect,
  revision,
  yoloMode,
  workspaceToolsEnabled,
  project,
  onToggleYoloMode,
  onRollbackFromMessage,
  onCopyAnswer,
  onForkFromMessage,
  onApproveToolCall,
  onRejectToolCall,
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
  const customCommandsRef = useRef<CustomCommandSummary[]>([])
  const lastAppliedRestoredDraftRef = useRef<{ id: number; text: string } | undefined>(undefined)
  const consumedRestoredDraftIdsRef = useRef<Set<number>>(new Set())

  // --- Stable ref for props (avoids re-creating panel on callback changes) ---
  const propsRef = useRef<PropsRef>({
    onCopyAnswer,
    onRollbackFromMessage,
    onForkFromMessage,
    onToggleYoloMode,
    onApproveToolCall,
    onRejectToolCall,
    onModelSelect,
    yoloMode,
    workspaceToolsEnabled,
    disableFork,
    readOnly,
    allowModelControls,
    bypassClientApiKeyCheck,
  })
  // Keep ref in sync with the latest props so closures always read fresh values.
  // Using useEffect (instead of render-time assignment) satisfies the
  // react-hooks/refs lint rule while still being synchronous enough.
  useEffect(() => {
    propsRef.current = {
      onCopyAnswer,
      onRollbackFromMessage,
      onForkFromMessage,
      onToggleYoloMode,
      onApproveToolCall,
      onRejectToolCall,
      onModelSelect,
      yoloMode,
      workspaceToolsEnabled,
      disableFork,
      readOnly,
      allowModelControls,
      bypassClientApiKeyCheck,
    }
    restoredDraftRef.current = restoredDraft
  })

  // --- Refs that let the decoration trigger effect call into the active panel ---
  const decorateFnRef = useRef<(() => void) | null>(null)
  const scrollSyncRef = useRef<ReturnType<typeof createScrollSync> | null>(null)
  const scheduleDecorateRef = useRef<(() => void) | null>(null)
  const pendingApprovalRef = useRef<{ toolCallId: string; toolName: string; args: Record<string, unknown>; sessionId: string } | null>(null)

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

  const restoreDraftForSession = (panel: HTMLElement, draft: RestoredDraft, sessionId: string, force = false) => {
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
        : composerDraftsRef.current.get(sessionId)
      const lastApplied = lastAppliedRestoredDraftRef.current
      const isFirstApplyForDraft = lastApplied?.id !== draft.id
      const canApply = isFirstApplyForDraft || !hasDraft(currentDraft ?? emptyDraft()) || currentDraft?.text === lastApplied.text
      if (!canApply) return

      restoreComposerDraft(panel, draft, composerDraftsRef.current, sessionId)
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
    let disposed = false
    let observer: MutationObserver | undefined

    // --- Scroll sync subsystem ---
    const scrollSync = createScrollSync({ panel })
    scrollSyncRef.current = scrollSync

    // --- Command suggestions subsystem ---
    const cmdSuggestions = createCommandSuggestions({
      panel,
      getCustomCommands: () => customCommandsRef.current,
      getComposerDrafts: () => composerDraftsRef.current,
      sessionId,
      setComposerDrafts: (drafts) => { composerDraftsRef.current = drafts },
      restoreDraftIntoComposer: (draft) => {
        restoreComposerDraft(panel, draft, composerDraftsRef.current, sessionId)
      },
    })

    // --- Context usage subsystem ---
    const contextUsage = createContextUsageIndicator({
      panel,
      getSystemPrompt: () => agent.state.systemPrompt,
      getMessages: () => agent.state.messages as import('./chat-utils').MessageWithUsage[],
      getContextWindow: () => agent.state.model?.contextWindow ?? 0,
    })

    // --- Composer input/file-change handlers (update draft map) ---
    const handleEditorInput = (value: string) => {
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
      const attachments = editor?.attachments ? [...editor.attachments] : []
      composerDraftsRef.current.set(sessionId, { text: value, attachments })
    }
    const handleEditorFilesChange = (files: unknown[]) => {
      const editor = panel.querySelector<import('./chat-utils').MessageEditorElement>('message-editor')
      const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
      const text = editor?.value ?? textarea?.value ?? ''
      composerDraftsRef.current.set(sessionId, { text, attachments: files ? [...files] : [] })
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
          onForkFromMessage: props.onForkFromMessage,
          disableFork: props.disableFork,
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
        )
      } else {
        removeApprovalCard(panel)
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
        cmdSuggestions.remove()
        composerDraftsRef.current.delete(sessionId)
        scrollSync.enable()
      },
      onModelSelect: propsRef.current.onModelSelect,
      toolsFactory: () => getLocalWorkspaceTools(agent.state.tools),
    }).then(() => {
      if (disposed) return

      // Restore draft
      const draft = restoredDraftRef.current
      if (draft && restoredDraftIdRef.current !== draft.id) {
        restoredDraftIdRef.current = draft.id
        restoreDraftForSession(panel, draft, sessionId)
      } else {
        restoreComposerDraft(panel, composerDraftsRef.current.get(sessionId) ?? emptyDraft(), composerDraftsRef.current, sessionId)
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
        scrollSync.enable()
        // A new run started — clear any pending approval for this session
        if (pendingApprovalRef.current?.sessionId === agent.sessionId) {
          pendingApprovalRef.current = null
        }
      }
      if (event.type === 'message_start' || event.type === 'message_update' || event.type === 'message_end' || event.type === 'turn_end' || event.type === 'agent_end') {
        if (scrollSync.isEnabled) scrollSync.scheduleScrollToBottom()
      }
      if ((event as { type: string }).type === 'messages_replaced') {
        const draft = restoredDraftRef.current
        if (draft && restoredDraftIdRef.current === draft.id) {
          restoreDraftForSession(panel, draft, sessionId)
        }
      }
      const eventType = (event as { type: string }).type
      if (eventType === 'tool_execution_start' || eventType === 'tool_execution_update' || eventType === 'tool_execution_end') {
        const agentInterface = panel.querySelector('agent-interface') as { requestUpdate?: () => void } | null
        agentInterface?.requestUpdate?.()
        if (scrollSync.isEnabled) scrollSync.scheduleScrollToBottom()
      }
      if (event.type === 'agent_end') {
        // Run finished (or aborted) — clear pending approval for this session
        if (pendingApprovalRef.current?.sessionId === agent.sessionId) {
          pendingApprovalRef.current = null
          scheduleDecorateRef.current?.()
        }
      }
      // Store pending approval and trigger re-decoration
      if ((event as Record<string, unknown>).type === 'tool_approval_required') {
        const approvalEvent = event as unknown as { toolCallId: string; toolName: string; args: Record<string, unknown>; sessionId: string }
        pendingApprovalRef.current = { toolCallId: approvalEvent.toolCallId, toolName: approvalEvent.toolName, args: approvalEvent.args, sessionId: approvalEvent.sessionId }
        scheduleDecorateRef.current?.()
      }
    })

    return () => {
      captureComposerDraft(panel, composerDraftsRef.current, sessionId)
      cmdSuggestions.remove()
      cmdSuggestions.cleanupTextareaHandler()
      disposed = true
      scrollSync.cleanup()
      scrollSyncRef.current = null
      unsubscribeScrollEvents()
      observer?.disconnect()
      decorateFnRef.current = null
      panel.remove()
    }
  }, [agent]) // ← ONLY agent triggers panel recreation

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
  }, [yoloMode, workspaceToolsEnabled, disableFork, readOnly, allowModelControls, revision])

  // Draft restoration trigger
  useEffect(() => {
    const draft = restoredDraftRef.current
    if (!draft || !hostRef.current) return
    const sessionId = (agent as ServerAgent | SharedServerAgent | null)?.sessionId ?? ''
    if (draft.sessionId && draft.sessionId !== sessionId) return
    const panel = hostRef.current.querySelector('pi-chat-panel')
    if (!panel) return
    restoredDraftIdRef.current = draft.id
    restoreDraftForSession(panel as HTMLElement, draft, sessionId, true)
  }, [restoredDraft, agent])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
}
