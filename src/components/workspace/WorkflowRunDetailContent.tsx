import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { t } from '@/lib/i18n'
import { formatDuration, renderCodeBlock } from '@/lib/tool-renderers/shared'
import {
  workflowCountParts,
  workflowPhaseSteps,
  workflowStatusLabelKey,
  workflowTimeline,
  type WorkflowAgentView,
  type WorkflowPhaseView,
  type WorkflowRunView,
  type WorkflowTimeline,
  type WorkflowTimelineEntry,
  type WorkflowToolView,
} from '@/lib/workflow-run-detail'
import type { WorkflowRunPayload } from '@/lib/workflow-run-payload'

type DetailView = 'timeline' | 'phase' | 'log'

type WorkflowRunDetailContentProps = {
  payload?: WorkflowRunPayload
  /** 打开某个 Agent 的独立运行详情（复用 run_subagent 的 Inspector Tab）。 */
  onOpenAgentRun?: (workflowRunId: string, agent: WorkflowAgentView) => void
}

function statusTone(status: WorkflowRunView['status']) {
  if (status === 'done') return 'done'
  if (status === 'error' || status === 'aborted') return 'error'
  return 'running'
}

function stepTone(status: WorkflowTimelineEntry['status']) {
  if (status === 'done') return 'done'
  if (status === 'error' || status === 'aborted') return 'error'
  if (status === 'running') return 'running'
  return 'pending'
}

function phaseTone(phase: WorkflowPhaseView) {
  if (phase.agents.some((agent) => agent.status === 'running') || phase.tools.some((tool) => tool.status === 'running')) return 'running'
  if (phase.agents.some((agent) => agent.status === 'error' || agent.status === 'aborted')
    || phase.tools.some((tool) => tool.status === 'error' || tool.status === 'aborted')) return 'error'
  if (phase.agents.length > 0 || phase.tools.length > 0) return 'done'
  return 'pending'
}

// ---------------------------------------------------------------------------
// 时间轴：把 seq + startedAt + durationMs 摊平成甘特图
//
// 用 DOM + 百分比定位渲染，而不是固定 viewBox 的 SVG：SVG 的 viewBox 缩放会把
// 字号一起缩掉（640px 面板下 9px 字实际渲染约 5.8px，340px 时约 3px），改为
// 「左侧固定宽度标签列 + 右侧百分比轨道」后，字号与行高恒定，只有轨道宽度随
// 面板变化。
// ---------------------------------------------------------------------------

type TimelineRow =
  | { kind: 'phase'; key: string; title: string; index: number; tone: string }
  | { kind: 'entry'; key: string; entry: WorkflowTimelineEntry }

const TIMELINE_TICK_COUNT = 5

function buildTimelineRows(view: WorkflowRunView, timeline: WorkflowTimeline): TimelineRow[] {
  const byId = new Map(timeline.entries.map((entry) => [entry.id, entry]))
  const rows: TimelineRow[] = []
  view.phases.forEach((phase, index) => {
    rows.push({
      kind: 'phase',
      key: `phase:${phase.title}:${index}`,
      title: phase.title,
      index,
      tone: phaseTone(phase),
    })
    const entries = [...phase.agents.map((agent) => byId.get(`agent:${agent.id}`)), ...phase.tools.map((tool) => byId.get(`tool:${tool.id}`))]
      .filter((entry): entry is WorkflowTimelineEntry => Boolean(entry))
      .sort((left, right) => left.seq - right.seq)
    for (const entry of entries) {
      rows.push({ kind: 'entry', key: entry.id, entry })
    }
  })
  return rows
}

function TimelineView({ view }: { view: WorkflowRunView }) {
  const timeline = useMemo(() => workflowTimeline(view), [view])
  const rows = useMemo(() => buildTimelineRows(view, timeline), [timeline, view])

  if (timeline.entries.length === 0) {
    return <p className="quickforge-workflow-detail-empty">{t('workflowDetailNoPhases')}</p>
  }

  // 百分比：条形左偏移与宽度都以 totalMs 为分母；短调用保底 0.6%，避免消失。
  const toPercent = (offsetMs: number) => Math.min(100, (Math.max(0, offsetMs) / timeline.totalMs) * 100)
  const ticks = Array.from({ length: TIMELINE_TICK_COUNT }, (_, index) => {
    const ratio = index / (TIMELINE_TICK_COUNT - 1)
    return { ratio, label: formatDuration(timeline.totalMs * ratio), left: ratio * 100 }
  })

  return (
    <div className="quickforge-workflow-detail-timeline">
      <div className="quickforge-workflow-detail-axis" aria-hidden="true">
        <span className="quickforge-workflow-detail-axis-spacer" />
        <span className="quickforge-workflow-detail-axis-track">
          <span className="quickforge-workflow-detail-axis-plot">
            {ticks.map((tick) => (
              <span
                className="quickforge-workflow-detail-axis-tick"
                key={`tick-${tick.ratio}`}
                style={{ left: `${tick.left}%` }}
                data-edge={tick.ratio === 0 ? 'start' : tick.ratio === 1 ? 'end' : undefined}
              >
                {tick.label}
              </span>
            ))}
          </span>
        </span>
      </div>

      <div className="quickforge-workflow-detail-rows">
        {rows.map((row) => row.kind === 'phase' ? (
          <div className="quickforge-workflow-detail-row is-phase" key={row.key} data-tone={row.tone}>
            <span className="quickforge-workflow-detail-row-head">
              <span className="quickforge-workflow-detail-phase-index">{String(row.index + 1).padStart(2, '0')}</span>
              <span className="quickforge-workflow-detail-phase-name">{row.title}</span>
            </span>
            <span className="quickforge-workflow-detail-row-track" aria-hidden="true">
              <span className="quickforge-workflow-detail-row-plot">
                <span className="quickforge-workflow-detail-phase-rule" />
              </span>
            </span>
          </div>
        ) : (
          <div
            className="quickforge-workflow-detail-row"
            key={row.key}
            data-kind={row.entry.kind}
            data-tone={stepTone(row.entry.status)}
          >
            <span className="quickforge-workflow-detail-row-head" title={row.entry.label}>
              <i className="quickforge-workflow-detail-dot" data-tone={stepTone(row.entry.status)} aria-hidden="true" />
              <span className={`quickforge-workflow-detail-row-label${row.entry.kind === 'tool' ? ' is-tool' : ''}`}>
                {row.entry.label}
              </span>
            </span>
            <span className="quickforge-workflow-detail-row-track">
              <span className="quickforge-workflow-detail-row-plot">
                {ticks.map((tick) => (
                  <span
                    className="quickforge-workflow-detail-grid"
                    key={`grid-${row.key}-${tick.ratio}`}
                    style={{ left: `${tick.left}%` }}
                    aria-hidden="true"
                  />
                ))}
                <span
                  className={`quickforge-workflow-detail-bar${row.entry.parallel ? ' is-parallel' : ''}`}
                  data-tone={stepTone(row.entry.status)}
                  data-kind={row.entry.kind}
                  style={{
                    left: `${toPercent(row.entry.startOffsetMs)}%`,
                    width: `${Math.max(0.6, toPercent(row.entry.startOffsetMs + row.entry.durationMs) - toPercent(row.entry.startOffsetMs))}%`,
                  }}
                />
                {/* 耗时与「并行」是绘图区的绝对定位子元素，不是条形的子元素：
                    挂在条形上会随条形位置溢出轨道右侧而被面板裁掉。 */}
                {row.entry.durationMs > 0 ? (
                  <span className="quickforge-workflow-detail-bar-value">{formatDuration(row.entry.durationMs)}</span>
                ) : null}
                {row.entry.parallel ? (
                  <span className="quickforge-workflow-detail-parallel-tag">{t('workflowDetailParallelBadge')}</span>
                ) : null}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="quickforge-workflow-detail-legend">
        <span><i className="swatch" data-tone="agent" />{t('workflowDetailTimelineLegendAgent')}</span>
        <span><i className="swatch" data-tone="tool" />{t('workflowDetailTimelineLegendTool')}</span>
        <span><i className="swatch" data-tone="parallel" />{t('workflowDetailTimelineLegendParallel')}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 阶段视图
// ---------------------------------------------------------------------------

function toolStatusText(tool: WorkflowToolView) {
  if (tool.status === 'running') return t('workflowAgentRunning')
  if (tool.status === 'error' || tool.status === 'aborted') return t('workflowAgentFailed')
  if (tool.status === 'queued') return t('workflowAgentQueued')
  return ''
}

function agentStatusText(agent: WorkflowAgentView) {
  if (agent.status === 'running') return t('workflowAgentRunning')
  if (agent.status === 'error') return t('workflowAgentFailed')
  if (agent.status === 'aborted') return t('workflowAgentAborted')
  if (agent.status === 'queued') return t('workflowAgentQueued')
  return ''
}

function ToolRow({ tool, detailed }: { tool: WorkflowToolView; detailed: boolean }) {
  const [open, setOpen] = useState(false)
  const name = tool.label || tool.name
  const argsPreview = detailed && tool.args ? JSON.stringify(tool.args) : ''
  const expandable = detailed || Boolean(tool.resultPreview) || Boolean(tool.error)
  return (
    <li>
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className="quickforge-workflow-detail-tool"
          data-tone={stepTone(tool.status)}
          title={tool.error ? `${name}: ${tool.error}` : name}
        >
          <span className="quickforge-workflow-detail-tool-name">{name}</span>
          {tool.durationMs > 0 ? <span className="quickforge-workflow-detail-duration">{formatDuration(tool.durationMs)}</span> : null}
          {expandable ? <ChevronRight className="quickforge-workflow-detail-chevron" aria-hidden="true" /> : null}
        </summary>
        {expandable ? (
          <div className="quickforge-workflow-detail-tool-body">
            {argsPreview ? (
              <div>
                <div className="quickforge-workflow-detail-field-label">{t('input')}</div>
                {renderCodeBlock(argsPreview, 'json')}
              </div>
            ) : null}
            {tool.resultPreview ? (
              <div>
                <div className="quickforge-workflow-detail-field-label">{t('output')}</div>
                {renderCodeBlock(tool.resultPreview, 'text')}
              </div>
            ) : null}
            {tool.error ? <div className="quickforge-workflow-detail-error-text">{tool.error}</div> : null}
            {!argsPreview && !tool.resultPreview && !tool.error ? (
              <div className="quickforge-workflow-detail-field-label">{toolStatusText(tool) || t('workflowDetailPending')}</div>
            ) : null}
          </div>
        ) : null}
      </details>
    </li>
  )
}

function AgentCard({
  agent,
  detailed,
  workflowRunId,
  onOpenAgentRun,
}: {
  agent: WorkflowAgentView
  detailed: boolean
  workflowRunId: string
  onOpenAgentRun?: (workflowRunId: string, agent: WorkflowAgentView) => void
}) {
  const meta = [
    agent.profile,
    agent.toolCalls > 0 ? t('workflowAgentToolCalls', { count: agent.toolCalls }) : '',
    agent.schemaValidated ? t('workflowAgentSchema') : '',
  ].filter(Boolean).join(' · ')
  const status = agentStatusText(agent)
  return (
    <div className="quickforge-workflow-detail-agent" data-tone={stepTone(agent.status)}>
      <div className="quickforge-workflow-detail-agent-head">
        <span className="quickforge-workflow-detail-dot" data-tone={stepTone(agent.status)} aria-hidden="true" />
        <span
          className={`quickforge-workflow-detail-agent-name${agent.status === 'running' ? ' quickforge-tool-running-sweep' : ''}`}
          title={agent.error ? `${agent.label}: ${agent.error}` : agent.label}
        >
          {agent.label}
        </span>
        {meta ? <span className="quickforge-workflow-detail-agent-meta">{meta}</span> : null}
        {agent.durationMs > 0 ? <span className="quickforge-workflow-detail-duration">{formatDuration(agent.durationMs)}</span> : null}
        {onOpenAgentRun && agent.status !== 'queued' ? (
          <button
            type="button"
            className="quickforge-workflow-detail-agent-open"
            onClick={() => onOpenAgentRun(workflowRunId, agent)}
          >
            {t('workflowDetailOpenAgentDetails')}
          </button>
        ) : null}
      </div>
      {agent.error ? <div className="quickforge-workflow-detail-error-text">{agent.error}</div> : null}
      {status && !agent.error ? <span className="quickforge-workflow-detail-sr">{status}</span> : null}
      {detailed && agent.resultPreview ? (
        <div className="quickforge-workflow-detail-agent-body">
          <div className="quickforge-workflow-detail-field-label">{t('workflowToolResult')}</div>
          {renderCodeBlock(agent.resultPreview, 'text')}
        </div>
      ) : null}
    </div>
  )
}

function PhaseView({
  view,
  detailed,
  onOpenAgentRun,
}: {
  view: WorkflowRunView
  detailed: boolean
  onOpenAgentRun?: (workflowRunId: string, agent: WorkflowAgentView) => void
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  if (view.phases.length === 0) {
    return <p className="quickforge-workflow-detail-empty">{t('workflowDetailNoPhases')}</p>
  }
  return (
    <div className="quickforge-workflow-detail-phases">
      {view.phases.map((phase, index) => {
        const steps = workflowPhaseSteps(phase)
        const stepCount = phase.agents.length + phase.tools.length
        const tone = phaseTone(phase)
        const isCollapsed = collapsed[phase.title] === true
        const phaseDuration = phase.agents.reduce((sum, agent) => sum + agent.durationMs, 0)
        return (
          <section className="quickforge-workflow-detail-phase" data-tone={tone} key={`${phase.title}:${index}`}>
            <button
              type="button"
              className="quickforge-workflow-detail-phase-head"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((current) => ({ ...current, [phase.title]: !isCollapsed }))}
            >
              <span className="quickforge-workflow-detail-phase-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="quickforge-workflow-detail-phase-name">{phase.title || t('workflowDetailPhaseCount', { index: index + 1 })}</span>
              <span className="quickforge-workflow-detail-phase-count">{t('workflowDetailStepCount', { count: stepCount })}</span>
              {phaseDuration > 0 ? <span className="quickforge-workflow-detail-duration">{formatDuration(phaseDuration)}</span> : null}
              <ChevronRight className="quickforge-workflow-detail-chevron" aria-hidden="true" />
            </button>
            {isCollapsed ? null : (
              <div className="quickforge-workflow-detail-phase-body">
                {steps.map((step) => step.kind === 'agent' ? (
                  <AgentCard
                    key={step.agent.id}
                    agent={step.agent}
                    detailed={detailed}
                    workflowRunId={view.runId}
                    onOpenAgentRun={onOpenAgentRun}
                  />
                ) : (
                  <ul className="quickforge-workflow-detail-tools" key={step.tools[0].id}>
                    {step.tools.map((tool) => <ToolRow key={tool.id} tool={tool} detailed={detailed} />)}
                  </ul>
                ))}
                {phase.logs.length > 0 ? (
                  <ul className="quickforge-workflow-detail-phase-logs">
                    {phase.logs.map((log, logIndex) => (
                      <li key={`${log.at}:${logIndex}`} data-level={log.level}>{log.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 日志视图
// ---------------------------------------------------------------------------

function LogView({ view }: { view: WorkflowRunView }) {
  const origin = view.runStartedAt ?? view.logs[0]?.at ?? 0
  if (view.logs.length === 0) {
    return <p className="quickforge-workflow-detail-empty">{t('workflowDetailNoLogs')}</p>
  }
  return (
    <ul className="quickforge-workflow-detail-log-list">
      {view.logs.map((log, index) => (
        <li key={`${log.at}:${index}`} className="quickforge-workflow-detail-log" data-level={log.level}>
          <time className="quickforge-workflow-detail-log-time">{formatDuration(Math.max(0, log.at - origin))}</time>
          {log.phase ? <span className="quickforge-workflow-detail-log-phase">{log.phase}</span> : null}
          <span className="quickforge-workflow-detail-log-text">{log.message}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// 外壳
// ---------------------------------------------------------------------------

export function WorkflowRunDetailContent({ payload, onOpenAgentRun }: WorkflowRunDetailContentProps) {
  const [view, setView] = useState<DetailView>('timeline')
  const [sheet, setSheet] = useState<'script' | 'result' | undefined>(undefined)

  if (!payload) {
    return <div className="quickforge-workflow-detail-empty">{t('workflowDetailNoPhases')}</div>
  }

  const run = payload.view
  const tone = statusTone(run.status)
  const timeline = workflowTimeline(run)
  const views: Array<{ key: DetailView; label: string; count?: string }> = [
    { key: 'timeline', label: t('workflowDetailViewTimeline'), count: timeline.peakConcurrency > 1 ? `×${timeline.peakConcurrency}` : undefined },
    { key: 'phase', label: t('workflowDetailViewPhases'), count: String(run.phases.length) },
    { key: 'log', label: t('workflowDetailViewLogs'), count: String(run.logs.length) },
  ]

  return (
    <div className="quickforge-workflow-detail" data-status={run.status}>
      <div className="quickforge-workflow-detail-overview">
        <div className="quickforge-workflow-detail-overview-row">
          <span className="quickforge-workflow-detail-pill" data-tone={tone}>
            <i aria-hidden="true" />
            {t(workflowStatusLabelKey(run.status))}
          </span>
          {run.durationMs > 0 ? <span className="quickforge-workflow-detail-duration">{formatDuration(run.durationMs)}</span> : null}
          <span className="quickforge-workflow-detail-scale">
            {workflowCountParts(run, t)
              .concat(t('workflowDetailPhaseTotal', { count: run.phases.length }))
              .join(' · ')}
          </span>
        </div>
        <div className="quickforge-workflow-detail-overview-row is-meta">
          {timeline.peakConcurrency > 1 ? <span>{t('workflowDetailPeakConcurrency', { count: timeline.peakConcurrency })}</span> : null}
          {timeline.savedMs > 0 ? <span>{t('workflowDetailSaved', { duration: formatDuration(timeline.savedMs) })}</span> : null}
          {run.maxAgents > 0 || run.maxTools > 0 ? (
            <span>
              {t('workflowDetailBudget')} <b>{run.maxAgents}</b> agent / <b>{run.maxTools}</b> tool
            </span>
          ) : null}
        </div>
      </div>

      <div className="quickforge-workflow-detail-seg" role="tablist" aria-label={t('workflowRunDetails')}>
        {views.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            onClick={() => setView(item.key)}
          >
            {item.label}
            {item.count ? <span className="quickforge-workflow-detail-seg-count">{item.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="quickforge-workflow-detail-pane">
        {run.error ? (
          <div className="quickforge-workflow-detail-error" role="alert">
            <span className="quickforge-workflow-detail-error-label">{t('workflowError')}</span>
            <span>{run.error}</span>
          </div>
        ) : null}
        {view === 'timeline' ? <TimelineView view={run} /> : null}
        {view === 'phase' ? <PhaseView view={run} detailed={payload.detailed} onOpenAgentRun={onOpenAgentRun} /> : null}
        {view === 'log' ? <LogView view={run} /> : null}
      </div>

      <div className="quickforge-workflow-detail-foot">
        {payload.script ? (
          <button type="button" className="quickforge-workflow-detail-foot-btn" onClick={() => setSheet(sheet === 'script' ? undefined : 'script')}>
            {t('workflowScript')}
          </button>
        ) : null}
        {run.resultPreview ? (
          <button type="button" className="quickforge-workflow-detail-foot-btn" onClick={() => setSheet(sheet === 'result' ? undefined : 'result')}>
            {t('workflowResult')}
          </button>
        ) : null}
      </div>

      {sheet === 'script' && payload.script ? (
        <div className="quickforge-workflow-detail-sheet">
          {renderCodeBlock(payload.script, 'javascript')}
        </div>
      ) : null}
      {sheet === 'result' && run.resultPreview ? (
        <div className="quickforge-workflow-detail-sheet">
          {renderCodeBlock(run.resultPreview, 'text')}
        </div>
      ) : null}
    </div>
  )
}

export type { WorkflowRunPayload }
