/* eslint-disable react-refresh/only-export-components -- the class renderer and its private helpers are intentionally colocated; they carry no HMR state contract. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { t } from '@/lib/i18n'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import {
  buildWorkflowRunView,
  isWorkflowErrorCollapsible,
  workflowStatusLabelKey,
  workflowSummaryText,
  type WorkflowRunView,
} from '@/lib/workflow-run-detail'
import {
  OPEN_WORKFLOW_RUN_EVENT,
  activeWorkflowRunStore,
  buildWorkflowRunPayload,
  shouldPublishWorkflowRunPayload,
  workflowRunStore,
} from '@/lib/workflow-run-payload'
import {
  renderStatus,
  renderToolIcon,
  renderToolMarquee,
  resultText,
  toolDisplayDetailed,
  type ToolResultLike,
  type ToolStatusKey,
} from './shared'

function workflowRenderStatus(view: ReturnType<typeof buildWorkflowRunView>): ToolStatusKey {
  if (!view) return 'called'
  if (view.status === 'error' || view.status === 'aborted') return 'error'
  if (view.status === 'running') return 'running'
  return 'done'
}

const subscribeActiveWorkflowRun = (onChange: () => void) => activeWorkflowRunStore.subscribe(onChange)

/**
 * 无 details 失败帧的错误块（审批拒绝、参数校验失败、worker 启动失败等）：
 * 错误原文可能很长（含「已完成步骤」清单），默认只露两行，长文本给展开按钮。
 */
function WorkflowFallbackError({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const collapsible = isWorkflowErrorCollapsible(text)
  const expanded = collapsible && open
  return (
    <div className="quickforge-workflow-error" role="alert" data-open={expanded ? 'true' : undefined}>
      <span className="quickforge-workflow-error-label">{t('workflowError')}</span>
      <span className="quickforge-workflow-error-text">{text}</span>
      {collapsible ? (
        <button
          type="button"
          className="quickforge-workflow-error-toggle"
          aria-expanded={expanded}
          onClick={() => setOpen((current) => !current)}
        >
          {t(expanded ? 'workflowErrorCollapse' : 'workflowErrorExpand')}
        </button>
      ) : null}
    </div>
  )
}

/**
 * 订阅「当前激活的工作流详情 Tab」，让卡片显示「已打开」。
 * 订阅的是极小广播器，而不是把 Inspector tab 状态提升为全局 store；
 * 用 useSyncExternalStore 直接读外部快照，避免 effect 里 setState 造成级联渲染。
 */
function useWorkflowRunOpened(runId: string) {
  const getSnapshot = useCallback(
    () => Boolean(runId) && activeWorkflowRunStore.get() === runId,
    [runId],
  )
  return useSyncExternalStore(subscribeActiveWorkflowRun, getSnapshot, getSnapshot)
}

/**
 * run_workflow 摘要卡：聊天区只保留一行状态，点击在右侧 Workspace Inspector 打开
 * 该次运行的详情 Tab（时间轴 / 阶段 / 日志）。
 *
 * 数据契约见 src/lib/workflow-run-detail.ts 与 src/lib/workflow-run-payload.ts；
 * 服务端 details 见 server/agent-workflow-runner.mjs。
 */
export class WorkflowToolRenderer {
  render(
    params: Record<string, unknown> | undefined,
    result: ToolResultLike | undefined,
    isStreaming?: boolean,
  ) {
    const view = buildWorkflowRunView(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const script = typeof params?.script === 'string' ? params.script : ''
    const detailed = toolDisplayDetailed()

    if (!view) {
      // A final result without workflow details (approval rejection, argument
      // validation, missing workspace/model) still needs to surface its error
      // text; only a result-less pending frame is "preparing".
      const fallbackError = result ? resultText(result) : ''
      const fallbackStatus: ToolStatusKey = result?.isError ? 'error' : 'done'
      return {
        isCustom: true,
        content: (
          <div className="quickforge-local-tool-shell quickforge-workflow-tool-shell">
            <div className="quickforge-workflow-preparing">
              {renderToolIcon('run_workflow')}
              <span>{t(result ? (result.isError ? 'workflowFailed' : 'workflowCompleted') : 'workflowPreparing')}</span>
              {result ? renderStatus(fallbackStatus, timing) : null}
            </div>
            {fallbackError ? <WorkflowFallbackError text={fallbackError} /> : null}
          </div>
        ),
      }
    }

    const status = workflowRenderStatus(view)
    const payload = buildWorkflowRunPayload({ runId: view.runId, view, script, detailed })

    return {
      isCustom: true,
      content: (
        <WorkflowRunCard
          view={view}
          payloadRunId={payload.runId}
          script={script}
          detailed={detailed}
          status={status}
          summaryText={workflowSummaryText(view, t)}
          running={view.status === 'running'}
          marqueeText={view.status === 'running' ? (view.phases[view.phases.length - 1]?.title ?? '') : ''}
          timing={timing}
        />
      ),
    }
  }
}

type WorkflowRunCardProps = {
  view: WorkflowRunView
  payloadRunId: string
  script: string
  detailed: boolean
  status: ToolStatusKey
  summaryText: string
  running: boolean
  marqueeText: string
  timing: ReturnType<typeof extractQuickForgeTiming>
}

function WorkflowRunCard({ view, payloadRunId, script, detailed, status, summaryText, running, marqueeText, timing }: WorkflowRunCardProps) {
  const opened = useWorkflowRunOpened(payloadRunId)

  // 聊天重渲染时回填 store：历史会话首帧、或 SSE 断连漏帧都能打开完整详情。
  useEffect(() => {
    const payload = buildWorkflowRunPayload({ runId: payloadRunId, view, script, detailed })
    const existing = workflowRunStore.get(payload.runId)
    if (shouldPublishWorkflowRunPayload(payload, existing)) workflowRunStore.publish(payload)
  }, [detailed, payloadRunId, script, view])

  const openRun = () => {
    const payload = buildWorkflowRunPayload({ runId: payloadRunId, view, script, detailed })
    const existing = workflowRunStore.get(payload.runId)
    if (shouldPublishWorkflowRunPayload(payload, existing)) workflowRunStore.publish(payload)
    window.dispatchEvent(new CustomEvent(OPEN_WORKFLOW_RUN_EVENT, { detail: { runId: payload.runId, payload } }))
  }

  return (
    <div className="quickforge-local-tool-shell quickforge-workflow-tool-shell">
      <button
        type="button"
        className="quickforge-workflow-card"
        data-open={opened ? 'true' : 'false'}
        aria-expanded={opened}
        aria-label={`${summaryText} · ${t(opened ? 'workflowDetailOpened' : 'workflowDetailOpenRun')}`}
        onClick={openRun}
      >
        {renderToolIcon('run_workflow')}
        <span className={running ? 'quickforge-workflow-title quickforge-tool-running-sweep' : 'quickforge-workflow-title'}>
          {summaryText}
        </span>
        {marqueeText ? renderToolMarquee(marqueeText, t(workflowStatusLabelKey(view.status)), 'quickforge-workflow-marquee') : null}
        {running ? null : renderStatus(status, timing)}
      </button>
    </div>
  )
}
