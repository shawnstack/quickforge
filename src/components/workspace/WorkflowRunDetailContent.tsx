import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import { disposeInputClampBoxes, syncInputClampBoxes, type InputClampLabels } from '@/lib/input-clamp'
import {
  ToolDetails,
  formatDuration,
  renderCodeBlock,
  renderConsoleBlock,
  renderToolChevron,
  renderToolIcon,
} from '@/lib/tool-renderers/shared'
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

// ---------------------------------------------------------------------------
// 单页合并视图：时间轴 / 阶段 / 日志原本是三份投影（同一份运行数据的甘特图、
// 阶段明细、日志流），切成三个分段 Tab 后必须点一下才能互相参照。现在合并成
// 一页连续滚动：整页共享一根时间轴（刻度条吸顶），每个阶段 = 粘性阶段头 +
// 该阶段的行（Agent 行带条形、工具行缩进）+ 该阶段自己的日志。
//
// 条形仍然用 DOM + 百分比定位（不用固定 viewBox 的 SVG：等比缩放会把字号一起
// 缩掉），标签列宽度 clamp 自适应，字号走消息字号基准。
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

/** 刻度条：吸顶在滚动容器顶部，与行轨道同列，保证刻度与条形对齐。 */
function TimelineAxis({ ticks }: { ticks: TimelineTick[] }) {
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
        </span>
      </span>
    </div>
  )
}

function StepTrack({ entry, ticks, totalMs }: { entry: WorkflowTimelineEntry; ticks: TimelineTick[]; totalMs: number }) {
  // 百分比：条形左偏移与宽度都以 totalMs 为分母；短调用保底 0.6%，避免消失。
  const toPercent = (offsetMs: number) => Math.min(100, (Math.max(0, offsetMs) / totalMs) * 100)
  const left = toPercent(entry.startOffsetMs)
  const width = Math.max(0.6, toPercent(entry.startOffsetMs + entry.durationMs) - left)
  return (
    <span className="quickforge-workflow-detail-row-track">
      <span className="quickforge-workflow-detail-row-plot">
        {ticks.map((tick) => (
          <span
            className="quickforge-workflow-detail-grid"
            key={`grid-${tick.ratio}`}
            style={{ left: `${tick.left}%` }}
            aria-hidden="true"
          />
        ))}
        <span
          className={`quickforge-workflow-detail-bar${entry.parallel ? ' is-parallel' : ''}`}
          data-tone={stepTone(entry.status)}
          data-kind={entry.kind}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        {/* 耗时与「并行」是绘图区的绝对定位子元素，不是条形的子元素：
            挂在条形上会随条形位置溢出轨道右侧而被面板裁掉。 */}
        {entry.durationMs > 0 ? (
          <span className="quickforge-workflow-detail-bar-value">{formatDuration(entry.durationMs)}</span>
        ) : null}
        {entry.parallel ? (
          <span className="quickforge-workflow-detail-parallel-tag">{t('workflowDetailParallelBadge')}</span>
        ) : null}
      </span>
    </span>
  )
}

type StepProps = {
  entry?: WorkflowTimelineEntry
  ticks: TimelineTick[]
  totalMs: number
  detailed: boolean
}

/**
 * 行首的类型图标：直接复用工具卡的 `renderToolIcon`（与聊天里的工具行 / subagent 行
 * 同一套图标），外层 span 只负责按状态着色。合并成单页后状态点与条形各表达一半
 * 信息，图标补上「这是哪种工具」，比原来的纯圆点信息量高且不增加行高。
 */
function StepIcon({ toolName, tone }: { toolName: string; tone: string }) {
  return <span className="quickforge-workflow-detail-row-icon" data-tone={tone}>{renderToolIcon(toolName)}</span>
}

/**
 * Agent 展开体里的任务说明块：与 SubagentRunDetailContent 顶部的任务块**同一套**
 * 结构（`.quickforge-subagent-task.quickforge-input-clamp` + `input-clamp` 控制器），
 * 长 prompt 超过六行时定高收起并给「展开」pill，不把整段任务说明平铺在时间轴上。
 */
const inputClampLabels: InputClampLabels = { collapsed: () => t('expand'), expanded: () => t('collapse') }

function AgentTaskBlock({ task, context, expectedOutput }: { task: string; context: string; expectedOutput: string }) {
  const root = useRef<HTMLDivElement>(null)
  // 只有这三段文本影响定高测量；依赖整个 agent 对象会在每帧实时快照上重测量导致抖动
  //（与 SubagentRunDetailContent 同一处坑）。
  useEffect(() => {
    const element = root.current
    if (!element) return
    syncInputClampBoxes(element, inputClampLabels)
    return () => disposeInputClampBoxes(element)
  }, [task, context, expectedOutput])

  return (
    <div ref={root}>
      <div className="quickforge-subagent-task quickforge-input-clamp" data-quickforge-input-clamp="true">
        <div className="space-y-1">
          {task ? <div><span className="font-medium">{t('subagentTask')}:</span> <span className="quickforge-subagent-task-value">{task}</span></div> : null}
          {context ? <div><span className="font-medium">{t('subagentContext')}:</span> <span className="quickforge-subagent-task-value">{context}</span></div> : null}
          {expectedOutput ? <div><span className="font-medium">{t('subagentExpectedOutput')}:</span> <span className="quickforge-subagent-task-value">{expectedOutput}</span></div> : null}
        </div>
      </div>
    </div>
  )
}

/** Agent 行：整行是 details 的 summary，展开后是该步的元信息、错误与结果。 */
function AgentStep({
  agent,
  entry,
  ticks,
  totalMs,
  detailed,
  workflowRunId,
  onOpenAgentRun,
}: StepProps & {
  agent: WorkflowAgentView
  workflowRunId: string
  onOpenAgentRun?: (workflowRunId: string, agent: WorkflowAgentView) => void
}) {
  const tone = stepTone(agent.status)
  const meta = [
    agent.profile,
    agent.toolCalls > 0 ? t('workflowAgentToolCalls', { count: agent.toolCalls }) : '',
    agent.schemaValidated ? t('workflowAgentSchema') : '',
  ].filter(Boolean).join(' · ')
  const status = agentStatusText(agent)
  const openable = Boolean(onOpenAgentRun) && agent.status !== 'queued'
  return (
    // 复用 ToolDetails：开合状态按 stateKey 记忆（展开过的 Agent 关掉面板再打开仍展开），
    // 与工具卡同一套 LRU 记忆，不再每次渲染都回到折叠态。
    <ToolDetails
      className="quickforge-workflow-detail-step group/tool"
      data-kind="agent"
      data-tone={tone}
      initiallyOpen={false}
      stateKey={`workflow:${workflowRunId}:agent:${agent.id}`}
    >
      <summary className="quickforge-workflow-detail-row" title={agent.error ? `${agent.label}: ${agent.error}` : agent.label}>
        <span className="quickforge-workflow-detail-row-head">
          <StepIcon toolName="run_subagent" tone={tone} />
          <span className={`quickforge-workflow-detail-row-label${agent.status === 'running' ? ' quickforge-tool-running-sweep' : ''}`}>
            {agent.label}
          </span>
          {renderToolChevron()}
        </span>
        {entry ? <StepTrack entry={entry} ticks={ticks} totalMs={totalMs} /> : <span className="quickforge-workflow-detail-row-track" />}
      </summary>
      <div className="quickforge-workflow-detail-step-body">
        {agent.promptPreview || agent.context || agent.expectedOutput ? (
          <AgentTaskBlock task={agent.promptPreview} context={agent.context} expectedOutput={agent.expectedOutput} />
        ) : null}
        {meta ? <div className="quickforge-workflow-detail-step-meta">{meta}</div> : null}
        {agent.error ? <div className="quickforge-workflow-detail-error-text">{agent.error}</div> : null}
        {detailed && agent.resultPreview ? (
          <div>
            <div className="quickforge-workflow-detail-field-label">{t('workflowToolResult')}</div>
            {renderCodeBlock(agent.resultPreview, 'text')}
          </div>
        ) : null}
        {status && !agent.error ? <span className="quickforge-workflow-detail-sr">{status}</span> : null}
        {openable ? (
          <div className="quickforge-workflow-detail-step-actions">
            <button
              type="button"
              className="quickforge-workflow-detail-agent-open"
              onClick={() => onOpenAgentRun?.(workflowRunId, agent)}
            >
              {t('workflowDetailOpenAgentDetails')}
            </button>
          </div>
        ) : null}
        {!meta && !agent.error && !(detailed && agent.resultPreview) ? (
          <div className="quickforge-workflow-detail-field-label">{status || t('workflowDetailPending')}</div>
        ) : null}
      </div>
    </ToolDetails>
  )
}

/** 工具行：Agent 的子级，展开后是入参 / 输出 / 错误（run_command 输出走共享控制台块）。 */
function ToolStep({
  tool,
  entry,
  ticks,
  totalMs,
  detailed,
  workflowRunId,
}: StepProps & { tool: WorkflowToolView; workflowRunId: string }) {
  const name = tool.label || tool.name
  const tone = stepTone(tool.status)
  const argsPreview = detailed && tool.args ? JSON.stringify(tool.args) : ''
  return (
    <ToolDetails
      className="quickforge-workflow-detail-step group/tool"
      data-kind="tool"
      data-tone={tone}
      initiallyOpen={false}
      stateKey={`workflow:${workflowRunId}:tool:${tool.id}`}
    >
      <summary className="quickforge-workflow-detail-row" title={tool.error ? `${name}: ${tool.error}` : name}>
        <span className="quickforge-workflow-detail-row-head">
          <StepIcon toolName={tool.name} tone={tone} />
          <span className="quickforge-workflow-detail-row-label">{name}</span>
          {renderToolChevron()}
        </span>
        {entry ? <StepTrack entry={entry} ticks={ticks} totalMs={totalMs} /> : <span className="quickforge-workflow-detail-row-track" />}
      </summary>
      <div className="quickforge-workflow-detail-step-body">
        {argsPreview ? (
          <div>
            <div className="quickforge-workflow-detail-field-label">{t('input')}</div>
            {renderCodeBlock(argsPreview, 'json')}
          </div>
        ) : null}
        {tool.resultPreview ? (
          <div>
            <div className="quickforge-workflow-detail-field-label">{t('output')}</div>
            {/* 命令输出复用聊天工具卡的同一块控制台渲染（等宽 + 复制按钮）。 */}
            {tool.name === 'run_command'
              ? renderConsoleBlock(tool.resultPreview, tool.status === 'error' ? 'error' : 'default')
              : renderCodeBlock(tool.resultPreview, 'text')}
          </div>
        ) : null}
        {tool.error ? <div className="quickforge-workflow-detail-error-text">{tool.error}</div> : null}
        {!argsPreview && !tool.resultPreview && !tool.error ? (
          <div className="quickforge-workflow-detail-field-label">{toolStatusText(tool) || t('workflowDetailPending')}</div>
        ) : null}
      </div>
    </ToolDetails>
  )
}

/** 阶段小节：粘性阶段头 + 该阶段的行 + 该阶段自己的日志（日志带 phase，永远有归属）。 */
function PhaseSection({
  phase,
  ordinal,
  ticks,
  totalMs,
  logOrigin,
  detailed,
  workflowRunId,
  entryIndex,
  onOpenAgentRun,
}: StepProps & {
  phase: WorkflowPhaseView
  ordinal: number
  logOrigin: number
  workflowRunId: string
  entryIndex: EntryIndex
  onOpenAgentRun?: (workflowRunId: string, agent: WorkflowAgentView) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const steps = workflowPhaseSteps(phase)
  const entries = [
    ...phase.agents.map((agent) => entryIndex.get(`agent:${agent.id}`)),
    ...phase.tools.map((tool) => entryIndex.get(`tool:${tool.id}`)),
  ].filter((entry): entry is WorkflowTimelineEntry => Boolean(entry))
  const spanMs = entries.length > 0
    ? Math.max(...entries.map((entry) => entry.startOffsetMs + entry.durationMs))
      - Math.min(...entries.map((entry) => entry.startOffsetMs))
    : 0
  const stepCount = phase.agents.length + phase.tools.length
  // 服务端理论上可能给出没有标题的阶段桶（日志/步骤的 phase 是空串）：
  // 合并成单页后这里就是「不属于任何阶段」的那一段，用专门的标题而不是「阶段 N」。
  const title = phase.title || t('workflowDetailRunLogs')
  return (
    <section className="quickforge-workflow-detail-phase" data-tone={phaseTone(phase)}>
      <button
        type="button"
        className="quickforge-workflow-detail-phase-head"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span className="quickforge-workflow-detail-phase-index">{String(ordinal).padStart(2, '0')}</span>
        <span className="quickforge-workflow-detail-phase-name" title={title}>{title}</span>
        <span className="quickforge-workflow-detail-phase-count">{t('workflowDetailStepCount', { count: stepCount })}</span>
        {spanMs > 0 ? <span className="quickforge-workflow-detail-duration">{formatDuration(spanMs)}</span> : null}
        {renderToolChevron()}
      </button>
      {collapsed ? null : (
        <div className="quickforge-workflow-detail-phase-body">
          {steps.map((step) => step.kind === 'agent' ? (
            <AgentStep
              key={step.agent.id}
              agent={step.agent}
              entry={entryIndex.get(`agent:${step.agent.id}`)}
              ticks={ticks}
              totalMs={totalMs}
              detailed={detailed}
              workflowRunId={workflowRunId}
              onOpenAgentRun={onOpenAgentRun}
            />
          ) : (
            <div className="quickforge-workflow-detail-tools" key={`tools:${step.tools[0].id}`}>
              {step.tools.map((tool) => (
                <ToolStep
                  key={tool.id}
                  tool={tool}
                  entry={entryIndex.get(`tool:${tool.id}`)}
                  ticks={ticks}
                  totalMs={totalMs}
                  detailed={detailed}
                  workflowRunId={workflowRunId}
                />
              ))}
            </div>
          ))}
          {phase.logs.length > 0 ? (
            <ul className="quickforge-workflow-detail-phase-logs">
              {phase.logs.map((log, logIndex) => (
                <li key={`${log.at}:${logIndex}`} data-level={log.level}>
                  <time>{formatDuration(Math.max(0, log.at - logOrigin))}</time>
                  <span>{log.message}</span>
                </li>
              ))}
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

export function WorkflowRunDetailContent({ payload, onOpenAgentRun }: WorkflowRunDetailContentProps) {
  const [sheet, setSheet] = useState<'script' | 'result' | undefined>(undefined)
  const timeline = useMemo(() => (payload ? workflowTimeline(payload.view) : undefined), [payload])

  if (!payload || !timeline) {
    return <div className="quickforge-workflow-detail-empty">{t('workflowDetailNoPhases')}</div>
  }

  const run = payload.view
  const tone = statusTone(run.status)
  const ticks = timelineTicks(timeline)
  const entryIndex: EntryIndex = new Map(timeline.entries.map((entry) => [entry.id, entry]))
  const logOrigin = run.runStartedAt ?? run.logs[0]?.at ?? 0

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
          {/* 图例整页共享一套编码，随概览条常驻，不再挂在某一视图底部。 */}
          <span className="quickforge-workflow-detail-legend">
            <span><i className="swatch" data-tone="agent" />{t('workflowDetailTimelineLegendAgent')}</span>
            <span><i className="swatch" data-tone="tool" />{t('workflowDetailTimelineLegendTool')}</span>
            <span><i className="swatch" data-tone="parallel" />{t('workflowDetailTimelineLegendParallel')}</span>
          </span>
        </div>
      </div>

      <div className="quickforge-workflow-detail-scroll">
        <TimelineAxis ticks={ticks} />
        {run.error ? (
          <div className="quickforge-workflow-detail-error" role="alert">
            <span className="quickforge-workflow-detail-error-label">{t('workflowError')}</span>
            <span>{run.error}</span>
          </div>
        ) : null}
        {run.phases.length === 0 ? (
          <p className="quickforge-workflow-detail-empty">{t('workflowDetailNoPhases')}</p>
        ) : (
          <div className="quickforge-workflow-detail-phases">
            {run.phases.map((phase, index) => (
              <PhaseSection
                key={`${phase.title}:${index}`}
                phase={phase}
                ordinal={index + 1}
                ticks={ticks}
                totalMs={timeline.totalMs}
                logOrigin={logOrigin}
                detailed={payload.detailed}
                workflowRunId={run.runId}
                entryIndex={entryIndex}
                onOpenAgentRun={onOpenAgentRun}
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
