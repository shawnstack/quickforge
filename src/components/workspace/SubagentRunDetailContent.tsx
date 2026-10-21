import { Component, createRef, useEffect, useRef } from 'react'
import type { AgentMessage, AgentTool } from '@/components/chat/surface/ChatTypes'
import { MessageList } from '@/components/chat/surface/MessageList'
import { AssistantStreamingContext } from '@/components/chat/surface/surface-context'
import { decorateProcessBlocks, releaseProcessGroups } from '@/components/chat/panel-decoration/process-folding'
import { t } from '@/lib/i18n'
import { translateErrorMessage } from '@/lib/error-messages'
import { disposeInputClampBoxes, syncInputClampBoxes, type InputClampLabels } from '@/lib/input-clamp'
import { renderCodeBlock, renderTiming } from '@/lib/tool-renderers/shared'
import { subagentTraceStructureSignature } from './subagent-trace-structure'
import {
  subagentRunBodyBlocks,
  subagentRunModelLabel,
  subagentRunTraceMessagesForDisplay,
  subagentThinkingLevelLabelKey,
  type SubagentRunPayload,
} from '@/lib/subagent-run-detail'

const inputClampLabels: InputClampLabels = { collapsed: () => t('expand'), expanded: () => t('collapse') }

function samePendingToolCallIds(previous: string[] | undefined, current: string[]) {
  return Boolean(
    previous
    && previous.length === current.length
    && previous.every((id, index) => id === current[index]),
  )
}

type SubagentRunDetailContentProps = {
  payload?: SubagentRunPayload
}

/**
 * Folding moves message nodes. Restore their React-owned parents before the
 * mutation phase (an effect cleanup is too late), then decorate after the child
 * messages refreshed the DOM-facing message/tool properties.
 *
 * Two guards keep the folding layer from thrashing while a run streams (the
 * server pushes a new snapshot every ~150ms):
 *
 * - `shouldComponentUpdate` bails out on Inspector re-renders that carry the
 *   same payload snapshot (tab switches, resizes, host revisions).
 * - `getSnapshotBeforeUpdate` releases only when the structure signature of the
 *   rendered messages actually changed. Releasing unconditionally dissolved the
 *   group on every commit, which (a) painted an unfolded frame and (b) dropped
 *   the group's fingerprint, making `updateProcessGroup`'s `update`/`skip` fast
 *   paths unreachable — every commit rebuilt the whole group by moving every
 *   node again (restarting CSS keyframes, re-decoding previews).
 *
 * The re-fold runs synchronously in the same commit (`componentDidUpdate`, no
 * timer/rAF): a released group must be re-folded before the browser paints, or
 * the unfolded state becomes a visible frame. Child messages mirror their
 * DOM-facing properties from `useLayoutEffect`, which React runs (child-first)
 * before this lifecycle, so the folding pass reads this commit's values.
 */
export class SubagentTrace extends Component<{ payload: SubagentRunPayload }> {
  private root = createRef<HTMLDivElement>()
  private revision = 0
  private decorating = false
  private structure: string
  /** 上次交给 MessageList 的 pendingToolCalls Set（内容未变时复用同一身份）。 */
  private pendingToolCalls?: ReadonlySet<string>
  private pendingToolCallIds?: string[]

  constructor(props: { payload: SubagentRunPayload }) {
    super(props)
    this.structure = SubagentTrace.signature(props.payload)
  }

  componentDidMount() { this.decorate() }

  shouldComponentUpdate(nextProps: { payload: SubagentRunPayload }) {
    // The Inspector owns the payload snapshot: a new object means new trace
    // content, an identical object means this commit cannot change the trace.
    return nextProps.payload !== this.props.payload
  }

  // React contract: the parameter is `prevProps` (and `prevState`), while the
  // props for this commit are already on `this.props`. Reading the new payload
  // from `this.props` is what makes the release land on the very commit whose
  // structure changed: `this.structure` tracks the committed DOM, so a mismatch
  // means *this* commit will move nodes React still reaches through. Keying off
  // the parameter compared the previous commit's signature and released one
  // commit late — React then mutated around nodes a folded group still owned.
  getSnapshotBeforeUpdate() {
    const next = SubagentTrace.signature(this.props.payload)
    if (next !== this.structure) {
      this.structure = next
      this.release()
    }
    return null
  }

  componentDidUpdate() { this.decorate() }

  componentWillUnmount() {
    this.revision += 1
    this.release()
  }

  private static signature(payload: SubagentRunPayload) {
    return subagentTraceStructureSignature(subagentRunTraceMessagesForDisplay(payload))
  }

  private release() {
    // Own the whole trace subtree, not just the message list: releasing is
    // idempotent and drops nodes React already re-created, so a wider root only
    // adds safety (no group can outlive the commit that owns it).
    const root = this.root.current
    if (root) releaseProcessGroups(root)
  }

  private decorate() {
    // `revision` invalidates an interrupted pass (a newer payload, or an
    // unmount); `decorating` is the single-flight guard — the pass moves nodes,
    // so a nested pass must not interleave with the one that owns the DOM.
    const revision = ++this.revision
    if (this.decorating) return
    this.decorating = true
    try {
      const list = this.root.current?.querySelector<HTMLElement>('.qf-message-list')
      if (!list?.isConnected) return
      const messages = Array.from(list.querySelectorAll<HTMLElement>('.qf-user-message, .qf-assistant-message'))
        .filter((node) => node.closest('.qf-message-list') === list)
      // A nested pass may have superseded this token while the DOM was read.
      if (revision !== this.revision) return
      decorateProcessBlocks(list, messages, this.props.payload.status === 'running')
    } finally {
      this.decorating = false
    }
  }

  /**
   * pendingToolCalls 的身份稳定化：服务端每 ~150ms 推一个全新 payload 对象，
   * 若每次渲染都 `new Set(payload.pendingToolCalls)`，MessageList 下所有 memo 化
   * 的 AssistantMessage 行都会因 props 身份比较失败而整条 trace 重渲染。内容
   * （id 序列）未变时必须复用同一 Set 实例；真变了再换新实例。
   */
  private stablePendingToolCalls(payload: SubagentRunPayload) {
    const ids = payload.pendingToolCalls ?? []
    if (this.pendingToolCalls && samePendingToolCallIds(this.pendingToolCallIds, ids)) {
      return this.pendingToolCalls
    }
    this.pendingToolCallIds = ids
    this.pendingToolCalls = new Set(ids)
    return this.pendingToolCalls
  }

  render() {
    const { payload } = this.props
    const isStreaming = payload.status === 'running'
    return (
      <div ref={this.root} className="quickforge-subagent-trace p-2.5" data-quickforge-subagent-process="true" data-quickforge-subagent-streaming={String(isStreaming)}>
        {/* The trace is its own streaming surface: it has no `.qf-streaming-message`
            container, so code blocks read the flag from here instead of the DOM. */}
        <AssistantStreamingContext.Provider value={isStreaming}>
          <MessageList
            messages={subagentRunTraceMessagesForDisplay(payload) as AgentMessage[]}
            tools={payload.tools as AgentTool[]}
            pendingToolCalls={this.stablePendingToolCalls(payload)}
          />
        </AssistantStreamingContext.Provider>
      </div>
    )
  }
}

function SubagentRunBody({ payload }: { payload: SubagentRunPayload }) {
  const root = useRef<HTMLDivElement>(null)
  const { runId, task, context, expectedOutput } = payload
  useEffect(() => {
    const element = root.current
    if (!element) return
    syncInputClampBoxes(element, inputClampLabels)
    return () => disposeInputClampBoxes(element)
    // Only the clamped task-block text affects the measurement. Depending on the
    // whole payload (a fresh object on every ~150ms trace snapshot) disposed and
    // re-measured the box on every update, which made the block visibly jitter.
  }, [runId, task, context, expectedOutput])

  const blocks = new Set(subagentRunBodyBlocks(payload))
  const model = subagentRunModelLabel(payload.model)
  const thinking = payload.thinkingLevel ? t(subagentThinkingLevelLabelKey(payload.thinkingLevel)) : ''
  return (
    <div ref={root} className="mt-3 space-y-3" data-subagent-run-id={payload.runId} data-subagent-status={payload.status}>
      {blocks.has('meta') ? <div className="quickforge-subagent-meta flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        {model ? <span>{model}</span> : null}
        {model && thinking ? <span aria-hidden="true">·</span> : null}
        {thinking ? <span>{thinking}</span> : null}
      </div> : null}
      {blocks.has('task') ? <div className="quickforge-subagent-task quickforge-input-clamp" data-quickforge-input-clamp="true">
        <div className="space-y-1">
          {payload.task ? <div><span className="font-medium">{t('subagentTask')}:</span> <span className="quickforge-subagent-task-value">{payload.task}</span></div> : null}
          {payload.context ? <div><span className="font-medium">{t('subagentContext')}:</span> <span className="quickforge-subagent-task-value">{payload.context}</span></div> : null}
          {payload.expectedOutput ? <div><span className="font-medium">{t('subagentExpectedOutput')}:</span> <span className="quickforge-subagent-task-value">{payload.expectedOutput}</span></div> : null}
        </div>
      </div> : null}
      {blocks.has('summary') ? <div className="quickforge-subagent-summary rounded-lg border border-[color-mix(in_oklab,var(--border)_75%,transparent)] bg-muted/30 px-3 py-2.5 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span className="font-medium text-foreground">{payload.label}</span>
          {payload.toolCalls !== undefined ? <span>{t('subagentToolCalls')}: {payload.toolCalls}</span> : null}
          {payload.timing ? <span>{renderTiming(payload.timing, payload.status)}</span> : null}
        </div>
        {payload.allowedTools.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{payload.allowedTools.map((tool) => <span key={tool} className="rounded-full bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground">{tool}</span>)}</div> : null}
      </div> : null}
      {blocks.has('trace') ? <SubagentTrace payload={payload} /> : null}
      {blocks.has('error') ? <div className="quickforge-subagent-error rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert"><span className="font-medium">{t('subagentErrorReason')}:</span> {translateErrorMessage(payload.errorMessage) || t('subagentErrorUnavailable')}</div> : null}
      {blocks.has('output') ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('subagentResult')}</div>{renderCodeBlock(payload.output, 'text')}</div> : null}
      {blocks.has('input') ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(payload.input, 'json')}</div> : null}
      {blocks.has('details') ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('details')}</div>{renderCodeBlock(payload.details, 'json')}</div> : null}
    </div>
  )
}

/** Inspector 的订阅由 useInspectorTabs 持有；此组件只渲染最新快照。 */
export function SubagentRunDetailContent({ payload }: SubagentRunDetailContentProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {payload ? <SubagentRunBody key={payload.runId} payload={payload} /> : <div className="rounded-lg border border-border bg-background/90 px-3 py-6 text-center text-sm text-muted-foreground">{t('subagentRunEmpty')}</div>}
    </div>
  )
}
