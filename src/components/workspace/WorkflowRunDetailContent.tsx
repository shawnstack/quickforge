import { useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { ToolMessage } from '@/components/chat/surface/ToolMessage'
import type { ToolCall, ToolResultMessage } from '@/components/chat/surface/ChatTypes'
import { renderSubagentRunSummary } from '@/lib/tool-renderers/subagent-tool-renderer'
import { shouldPublishSubagentRunPayload, subagentRunStore } from '@/lib/subagent-run-detail'
import { buildWorkflowSubagentRunPayload } from '@/lib/workflow-subagent-detail'
import {
  formatDuration,
  renderCodeBlock,
  renderToolChevron,
} from '@/lib/tool-renderers/shared'
import {
  workflowCountParts,
  workflowPhaseSpan,
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

type WorkflowRunDetailContentProps = {
  payload?: WorkflowRunPayload
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
// 单页合并视图：时间轴 / 阶段 / 日志原本是三份投影（同一份运行数据的甘特图、
// 阶段明细、日志流），切成三个分段 Tab 后必须点一下才能互相参照。现在合并成
// 一页连续滚动：整页共享一根时间轴（刻度条吸顶），每个阶段 = 粘性阶段头 +
// 该阶段的行（Agent 行带条形、工具行缩进）+ 该阶段自己的日志。
//
// 步骤行复用普通对话的卡片：工具行直接渲染 ToolMessage（各工具渲染器），Agent
// 行渲染 run_subagent 摘要卡（renderSubagentRunSummary）——与聊天区同一份信息、
// 样式与交互（展开体、跑马灯、状态/耗时、点击打开运行详情）。工作流自己只补充
// 右侧的时间轴轨道（何时运行、跑了多久、并行关系），不再各写一套步骤 UI。
//
// 条形仍然用 DOM + 百分比定位（不用固定 viewBox 的 SVG：等比缩放会把字号一起
// 缩掉），轨道列宽度 clamp 自适应，字号走消息字号基准。
// ---------------------------------------------------------------------------

const TIMELINE_TICK_COUNT = 5

type TimelineTick = { ratio: number; label: string; left: number }

function timelineTicks(timeline: WorkflowTimeline): TimelineTick[] {
  return Array.from({ length: TIMELINE_TICK_COUNT }, (_, index) => {
    const ratio = index / (TIMELINE_TICK_COUNT - 1)
    return { ratio, label: formatDuration(timeline.totalMs * ratio), left: ratio * 100 }
  })
}

type EntryIndex = Map<string, WorkflowTimelineEntry>

/** 刻度条：吸顶在滚动容器顶部，与行轨道同列，保证刻度与条形对齐。
 *  运行中附带「现在」chip（与阶段区的游标竖线同一百分比）。 */
function TimelineAxis({ ticks, now }: { ticks: TimelineTick[]; now?: { left: number; label: string; title: string } }) {
  return (
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
          {now ? (
            <span className="quickforge-workflow-detail-now-chip" style={{ left: `${now.left}%` }} title={now.title}>
              {now.label}
            </span>
          ) : null}
        </span>
      </span>
    </div>
  )
}

function StepTrack({ entry, totalMs }: { entry: WorkflowTimelineEntry; totalMs: number }) {
  // 百分比：条形左偏移与宽度都以 totalMs 为分母；短调用保底 0.6%，避免消失。
  const toPercent = (offsetMs: number) => Math.min(100, (Math.max(0, offsetMs) / totalMs) * 100)
  const left = toPercent(entry.startOffsetMs)
  const width = Math.max(0.6, toPercent(entry.startOffsetMs + entry.durationMs) - left)
  return (
    <span className="quickforge-workflow-detail-row-track">
      <span className="quickforge-workflow-detail-row-plot">
        <span
          className={`quickforge-workflow-detail-bar${entry.parallel ? ' is-parallel' : ''}`}
          data-tone={stepTone(entry.status)}
          data-kind={entry.kind}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        {/* 耗时是绘图区的绝对定位子元素，不是条形的子元素：
            挂在条形上会随条形位置溢出轨道右侧而被面板裁掉。 */}
        {entry.durationMs > 0 ? (
          <span className="quickforge-workflow-detail-bar-value">{formatDuration(entry.durationMs)}</span>
        ) : null}
      </span>
    </span>
  )
}

type StepProps = {
  entry?: WorkflowTimelineEntry
  totalMs: number
}

/**
 * 步骤行 = 普通对话的卡片 + 右侧时间轴轨道：卡片列（flex 弹性）承载与聊天区
 * 完全同一份信息与样式，轨道列（固定宽）只补充「何时运行、跑了多久」这条
 * 工作流自己的维度。卡片展开体是聊天卡自己的展开体，不再另写一份。
 */

/** 把 workflow 工具记录合成为聊天 ToolMessage 需要的 toolCall / result 形状。 */
function workflowToolCall(tool: WorkflowToolView): ToolCall {
  return { type: 'toolCall', id: tool.id, name: tool.name, arguments: tool.args ?? {} }
}

function workflowToolResult(tool: WorkflowToolView): ToolResultMessage | undefined {
  if (tool.status === 'queued') return undefined
  const text = tool.resultPreview || tool.error
  return {
    role: 'toolResult',
    toolCallId: tool.id,
    toolName: tool.name,
    isError: tool.status === 'error' || tool.status === 'aborted',
    content: text ? [{ type: 'text', text }] : [],
    // 聊天卡的耗时徽标（quickforge-elapsed-time）从 timing 推导；workflow 记录的
    // startedAt/durationMs 与 run_subagent 的 quickforgeTiming 同源语义（ms epoch）。
    details: tool.startedAt !== undefined || tool.durationMs > 0
      ? {
          quickforgeTiming: {
            ...(tool.startedAt !== undefined ? { startedAt: tool.startedAt } : {}),
            ...(tool.durationMs > 0 ? { durationMs: tool.durationMs } : {}),
          },
        }
      : undefined,
    // 合成结果只用于展示（渲染器从不读时间戳），保持 0 维持 render 纯度。
    timestamp: 0,
  }
}

/** 工具行：直接渲染普通对话的工具卡（ToolMessage → 各工具渲染器），与聊天区同一份摘要、展开体与状态。 */
function ToolStep({ tool, entry, totalMs }: StepProps & { tool: WorkflowToolView }) {
  return (
    <div className="quickforge-workflow-detail-step" data-kind="tool" data-tone={stepTone(tool.status)}>
      <ToolMessage toolCall={workflowToolCall(tool)} result={workflowToolResult(tool)} isStreaming={tool.status === 'running'} />
      {entry ? <StepTrack entry={entry} totalMs={totalMs} /> : <span className="quickforge-workflow-detail-row-track" />}
    </div>
  )
}

/**
 * Agent 行：渲染普通对话的 run_subagent 摘要卡（renderSubagentRunSummary）。
 * 点击走卡片自己的链路（store 最新快照优先 → OPEN_SUBAGENT_RUN_EVENT），与
 * 聊天里点 Agent 卡打开运行详情完全一致；queued 尚无运行详情，保持禁用。
 */
function AgentStep({
  agent,
  entry,
  totalMs,
  workflowRunId,
}: StepProps & { agent: WorkflowAgentView; workflowRunId: string }) {
  // 与 SubagentToolRenderer.render 同一套发布口径：store 已有更完整的实时快照
  // （SSE 由 WorkflowAgentRunEventPublisher 持续发布）时优先回填，避免详情闪空。
  const existing = subagentRunStore.get(`${workflowRunId || 'workflow'}:agent:${agent.id}`)
  const payload = buildWorkflowSubagentRunPayload(workflowRunId, agent, t, { previous: existing })
  if (shouldPublishSubagentRunPayload(payload, existing)) subagentRunStore.publish(payload)
  return (
    <div className="quickforge-workflow-detail-step" data-kind="agent" data-tone={stepTone(agent.status)}>
      {renderSubagentRunSummary(payload, {
        label: agent.label,
        meta: agent.profile && agent.profile !== agent.label ? agent.profile : undefined,
        labelClassName: agent.status === 'running' ? 'quickforge-subagent-label quickforge-tool-running-sweep' : undefined,
        title: agent.error ? `${agent.label}: ${agent.error}` : undefined,
        disabled: agent.status === 'queued',
      })}
      {entry ? <StepTrack entry={entry} totalMs={totalMs} /> : <span className="quickforge-workflow-detail-row-track" />}
    </div>
  )
}

/** 阶段小节：粘性阶段头（带时间轴跨度条）+ 该阶段的行 + 该阶段自己的日志（日志带 phase，永远有归属）。 */
const LOG_FOLD_LIMIT = 6

/** 时间轴百分比（0–100）。分母恒 >= 1（workflowTimeline 保证），可直接相除。 */
function timelinePercent(offsetMs: number, totalMs: number) {
  return (Math.max(0, offsetMs) / totalMs) * 100
}

type PhaseRow = {
  key: string
  entry?: WorkflowTimelineEntry
  node: ReactNode
}

function PhaseSection({
  phase,
  ordinal,
  timeline,
  nowMs,
  logOrigin,
  workflowRunId,
  entryIndex,
}: {
  phase: WorkflowPhaseView
  ordinal: number
  timeline: WorkflowTimeline
  /** 运行中的当前时刻（相对开始）；终态为 undefined，跨度条不再钳制。 */
  nowMs?: number
  logOrigin: number
  workflowRunId: string
  entryIndex: EntryIndex
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const steps = workflowPhaseSteps(phase)
  const tone = phaseTone(phase)
  const stepCount = phase.agents.length + phase.tools.length
  // 服务端理论上可能给出没有标题的阶段桶（日志/步骤的 phase 是空串）：
  // 合并成单页后这里就是「不属于任何阶段」的那一段，用专门的标题而不是「阶段 N」。
  const title = phase.title || t('workflowDetailRunLogs')

  // 阶段跨度：最早起点 → 最晚终点；运行中右端不超过当前时刻（不预测未来）。
  const span = workflowPhaseSpan(phase, timeline)
  const spanEnd = span === null ? 0 : nowMs === undefined ? span.endOffsetMs : Math.min(span.endOffsetMs, nowMs)
  const spanLeft = span ? timelinePercent(span.startOffsetMs, timeline.totalMs) : 0
  const spanWidth = span ? Math.max(0.6, timelinePercent(spanEnd, timeline.totalMs) - spanLeft) : 0

  const rows: PhaseRow[] = steps.map((step) => step.kind === 'agent'
    ? {
        key: step.agent.id,
        entry: entryIndex.get(`agent:${step.agent.id}`),
        node: (
          <AgentStep
            key={step.agent.id}
            agent={step.agent}
            entry={entryIndex.get(`agent:${step.agent.id}`)}
            totalMs={timeline.totalMs}
            workflowRunId={workflowRunId}
          />
        ),
      }
    : {
        key: `tools:${step.tools[0].id}`,
        entry: entryIndex.get(`tool:${step.tools[0].id}`),
        node: (
          <div className="quickforge-workflow-detail-tools" key={`tools:${step.tools[0].id}`}>
            {step.tools.map((tool) => (
              <ToolStep
                key={tool.id}
                tool={tool}
                entry={entryIndex.get(`tool:${tool.id}`)}
                totalMs={timeline.totalMs}
              />
            ))}
          </div>
        ),
      })

  // 连续的并行行包进一个 bracket 容器；组首（parallelGroupStart）标注一次「并行×N」。
  // 虚线描边（is-parallel）保留在每条条形上，双编码不删。
  const nodes: ReactNode[] = []
  for (let index = 0; index < rows.length;) {
    const row = rows[index]
    if (!row.entry?.parallel) {
      nodes.push(row.node)
      index += 1
      continue
    }
    let end = index
    while (end + 1 < rows.length && rows[end + 1].entry?.parallel) end += 1
    const first = rows[index]
    nodes.push(
      <div className="quickforge-workflow-detail-parallel-group" key={`parallel:${first.key}`}>
        {first.entry?.parallelGroupStart ? (
          <span className="quickforge-workflow-detail-parallel-tag" aria-hidden="true">
            {t('workflowDetailParallelCount', { count: first.entry.parallelGroupSize })}
          </span>
        ) : null}
        {rows.slice(index, end + 1).map((member) => member.node)}
      </div>,
    )
    index = end + 1
  }

  const foldLogs = phase.logs.length > LOG_FOLD_LIMIT
  const visibleLogs = foldLogs && !logsOpen ? phase.logs.slice(0, LOG_FOLD_LIMIT) : phase.logs

  return (
    <section
      className="quickforge-workflow-detail-phase"
      data-tone={tone}
      data-collapsed={collapsed ? 'true' : undefined}
    >
      <button
        type="button"
        className="quickforge-workflow-detail-phase-head"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span className="quickforge-workflow-detail-phase-text">
          <span className="quickforge-workflow-detail-phase-index">{String(ordinal).padStart(2, '0')}</span>
          <span className="quickforge-workflow-detail-phase-name" title={title}>{title}</span>
          <span className="quickforge-workflow-detail-phase-count">{t('workflowDetailStepCount', { count: stepCount })}</span>
        </span>
        {span ? (
          <span className="quickforge-workflow-detail-phase-track" aria-hidden="true">
            <span
              className="quickforge-workflow-detail-phase-bar"
              data-tone={tone}
              style={{ left: `${spanLeft}%`, width: `${spanWidth}%` }}
            />
          </span>
        ) : null}
        {span ? <span className="quickforge-workflow-detail-duration">{formatDuration(spanEnd - span.startOffsetMs)}</span> : null}
        {renderToolChevron()}
      </button>
      {collapsed ? null : (
        <div className="quickforge-workflow-detail-phase-body">
          {nodes}
          {phase.logs.length > 0 ? (
            <ul className="quickforge-workflow-detail-phase-logs">
              {visibleLogs.map((log, logIndex) => (
                <li key={`${log.at}:${logIndex}`} data-level={log.level}>
                  <time>{formatDuration(Math.max(0, log.at - logOrigin))}</time>
                  <span>{log.message}</span>
                </li>
              ))}
              {foldLogs ? (
                <li className="quickforge-workflow-detail-logs-toggle">
                  <button type="button" onClick={() => setLogsOpen((current) => !current)}>
                    {logsOpen ? t('workflowDetailLogsCollapse') : t('workflowDetailLogsExpand', { count: phase.logs.length })}
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 外壳
// ---------------------------------------------------------------------------

export function WorkflowRunDetailContent({ payload }: WorkflowRunDetailContentProps) {
  const [sheet, setSheet] = useState<'script' | 'result' | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timeline = useMemo(() => (payload ? workflowTimeline(payload.view) : undefined), [payload])

  if (!payload || !timeline) {
    return <div className="quickforge-workflow-detail-empty">{t('workflowDetailNoPhases')}</div>
  }

  const run = payload.view
  const tone = statusTone(run.status)
  const ticks = timelineTicks(timeline)
  const entryIndex: EntryIndex = new Map(timeline.entries.map((entry) => [entry.id, entry]))
  const logOrigin = run.runStartedAt ?? run.logs[0]?.at ?? 0
  // 运行游标：全部条目的最晚终点（运行中帧的 durationMs 是已运行时长，可当 elapsed 用）。
  // 终态不渲染游标，也没有钳制需求。
  const nowMs = run.status === 'running' && timeline.entries.length > 0
    ? Math.min(timeline.totalMs, Math.max(...timeline.entries.map((entry) => entry.startOffsetMs + entry.durationMs)))
    : undefined

  // 「定位失败步骤」：展开所属阶段与该步的聊天工具卡（卡内的 details 是受控的，
  // 走原生 summary 点击让 onToggle 回写状态，不能直接改 open 属性；Agent 行是
  // 摘要按钮，没有展开体），滚动居中后对整个步骤行闪烁描边。
  const jumpToFailure = () => {
    const step = scrollRef.current?.querySelector<HTMLElement>('.quickforge-workflow-detail-step[data-tone="error"]')
    if (!step) return
    const phase = step.closest('.quickforge-workflow-detail-phase')
    if (phase?.matches('[data-collapsed]')) {
      (phase.querySelector('.quickforge-workflow-detail-phase-head') as HTMLElement | null)?.click()
    }
    window.setTimeout(() => {
      const details = step.querySelector('details')
      if (details && !details.open) (details.querySelector('summary') as HTMLElement | null)?.click()
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      step.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' })
      step.classList.remove('is-flash')
      void step.offsetWidth
      step.classList.add('is-flash')
      window.setTimeout(() => step.classList.remove('is-flash'), 1700)
    }, 0)
  }

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
          {/* 图例整页共享一套编码，随概览条第一行常驻（右侧）。 */}
          <span className="quickforge-workflow-detail-legend">
            <span><i className="swatch" data-tone="agent" />{t('workflowDetailTimelineLegendAgent')}</span>
            <span><i className="swatch" data-tone="tool" />{t('workflowDetailTimelineLegendTool')}</span>
            <span><i className="swatch" data-tone="parallel" />{t('workflowDetailTimelineLegendParallel')}</span>
          </span>
        </div>
        {/* 派生统计只在真实存在时渲染；预算是脚本配置，随「脚本」sheet 头部展示。 */}
        {timeline.peakConcurrency > 1 || timeline.savedMs > 0 ? (
          <div className="quickforge-workflow-detail-overview-row is-meta">
            {timeline.peakConcurrency > 1 ? <span>{t('workflowDetailPeakConcurrency', { count: timeline.peakConcurrency })}</span> : null}
            {timeline.savedMs > 0 ? <span>{t('workflowDetailSaved', { duration: formatDuration(timeline.savedMs) })}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="quickforge-workflow-detail-scroll" ref={scrollRef}>
        <TimelineAxis
          ticks={ticks}
          now={nowMs !== undefined ? {
            left: timelinePercent(nowMs, timeline.totalMs),
            label: t('workflowDetailNow', { duration: formatDuration(nowMs) }),
            title: t('workflowDetailNowTitle', {
              duration: formatDuration(nowMs),
              total: formatDuration(timeline.totalMs),
            }),
          } : undefined}
        />
        {run.error ? (
          <div className="quickforge-workflow-detail-error" role="alert">
            <span className="quickforge-workflow-detail-error-label">{t('workflowError')}</span>
            <span>{run.error}</span>
            <button type="button" className="quickforge-workflow-detail-error-jump" onClick={jumpToFailure}>
              {t('workflowDetailLocateFailure')}
            </button>
          </div>
        ) : null}
        {run.phases.length === 0 ? (
          <p className="quickforge-workflow-detail-empty">{t('workflowDetailNoPhases')}</p>
        ) : (
          <div className="quickforge-workflow-detail-phases">
            {/* 共享竖向网格（内部三条）+ 运行游标：垫在行之下/条形之上，
                展开体、日志块、吸顶头都有实底会自动遮线。 */}
            <div className="quickforge-workflow-detail-grid-layer" aria-hidden="true">
              {ticks.slice(1, -1).map((tick) => (
                <span
                  className="quickforge-workflow-detail-grid-line"
                  key={`grid-${tick.ratio}`}
                  style={{ left: `${tick.left}%` }}
                />
              ))}
            </div>
            {nowMs !== undefined ? (
              <div className="quickforge-workflow-detail-now-layer" aria-hidden="true">
                <span
                  className="quickforge-workflow-detail-now-line"
                  style={{ left: `${timelinePercent(nowMs, timeline.totalMs)}%` }}
                />
              </div>
            ) : null}
            {run.phases.map((phase, index) => (
              <PhaseSection
                key={`${phase.title}:${index}`}
                phase={phase}
                ordinal={index + 1}
                timeline={timeline}
                nowMs={nowMs}
                logOrigin={logOrigin}
                workflowRunId={run.runId}
                entryIndex={entryIndex}
              />
            ))}
          </div>
        )}
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
          {run.maxAgents > 0 || run.maxTools > 0 || run.concurrency > 0 ? (
            <div className="quickforge-workflow-detail-sheet-meta">
              {t('workflowDetailBudgetLine', {
                agents: run.maxAgents,
                tools: run.maxTools,
                concurrency: run.concurrency,
                duration: formatDuration(run.maxRuntimeMs),
              })}
            </div>
          ) : null}
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
