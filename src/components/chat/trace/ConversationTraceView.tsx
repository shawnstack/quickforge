import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { getToolApprovalDisplayName } from '@/components/chat/panel-decoration/approval-card'
import type { AgentMessage } from '@/components/chat/surface/ChatTypes'
import { t } from '@/lib/i18n'
import {
  buildConversationTrace,
  formatTraceClock,
  formatTraceDuration,
  formatTraceTokens,
  layoutTraceSpans,
  traceBounds,
  traceRowMatches,
  traceRows,
  traceTurnMarkers,
  type TraceLayoutMode,
  type TraceModel,
  type TraceRow,
  type TraceStep,
  type TraceTool,
  type TraceTurn,
} from '@/lib/conversation-trace'
import { renderToolIcon } from '@/lib/tool-renderers/shared'
import { cn } from '@/lib/utils'

import './conversation-trace.css'

/**
 * Conversation trace view.
 *
 * Renders the projection from `@/lib/conversation-trace` — the same data the
 * chat surface already has, folded by turn. It is a read-only view of one
 * session: no extra persistence, no network, no mutation of `agent.state`.
 *
 * Layout follows `WorkflowRunDetailContent`'s timeline contract: DOM + percent
 * positioning, never a fixed-`viewBox` SVG (that scales the font down with the
 * panel width).
 */

export type TraceAgentLike = {
  state: {
    messages: AgentMessage[]
    pendingToolCalls?: ReadonlySet<string> | readonly string[]
  }
  subscribe?: (listener: (event: { type: string }) => void) => () => void
}

export type ConversationTraceViewProps = {
  agent: TraceAgentLike | null
  /** Switch back to the chat view (used by the inspector's "locate in chat" action). */
  onOpenChat?: () => void
  className?: string
}

const TRACE_EVENTS = new Set([
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'message_end',
  'messages_replaced',
  'agent_start',
  'agent_end',
])

/** Re-render when the agent publishes a message-level event (App does not re-render per event). */
function useAgentRevision(agent: TraceAgentLike | null): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!agent?.subscribe) return undefined
    return agent.subscribe((event) => {
      if (TRACE_EVENTS.has(event.type)) setRevision((value) => value + 1)
    })
  }, [agent])
  return revision
}

/** One-second tick, only while a tool is actually running (in-flight durations). */
function useLiveClock(active: boolean): number {
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const id = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return clock
}

function pendingIds(agent: TraceAgentLike | null): ReadonlySet<string> {
  const raw = agent?.state.pendingToolCalls
  if (!raw) return new Set<string>()
  if (typeof (raw as ReadonlySet<string>).has === 'function') return raw as ReadonlySet<string>
  return new Set<string>(raw as readonly string[])
}

type Selection = { start: number; end: number }

/** Stable identity for "no session yet" (an inline [] would re-run the projection every render). */
const EMPTY_MESSAGES: AgentMessage[] = []

export function ConversationTraceView({ agent, onOpenChat, className }: ConversationTraceViewProps) {
  const revision = useAgentRevision(agent)
  // A fresh Set per revision: the agent mutates `state.pendingToolCalls` in place,
  // so identity has to come from the revision counter for downstream memos.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the trigger
  const pending = useMemo(() => new Set(pendingIds(agent)), [agent, revision])
  const clock = useLiveClock(pending.size > 0)

  // `agent?.state.messages ?? EMPTY` would be a fresh array per render and defeat the
  // memo; the agent's own array reference is stable between commits.
  const messages = agent?.state.messages
  const model = useMemo(
    () => buildConversationTrace(messages ?? EMPTY_MESSAGES, { pendingToolCalls: pending, now: clock }),
    // `pending` re-derives per revision (see above) and `clock` ticks only while a
    // tool is running, so both in-place `agent.state` updates are covered here.
    [messages, pending, clock],
  )

  const [mode, setMode] = useState<TraceLayoutMode>('duration')
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(() => new Set())
  const [collapsedSteps, setCollapsedSteps] = useState<ReadonlySet<string>>(() => new Set())
  const [hover, setHover] = useState<{ row: TraceRow; x: number; y: number } | null>(null)

  const rows = useMemo(() => traceRows(model), [model])
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId])
  const spans = useMemo(() => layoutTraceSpans(model, mode), [model, mode])
  const markers = useMemo(() => (mode === 'time' ? traceTurnMarkers(model) : []), [model, mode])

  const visibleRows = useMemo(() => rows.filter((row) => {
    if (selection && (row.endAt < selection.start || row.at > selection.end)) return false
    return true
  }), [rows, selection])

  const dimmedIds = useMemo(() => {
    if (!query.trim()) return new Set<string>()
    const dimmed = new Set<string>()
    for (const row of rows) if (!traceRowMatches(row, query)) dimmed.add(row.id)
    return dimmed
  }, [rows, query])

  const matchCount = useMemo(
    () => (query.trim() ? rows.filter((row) => traceRowMatches(row, query)).length : 0),
    [rows, query],
  )

  const ledgerRef = useRef<HTMLDivElement | null>(null)

  const revealRow = (id: string) => {
    const row = rows.find((item) => item.id === id)
    if (!row) return
    setCollapsedTurns((current) => {
      if (!current.has(row.turnIndex)) return current
      const next = new Set(current)
      next.delete(row.turnIndex)
      return next
    })
    if (row.kind === 'tool') {
      setCollapsedSteps((current) => {
        if (!current.has(row.stepId)) return current
        const next = new Set(current)
        next.delete(row.stepId)
        return next
      })
    }
    window.requestAnimationFrame(() => {
      const element = ledgerRef.current?.querySelector<HTMLElement>(`[data-trace-row="${CSS.escape(id)}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const selectRow = (id: string, options?: { reveal?: boolean }) => {
    setSelectedId(id)
    if (options?.reveal) revealRow(id)
  }

  const toggleTurn = (index: number) => {
    setCollapsedTurns((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const toggleStep = (id: string) => {
    setCollapsedSteps((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allCollapsed = model.turns.length > 0
    && model.turns.every((turn) => collapsedTurns.has(turn.index))

  const toggleAll = () => {
    if (allCollapsed) {
      setCollapsedTurns(new Set())
      setCollapsedSteps(new Set())
      return
    }
    setCollapsedTurns(new Set(model.turns.map((turn) => turn.index)))
    setCollapsedSteps(new Set(model.turns.flatMap((turn) => turn.steps.map((step) => step.id))))
  }

  // Empty only when the session recorded no model request at all. A text-only
  // exchange still lists its USER/ASSISTANT rows — the request, model and token
  // counts are exactly what the trace is for.
  const empty = model.turns.every((turn) => turn.steps.length === 0)

  return (
    <div className={cn('quickforge-trace', className)}>
      <div className="quickforge-trace-toolbar">
        <div className="quickforge-trace-seg" role="group" aria-label={t('trace.timelineTitle')}>
          {(['sequence', 'duration', 'time'] as TraceLayoutMode[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value)
                if (value !== 'time') setSelection(null)
              }}
            >
              {value === 'sequence' ? t('trace.modeSequence') : value === 'duration' ? t('trace.modeDuration') : t('trace.modeTime')}
            </button>
          ))}
        </div>

        <button className="quickforge-trace-action" type="button" onClick={toggleAll} disabled={empty}>
          {allCollapsed ? t('trace.expandAll') : t('trace.collapseAll')}
        </button>

        <span className="quickforge-trace-toolbar-spacer" />

        {query.trim() ? (
          <span className="quickforge-trace-count">{t('trace.matchCount', { count: matchCount })}</span>
        ) : null}

        <label className="quickforge-trace-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={query}
            placeholder={t('trace.searchPlaceholder')}
            aria-label={t('trace.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {empty ? (
        <div className="quickforge-trace-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <p className="quickforge-trace-empty-title">{t('trace.emptyTitle')}</p>
          <p className="quickforge-trace-empty-body">{t('trace.emptyBody')}</p>
        </div>
      ) : (
        <>
          <TraceOverview
            model={model}
            mode={mode}
            spans={spans}
            markers={markers}
            selection={selection}
            onSelectionChange={setSelection}
            selectedId={selectedId}
            onHover={setHover}
            onSelect={selectRow}
          />

          <div className="quickforge-trace-body">
            <div className="quickforge-trace-ledger" ref={ledgerRef}>
              {visibleRows.length === 0 ? (
                <div className="quickforge-trace-empty quickforge-trace-empty-inline">
                  <p className="quickforge-trace-empty-title">{t('trace.noMatchTitle')}</p>
                  <p className="quickforge-trace-empty-body">
                    {selection ? t('trace.noMatchSelection') : t('trace.noMatchBody')}
                  </p>
                </div>
              ) : (
                model.turns.map((turn) => {
                  const turnRows = visibleRows.filter((row) => row.turnIndex === turn.index)
                  if (!turnRows.length) return null
                  const collapsed = collapsedTurns.has(turn.index)
                  const toolCount = turnRows.filter((row) => row.kind === 'tool').length
                  return (
                    <section className="quickforge-trace-turn" key={turn.index}>
                      <button
                        className="quickforge-trace-turn-head"
                        type="button"
                        aria-expanded={!collapsed}
                        onClick={() => toggleTurn(turn.index)}
                      >
                        <span className="quickforge-trace-chevron" data-collapsed={collapsed || undefined} aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </span>
                        <span className="quickforge-trace-turn-index">{t('trace.turnLabel', { index: turn.index })}</span>
                        <span className="quickforge-trace-turn-time">{formatTraceClock(turn.startAt)}</span>
                        <span className="quickforge-trace-turn-stat">
                          {t('trace.turnStat', {
                            steps: turn.steps.length,
                            tools: toolCount,
                            duration: formatTraceDuration(turn.endAt - turn.startAt),
                          })}
                        </span>
                      </button>

                      {collapsed ? null : (
                        <div className="quickforge-trace-turn-body">
                          {turnRows.filter((row) => row.kind === 'user').map((row) => (
                            <TraceRowButton
                              key={row.id}
                              row={row}
                              selected={selectedId === row.id}
                              dimmed={dimmedIds.has(row.id)}
                              now={clock}
                              onSelect={() => selectRow(row.id)}
                            />
                          ))}
                          {turn.steps.map((step) => {
                            const stepRows = turnRows.filter(
                              (row) => row.kind === 'step' && row.id === step.id,
                            )
                            const toolRows = turnRows.filter(
                              (row) => row.kind === 'tool' && row.stepId === step.id,
                            )
                            if (!stepRows.length && !toolRows.length) return null
                            const stepCollapsed = collapsedSteps.has(step.id)
                            const stepRow = stepRows[0]
                            return (
                              <div className="quickforge-trace-step" key={step.id}>
                                <div className="quickforge-trace-step-head">
                                  <button
                                    className="quickforge-trace-step-toggle"
                                    type="button"
                                    aria-expanded={!stepCollapsed}
                                    aria-label={t('trace.collapseStep')}
                                    disabled={!toolRows.length}
                                    onClick={() => toggleStep(step.id)}
                                  >
                                    <span className="quickforge-trace-chevron" data-collapsed={stepCollapsed || undefined} aria-hidden="true">
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m6 9 6 6 6-6" />
                                      </svg>
                                    </span>
                                  </button>
                                  {stepRow ? (
                                    <TraceRowButton
                                      row={stepRow}
                                      selected={selectedId === stepRow.id}
                                      dimmed={dimmedIds.has(stepRow.id)}
                                      now={clock}
                                      onSelect={() => selectRow(stepRow.id)}
                                      inline
                                    />
                                  ) : null}
                                </div>
                                {stepCollapsed || !toolRows.length ? null : (
                                  <div className="quickforge-trace-tool-rows">
                                    {toolRows.map((row) => (
                                      <TraceRowButton
                                        key={row.id}
                                        row={row}
                                        selected={selectedId === row.id}
                                        dimmed={dimmedIds.has(row.id)}
                                        now={clock}
                                        onSelect={() => selectRow(row.id)}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </section>
                  )
                })
              )}
            </div>

            {selected ? (
              <TraceInspector
                row={selected}
                onClose={() => setSelectedId(null)}
                onOpenChat={onOpenChat ? () => onOpenChat() : undefined}
              />
            ) : null}
          </div>
        </>
      )}

      {hover ? (
        <div
          className="quickforge-trace-tooltip"
          style={{ left: hover.x, top: hover.y }}
          role="tooltip"
        >
          <strong>{hover.row.kind === 'tool' ? getToolApprovalDisplayName(hover.row.tool.name) : hover.row.kind === 'step' ? t('trace.badgeAssistant') : t('trace.badgeUser')}</strong>
          <span>
            {formatTraceClock(hover.row.at)} → {formatTraceClock(hover.row.endAt)} · {formatTraceDuration(hover.row.endAt - hover.row.at)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Timeline overview                                                          */
/* -------------------------------------------------------------------------- */

function TraceOverview({
  model,
  mode,
  spans,
  markers,
  selection,
  onSelectionChange,
  selectedId,
  onHover,
  onSelect,
}: {
  model: TraceModel
  mode: TraceLayoutMode
  spans: ReturnType<typeof layoutTraceSpans>
  markers: ReturnType<typeof traceTurnMarkers>
  selection: Selection | null
  onSelectionChange: (selection: Selection | null) => void
  selectedId: string | null
  onHover: (hover: { row: TraceRow; x: number; y: number } | null) => void
  onSelect: (id: string) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const bounds = useMemo(() => traceBounds(model), [model])
  const rows = useMemo(() => traceRows(model), [model])
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])

  const percentAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(Math.max(((clientX - rect.left) / rect.width) * 100, 0), 100)
  }

  const timeAt = (percent: number): number => {
    if (!bounds) return 0
    return bounds.min + (percent / 100) * bounds.span
  }

  const dragWindow = drag ?? null
  const highlight = dragWindow
    ? { left: Math.min(dragWindow.from, dragWindow.to), width: Math.abs(dragWindow.to - dragWindow.from) }
    : selection && bounds
      ? {
          left: ((selection.start - bounds.min) / bounds.span) * 100,
          width: ((selection.end - selection.start) / bounds.span) * 100,
        }
      : null

  return (
    <div className="quickforge-trace-overview">
      <div className="quickforge-trace-overview-head">
        <span className="quickforge-trace-overview-title">{t('trace.timelineTitle')}</span>
        <span className="quickforge-trace-overview-span">
          {bounds ? `${formatTraceClock(bounds.min)} – ${formatTraceClock(bounds.max)}` : ''}
        </span>
        <span className="quickforge-trace-overview-hint">
          {mode === 'time'
            ? t('trace.hintTime')
            : mode === 'duration'
              ? t('trace.hintDuration')
              : t('trace.hintSequence')}
        </span>
        {selection ? (
          <button
            className="quickforge-trace-overview-reset"
            type="button"
            onClick={() => onSelectionChange(null)}
          >
            {t('trace.clearSelection')}
          </button>
        ) : null}
      </div>

      <div className="quickforge-trace-overview-grid">
        <div className="quickforge-trace-lanes" aria-hidden="true">
          <span>{t('trace.laneInput')}</span>
          <span>{t('trace.laneModel')}</span>
          <span>{t('trace.laneTools')}</span>
        </div>
        <div
          className="quickforge-trace-track"
          ref={trackRef}
          onPointerDown={(event) => {
            if (mode !== 'time' || event.button !== 0) return
            const from = percentAt(event.clientX)
            setDrag({ from, to: from })
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (!drag) return
            setDrag({ from: drag.from, to: percentAt(event.clientX) })
          }}
          onPointerUp={(event) => {
            if (!drag) return
            const to = percentAt(event.clientX)
            const from = drag.from
            setDrag(null)
            if (Math.abs(to - from) < 1.5) {
              onSelectionChange(null)
              return
            }
            onSelectionChange({
              start: timeAt(Math.min(from, to)),
              end: timeAt(Math.max(from, to)),
            })
            event.currentTarget.releasePointerCapture?.(event.pointerId)
          }}
          onContextMenu={(event) => {
            if (!selection) return
            event.preventDefault()
            onSelectionChange(null)
          }}
        >
          {(['input', 'model', 'tools'] as const).map((lane) => (
            <div className="quickforge-trace-lane" key={lane} data-lane={lane}>
              {spans.filter((span) => span.lane === lane).map((span) => {
                const row = rowById.get(span.id)
                const tool = row?.kind === 'tool' ? row.tool : null
                const step = row?.kind === 'step' ? row.step : null
                return (
                  <button
                    key={span.id}
                    type="button"
                    className="quickforge-trace-span"
                    data-lane={lane}
                    data-status={tool?.status}
                    data-selected={selectedId === span.id || undefined}
                    style={{ left: `${span.left}%`, width: `${span.width}%` }}
                    title={row ? `${formatTraceClock(row.at)} · ${formatTraceDuration(row.endAt - row.at)}` : undefined}
                    onMouseEnter={(event) => {
                      if (!row) return
                      setHoverSafe(onHover, { row, x: event.clientX + 12, y: event.clientY + 16 })
                    }}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect(span.id)}
                  >
                    {step && step.tools.length > 1 ? <span className="quickforge-trace-span-parallel" aria-hidden="true" /> : null}
                  </button>
                )
              })}
            </div>
          ))}

          {markers.map((marker) => (
            <span
              key={marker.index}
              className="quickforge-trace-marker"
              style={{ left: `${marker.left}%` }}
              aria-hidden="true"
            />
          ))}

          {highlight && highlight.width > 0 ? (
            <span
              className="quickforge-trace-highlight"
              style={{ left: `${highlight.left}%`, width: `${highlight.width}%` }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function setHoverSafe(
  onHover: (hover: { row: TraceRow; x: number; y: number } | null) => void,
  value: { row: TraceRow; x: number; y: number },
) {
  onHover(value)
}

/* -------------------------------------------------------------------------- */
/* Ledger rows                                                                */
/* -------------------------------------------------------------------------- */

function TraceRowButton({
  row,
  selected,
  dimmed,
  inline,
  now,
  onSelect,
}: {
  row: TraceRow
  selected: boolean
  dimmed: boolean
  inline?: boolean
  /** Wall clock for in-flight durations; passed in so the row stays pure. */
  now: number
  onSelect: () => void
}) {
  if (row.kind === 'user') {
    return (
      <button
        className={cn('quickforge-trace-row', inline && 'is-inline')}
        type="button"
        data-trace-row={row.id}
        data-kind="user"
        data-selected={selected || undefined}
        data-dimmed={dimmed || undefined}
        onClick={onSelect}
      >
        <span className="quickforge-trace-row-rule" aria-hidden="true" />
        <span className="quickforge-trace-badge" data-kind="user">{t('trace.badgeUser')}</span>
        <span className="quickforge-trace-row-text">{row.text}</span>
        <span className="quickforge-trace-row-meta">{formatTraceClock(row.at)}</span>
      </button>
    )
  }

  if (row.kind === 'step') {
    return (
      <button
        className={cn('quickforge-trace-row', inline && 'is-inline')}
        type="button"
        data-trace-row={row.id}
        data-kind="step"
        data-selected={selected || undefined}
        data-dimmed={dimmed || undefined}
        onClick={onSelect}
      >
        <span className="quickforge-trace-row-rule" aria-hidden="true" />
        <span className="quickforge-trace-badge" data-kind="step">{t('trace.badgeAssistant')}</span>
        {row.step.model ? <span className="quickforge-trace-row-name">{row.step.model}</span> : null}
        <span className="quickforge-trace-row-text">{row.step.text || row.step.thinking}</span>
        <span className="quickforge-trace-row-meta">
          {formatTraceTokens(row.step.inputTokens)}→{formatTraceTokens(row.step.outputTokens)}
        </span>
        <span className="quickforge-trace-row-duration">{formatTraceDuration(row.step.durationMs)}</span>
      </button>
    )
  }

  const tool = row.tool
  return (
    <button
      className={cn('quickforge-trace-row', 'is-tool', inline && 'is-inline')}
      type="button"
      data-trace-row={row.id}
      data-kind="tool"
      data-status={tool.status}
      data-selected={selected || undefined}
      data-dimmed={dimmed || undefined}
      onClick={onSelect}
    >
      <span className="quickforge-trace-row-rule" aria-hidden="true" />
      <span className="quickforge-trace-badge" data-kind="tool">{t('trace.badgeTool')}</span>
      {renderToolIcon(tool.name)}
      <span className="quickforge-trace-row-name">{getToolApprovalDisplayName(tool.name)}</span>
      {tool.parallelGroupId ? <span className="quickforge-trace-parallel">{t('trace.parallelBadge')}</span> : null}
      <span className="quickforge-trace-row-args">{tool.argsSummary}</span>
      <span className="quickforge-trace-row-duration">
        {tool.status === 'running'
          ? `+${formatTraceDuration(Math.max(0, now - tool.at))}`
          : formatTraceDuration(tool.durationMs)}
      </span>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Inspector                                                                  */
/* -------------------------------------------------------------------------- */

type InspectorTab = 'summary' | 'args' | 'result' | 'timing' | 'output' | 'usage' | 'raw'

const TABS: Record<TraceRow['kind'], InspectorTab[]> = {
  user: ['summary', 'raw'],
  step: ['summary', 'output', 'usage', 'raw'],
  tool: ['summary', 'args', 'result', 'timing'],
}

function tabLabel(tab: InspectorTab): string {
  switch (tab) {
    case 'summary': return t('trace.tabSummary')
    case 'args': return t('trace.tabArgs')
    case 'result': return t('trace.tabResult')
    case 'timing': return t('trace.tabTiming')
    case 'output': return t('trace.tabOutput')
    case 'usage': return t('trace.tabUsage')
    default: return t('trace.tabRaw')
  }
}

function statusLabel(status: TraceTool['status']): string {
  if (status === 'running') return t('trace.statusRunning')
  if (status === 'error') return t('trace.statusError')
  if (status === 'interrupted') return t('trace.statusInterrupted')
  return t('trace.statusDone')
}

function TraceInspector({
  row,
  onClose,
  onOpenChat,
}: {
  row: TraceRow
  onClose: () => void
  onOpenChat?: () => void
}) {
  const [tab, setTab] = useState<InspectorTab>('summary')
  const tabs = TABS[row.kind]
  const activeTab = tabs.includes(tab) ? tab : 'summary'

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <aside className="quickforge-trace-inspector" aria-label={t('trace.title')}>
      <div className="quickforge-trace-inspector-head">
        <span className="quickforge-trace-badge" data-kind={row.kind}>
          {row.kind === 'user' ? t('trace.badgeUser') : row.kind === 'step' ? t('trace.badgeAssistant') : t('trace.badgeTool')}
        </span>
        <span className="quickforge-trace-inspector-title">
          {row.kind === 'tool'
            ? getToolApprovalDisplayName(row.tool.name)
            : row.kind === 'step'
              ? row.step.model || t('trace.badgeAssistant')
              : t('trace.badgeUser')}
        </span>
        <span className="quickforge-trace-toolbar-spacer" />
        <button className="quickforge-trace-icon-button" type="button" aria-label={t('trace.closeInspector')} onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="quickforge-trace-inspector-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={activeTab === item}
            onClick={() => setTab(item)}
          >
            {tabLabel(item)}
          </button>
        ))}
      </div>

      <div className="quickforge-trace-inspector-body">
        {row.kind === 'tool' ? (
          <ToolInspectorBody tool={row.tool} tab={activeTab} onOpenChat={onOpenChat} />
        ) : row.kind === 'step' ? (
          <StepInspectorBody step={row.step} tab={activeTab} />
        ) : (
          <UserInspectorBody row={row} tab={activeTab} />
        )}
      </div>
    </aside>
  )
}

function MetaRow({ label, children, tone }: { label: string; children: ReactNode; tone?: 'ok' | 'bad' }) {
  return (
    <>
      <dt>{label}</dt>
      <dd data-tone={tone}>{children}</dd>
    </>
  )
}

function ToolInspectorBody({
  tool,
  tab,
  onOpenChat,
}: {
  tool: TraceTool
  tab: InspectorTab
  onOpenChat?: () => void
}) {
  if (tab === 'args') {
    return (
      <section className="quickforge-trace-inspector-section">
        <h4>{t('trace.argsLabel')}</h4>
        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
      </section>
    )
  }

  if (tab === 'result') {
    return (
      <section className="quickforge-trace-inspector-section">
        <h4>{tool.isError ? t('trace.errorOutputLabel') : t('trace.outputLabel')}</h4>
        <pre data-tone={tool.isError ? 'bad' : undefined}>{tool.resultText || t('trace.noOutput')}</pre>
      </section>
    )
  }

  if (tab === 'timing') {
    return (
      <>
        <dl className="quickforge-trace-inspector-meta">
          <MetaRow label="startedAt">
            {tool.startedAt === undefined ? '—' : `${tool.startedAt} · ${formatTraceClock(tool.startedAt)}`}
          </MetaRow>
          <MetaRow label="finishedAt">
            {tool.finishedAt === undefined ? '—' : `${tool.finishedAt} · ${formatTraceClock(tool.finishedAt)}`}
          </MetaRow>
          <MetaRow label="durationMs">{tool.durationMs === undefined ? '—' : String(tool.durationMs)}</MetaRow>
          <MetaRow label={t('trace.fieldSource')}><code>details.quickforgeTiming</code></MetaRow>
          <MetaRow label={t('trace.fieldPersisted')}>{t('trace.fieldPersistedValue')}</MetaRow>
        </dl>
        <section className="quickforge-trace-inspector-section">
          <h4>{t('trace.rawDetails')}</h4>
          <pre>
            {JSON.stringify(
              {
                quickforgeTiming: {
                  startedAt: tool.startedAt,
                  finishedAt: tool.finishedAt,
                  durationMs: tool.durationMs,
                },
              },
              null,
              2,
            )}
          </pre>
        </section>
      </>
    )
  }

  return (
    <>
      <dl className="quickforge-trace-inspector-meta">
        <MetaRow label={t('trace.fieldStatus')} tone={tool.status === 'error' ? 'bad' : tool.status === 'done' ? 'ok' : undefined}>
          {statusLabel(tool.status)}
        </MetaRow>
        <MetaRow label={t('trace.fieldDuration')}>
          {tool.status === 'running' ? t('trace.inFlight') : formatTraceDuration(tool.durationMs)}
        </MetaRow>
        <MetaRow label={t('trace.fieldStart')}>{formatTraceClock(tool.at)}</MetaRow>
        <MetaRow label={t('trace.fieldEnd')}>
          {tool.finishedAt === undefined ? t('trace.inFlight') : formatTraceClock(tool.finishedAt)}
        </MetaRow>
        {tool.parallelGroupId ? <MetaRow label={t('trace.fieldParallelGroup')}><code>{tool.parallelGroupId}</code></MetaRow> : null}
        <MetaRow label={t('trace.fieldCallId')}><code>{tool.id}</code></MetaRow>
      </dl>
      <section className="quickforge-trace-inspector-section">
        <h4>{t('trace.argsSummaryLabel')}</h4>
        <pre>{tool.argsSummary || t('trace.noArgs')}</pre>
      </section>
      {onOpenChat ? (
        <div className="quickforge-trace-inspector-actions">
          <button type="button" onClick={onOpenChat}>{t('trace.actionGotoChat')}</button>
        </div>
      ) : null}
    </>
  )
}

function StepInspectorBody({ step, tab }: { step: TraceStep; tab: InspectorTab }) {
  if (tab === 'output') {
    return (
      <>
        <section className="quickforge-trace-inspector-section">
          <h4>{t('trace.outputLabel')}</h4>
          <pre>{step.text || t('trace.noOutput')}</pre>
        </section>
        {step.thinking ? (
          <section className="quickforge-trace-inspector-section">
            <h4>{t('trace.thinkingLabel')}</h4>
            <pre>{step.thinking}</pre>
          </section>
        ) : null}
      </>
    )
  }

  if (tab === 'usage') {
    return (
      <dl className="quickforge-trace-inspector-meta">
        <MetaRow label="input">{formatTraceTokens(step.inputTokens)}</MetaRow>
        <MetaRow label="output">{formatTraceTokens(step.outputTokens)}</MetaRow>
        <MetaRow label="cache read">{formatTraceTokens(step.cacheReadTokens)}</MetaRow>
        <MetaRow label="cache write">{formatTraceTokens(step.cacheWriteTokens)}</MetaRow>
        <MetaRow label="cost">{step.costTotal > 0 ? `$${step.costTotal.toFixed(4)}` : '—'}</MetaRow>
      </dl>
    )
  }

  if (tab === 'raw') {
    return (
      <section className="quickforge-trace-inspector-section">
        <h4>{t('trace.rawMessage')}</h4>
        <pre>
          {JSON.stringify(
            {
              role: 'assistant',
              model: step.model,
              timestamp: step.at,
              stopReason: step.stopReason,
              errorMessage: step.errorMessage,
              usage: { input: step.inputTokens, output: step.outputTokens },
            },
            null,
            2,
          )}
        </pre>
      </section>
    )
  }

  return (
    <>
      <dl className="quickforge-trace-inspector-meta">
        <MetaRow label={t('trace.fieldModel')}>{step.model || '—'}</MetaRow>
        <MetaRow label={t('trace.fieldDuration')}>{formatTraceDuration(step.durationMs)}</MetaRow>
        <MetaRow label={t('trace.fieldStart')}>{formatTraceClock(step.at)}</MetaRow>
        <MetaRow label={t('trace.fieldEnd')}>
          {step.endAt === undefined ? t('trace.inFlight') : formatTraceClock(step.endAt)}
        </MetaRow>
        <MetaRow label={t('trace.fieldTools')}>{String(step.tools.length)}</MetaRow>
        {step.stopReason ? <MetaRow label="stopReason"><code>{step.stopReason}</code></MetaRow> : null}
        {step.errorMessage ? <MetaRow label="error" tone="bad">{step.errorMessage}</MetaRow> : null}
      </dl>
    </>
  )
}

function UserInspectorBody({ row, tab }: { row: Extract<TraceRow, { kind: 'user' }>; tab: InspectorTab }) {
  if (tab === 'raw') {
    return (
      <section className="quickforge-trace-inspector-section">
        <h4>{t('trace.rawMessage')}</h4>
        <pre>{JSON.stringify({ role: 'user', timestamp: row.at, content: row.text }, null, 2)}</pre>
      </section>
    )
  }
  return (
    <>
      <dl className="quickforge-trace-inspector-meta">
        <MetaRow label={t('trace.fieldStart')}>{formatTraceClock(row.at)}</MetaRow>
        <MetaRow label={t('trace.fieldTurn')}>{t('trace.turnLabel', { index: row.turnIndex })}</MetaRow>
      </dl>
      <section className="quickforge-trace-inspector-section">
        <h4>{t('trace.inputLabel')}</h4>
        <pre>{row.text}</pre>
      </section>
    </>
  )
}

export type { TraceTurn }
