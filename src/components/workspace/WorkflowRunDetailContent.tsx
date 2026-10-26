import { useMemo, useRef, useState } from 'react'
import { Braces, ExternalLink, FileOutput, List } from 'lucide-react'
import { t } from '@/lib/i18n'
import { ToolMessage } from '@/components/chat/surface/ToolMessage'
import type { ToolCall, ToolResultMessage } from '@/components/chat/surface/ChatTypes'
import {
  OPEN_SUBAGENT_RUN_EVENT,
  canOpenSubagentRunPayload,
  resolveSubagentRunPayloadForOpen,
  shouldPublishSubagentRunPayload,
  subagentRunStore,
} from '@/lib/subagent-run-detail'
import { buildWorkflowSubagentRunPayload } from '@/lib/workflow-subagent-detail'
import {
  formatDuration,
  renderCodeBlock,
  renderStatusIcon,
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
  type WorkflowTimelineEntry,
  type WorkflowToolView,
} from '@/lib/workflow-run-detail'
import type { WorkflowRunPayload } from '@/lib/workflow-run-payload'

type WorkflowRunDetailContentProps = {
  payload?: WorkflowRunPayload
}

type EntryIndex = Map<string, WorkflowTimelineEntry>

function statusTone(status: WorkflowRunView['status']) {
  if (status === 'done') return 'done'
  if (status === 'error' || status === 'aborted') return 'error'
  return 'running'
}

function stepTone(status: WorkflowAgentView['status']) {
  if (status === 'done') return 'done'
  if (status === 'error' || status === 'aborted') return 'error'
  if (status === 'running') return 'running'
  return 'pending'
}

/**
 * 阶段状态点：运行中优先，其次错误，再次全 queued / 空阶段。
 * 混合 done + queued 表示阶段仍在推进，不能提前显示成 done。
 */
function phaseTone(phase: WorkflowPhaseView) {
  const steps = [...phase.agents, ...phase.tools]
  if (steps.some((step) => step.status === 'running')) return 'running'
  if (steps.some((step) => step.status === 'error' || step.status === 'aborted')) return 'error'
  if (steps.length === 0 || steps.every((step) => step.status === 'queued')) return 'pending'
  if (steps.some((step) => step.status === 'queued')) return 'running'
  return 'done'
}

function agentStatusIcon(status: WorkflowAgentView['status']) {
  if (status === 'queued') return renderStatusIcon('called')
  if (status === 'aborted') return renderStatusIcon('error')
  return renderStatusIcon(status)
}

// ---------------------------------------------------------------------------
// 详情 = 概览 + 阶段小节 + 步骤流 + 日志 + 底部操作。
//
// 不再绘制时间轴：没有刻度、条形、游标、网格与并行 bracket。步骤行只复用
// 聊天卡的摘要/展开能力；Agent 行是轻量入口，点击仍走原来的 store 快照 +
// OPEN_SUBAGENT_RUN_EVENT 打开子 Agent 运行详情，但不在 workflow 详情里显示
// subagent 的当前工具跑马灯或内部 trace。workflow 自己的 tool() 行仍保留在
// Agent 下方，用 1px 连接线表达从属关系。
// ---------------------------------------------------------------------------

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

type StepProps = {
  parallelCount?: number
}

/**
 * Agent 行：只呈现任务名、profile 与状态，点击打开对应子 Agent 运行详情。
 * 不复用 run_subagent 摘要卡的当前工具跑马灯/内部过程。
 */
function AgentStep({ agent, workflowRunId, parallelCount }: StepProps & { agent: WorkflowAgentView; workflowRunId: string }) {
  const existing = subagentRunStore.get(`${workflowRunId || 'workflow'}:agent:${agent.id}`)
  const payload = buildWorkflowSubagentRunPayload(workflowRunId, agent, t, { previous: existing })
  if (shouldPublishSubagentRunPayload(payload, existing)) subagentRunStore.publish(payload)
  const disabled = agent.status === 'queued' || !canOpenSubagentRunPayload(payload)
  const open = () => {
    if (disabled) return
    const payloadForOpen = resolveSubagentRunPayloadForOpen(payload, subagentRunStore.get(payload.runId))
    window.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_RUN_EVENT, {
      detail: { runId: payloadForOpen.runId, payload: payloadForOpen },
    }))
  }
  return (
    <div className="quickforge-workflow-detail-step" data-kind="agent" data-tone={stepTone(agent.status)}>
      <button
        type="button"
        className="quickforge-workflow-detail-agent"
        title={t('viewSubagentRunDetails')}
        aria-label={`${agent.label} · ${t('viewSubagentRunDetails')}`}
        disabled={disabled}
        onClick={open}
      >
        {renderToolIcon('run_subagent')}
        <span className="quickforge-workflow-detail-agent-label">{agent.label}</span>
        {agent.profile && agent.profile !== agent.label ? (
          <span className="quickforge-workflow-detail-agent-meta">· {agent.profile}</span>
        ) : null}
        {parallelCount ? (
          <span className="quickforge-workflow-detail-parallel-tag">
            {t('workflowDetailParallelCount', { count: parallelCount })}
          </span>
        ) : null}
        {agentStatusIcon(agent.status)}
        {disabled ? null : <ExternalLink className="quickforge-workflow-detail-agent-link" size={12} strokeWidth={1.8} aria-hidden="true" />}
      </button>
    </div>
  )
}

/** 工具行：直接渲染聊天工具卡；只有 workflow tool() 行是内联展开。 */
function ToolStep({ tool, parallelCount }: StepProps & { tool: WorkflowToolView }) {
  return (
    <div className="quickforge-workflow-detail-step" data-kind="tool" data-tone={stepTone(tool.status)}>
      <div className="quickforge-workflow-detail-tool-line">
        <ToolMessage
          toolCall={workflowToolCall(tool)}
          result={workflowToolResult(tool)}
          isStreaming={tool.status === 'running'}
        />
        {parallelCount ? (
          <span className="quickforge-workflow-detail-parallel-tag is-tool">
            {t('workflowDetailParallelCount', { count: parallelCount })}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** 阶段日志：默认收起；阶段里有错误时默认展开，错误只染消息文本。 */
function PhaseLogs({ logs, logOrigin }: { logs: WorkflowPhaseView['logs']; logOrigin: number }) {
  const [open, setOpen] = useState(() => logs.some((log) => log.level === 'error'))
  if (logs.length === 0) return null
  const hasError = logs.some((log) => log.level === 'error')
  return (
    <div className="quickforge-workflow-detail-phase-logs">
      <button
        type="button"
        className="quickforge-workflow-detail-logs-head"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <List className="quickforge-workflow-detail-logs-icon" size={12} strokeWidth={1.8} aria-hidden="true" />
        <span className="quickforge-workflow-detail-logs-label">{t('workflowDetailRunLogs')}</span>
        <span className="quickforge-workflow-detail-logs-count">{logs.length}</span>
        {hasError ? <i className="quickforge-workflow-detail-logs-flag" aria-hidden="true" /> : null}
        <span className="quickforge-workflow-detail-logs-chevron">{renderToolChevron()}</span>
      </button>
      {open ? (
        <ul className="quickforge-workflow-detail-logs-body">
          {logs.map((log, index) => (
            <li key={`${log.at}:${index}`} data-level={log.level}>
              <time>{formatDuration(Math.max(0, log.at - logOrigin))}</time>
              <span>{log.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function PhaseSection({
  phase,
  ordinal,
  logOrigin,
  workflowRunId,
  entryIndex,
}: {
  phase: WorkflowPhaseView
  ordinal: number
  logOrigin: number
  workflowRunId: string
  entryIndex: EntryIndex
}) {
  const [collapsed, setCollapsed] = useState(false)
  const steps = workflowPhaseSteps(phase)
  const tone = phaseTone(phase)
  const stepCount = phase.agents.length + phase.tools.length
  // 服务端理论上可能给出没有标题的阶段桶（日志/步骤的 phase 是空串）：
  // 合并成单页后这里就是「不属于任何阶段」的那一段，用专门的标题而不是「阶段 N」。
  const title = phase.title || t('workflowDetailRunLogs')
  const pending = tone === 'pending' && stepCount > 0
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
          <i className="quickforge-workflow-detail-phase-dot" data-tone={tone} aria-hidden="true" />
          <span className="quickforge-workflow-detail-phase-index">{String(ordinal).padStart(2, '0')}</span>
          <span className="quickforge-workflow-detail-phase-name" title={title}>{title}</span>
          <span className="quickforge-workflow-detail-phase-count">{t('workflowDetailStepCount', { count: stepCount })}</span>
          {pending ? <span className="quickforge-workflow-detail-phase-note">{t('workflowDetailPending')}</span> : null}
        </span>
        {renderToolChevron()}
      </button>
      {collapsed ? null : (
        <div className="quickforge-workflow-detail-phase-body">
          {steps.map((step, index) => {
            if (step.kind === 'agent') {
              const entry = entryIndex.get(`agent:${step.agent.id}`)
              return (
                <AgentStep
                  key={step.agent.id}
                  agent={step.agent}
                  workflowRunId={workflowRunId}
                  parallelCount={entry?.parallelGroupStart ? entry.parallelGroupSize : undefined}
                />
              )
            }
            // 只有前置 Agent 的 tool() 组才缩进 + 画连接线；阶段开头的 tool-only
            // 组没有可归属的 Agent，保持平铺（DESIGN_LANGUAGE 的例外约束）。
            const ownedByAgent = index > 0 && steps[index - 1]?.kind === 'agent'
            return (
              <div
                className="quickforge-workflow-detail-tools"
                data-owned={ownedByAgent ? 'true' : undefined}
                key={`tools:${step.tools[0].id}`}
              >
                {step.tools.map((tool, toolIndex) => {
                  const entry = entryIndex.get(`tool:${tool.id}`)
                  return (
                    <ToolStep
                      key={tool.id}
                      tool={tool}
                      parallelCount={toolIndex === 0 && entry?.parallelGroupStart ? entry.parallelGroupSize : undefined}
                    />
                  )
                })}
              </div>
            )
          })}
          <PhaseLogs logs={phase.logs} logOrigin={logOrigin} />
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 外壳
// ---------------------------------------------------------------------------

export function WorkflowRunDetailContent({ payload }: WorkflowRunDetailContentProps) {
  // 脚本是运行详情的主要阅读内容之一：payload 带 script 时默认展开脚本 sheet；
  // 用户点击底部按钮自行切换。
  const [sheet, setSheet] = useState<'script' | 'result' | undefined>(() => (payload?.script ? 'script' : undefined))
  const scrollRef = useRef<HTMLDivElement>(null)
  const timeline = useMemo(() => (payload ? workflowTimeline(payload.view) : undefined), [payload])

  if (!payload || !timeline) {
    return <div className="quickforge-workflow-detail-empty">{t('workflowDetailNoPhases')}</div>
  }

  const run = payload.view
  const tone = statusTone(run.status)
  const entryIndex: EntryIndex = new Map(timeline.entries.map((entry) => [entry.id, entry]))
  const logOrigin = run.runStartedAt ?? run.logs[0]?.at ?? 0
  const failedCount = run.failedAgentCount + run.failedToolCount
  const showFailureJump = !run.error && failedCount > 0
  const showMeta = timeline.peakConcurrency > 1 || timeline.savedMs > 0 || showFailureJump
  const toggleSheet = (next: 'script' | 'result') => {
    setSheet((current) => (current === next ? undefined : next))
  }

  // 「定位失败步骤」：展开所属阶段与该步的聊天工具卡（卡内的 details 是受控的，
  // 走原生 summary 点击让 onToggle 回写状态，不能直接改 open 属性；Agent 行没有
  // 展开体，只滚动 + 闪烁），滚动居中后对整个步骤行闪烁描边。
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
        </div>
        {showMeta ? (
          <div className="quickforge-workflow-detail-overview-row is-meta">
            {timeline.peakConcurrency > 1 ? <span>{t('workflowDetailPeakConcurrency', { count: timeline.peakConcurrency })}</span> : null}
            {timeline.savedMs > 0 ? <span>{t('workflowDetailSaved', { duration: formatDuration(timeline.savedMs) })}</span> : null}
            {showFailureJump ? (
              <button
                type="button"
                className="quickforge-workflow-detail-failure"
                title={t('workflowDetailLocateFailure')}
                onClick={jumpToFailure}
              >
                <i aria-hidden="true" />
                {t(failedCount === 1 ? 'workflowDetailFailedStepsOne' : 'workflowDetailFailedStepsMany', { count: failedCount })}
                <span>{t('workflowDetailLocate')}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="quickforge-workflow-detail-scroll" ref={scrollRef}>
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
            {run.phases.map((phase, index) => (
              <PhaseSection
                key={`${phase.title}:${index}`}
                phase={phase}
                ordinal={index + 1}
                logOrigin={logOrigin}
                workflowRunId={run.runId}
                entryIndex={entryIndex}
              />
            ))}
          </div>
        )}
      </div>

      {payload.script || run.resultPreview ? (
        <div className="quickforge-workflow-detail-foot">
          {payload.script ? (
            <button
              type="button"
              className="quickforge-workflow-detail-foot-btn"
              aria-expanded={sheet === 'script'}
              aria-controls="quickforge-workflow-detail-script-sheet"
              onClick={() => toggleSheet('script')}
            >
              <Braces size={12} strokeWidth={1.8} aria-hidden="true" />
              {t('workflowScript')}
            </button>
          ) : null}
          {run.resultPreview ? (
            <button
              type="button"
              className="quickforge-workflow-detail-foot-btn"
              aria-expanded={sheet === 'result'}
              aria-controls="quickforge-workflow-detail-result-sheet"
              onClick={() => toggleSheet('result')}
            >
              <FileOutput size={12} strokeWidth={1.8} aria-hidden="true" />
              {t('workflowResult')}
            </button>
          ) : null}
        </div>
      ) : null}

      {sheet === 'script' && payload.script ? (
        <div
          id="quickforge-workflow-detail-script-sheet"
          className="quickforge-workflow-detail-sheet"
          role="region"
          aria-label={t('workflowScript')}
        >
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
        <div
          id="quickforge-workflow-detail-result-sheet"
          className="quickforge-workflow-detail-sheet"
          role="region"
          aria-label={t('workflowResult')}
        >
          {renderCodeBlock(run.resultPreview, 'text')}
        </div>
      ) : null}
    </div>
  )
}

export type { WorkflowRunPayload }
