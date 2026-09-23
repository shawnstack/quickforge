/* eslint-disable react-refresh/only-export-components -- exports the ChatSurface component plus the pure send flow, agent snapshot and release-gate helpers covered by tests. */
import { Component, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createMessageWindow, type MessageWindowController } from '../windowed-messages'
import { releaseProcessGroups } from '../panel-decoration/process-folding'
import { getAppStorage } from '@/storage'
import type {
  Agent,
  AgentEvent,
  AgentMessage,
  AgentTool,
  Api,
  Attachment,
  ChatSurfaceHandle,
  ChatSurfaceProps,
  Model,
  ThinkingLevel,
  UserMessageWithAttachments,
  AssistantMessage as AssistantMessageType,
} from './ChatTypes'
import type { SurfaceEditorBridgeElement } from './ChatTypes'
import { t } from '@/lib/i18n'
import { MessageList } from './MessageList'
import { MessageEditor } from './MessageEditor'
import { isRenderableMessage, messageRenderKeys } from './content-parts'
import { CommandActionsEnabledContext } from './surface-context'
import { UsageBar } from './UsageBar'

/**
 * React replacement for the legacy `ChatPanel` + `AgentInterface` pair
 * (self-hosted-chat-ui T3). Renders the message list, streaming container,
 * composer and usage bar for an `Agent` session and exposes
 * `setInput` / `setAutoScroll` through its ref.
 */

export interface SendMessageContext {
  /** Read the locally stored provider API key (`@/storage` providerKeys). */
  getApiKey: (provider: string) => Promise<string | null>
  onApiKeyRequired?: (provider: string) => Promise<boolean>
  onBeforeSend?: () => void | Promise<void>
  isStreaming: () => boolean
  /** Current model provider; undefined when no model is set. */
  getProvider: () => string | undefined
  clearEditor: () => void
  /** Put a failed send's text and attachments back into the composer. */
  restoreEditor?: (input: string, attachments: Attachment[] | undefined) => void
  enableAutoScroll: () => void
  /** Deliver the prompt: a plain string, or a user message with attachments. */
  prompt: (message: string | UserMessageWithAttachments) => Promise<void>
  onError?: (message: string) => void
}

/**
 * Send-message flow aligned with the legacy `AgentInterface.sendMessage`:
 * - Abort on empty input (no attachments) or while streaming.
 * - Read the provider key from local storage; when missing, ask
 *   `onApiKeyRequired` and abort when it resolves false.
 * - Re-check streaming after the awaits above (the key dialog can stay open
 *   for minutes while another turn starts) and drop the send when live.
 * - Run `onBeforeSend`, clear the editor, re-enable auto-scroll, then prompt
 *   with a `user-with-attachments` message when attachments exist.
 * - When the prompt rejects, restore the draft through `restoreEditor` and
 *   surface the failure via `onError` instead of losing the composer text.
 */
export async function runSendMessage(input: string, attachments: Attachment[] | undefined, context: SendMessageContext): Promise<void> {
  // `attachments` may be undefined; treat "no attachments" as absence, not
  // `length === 0`, otherwise blank input with undefined attachments slips through.
  const hasAttachments = !!(attachments && attachments.length > 0)
  if ((!input.trim() && !hasAttachments) || context.isStreaming()) return

  const provider = context.getProvider()
  if (provider === undefined) {
    context.onError?.(t('chatNoModelSet'))
    return
  }

  const apiKey = await context.getApiKey(provider)
  if (!apiKey) {
    if (!context.onApiKeyRequired) {
      context.onError?.('No API key configured and no onApiKeyRequired handler set')
      return
    }
    const success = await context.onApiKeyRequired(provider)
    if (!success) return
  }

  // The key dialog (or the storage read) can resolve long after the user
  // pressed send; a turn may already be streaming. Drop this send instead of
  // interleaving it with the live one — the draft is still intact because the
  // editor is only cleared below.
  if (context.isStreaming()) return

  if (context.onBeforeSend) {
    await context.onBeforeSend()
  }

  // Only clear the editor after we know the send can proceed.
  context.clearEditor()
  context.enableAutoScroll()

  try {
    if (hasAttachments) {
      await context.prompt({
        role: 'user-with-attachments',
        content: input,
        attachments: attachments as Attachment[],
        timestamp: Date.now(),
      })
    } else {
      await context.prompt(input)
    }
  } catch (error) {
    // Prompt rejected (network/server refusal): give the draft back to the
    // composer and report through the host's feedback channel.
    context.restoreEditor?.(input, attachments)
    context.onError?.(t('chatSendFailed', { error: error instanceof Error ? error.message : String(error) }))
  }
}

/** Immutable view of the mutable `AgentState` used for React rendering. */
export interface AgentSurfaceSnapshot {
  messages: AgentMessage[]
  tools: AgentTool[]
  isStreaming: boolean
  pendingToolCalls: ReadonlySet<string>
  streamingMessage?: AgentMessage
  model?: Model<Api>
  thinkingLevel: ThinkingLevel
}

/**
 * Shallow "no observable change" checks for snapshot identity reuse (R1 F1a).
 *
 * Every writer of `state.messages` / `state.tools` / `state.pendingToolCalls`
 * swaps in fresh containers with fresh element objects for changed entries
 * (`upsertMessage`, `upsertToolResult`, `mergeGoalIterationMarkers`, server
 * snapshot replacement, `new Set([...])`) and never mutates an already
 * published message object in place, so "same length + same element
 * references" (same size + same members for Sets) means "no visible change".
 */
function sameArrayItems<T>(previous: readonly T[] | undefined, next: readonly T[]): boolean {
  if (previous === undefined || previous.length !== next.length) return false
  for (let index = 0; index < next.length; index++) {
    if (previous[index] !== next[index]) return false
  }
  return true
}

function sameSetItems<T>(previous: ReadonlySet<T> | undefined, next: ReadonlySet<T>): boolean {
  if (previous === undefined || previous.size !== next.size) return false
  for (const item of next) {
    if (!previous.has(item)) return false
  }
  return true
}

export function readAgentSnapshot(agent: Agent, previous?: AgentSurfaceSnapshot): AgentSurfaceSnapshot {
  // Reuse the previous snapshot's array/Set identities when the state did not
  // observably change (R1 F1a): without this, every agent event produced new
  // `messages`/`tools`/`pendingToolCalls` identities and invalidated every
  // downstream memo/useMemo comparison (MessageArea, message rows,
  // toolResultsById) even for events that only touch `streamingMessage`.
  const state = agent.state
  const messages =
    previous && sameArrayItems(previous.messages, state.messages) ? previous.messages : [...state.messages]
  const tools = previous && sameArrayItems(previous.tools, state.tools) ? previous.tools : [...state.tools]
  const pendingToolCalls =
    previous && sameSetItems(previous.pendingToolCalls, state.pendingToolCalls)
      ? previous.pendingToolCalls
      : new Set(state.pendingToolCalls)
  // The streaming partial body keeps its per-event shallow copy: every
  // `message_update` frame carries a new message object and the growing body
  // must re-render the streaming container on each event (see MessageArea).
  const streamingMessage = state.streamingMessage
    ? ({ ...(state.streamingMessage as object) } as AgentMessage)
    : undefined
  if (
    previous &&
    previous.messages === messages &&
    previous.tools === tools &&
    previous.pendingToolCalls === pendingToolCalls &&
    previous.isStreaming === state.isStreaming &&
    previous.model === state.model &&
    previous.thinkingLevel === state.thinkingLevel &&
    previous.streamingMessage === undefined &&
    streamingMessage === undefined
  ) {
    // Nothing observable changed: hand back the previous snapshot object so
    // `setSnapshot` bails out and no-op events cost no render at all.
    return previous
  }
  return {
    messages,
    tools,
    isStreaming: state.isStreaming,
    pendingToolCalls,
    streamingMessage,
    model: state.model,
    thinkingLevel: state.thinkingLevel,
  }
}

// `messages_replaced` (rollback/clear/compaction replaces state.messages
// in place, see ServerAgent's wire-event handling) and
// `message_metadata_updated` (local metadata-only refresh) must refresh the
// snapshot too, otherwise the surface keeps rendering the pre-replacement list.
// `tool_execution_*` frames upsert tool results into state.messages /
// pendingToolCalls immediately, so they must refresh too or tool cards lag
// until the next message event.
const SUBSCRIBED_EVENTS = new Set([
  'message_start',
  'message_update',
  'message_end',
  'turn_start',
  'turn_end',
  'agent_start',
  'agent_end',
  'messages_replaced',
  'message_metadata_updated',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
])

/** Whether an agent event requires a fresh `readAgentSnapshot` copy. */
export function isSnapshotRefreshEvent(eventType: string): boolean {
  return SUBSCRIBED_EVENTS.has(eventType)
}

/**
 * Ownership boundary between React and the DOM decoration layer (R6).
 *
 * Process folding re-parents React-rendered nodes (`qf-thinking-block` /
 * `qf-tool-message` / `qf-markdown-block`) into `.quickforge-process-group`.
 * React still models those nodes as direct children of the container it
 * rendered, so a commit that inserts, reorders or removes siblings while a
 * group holds them would call `removeChild` / `insertBefore` on a node that is
 * no longer React's direct child.
 *
 * `getSnapshotBeforeUpdate` is the only hook React runs before the mutation
 * phase of the whole commit, so releasing here guarantees every commit starts
 * from the DOM React rendered. The decoration layer owns re-folding and is
 * notified through `onReleased`, which keeps the "release → re-fold" pair inside
 * one unpainted interval (the host decoration pass runs on an animation frame
 * after the commit, never between the two paints around it). Unmount releases
 * too, defensively, so no decoration state can outlive the subtree it describes.
 *
 * `getSnapshotBeforeUpdate` runs for a class component whenever it re-renders.
 * The boundary sits inside the memoized `MessageArea`, so it re-renders exactly
 * when the message snapshot does — which is the only way the message DOM
 * structurally changes (child-local state like the thinking-block disclosure
 * only mutates inside an already-moved node). Composer typing and other
 * snapshot-irrelevant `ChatSurface` commits bail out at the `MessageArea`
 * memo comparison and never reach this boundary, so they cannot release (and
 * flash) folded groups. Within a `MessageArea` re-render, only commits that
 * changed the rendered row identities actually release; pure streaming frames
 * (the partial body grows in place) and the `message_end` hand-off (the
 * streaming row commits under the identity it already had) leave the groups
 * folded.
 */
/**
 * Whether a MessageArea commit must dissolve folded process groups first.
 *
 * Groups re-parent nodes React modeled as direct children, so a commit that
 * inserts, reorders or removes message-list rows needs them handed back
 * before the mutation phase. `MessageList` keys its rows with
 * `messageRenderKeys` (`content-parts`) — streaming partial included — so that
 * key sequence is exactly the structure React reconciles at list level, and
 * the gate compares it with the same function — the gate and the renderer can
 * never drift. Array identity alone over-released: high-frequency
 * `tool_execution_update` frames (subagent tool start/end fire immediately,
 * the trace is throttled to ~150ms) upsert the *same* toolResult row — fresh
 * array, fresh row object, unchanged `toolResult:<toolCallId>` identity —
 * which inlines into the assistant's tool card and patches it in place, inside
 * a node the group already owns. Releasing those frames dissolved every live
 * group and the next decorate pass rebuilt it from scratch, moving each
 * grouped node twice per frame and restarting CSS animations like the
 * pending-tool spinner's `animate-spin`.
 *
 * The gate sees the rendered sequence (`MessageArea` appends the streaming
 * partial while it renders at the tail). `message_end` commits the partial
 * into `messages` under the same render identity the streaming row used, so
 * the sequence — and therefore the fold — survives the hand-off untouched.
 * Terminal events that drop the partial without committing it (abort, error)
 * shorten the sequence and release through the same structural comparison.
 */
export type ProcessGroupReleaseGate = {
  /**
   * The rendered row sequence `MessageList` reconciles by — the committed
   * messages plus, while a partial streams at the tail, the streaming
   * assistant partial itself (see `MessageArea`). Structural commits swap it.
   */
  messages?: readonly AgentMessage[]
}

/**
 * Cached `messageRenderKeys` results, keyed by messages-array identity.
 *
 * `getSnapshotBeforeUpdate` runs on every `MessageArea` re-render and needs
 * the structural key sequence of both gate arrays; the previous array is
 * always one this cache already keyed on the commit before. `messageRenderKeys`
 * allocates a Map per call, so the cache keeps the unchanged case at
 * reference-compare cost. It cannot go stale: writers never mutate a published
 * message in place and `readAgentSnapshot` reuses an array identity only when
 * no element changed, so an unchanged identity always has unchanged keys.
 * Weak keys let replaced snapshots be collected.
 */
/**
 * Row keys the gate compares: renderable rows only.
 *
 * `MessageList` renders standalone rows for user / user-with-attachments /
 * assistant messages; `toolResult` bodies inline into the paired assistant's
 * tool card and `artifact` rows render nothing — neither swaps list-level DOM.
 * A gate over the full `messageRenderKeys` sequence treated every toolResult
 * upsert (`tool_execution_update` re-inserting the same result, a fresh
 * result landing mid-turn) as a structural change and released the folded
 * groups for a commit that never touched the row list — the full rebuild
 * then re-parented every grouped node, restarting their CSS animations and
 * replaying the "re-expanding" feel while a thinking block was left expanded.
 */
const renderableRowKeysBySource = new WeakMap<readonly AgentMessage[], string[]>()

function cachedRenderableRowKeys(messages: readonly AgentMessage[]): string[] {
  let keys = renderableRowKeysBySource.get(messages)
  if (keys === undefined) {
    // Filter by `isRenderableMessage` before keying: the key sequence must
    // mirror the rows React actually reconciles, never the raw array.
    keys = messageRenderKeys(messages.filter(isRenderableMessage))
    renderableRowKeysBySource.set(messages, keys)
  }
  return keys
}

/**
 * Structural half of the gate: compare the two messages arrays by the row
 * render identities `MessageList` reconciles by, not by array identity.
 *
 * A pure tail append (the previous sequence is a strict prefix of the next)
 * is safe to skip: React only appends the new row at the list tail
 * (`appendChild`), every existing row bails out at its memo with zero DOM
 * writes (a re-render from a fresh `toolResultsById` identity produces an
 * identical tree), and the folded groups hold nodes *inside* rows — nothing
 * the commit touches. This is the frame where the next streaming assistant
 * row appears (every tool-loop round); releasing there dissolved the whole
 * group and the re-fold rebuilt it from scratch, restarting in-flight CSS
 * animations and shifting layout mid-read of an expanded stage.
 */
function shouldReleaseForMessageStructure(
  prevMessages: readonly AgentMessage[] | undefined,
  nextMessages: readonly AgentMessage[] | undefined,
): boolean {
  // Missing identity (defensive callers / untyped updates) errs on releasing.
  if (prevMessages === undefined || nextMessages === undefined) return true
  if (prevMessages === nextMessages) return false
  const prevKeys = cachedRenderableRowKeys(prevMessages)
  const nextKeys = cachedRenderableRowKeys(nextMessages)
  if (prevKeys.length === nextKeys.length) {
    return prevKeys.some((key, index) => key !== nextKeys[index])
  }
  if (nextKeys.length > prevKeys.length) {
    // Tail append only when every previous row identity is unchanged.
    return !prevKeys.every((key, index) => key === nextKeys[index])
  }
  // Removal (or any other shape change) still releases.
  return true
}

export function shouldReleaseProcessGroups(
  prev: ProcessGroupReleaseGate | undefined,
  next: ProcessGroupReleaseGate | undefined,
): boolean {
  // Missing gate (defensive callers / untyped updates) errs on releasing.
  if (prev === undefined || next === undefined) return true
  // Structural row-sequence change only: rows appended/removed/reordered/
  // re-identified. The sequence includes the streaming partial while it
  // renders at the tail, so `message_end` — which commits the partial into
  // `messages` under the same render identity the streaming row used — keeps
  // the sequence unchanged and the folded groups untouched (zero node moves,
  // no restarted animations). Terminal flips that *do* drop the partial
  // without committing it (abort/error) shorten the sequence and release.
  return shouldReleaseForMessageStructure(prev.messages, next.messages)
}

type ProcessGroupReleaseBoundaryProps = ProcessGroupReleaseGate & {
  children?: ReactNode
  /** Root of the decorated subtree (the chat scroll container). */
  getReleaseRoot: () => HTMLElement | null
  /**
   * Called when a release actually dissolved groups, so the host re-decorates.
   *
   * The host must re-fold **synchronously**: this fires from
   * `componentDidUpdate`, i.e. in the same task as the commit that handed the
   * nodes back, so the browser only ever paints the folded state. Deferring the
   * re-fold (animation frame / timer) leaves exactly one painted frame with the
   * released nodes back in their natural position — the flicker seen when the
   * thinking phase ends and the turn commits. `SubagentTrace` keeps the same
   * same-commit contract.
   */
  onReleased?: () => void
}

export class ProcessGroupReleaseBoundary extends Component<ProcessGroupReleaseBoundaryProps> {
  /**
   * Release half of the ownership contract: dissolve the folded groups before
   * React mutates the subtree (the same pairing `SubagentTrace` implements),
   * and report through the snapshot whether anything was handed back, so the
   * re-fold runs on the matching `componentDidUpdate` and nowhere else.
   */
  getSnapshotBeforeUpdate(prevProps?: Readonly<ProcessGroupReleaseBoundaryProps>) {
    // Skip structure-preserving commits (row render identities, streaming
    // flag and streaming row presence all unchanged): React only patches
    // inside nodes the groups already own, so releasing would only oscillate
    // every folded group between frames.
    if (!shouldReleaseProcessGroups(prevProps, this.props)) return false
    return this.release()
  }

  /**
   * Re-fold half of the contract, in the same task as the commit. React runs
   * this right after the mutation phase, so the synchronous re-decoration
   * requested here lands before the browser paints and no unfolded frame is
   * ever visible. Child layout effects (`MessageList` / `AssistantMessage`
   * mirror their DOM-facing props there) already ran — React runs them
   * child-first, ahead of this lifecycle — so the folding pass reads this
   * commit's values.
   */
  componentDidUpdate(_prevProps?: Readonly<ProcessGroupReleaseBoundaryProps>, _prevState?: unknown, released = false) {
    if (released) this.props.onReleased?.()
  }

  componentWillUnmount() {
    // Hand the nodes back so React can detach them; an unmounting boundary has
    // nothing left to re-fold.
    this.release()
  }

  /** Dissolves the folded groups; `true` when at least one group was handed back. */
  private release() {
    const root = this.props.getReleaseRoot()
    if (!root) return false
    // Re-decoration is only needed when groups were actually handed back: a
    // re-render before any decoration folded (fresh mount, or a follow-up
    // commit after a release that dissolved everything) finds no groups, so
    // the host decorate pass would be a no-op anyway.
    return releaseProcessGroups(root).groups > 0
  }

  render() {
    return this.props.children
  }
}

type MessageAreaProps = {
  /** Stable refs/callbacks from the surface (identity never changes per mount). */
  contentRef: RefObject<HTMLDivElement | null>
  getReleaseRoot: () => HTMLElement | null
  /** Same-frame re-fold request for the ownership hand-back (see the boundary). */
  onProcessGroupsReleased?: () => void
  /** Message-snapshot inputs; anything else must not re-render this subtree. */
  messages: AgentMessage[]
  messageIndexOffset: number
  atTail: boolean
  tools: AgentTool[]
  pendingToolCalls: ReadonlySet<string>
  isStreaming: boolean
  streamingAssistant?: AssistantMessageType
  onCostClick?: () => void
}

/**
 * Memoized messages area (R9 flicker fix).
 *
 * `ProcessGroupReleaseBoundary` dissolves every folded process group before
 * the commit mutates the DOM and the host re-folds synchronously from the
 * matching `componentDidUpdate` — both halves land in the same task, so the
 * released (unfolded) state is never painted. Releasing is only correct (and
 * only needed) for commits that re-render the message DOM; composer typing
 * re-renders `ChatSurface` through editor state without touching the message
 * snapshot, which previously re-rendered the boundary on every keystroke.
 *
 * Props are therefore exactly the message-snapshot inputs plus stable refs
 * and callbacks: when none of them change, React bails out at this memo and
 * typing cannot trigger a release. Every structural change to the message
 * DOM still flows through a snapshot-driven re-render of this component,
 * which re-renders the release boundary with it.
 */
const MessageArea = memo(function MessageArea({
  contentRef,
  getReleaseRoot,
  onProcessGroupsReleased,
  messages,
  messageIndexOffset,
  atTail,
  tools,
  pendingToolCalls,
  isStreaming,
  streamingAssistant,
  onCostClick,
}: MessageAreaProps) {
  // The streaming partial renders as the message list's last row (same render
  // identity the committed row will use — see MessageList), so this is the
  // exact row sequence React reconciles: the release gate compares it against
  // the renderer's own keys and the `message_end` hand-off keeps it identical.
  const rendersStreamingRow = isStreaming && atTail && Boolean(streamingAssistant)
  const renderedSequence = rendersStreamingRow && streamingAssistant
    ? [...messages, streamingAssistant]
    : messages
  return (
    <ProcessGroupReleaseBoundary
      messages={renderedSequence}
      getReleaseRoot={getReleaseRoot}
      onReleased={onProcessGroupsReleased}
    >
      <div className="mx-auto max-w-3xl p-4 pb-4" ref={contentRef}>
        <div className="flex flex-col gap-3">
          <MessageList
            messages={messages}
            messageIndexOffset={messageIndexOffset}
            tools={tools}
            pendingToolCalls={pendingToolCalls}
            streamingAssistant={rendersStreamingRow ? streamingAssistant : undefined}
            onCostClick={onCostClick}
          />
          {/* Streaming cursor container. The streaming assistant message itself
              renders as the message list's last row above (it commits in place
              at `message_end`); this container keeps the cursor anchor alive
              and hides itself through `.qf-streaming-message:has(>
              span.animate-pulse:only-child)` — with no assistant inside it is
              the only child, exactly the state that rule hides. */}
          {isStreaming && atTail ? (
            <div className="qf-streaming-message mb-3 flex flex-col gap-3">
              <span className="mx-4 inline-block h-4 w-2 animate-pulse bg-muted-foreground" />
            </div>
          ) : null}
        </div>
      </div>
    </ProcessGroupReleaseBoundary>
  )
})

export type WindowedChatSurfaceHandle = ChatSurfaceHandle & {
  getWindowMessages: () => AgentMessage[]
  getWindowStart: () => number
  loadMoreMessages: () => Promise<void>
  showMessageIndex: (index: number) => Promise<void>
}

type WindowedChatSurfaceProps = ChatSurfaceProps & {
  onWindowChanged?: () => void
  /**
   * The commit handed folded process nodes back; re-run panel decoration.
   *
   * Must re-fold synchronously (see `ProcessGroupReleaseBoundaryProps`): it is
   * called from `componentDidUpdate`, in the same task as the commit, so the
   * unfolded state the release exposed never reaches a paint.
   */
  onProcessGroupsReleased?: () => void
}

type WindowSnapshot = {
  messages: AgentMessage[]
  start: number
  atTail: boolean
}

function readWindow(controller: MessageWindowController, messages: AgentMessage[]): WindowSnapshot {
  const visible = controller.getWindowMessages()
  // Extra out-of-window toolResults are lookup-only, not a tail signal.
  const lastTurn = messages.findLastIndex((message) => message.role === 'user' || message.role === 'user-with-attachments')
  return { messages: visible, start: controller.getWindowStart(), atTail: lastTurn < 0 || visible.includes(messages[lastTurn]) }
}

export const ChatSurface = forwardRef<WindowedChatSurfaceHandle, WindowedChatSurfaceProps>(function ChatSurface(
  {
    agent,
    enableAttachments = true,
    enableModelSelector = true,
    enableThinkingSelector = true,
    readOnly = false,
    chatPanelRevision,
    commandActionsEnabled = true,
    onApiKeyRequired,
    onBeforeSend,
    onCostClick,
    onModelSelect,
    onWindowChanged,
    onProcessGroupsReleased,
  },
  ref,
) {
  const [snapshot, setSnapshot] = useState<AgentSurfaceSnapshot | null>(() => (agent ? readAgentSnapshot(agent) : null))
  // Latest snapshot handed to React (R1 F1a). `syncSnapshot` reads it to reuse
  // unchanged identities without depending on the `snapshot` state, which
  // would re-create the callback and re-run the subscription effect on every
  // agent event.
  const snapshotRef = useRef(snapshot)
  // Render the complete conversation up front so turn navigation can scroll
  // directly to existing DOM nodes without replacing the message window.
  const [windowController] = useState(() => createMessageWindow({ enabled: false }))
  const [messageWindow, setMessageWindow] = useState(() => {
    const messages = snapshot?.messages ?? []
    windowController.setFullMessages(messages)
    return readWindow(windowController, messages)
  })
  const committedWindowRef = useRef(messageWindow)
  // Last window published to React — scheduled or already committed (R1 F1c).
  // Comparing against this (not just `committedWindowRef`) keeps two publishes
  // inside one React batch from double-committing the same window.
  const publishedWindowRef = useRef(messageWindow)
  const fullMessagesRef = useRef(snapshot?.messages ?? [])
  const windowCommitCallbacksRef = useRef<Array<() => void>>([])
  const pageInFlightRef = useRef(false)
  const [editorValue, setEditorValue] = useState('')
  const [editorAttachments, setEditorAttachments] = useState<Attachment[]>([])

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const composerDockRef = useRef<HTMLDivElement | null>(null)
  const editorBridgeRef = useRef<SurfaceEditorBridgeElement | null>(null)
  const editorValueRef = useRef('')
  const editorAttachmentsRef = useRef<Attachment[]>([])
  const autoScrollRef = useRef(true)

  /** Apply composer text through state + the DOM-facing editor bridge. */
  const applyEditorText = useCallback((text: string) => {
    const next = String(text ?? '')
    editorValueRef.current = next
    setEditorValue(next)
    const bridge = editorBridgeRef.current
    const textarea = bridge?.querySelector('textarea')
    if (textarea && textarea.value !== next) textarea.value = next
  }, [])

  /** Apply composer attachments through state + the DOM-facing editor bridge. */
  const applyEditorAttachments = useCallback((files: unknown[]) => {
    const next = Array.isArray(files) ? (files as Attachment[]) : []
    editorAttachmentsRef.current = next
    setEditorAttachments(next)
  }, [])

  const publishWindow = useCallback(() => {
    const next = readWindow(windowController, fullMessagesRef.current)
    const last = publishedWindowRef.current
    // R1 (F1c): skip the state update when the window did not observably
    // change. Streaming events used to re-commit an identical window on every
    // frame, re-running the commit layout effect below (window callbacks,
    // auto-scroll and onWindowChanged → host decorate pass) for nothing. The
    // rendered window stays valid because `readWindow` derives from the same
    // controller state and message identities.
    if (last.messages === next.messages && last.start === next.start && last.atTail === next.atTail) {
      // No commit will run the effect that resolves queued window callbacks
      // (`loadMoreMessages` / `showMessageIndex` promises), and the DOM
      // already reflects `next` — flush them here instead of leaving them
      // queued until the next real commit.
      windowCommitCallbacksRef.current.splice(0).forEach((callback) => callback())
      return
    }
    publishedWindowRef.current = next
    setMessageWindow(next)
  }, [windowController])

  const resumeTail = useCallback(() => {
    autoScrollRef.current = true
    windowController.resetToTail()
    if (committedWindowRef.current.atTail) return
    windowController.setFullMessages(fullMessagesRef.current)
    publishWindow()
  }, [publishWindow, windowController])

  useLayoutEffect(() => {
    committedWindowRef.current = messageWindow
    const callbacks = windowCommitCallbacksRef.current.splice(0)
    callbacks.forEach((callback) => callback())
    if (autoScrollRef.current && messageWindow.atTail && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
    onWindowChanged?.()
  }, [messageWindow, onWindowChanged])

  useEffect(() => () => {
    windowCommitCallbacksRef.current.splice(0).forEach((callback) => callback())
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      setInput: (text: string, attachments?: Attachment[]) => {
        applyEditorText(text)
        if (attachments !== undefined) applyEditorAttachments(attachments)
      },
      setAutoScroll: (enabled: boolean) => {
        if (enabled) resumeTail()
        else autoScrollRef.current = false
      },
      getWindowMessages: () => committedWindowRef.current.messages,
      getWindowStart: () => committedWindowRef.current.start,
      loadMoreMessages: () => {
        const container = scrollContainerRef.current
        if (!container || pageInFlightRef.current || !windowController.hasMore()) return Promise.resolve()
        autoScrollRef.current = false
        const items = Array.from(container.querySelectorAll<HTMLElement>('.qf-message-list > [data-message-index]'))
        const anchor = items.find((item) => item.getBoundingClientRect().bottom > container.getBoundingClientRect().top)
        const anchorIndex = anchor?.dataset.messageIndex
        const anchorTop = anchor?.getBoundingClientRect().top ?? 0
        const previousScrollTop = container.scrollTop
        if (!windowController.loadMore()) return Promise.resolve()
        pageInFlightRef.current = true
        return new Promise<void>((resolve) => {
          windowCommitCallbacksRef.current.push(() => {
            pageInFlightRef.current = false
            const retained = anchorIndex === undefined ? null : container.querySelector<HTMLElement>(`[data-message-index="${anchorIndex}"]`)
            // Fixed-size pages may not overlap. Land at the older page's bottom,
            // never reuse an unrelated element's rendered ordinal as the anchor.
            container.scrollTop = retained
              ? previousScrollTop + retained.getBoundingClientRect().top - anchorTop
              : Math.max(0, container.scrollHeight - container.clientHeight)
            resolve()
          })
          publishWindow()
        })
      },
      showMessageIndex: (index: number) => {
        autoScrollRef.current = false
        if (!windowController.showMessageIndex(index)) return Promise.resolve()
        return new Promise<void>((resolve) => {
          windowCommitCallbacksRef.current.push(resolve)
          publishWindow()
        })
      },
    }),
    [applyEditorText, applyEditorAttachments, publishWindow, resumeTail, windowController],
  )

  /**
   * Re-read the mutable `AgentState` into a snapshot (reusing the previous
   * snapshot's identities when nothing observably changed, see
   * `readAgentSnapshot`) and re-publish the message window. Called for
   * subscribed agent events and for host-driven `chatPanelRevision`
   * bumps — model switches rewrite `state.model` in place without emitting
   * an event, so the surface needs the explicit nudge to re-render.
   */
  const syncSnapshot = useCallback(() => {
    if (!agent) return
    const next = readAgentSnapshot(agent, snapshotRef.current ?? undefined)
    snapshotRef.current = next
    fullMessagesRef.current = next.messages
    windowController.setFullMessages(next.messages)
    setSnapshot(next)
    publishWindow()
  }, [agent, publishWindow, windowController])

  // Subscribe to agent lifecycle events and refresh the snapshot copy.
  useEffect(() => {
    if (!agent) {
      snapshotRef.current = null
      setSnapshot(null)
      return
    }
    windowController.resetToTail()
    syncSnapshot()
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (isSnapshotRefreshEvent(event.type)) syncSnapshot()
    })
    return unsubscribe
  }, [agent, syncSnapshot, windowController])

  // Host-driven refresh: `chatPanelRevision` bumps when host-level state that
  // is not an agent event changes (model switch via `updateCurrentAgentModel`
  // assigns `state.model` directly). The legacy Lit panel re-rendered through
  // `requestUpdate`; this effect is the React equivalent for those paths, so
  // the composer model button text and other snapshot-derived UI stay current.
  useEffect(() => {
    if (!agent || chatPanelRevision === undefined) return
    syncSnapshot()
  }, [chatPanelRevision, agent, syncSnapshot])

  const sendMessage = useCallback(
    async (input: string, attachments?: Attachment[]) => {
      if (!agent) throw new Error('No agent set on ChatSurface')
      await runSendMessage(input, attachments, {
        getApiKey: (provider) => getAppStorage().providerKeys.get(provider),
        onApiKeyRequired,
        onBeforeSend,
        isStreaming: () => agent.state.isStreaming,
        getProvider: () => agent.state.model?.provider,
        clearEditor: () => {
          editorValueRef.current = ''
          editorAttachmentsRef.current = []
          setEditorValue('')
          setEditorAttachments([])
        },
        restoreEditor: (input, attachments) => {
          applyEditorText(input)
          applyEditorAttachments(attachments ?? [])
        },
        enableAutoScroll: resumeTail,
        // `Agent.prompt` is overloaded: `(input: string, images?: ImageContent[])`
        // and `(message: AgentMessage | AgentMessage[])`. A `string |
        // UserMessageWithAttachments` union matches neither signature, so the
        // runtime type has to pick the overload. Both branches are identical on
        // purpose: `message` is forwarded verbatim, never converted — a plain
        // string goes down the text path, an attachment message keeps its
        // `user-with-attachments` role and attachments.
        prompt: (message) => (typeof message === 'string' ? agent.prompt(message) : agent.prompt(message)),
        onError: (message) => {
          console.error(message)
          window.alert(message)
        },
      })
    },
    [agent, onApiKeyRequired, onBeforeSend, applyEditorText, applyEditorAttachments, resumeTail],
  )

  const sendMessageRef = useRef(sendMessage)
  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  // Keep the mirrored editor state refs in sync with React state commits so
  // the DOM-facing bridge getters (below) read fresh values between renders.
  useEffect(() => {
    editorValueRef.current = editorValue
  }, [editorValue])
  useEffect(() => {
    editorAttachmentsRef.current = editorAttachments
  }, [editorAttachments])

  // Install the legacy-compatible property surface on the `.qf-message-editor`
  // root node (see SurfaceEditorBridgeElement). The panel-decoration layer
  // queries that node and reads/writes these properties exactly like it did
  // with the legacy `<message-editor>` element; value/attachments setters
  // flow back into React state so the composer stays controlled.
  useEffect(() => {
    const editorNode = composerDockRef.current?.querySelector<HTMLElement>('.qf-message-editor')
    if (!editorNode) return
    const bridge = editorNode as SurfaceEditorBridgeElement
    const agentState = agent?.state
    editorBridgeRef.current = bridge
    const define = <K extends string>(key: K, descriptor: Pick<PropertyDescriptor, 'get' | 'set'>) => {
      Object.defineProperty(bridge, key, { configurable: true, enumerable: true, ...descriptor })
    }
    define('value', {
      get: () => editorValueRef.current,
      set: (text: unknown) => applyEditorText(typeof text === 'string' ? text : ''),
    })
    define('attachments', {
      get: () => editorAttachmentsRef.current,
      set: (files: unknown) => applyEditorAttachments(Array.isArray(files) ? files : []),
    })
    define('currentModel', {
      get: () => agentState?.model as SurfaceEditorBridgeElement['currentModel'],
      set: () => { /* model selection goes through onModelSelect */ },
    })
    define('thinkingLevel', {
      get: () => agentState?.thinkingLevel as string | undefined,
      set: (level: unknown) => {
        if (agentState && typeof level === 'string') agentState.thinkingLevel = level as ThinkingLevel
      },
    })
    bridge.contextReferences = []
    bridge.selectedCapabilities = []
    bridge.onInput = undefined
    bridge.onFilesChange = undefined
    bridge.onThinkingChange = undefined
    bridge.requestUpdate = () => { /* React state is the source of truth */ }
    // Base send handler: editor-bindings wraps this with plan-mode gating.
    // Reset the wrap bookkeeping so a re-bound decoration always starts from
    // the fresh base (mirrors a fresh editor instance per agent).
    bridge.__quickforgePlanBaseOnSend = undefined
    bridge.__quickforgePlanWrappedOnSend = undefined
    bridge.onSend = (input: string, attachments: unknown[]) => {
      void sendMessageRef.current(input, attachments as Attachment[] | undefined)
    }
    return () => {
      if (editorBridgeRef.current === bridge) editorBridgeRef.current = null
    }
  }, [agent, applyEditorText, applyEditorAttachments])

  // Snapshot-stable callbacks for the memoized message area: fresh identities
  // would defeat the memo comparison and re-introduce keystroke releases.
  const getReleaseRoot = useCallback(() => scrollContainerRef.current, [])

  if (!agent || !snapshot) {
    return <div className="qf-chat-panel p-4 text-center text-muted-foreground">{t('noSessionSet')}</div>
  }

  const streamingAssistant = snapshot.streamingMessage?.role === 'assistant' ? snapshot.streamingMessage : undefined

  return (
    <CommandActionsEnabledContext.Provider value={commandActionsEnabled}>
      <div className="qf-chat-panel flex h-full min-h-0 flex-col bg-background text-foreground">
        {/* Messages area */}
        <div className="qf-scroll-container flex-1 overflow-y-auto" ref={scrollContainerRef}>
          <MessageArea
            contentRef={contentRef}
            getReleaseRoot={getReleaseRoot}
            onProcessGroupsReleased={onProcessGroupsReleased}
            messages={messageWindow.messages}
            messageIndexOffset={messageWindow.start}
            atTail={messageWindow.atTail}
            tools={snapshot.tools}
            pendingToolCalls={snapshot.pendingToolCalls}
            isStreaming={snapshot.isStreaming}
            streamingAssistant={streamingAssistant}
            onCostClick={onCostClick}
          />
        </div>

        {/* Input area */}
        {readOnly ? null : (
          <div className="shrink-0" ref={composerDockRef}>
            <div className="mx-auto max-w-3xl px-2">
              <MessageEditor
                value={editorValue}
                attachments={editorAttachments}
                isStreaming={snapshot.isStreaming}
                currentModel={snapshot.model}
                thinkingLevel={snapshot.thinkingLevel}
                showAttachmentButton={enableAttachments}
                showModelSelector={enableModelSelector}
                showThinkingSelector={enableThinkingSelector}
                onInput={(value) => {
                  applyEditorText(value)
                  editorBridgeRef.current?.onInput?.(value)
                }}
                onSend={(input, attachments) => {
                  const bridge = editorBridgeRef.current
                  if (typeof bridge?.onSend === 'function') {
                    bridge.onSend(input, attachments)
                    return
                  }
                  void sendMessage(input, attachments)
                }}
                onAbort={() => agent.abort()}
                /* No built-in model selector dialog yet: the host decides via onModelSelect. */
                onModelSelect={onModelSelect}
                onThinkingChange={
                  enableThinkingSelector
                    ? (level) => {
                        agent.state.thinkingLevel = level
                      }
                    : undefined
                }
                onFilesChange={(files) => {
                  applyEditorAttachments(files)
                  editorBridgeRef.current?.onFilesChange?.(files)
                }}
              />
              <UsageBar messages={snapshot.messages} onCostClick={onCostClick} />
            </div>
          </div>
        )}
      </div>
    </CommandActionsEnabledContext.Provider>
  )
})
