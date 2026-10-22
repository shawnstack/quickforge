/* eslint-disable react-refresh/only-export-components -- exports the ChatSurface component plus the pure send flow, agent snapshot and release-gate helpers covered by tests. */
import { Component, forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createMessageWindow, type MessageWindowController } from '../windowed-messages'
import { isInsideHiddenView } from '@/lib/session-view-activity'
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
  Usage,
  UserMessageWithAttachments,
  AssistantMessage as AssistantMessageType,
} from './ChatTypes'
import type { SurfaceEditorBridgeElement } from './ChatTypes'
import type { SseConnectionStatus } from '@/lib/server-agent'
import type { SessionLeaseFailure, SessionLeaseSnapshot } from '@/lib/session-lease-client'
import type { GoalAction, GoalState } from '@/lib/goal'
import type { CapabilitySuggestion } from '../capability-suggestions'
import type { AgentAccessMode } from '@/lib/types'
import { t } from '@/lib/i18n'
import { MessageList } from './MessageList'
import { MessageEditor } from './MessageEditor'
import { TodoWriteSummary } from './TodoWriteSummary'
import { GoalControlStrip } from './GoalControlStrip'
import { ComposerPlusPopover, ComposerPlusTrigger, useComposerPlusMenu } from './ComposerPlusMenu'
import { AgentAccessMenu, AgentAccessTrigger, PlanModeTrigger, positionAgentAccessMenu } from './ComposerAccessControls'
import { registerAgentAccessMenuCloser } from '../panel-decoration/agent-access-menu'
import { ThinkingLevelControl } from './ThinkingLevelControl'
import { ModelRetryNotice, ReconnectNotice, SessionLeaseStrip, UnreachableStrip, useSseConnectionStatus, type ModelRetryInfo } from './ConnectionNotices'
import { resolveCompactionBoundary, type ContextCompactionState } from './ContextCompactionNotice'
import { resolveAssistantWaitingRow } from './AssistantWaitingBubble'
import { isRenderableMessage, messageRenderKeys } from './content-parts'
import { CommandActionsEnabledContext, LocalFilePathHandlerContext } from './surface-context'
import { aggregateUsage, UsageBar } from './UsageBar'
import { createComposerStore } from './composer-store'
import {
  readLatestTodoWriteSnapshot,
  type TodoWriteMessage,
  type TodoWriteSnapshot,
} from '../panel-decoration/todo-write-summary'

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
  /**
   * The server skipped an authoritative persist after CAS conflicts. Rendered as
   * a warning at the top of the message list (behaviour previously produced by
   * the `persist-degraded-notice` decoration).
   */
  persistDegraded: boolean
  /**
   * Session write lease (see `src/lib/session-lease-client.ts`). `undefined`
   * when this view never enabled the lease (read-only / shared / Side Chat).
   * Drives the "another window is writing" strip and the composer read-only
   * gate.
   */
  sessionLease?: SessionLeaseSnapshot
  /**
   * Server-side context compaction (`state.contextCompaction`). Drives the
   * timeline divider React renders inside the message list; previously the
   * `context-compaction` decoration read it straight off the agent on every
   * pass.
   */
  contextCompaction?: ContextCompactionState | null
  /**
   * Authoritative goal (`state.goal`). Drives the goal control strip; the
   * decoration layer used to read it off the agent on every pass and the host
   * re-ran that pass on `goal_updated`.
   */
  goal?: GoalState | null
  /**
   * Usage totals across every assistant message. Derived here, once per
   * snapshot commit, instead of inside `UsageBar` on every render: the composer
   * area re-rendered on each keystroke before the store split, and a full
   * `filter`/`reduce` over the message list was the O(messages) part of it.
   * Cached by `messages` identity (see `usageTotalsBySource`), so an unchanged
   * conversation costs one WeakMap lookup.
   */
  usage: Usage
  /**
   * Newest valid `todo_write` result, or null. Same reasoning as `usage`: the
   * capsule above the composer used to scan the message list backwards on every
   * composer render. Cached by `messages` identity.
   */
  todoSnapshot: { snapshot: TodoWriteSnapshot; key: string } | null
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
  // `persist_degraded` is a boolean flag. `persistDegraded` is an optional field
  // on the server agent's state (it is `undefined` once a persist succeeds), so
  // narrow rather than widen: the shared `AgentState` type stays untouched.
  const persistDegraded = (state as { persistDegraded?: boolean }).persistDegraded === true
  // Session write lease: compared by the small tuple of fields that can change
  // (`ServerAgent.applySessionLease` already dedupes no-op updates), so an
  // unchanged lease keeps the previous snapshot identity.
  const sessionLease = (state as { sessionLease?: SessionLeaseSnapshot }).sessionLease
  // Context compaction is replaced wholesale by the server agent on
  // `auto_compact_completed` / `messages_replaced`, so reference identity is
  // enough to detect a change.
  const contextCompaction = (state as { contextCompaction?: ContextCompactionState | null }).contextCompaction ?? null
  // The goal is replaced wholesale by the server agent on `goal_updated`, so a
  // reference comparison is enough (same reasoning as contextCompaction).
  const goal = (state as { goal?: GoalState | null }).goal ?? null
  // Derived projections of `messages` (see `usageTotals` / `latestTodoSnapshot`):
  // computed here, once per snapshot, and cached by array identity.
  const usage = usageTotals(messages)
  const todoSnapshot = latestTodoSnapshot(messages)
  if (
    previous &&
    previous.messages === messages &&
    previous.tools === tools &&
    previous.pendingToolCalls === pendingToolCalls &&
    previous.isStreaming === state.isStreaming &&
    previous.model === state.model &&
    previous.thinkingLevel === state.thinkingLevel &&
    previous.persistDegraded === persistDegraded &&
    previous.sessionLease === sessionLease &&
    previous.contextCompaction === contextCompaction &&
    previous.goal === goal &&
    previous.usage === usage &&
    previous.todoSnapshot === todoSnapshot &&
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
    persistDegraded,
    sessionLease,
    contextCompaction,
    goal,
    usage,
    todoSnapshot,
  }
}

/**
 * Cached `aggregateUsage` results, keyed by messages-array identity.
 *
 * `readAgentSnapshot` already reuses a `messages` identity when no element
 * changed, so an unchanged conversation always hits this cache and the totals
 * keep the same object identity — which is what lets `UsageBar`'s memo (and the
 * snapshot's own no-change bail-out) short-circuit. Weak keys let replaced
 * snapshots be collected.
 */
const usageTotalsBySource = new WeakMap<readonly AgentMessage[], Usage>()

function usageTotals(messages: AgentMessage[]): Usage {
  let totals = usageTotalsBySource.get(messages)
  if (totals === undefined) {
    totals = aggregateUsage(messages)
    usageTotalsBySource.set(messages, totals)
  }
  return totals
}

/**
 * Cached newest-`todo_write` lookup, keyed by messages-array identity.
 *
 * Same contract as `usageTotals`: the capsule above the composer used to scan
 * the message list backwards on every composer render (once per keystroke once
 * the input state lived in `ChatSurface`). Caching by array identity makes that
 * cost one WeakMap lookup per commit instead of O(messages).
 */
const todoSnapshotBySource = new WeakMap<readonly AgentMessage[], { snapshot: TodoWriteSnapshot; key: string } | null>()

function latestTodoSnapshot(messages: AgentMessage[]): { snapshot: TodoWriteSnapshot; key: string } | null {
  // A cached `null` is indistinguishable from "not cached" via `get`, so the
  // miss is detected with `has` before the (only) backwards scan.
  if (todoSnapshotBySource.has(messages)) return todoSnapshotBySource.get(messages) ?? null
  const found = readLatestTodoWriteSnapshot(messages as unknown as TodoWriteMessage[])
  todoSnapshotBySource.set(messages, found)
  return found
}

/**
 * Streaming with no assistant output yet → the stop button shows a waiting ring.
 *
 * Kept as an explicit host-provided flag rather than derived from the snapshot.
 * The host clears it on `message_start`/`message_update` of an assistant message
 * and on `agent_end`, which is *not* the same predicate as
 * `isStreaming && !streamingMessage`: `streamingMessage` only becomes defined on
 * the first `message_update`, so a derived flag would keep the ring visible for
 * the gap between `message_start` and the first delta. Same pixels, different
 * moment — not worth the risk to a visible behaviour.
 */

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
  'background_commands',
  // `persist_degraded` flips `state.persistDegraded`; without subscribing, the
  // warning rendered inside the message list would never appear or clear.
  'persist_degraded',
  // `auto_compact_completed` replaces `state.contextCompaction`; the timeline
  // divider rendered by the message list reads it, so the snapshot must refresh
  // for the divider to appear/disappear at the right moment.
  'auto_compact_completed',
  'auto_compact_failed',
  // `goal_updated` replaces `state.goal`; the goal strip rendered by the
  // composer reads it, so the snapshot must refresh for the strip to update.
  'goal_updated',
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
  /** Persist-degraded warning flag; rendered as the message list's first child. */
  persistDegraded: boolean
  /** Context-compaction state; drives the timeline divider inside the list. */
  contextCompaction?: ContextCompactionState | null
  /** Host-owned "still waiting for the first assistant output" flag. */
  assistantWaiting?: boolean
  /** SSE connection status; drives the inline reconnect/model-retry rows. */
  connectionStatus?: SseConnectionStatus | null
  /** Active model upstream retry; drives the retry row. */
  modelRetryInfo?: ModelRetryInfo | null
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
  persistDegraded,
  contextCompaction,
  assistantWaiting = false,
  connectionStatus = null,
  modelRetryInfo = null,
}: MessageAreaProps) {
  // The streaming partial renders as the message list's last row (same render
  // identity the committed row will use — see MessageList), so this is the
  // exact row sequence React reconciles: the release gate compares it against
  // the renderer's own keys and the `message_end` hand-off keeps it identical.
  const rendersStreamingRow = isStreaming && atTail && Boolean(streamingAssistant)
  const renderedSequence = rendersStreamingRow && streamingAssistant
    ? [...messages, streamingAssistant]
    : messages
  // Resolved here (not in MessageList) so the memoized list keeps receiving a
  // stable, already-computed position: the boundary depends on the rendered
  // window offset, not on anything the list itself owns.
  const compactionBoundary = useMemo(
    () => resolveCompactionBoundary({
      compaction: contextCompaction,
      messages,
      messageIndexOffset,
      isRenderable: isRenderableMessage,
    }),
    [contextCompaction, messages, messageIndexOffset],
  )
  // Same reasoning as the divider: the waiting bubble's position is an index into
  // the rendered rows, resolved here so the memoized list receives a plain number.
  const assistantWaitingRow = useMemo(
    () => resolveAssistantWaitingRow({
      messages,
      waiting: assistantWaiting,
      // The decoration required `isStreaming && isActive`; keeping it means the
      // bubble and the stop button's waiting ring stay in step.
      streaming: isStreaming,
      isRenderable: isRenderableMessage,
    }),
    [assistantWaiting, isStreaming, messages],
  )
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
            persistDegraded={persistDegraded}
            compactionBoundary={compactionBoundary}
            assistantWaitingRow={assistantWaitingRow}
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
          {/* Connection rows trail the message stream. The decoration appended
              them to `.qf-message-list` after every rebuild; rendering them here
              keeps them after the list without a second writer. */}
          {connectionStatus || modelRetryInfo ? (
            <>
              <ReconnectNotice status={connectionStatus} />
              <ModelRetryNotice info={modelRetryInfo} />
            </>
          ) : null}
        </div>
      </div>
    </ProcessGroupReleaseBoundary>
  )
})

export type WindowedChatSurfaceHandle = ChatSurfaceHandle & {  getWindowMessages: () => AgentMessage[]
  getWindowStart: () => number
  loadMoreMessages: () => Promise<void>
  showMessageIndex: (index: number) => Promise<void>
  /**
   * Capture the current reading anchor so a change that prepends content above
   * the viewport can restore it.
   *
   * Call this IMMEDIATELY BEFORE the mutation, not when loading starts:
   * background history hydration takes a network round trip, and the user may
   * scroll during it. A stale anchor would restore a position the user has
   * already left.
   *
   * Returns a cancel function for the case where the change never lands.
   */
  captureScrollAnchor: () => () => void
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
  /**
   * Render the SSE connection rows (inline reconnect notice + model-retry row).
   * Off for Side Chat, whose NDJSON stream does not share the global SSE
   * connection — the decoration layer skipped them there for the same reason.
   */
  enableConnectionNotices?: boolean
  /** Active model upstream retry, owned by the host (`model_stream_retry`). */
  modelRetryInfo?: ModelRetryInfo | null
  /**
   * QuickForge thinking selector, rendered into the composer's right-hand
   * control row. Replaces `panel-decoration/thinking-level-controls.ts`, which
   * injected the button and appended its menu to `document.body`.
   */
  enableThinkingControl?: boolean
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  /**
   * QuickForge "+" composer menu: the trigger renders in the editor's left
   * control row and the popover before the editor card, matching the decoration
   * layer's two insertion points (`leftControls.prepend` / `insertBefore(editor)`).
   */
  enableComposerPlusMenu?: boolean
  availablePluginRows?: () => CapabilitySuggestion[]
  selectPluginCapability?: (pluginName: string) => void
  /** Close the composer suggestion popovers (they are mutually exclusive). */
  onDismissComposerSuggestions?: () => void
  /**
   * Render the two QuickForge composer controls ("+" and thinking) in their
   * disabled state. Side Chat keeps them visible but inert —
   * `disableComposerControls` disabled them rather than removing them.
   */
  composerControlsDisabled?: boolean
  /**
   * Plan-mode toggle in the composer's left control row. The trigger renders
   * only while plan mode is ON: the decoration created it when planMode was
   * true and removed it when false, so plan mode off must not add a button.
   */
  showPlanModeControl?: boolean
  planMode?: boolean
  onTogglePlanMode?: () => void
  /**
   * Agent-access selector in the composer's left control row. Side Chat keeps it
   * visible but disabled (the decoration called `setupAgentAccessMenu` and then
   * disabled the trigger), so the `disabled` branch must stay reachable.
   */
  showAgentAccessControl?: boolean
  agentAccessMode?: AgentAccessMode
  onAccessModeChange?: (mode: AgentAccessMode) => void
  /**
   * Opens a local file path referenced in a message body. Omitted in read-only
   * and shared views, where links would be dead; that is the same gate the
   * decoration layer applied before it walked the DOM.
   */
  onOpenLocalFilePath?: (path: string) => void
  /**
   * Goal control strip: session id, capability gate and the action sender.
   * Kept on the windowed props (not `ChatSurfaceProps`) because the goal UI is
   * an application concern; `ChatTypes` stays free of `@/lib/goal`.
   */
  sessionId?: string
  enableGoalStrip?: boolean
  onGoalAction?: (action: GoalAction, objective?: string) => Promise<void>
  /**
   * 会话写入租约：本页不是持有者时显示只读提示条并禁用作曲区输入。
   * 由宿主（ChatPanelHost）根据 `agent.canWrite()` / `state.sessionLease` 传入，
   * `ChatSurface` 自身不触网、不读全局状态，仍是纯展示层。
   */
  leaseObserver?: boolean
  leaseDegraded?: boolean
  /** 降级原因（网络/未授权/服务端报错），只影响提示文案。 */
  leaseFailure?: SessionLeaseFailure
  leaseFailureStatus?: number
  onTakeOverLease?: () => Promise<boolean> | boolean
  /** 降级时的手动重试（用户不必干等 20s 心跳）。 */
  onRetryLease?: () => Promise<boolean> | boolean
}

type WindowSnapshot = {
  messages: AgentMessage[]
  start: number
  atTail: boolean
}

/**
 * Viewport reading anchor: the top visible row (by absolute message index when it
 * carries one, else by rendered ordinal) plus its offset from the scroll
 * container's top edge, captured before a change that prepends content above.
 */
import { readScrollAnchor, anchoredScrollTop, type ScrollAnchor } from '../scroll-anchor'

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
    enableCompactionDivider = true,
    readOnly = false,
    chatPanelRevision,
    commandActionsEnabled = true,
    onApiKeyRequired,
    onBeforeSend,
    onCostClick,
    onModelSelect,
    isReplyWaiting = false,
    onBeforeAbort,
    onWindowChanged,
    onProcessGroupsReleased,
    enableConnectionNotices = true,
    modelRetryInfo = null,
    sessionId,
    enableGoalStrip = false,
    onGoalAction,
    onOpenLocalFilePath,
    enableThinkingControl = false,
    onThinkingLevelChange,
    enableComposerPlusMenu = false,
    availablePluginRows,
    selectPluginCapability,
    onDismissComposerSuggestions,
    composerControlsDisabled = false,
    showPlanModeControl = false,
    planMode = false,
    onTogglePlanMode,
    showAgentAccessControl = false,
    agentAccessMode = 'default',
    onAccessModeChange,
    leaseObserver = false,
    leaseDegraded = false,
    leaseFailure,
    leaseFailureStatus,
    onTakeOverLease,
    onRetryLease,
  },
  ref,
) {
  const [snapshot, setSnapshot] = useState<AgentSurfaceSnapshot | null>(() => (agent ? readAgentSnapshot(agent) : null))
  // The SSE connection status is a global fact, so the surface subscribes here
  // rather than receiving it through props on every transition.
  const connectionStatus = useSseConnectionStatus()
  // 租约提示条的本地「接管中」态：接管是一次网络往返，按钮期间要禁用防重复点击。
  const [leaseTakeOverPending, setLeaseTakeOverPending] = useState(false)
  // 「重试」共用同一套 pending 态：降级与接管是互斥的两种提示，不会同屏出现。
  const [leaseRetryPending, setLeaseRetryPending] = useState(false)
  /**
   * 租约提示条只看显式传入的 `leaseObserver` / `leaseDegraded`，不回读
   * `snapshot.sessionLease`：这样 surface 的可见行为完全由宿主决定，
   * 只读视图与分享页不会被这类提示污染。
   */
  const leaseNoticeVisible = leaseObserver || leaseDegraded
  const handleTakeOverLease = useCallback(() => {
    if (!onTakeOverLease || leaseTakeOverPending) return
    setLeaseTakeOverPending(true)
    void Promise.resolve(onTakeOverLease())
      .catch(() => false)
      .finally(() => setLeaseTakeOverPending(false))
  }, [leaseTakeOverPending, onTakeOverLease])
  const handleRetryLease = useCallback(() => {
    if (!onRetryLease || leaseRetryPending) return
    setLeaseRetryPending(true)
    void Promise.resolve(onRetryLease())
      .catch(() => false)
      .finally(() => setLeaseRetryPending(false))
  }, [leaseRetryPending, onRetryLease])
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
  /**
   * Composer hot-path state, deliberately held outside React's render inputs.
   *
   * The text used to be `useState` here, which meant every keystroke re-rendered
   * this entire component — including the `UsageBar` aggregation and the todo
   * capsule scan over every message. Both are now derived once per snapshot
   * (see `AgentSurfaceSnapshot.usage` / `.todoSnapshot`), and only the composer
   * leaves subscribe to the store, so typing costs one `<textarea>` render.
   *
   * Created once via the lazy initializer: a new store per render would reset
   * the text and re-subscribe every consumer.
   */
  const [composerStore] = useState(createComposerStore)

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const composerDockRef = useRef<HTMLDivElement | null>(null)
  const editorBridgeRef = useRef<SurfaceEditorBridgeElement | null>(null)
  const autoScrollRef = useRef(true)
  /**
   * Reading anchor captured before a change that inserts content ABOVE the
   * viewport (background history hydration). Applied by the next layout commit,
   * which is when the prepended rows actually exist in the DOM.
   */
  const pendingAnchorRef = useRef<ScrollAnchor | null>(null)

  /**
   * Write composer text. The store is the single source of truth: React never
   * writes `textarea.value` back (that used to produce a duplicate write per
   * keystroke, one by this callback and one by React's commit).
   *
   * Callers that need the caret preserved across an external write (draft
   * restore, slash-prefix removal) go through the same entry point.
   */
  const applyEditorText = useCallback((text: string) => {
    composerStore.setText(String(text ?? ''))
  }, [composerStore])

  /** Write the composer attachment list through the store. */
  const applyEditorAttachments = useCallback((files: unknown[]) => {
    composerStore.setAttachments(Array.isArray(files) ? (files as Attachment[]) : [])
  }, [composerStore])

  // The "+" menu opens the editor's file input through this indirection: the
  // input stays owned by `MessageEditor`, so no DOM query is needed (the
  // decoration used to click `input[type=file]` it found by selector).
  const [openAttachmentPicker, setOpenAttachmentPicker] = useState<(() => void) | null>(null)
  const pickAttachment = useCallback((open: () => void) => setOpenAttachmentPicker(() => open), [])
  // One controller for both halves of the "+" menu: the trigger lives in the
  // editor's left control row, the popover before the editor card. `null` when
  // the menu is disabled (read-only / Side Chat without the capability).
  const plusMenu = useComposerPlusMenu(onDismissComposerSuggestions)
  const activePlusMenu = enableComposerPlusMenu ? plusMenu : null

  // Agent-access menu: fixed-position layer measured from the trigger, same
  // pattern as the thinking selector. `anchor` is null only on the first frame.
  const accessTriggerRef = useRef<HTMLButtonElement | null>(null)
  const accessMenuRef = useRef<HTMLDivElement | null>(null)
  const [accessMenuOpen, setAccessMenuOpen] = useState(false)
  const [accessMenuAnchor, setAccessMenuAnchor] = useState<{ left: number; top: number; width: number } | null>(null)
  const closeAccessMenu = useCallback(() => setAccessMenuOpen(false), [])

  useEffect(() => {
    // Let a decoration pass (mutually exclusive composer menus) close this
    // menu without touching the node: React owns it, and removing a React child
    // externally makes the later unmount throw.
    registerAgentAccessMenuCloser(() => setAccessMenuOpen(false))
    return () => registerAgentAccessMenuCloser(null)
  }, [])

  useEffect(() => {
    // A gate change (read-only, workspace tools removed, mode switch) unmounts
    // the menu; the open flag must not survive it, otherwise the menu would pop
    // back open by itself when the gate returns.
    if (!showAgentAccessControl) setAccessMenuOpen(false)
  }, [showAgentAccessControl])

  useEffect(() => {
    if (!accessMenuOpen) return undefined
    const reposition = () => {
      const trigger = accessTriggerRef.current
      if (!trigger) return
      const measured = accessMenuRef.current?.offsetHeight ?? 0
      const rect = trigger.getBoundingClientRect()
      setAccessMenuAnchor(positionAgentAccessMenu(
        { left: rect.left, top: rect.top, width: rect.width },
        measured,
        { width: window.innerWidth, height: window.innerHeight },
      ))
    }
    reposition()
    // The fixed layer must follow the trigger on resize/scroll (capture), like
    // the decoration's resize/scroll listeners did.
    window.addEventListener('resize', reposition, true)
    window.addEventListener('scroll', reposition, true)
    // Dismiss on any pointerdown outside the menu and its trigger, or on Escape.
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (accessMenuRef.current?.contains(target ?? null)) return
      if (accessTriggerRef.current?.contains(target ?? null)) return
      setAccessMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setAccessMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('resize', reposition, true)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [accessMenuOpen])

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

  /**
   * Read the current reading anchor via the shared `scroll-anchor` module.
   *
   * Pinned to the bottom returns null: keep following the tail rather than
   * freezing the viewport on an old row.
   *
   * Prefers a row carrying `data-message-index`. When the top-most visible row is
   * a folded process group, anchoring on it degrades to the ordinal fallback,
   * which points at the wrong row once 100+ messages are prepended (browser-
   * verified: the viewport kept `scrollTop` while the visible text was replaced).
   * Anchoring on the first real message row below it keeps the reading position;
   * only when no message row is visible at all do we fall back to any row.
   */
  const captureReadingAnchor = useCallback((): ScrollAnchor | null => {
    const container = scrollContainerRef.current
    if (!container || autoScrollRef.current) return null
    return readScrollAnchor(container, { requireMessageIndex: true }) ?? readScrollAnchor(container)
  }, [])

  /**
   * Re-anchor the viewport after a change that inserted content ABOVE it.
   * Returns true when the anchor was applied.
   */
  const applyReadingAnchor = useCallback((anchor: ScrollAnchor | null) => {
    const container = scrollContainerRef.current
    if (!anchor || !container) return false
    const next = anchoredScrollTop(container, anchor)
    if (next === null) return false
    container.scrollTop = next
    return true
  }, [])

  useLayoutEffect(() => {
    committedWindowRef.current = messageWindow
    const callbacks = windowCommitCallbacksRef.current.splice(0)
    // Apply a reading anchor captured by `hydrateFullHistory` right before it
    // replaced the list: this commit is where the prepended rows become real.
    const anchor = pendingAnchorRef.current
    if (anchor) {
      pendingAnchorRef.current = null
      applyReadingAnchor(anchor)
    }
    callbacks.forEach((callback) => callback())
    // Skip the tail write while this surface is kept (hidden). A hidden subtree
    // has no layout box, so `scrollHeight` reads 0 and writing it would park the
    // container at the top; the panel re-arms `autoScroll` and scrolls on
    // activation instead. The guard only consults the computed display of the
    // kept wrapper, so a visible surface takes the original code path unchanged.
    if (autoScrollRef.current && messageWindow.atTail && scrollContainerRef.current
      && !isInsideHiddenView(scrollContainerRef.current)) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
    onWindowChanged?.()
  }, [applyReadingAnchor, messageWindow, onWindowChanged])

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
        // Anchor on a real message row only: paging rebuilds folded process
        // groups, so a group row is not a stable anchor across the load.
        const anchor = readScrollAnchor(container, { requireMessageIndex: true })
        if (!windowController.loadMore()) return Promise.resolve()
        pageInFlightRef.current = true
        return new Promise<void>((resolve) => {
          windowCommitCallbacksRef.current.push(() => {
            pageInFlightRef.current = false
            const next = anchor ? anchoredScrollTop(container, anchor, { requireMessageIndex: true }) : null
            // Fixed-size pages may not overlap. Land at the older page's bottom
            // when no anchor row survived, rather than reusing an unrelated
            // element's rendered ordinal.
            container.scrollTop = next ?? Math.max(0, container.scrollHeight - container.clientHeight)
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
      captureScrollAnchor: () => {
        const captured = captureReadingAnchor()
        if (!captured) return () => undefined
        pendingAnchorRef.current = captured
        return () => {
          if (pendingAnchorRef.current === captured) pendingAnchorRef.current = null
        }
      },
    }),
    [applyEditorText, applyEditorAttachments, captureReadingAnchor, publishWindow, resumeTail, windowController],
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
          applyEditorText('')
          applyEditorAttachments([])
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

  // Install the legacy-compatible property surface on the `.qf-message-editor`
  // root node (see SurfaceEditorBridgeElement). The panel-decoration layer
  // queries that node and reads/writes these properties exactly like it did
  // with the legacy `<message-editor>` element.
  //
  // The bridge is a pure ADAPTER: `value` / `attachments` read and write the
  // composer store (no separate mirror to keep in sync), so a decoration-layer
  // write and a keystroke land on the same single source of truth. That removes
  // the old ref/state/DOM triple-write, and with it the "same text written 2-3
  // times per keystroke" path.
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
      get: () => composerStore.getText(),
      set: (text: unknown) => applyEditorText(typeof text === 'string' ? text : ''),
    })
    define('attachments', {
      get: () => composerStore.getAttachments(),
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
  }, [agent, applyEditorText, applyEditorAttachments, composerStore])

  // Snapshot-stable callbacks for the memoized message area: fresh identities
  // would defeat the memo comparison and re-introduce keystroke releases.
  const getReleaseRoot = useCallback(() => scrollContainerRef.current, [])

  if (!agent || !snapshot) {
    return <div className="qf-chat-panel p-4 text-center text-muted-foreground">{t('noSessionSet')}</div>
  }

  const streamingAssistant = snapshot.streamingMessage?.role === 'assistant' ? snapshot.streamingMessage : undefined

  return (
    <CommandActionsEnabledContext.Provider value={commandActionsEnabled}>
      <LocalFilePathHandlerContext.Provider value={onOpenLocalFilePath ?? null}>
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
            persistDegraded={snapshot.persistDegraded}
            contextCompaction={enableCompactionDivider ? snapshot.contextCompaction : null}
            assistantWaiting={isReplyWaiting}
            connectionStatus={enableConnectionNotices ? connectionStatus ?? null : null}
            modelRetryInfo={enableConnectionNotices ? modelRetryInfo ?? null : null}
          />
        </div>

        {/* Tier-2 unreachable strip: pinned above the composer, outside the
            scroll container so it stays visible at any scroll position. */}
        {enableConnectionNotices ? <UnreachableStrip status={connectionStatus} /> : null}
        {/* Session write lease: another window holds the write lease, so this
            view is a read-only observer with an explicit takeover action. */}
        {leaseNoticeVisible ? (
          <SessionLeaseStrip
            holder={snapshot.sessionLease?.holder ?? null}
            degraded={leaseDegraded}
            failure={leaseFailure}
            failureStatus={leaseFailureStatus}
            onTakeOver={handleTakeOverLease}
            takingOver={leaseTakeOverPending}
            onRetry={handleRetryLease}
            retrying={leaseRetryPending}
          />
        ) : null}
        {/* Input area */}
        {readOnly ? null : (
          <div className="shrink-0" ref={composerDockRef}>
            <div className="mx-auto max-w-3xl px-2">
              {/* The TodoWrite capsule used to be spliced in before the editor by
                  the decoration layer (it tolerated a suggestion menu, the goal
                  strip and the queue panel sitting between itself and the
                  editor, and re-asserted its position every pass). React renders
                  it in place, so the sibling order is fixed by this JSX. */}
              <TodoWriteSummary snapshot={snapshot.todoSnapshot} />
              {/* The "+" popover is a sibling *before* the editor card, exactly
                  where the decoration inserted it; its trigger lives in the
                  editor's left control row (`leadingControls` below). */}
              {activePlusMenu ? (
                <ComposerPlusPopover
                  controller={activePlusMenu}
                  attachmentsEnabled={enableAttachments}
                  pluginsEnabled={Boolean(availablePluginRows)}
                  availablePluginRows={availablePluginRows ?? (() => [])}
                  selectPluginCapability={selectPluginCapability ?? (() => undefined)}
                  onPickAttachment={() => openAttachmentPicker?.()}
                />
              ) : null}
              {/* The goal strip hugs the editor; React fixes the order, so the
                  decoration's "tolerate the goal strip as a legal follower"
                  rule is no longer needed. */}
              {enableGoalStrip && sessionId && onGoalAction ? (
                <GoalControlStrip
                  sessionId={sessionId}
                  goal={(agent.state as { goal?: GoalState | null }).goal ?? null}
                  enabled={enableGoalStrip}
                  onAction={onGoalAction}
                />
              ) : null}
              <MessageEditor
                store={composerStore}
                isStreaming={snapshot.isStreaming}
                isWaiting={isReplyWaiting}
                currentModel={snapshot.model}
                thinkingLevel={snapshot.thinkingLevel}
                // The native paperclip button is redundant: attachment picking is
                // owned by the QuickForge "+" menu (its "add attachment" row calls
                // `pickAttachment`). The decoration layer hid this button on every
                // pass via `.quickforge-native-attachment-hidden`; React simply
                // does not render it while the "+" menu is present.
                showAttachmentButton={enableAttachments && !activePlusMenu}
                showModelSelector={enableModelSelector}
                showThinkingSelector={enableThinkingSelector}
                // Notification only: the store already holds the new text. The
                // bridge forwards to the host, which owns draft persistence and
                // the three suggestion controllers.
                onInput={(value) => editorBridgeRef.current?.onInput?.(value)}
                onSend={(input, attachments) => {
                  const bridge = editorBridgeRef.current
                  if (typeof bridge?.onSend === 'function') {
                    bridge.onSend(input, attachments)
                    return
                  }
                  void sendMessage(input, attachments)
                }}
                onAbort={() => agent.abort()}
                onBeforeAbort={onBeforeAbort}
                /* No built-in model selector dialog yet: the host decides via onModelSelect. */
                onModelSelect={onModelSelect}
                onThinkingChange={
                  enableThinkingSelector
                    ? (level) => {
                        agent.state.thinkingLevel = level
                      }
                    : undefined
                }
                // Notification only: `MessageEditor` already wrote the merged
                // list to the store. Re-applying it here would be a redundant
                // write and could clobber a concurrent removal.
                onFilesChange={(files) => editorBridgeRef.current?.onFilesChange?.(files)}
                pickAttachment={pickAttachment}
                composerControlsDisabled={composerControlsDisabled || leaseObserver}
                composerReadOnly={leaseObserver}
                leadingControls={(
                  <>
                    {activePlusMenu ? <ComposerPlusTrigger controller={activePlusMenu} disabled={composerControlsDisabled} /> : null}
                    {showPlanModeControl && planMode ? (
                      <PlanModeTrigger planMode={planMode} onToggle={() => onTogglePlanMode?.()} />
                    ) : null}
                    {showAgentAccessControl ? (
                      <AgentAccessTrigger
                        ref={accessTriggerRef}
                        mode={agentAccessMode}
                        expanded={accessMenuOpen}
                        disabled={composerControlsDisabled}
                        onToggle={() => {
                          if (accessMenuOpen) {
                            setAccessMenuOpen(false)
                            return
                          }
                          onDismissComposerSuggestions?.()
                          setAccessMenuAnchor(null)
                          setAccessMenuOpen(true)
                        }}
                      />
                    ) : null}
                  </>
                )}
                trailingControls={enableThinkingControl && snapshot.model?.reasoning === true ? (
                  <ThinkingLevelControl
                    level={snapshot.thinkingLevel}
                    onChange={(level) => {
                      // The level lives on the mutable agent state, so write it
                      // and re-read the snapshot: without the refresh the button
                      // label would keep showing the old level.
                      agent.state.thinkingLevel = level
                      onThinkingLevelChange?.(level)
                      syncSnapshot()
                    }}
                    onBeforeOpen={onDismissComposerSuggestions}
                    // Same effective flag the rest of the composer row gets:
                    // a write-lease observer (another window owns the session)
                    // disables every control, this one included.
                    disabled={composerControlsDisabled || leaseObserver}
                  />
                ) : null}
              />
              <UsageBar totals={snapshot.usage} onCostClick={onCostClick} />
            </div>
          </div>
        )}
      </div>
      {accessMenuOpen && showAgentAccessControl ? (
        <AgentAccessMenu
          mode={agentAccessMode}
          anchor={accessMenuAnchor}
          menuRef={accessMenuRef}
          onSelect={(mode) => {
            closeAccessMenu()
            if (mode !== agentAccessMode) onAccessModeChange?.(mode)
          }}
        />
      ) : null}
      </LocalFilePathHandlerContext.Provider>
    </CommandActionsEnabledContext.Provider>
  )
})
