/* eslint-disable react-refresh/only-export-components -- the class renderer and its private row components are intentionally colocated; they carry no HMR state contract. */
import { useEffect } from 'react'
import { t, type AppTextKey } from '@/lib/i18n'
import { summarizeParams } from '@/lib/tool-param-summary'
import { shouldPublishSubagentRunPayload, subagentRunStore } from '@/lib/subagent-run-detail'
import { buildWorkflowSubagentRunPayload } from '@/lib/workflow-subagent-detail'
import { extractQuickForgeTiming, type QuickForgeToolTiming } from '@/lib/tool-execution-events'
import {
  buildWorkflowRunView,
  workflowActiveStepLabels,
  workflowCurrentPhase,
  workflowStatusLabelKey,
  workflowSummaryKey,
  type WorkflowAgentView,
  type WorkflowToolView,
} from '@/lib/workflow-run-detail'
import { renderSubagentRunSummary } from './subagent-tool-renderer'
import {
  ToolDetails,
  renderCodeBlock,
  renderConsoleBlock,
  renderStatus,
  renderToolChevron,
  renderToolIcon,
  renderToolMarquee,
  resultText,
  stringifyValue,
  toolDisplayDetailed,
  type ToolResultLike,
  type ToolStatusKey,
} from './shared'

const WORKFLOW_TOOL_LABEL_KEYS: Partial<Record<string, AppTextKey>> = {
  manage_global_memory: 'manageGlobalMemory',
  read_file: 'readFile',
  grep_files: 'searchFiles',
  write_file: 'writeFile',
  edit_file: 'editFile',
  run_command: 'runCommand',
  present_files: 'presentFiles',
  activate_skill: 'activateSkill',
  read_skill_resource: 'readSkillResource',
}

function workflowRenderStatus(view: ReturnType<typeof buildWorkflowRunView>): ToolStatusKey {
  if (!view) return 'called'
  if (view.status === 'error' || view.status === 'aborted') return 'error'
  if (view.status === 'running') return 'running'
  return 'done'
}

function workflowToolDisplayName(tool: WorkflowToolView) {
  if (tool.label && tool.label !== tool.name) return tool.label
  const key = WORKFLOW_TOOL_LABEL_KEYS[tool.name]
  return key ? t(key) : tool.name
}

function workflowToolSummary(tool: WorkflowToolView) {
  const summary = tool.args ? summarizeParams(tool.name, tool.args) : ''
  return summary || tool.argsPreview || ''
}

function workflowStepStatus(status: WorkflowToolView['status']): ToolStatusKey {
  if (status === 'error' || status === 'aborted') return 'error'
  if (status === 'running' || status === 'queued') return 'running'
  if (status === 'done') return 'done'
  return 'called'
}

function workflowStepTiming(durationMs: number, status: ToolStatusKey): QuickForgeToolTiming | undefined {
  if (durationMs > 0) return { durationMs }
  if (status === 'running') return { startedAt: Date.now() }
  return undefined
}

/** 内层行的开合记忆独立于外层 run_workflow 卡（同一 `.qf-tool-message` 宿主）。 */
function workflowToolStateKey(workflowRunId: string, toolId: string) {
  return workflowRunId ? `workflow:${workflowRunId}:tool:${toolId}` : ''
}

function WorkflowAgentRow({ agent, workflowRunId }: { agent: WorkflowAgentView; workflowRunId: string }) {
  const runId = `${workflowRunId || 'workflow'}:agent:${agent.id}`
  // 与服务端实时发布共用同一套载荷推导；store 已有更完整 trace 时回填，避免
  // 运行中被预算裁掉一帧后卡片跑马灯/状态闪空。
  const payload = buildWorkflowSubagentRunPayload(workflowRunId, agent, t, {
    previous: subagentRunStore.get(runId),
  })
  // 与 run_subagent 渲染回填同契约：历史首帧或“store 仍是 running、渲染帧已终态”
  // （SSE 断连漏掉结束帧）时修正 store，已打开的 Inspector Tab 随之转为终态；
  // 已有终态不被覆盖，保持 SSE 路径权威。
  useEffect(() => {
    const existing = subagentRunStore.get(payload.runId)
    if (shouldPublishSubagentRunPayload(payload, existing)) subagentRunStore.publish(payload)
  }, [payload])
  const meta = [
    agent.profile,
    agent.toolCalls > 0 ? t('workflowAgentToolCalls', { count: agent.toolCalls }) : '',
    agent.schemaValidated ? t('workflowAgentSchema') : '',
  ].filter(Boolean).join(' · ')
  return (
    <li className={`quickforge-workflow-agent quickforge-workflow-agent--${agent.status}`}>
      {/* 与 run_subagent 摘要卡共用同一渲染函数：状态/耗时/跑马灯/打开事件不再各写一份。 */}
      {renderSubagentRunSummary(payload, {
        ...(meta ? { meta } : {}),
        // 悬停文案额外带上 Agent 错误；run_subagent 没有记录级 error，保持其默认文案。
        ...(agent.error ? { title: `${t('viewSubagentRunDetails')}: ${agent.error}` } : {}),
        onOpen: (payloadForOpen) => {
          // 历史恢复/首帧或终态修正时把载荷写回 store，后续点击/订阅复用。
          const existing = subagentRunStore.get(payloadForOpen.runId)
          if (shouldPublishSubagentRunPayload(payloadForOpen, existing)) subagentRunStore.publish(payloadForOpen)
        },
      })}
    </li>
  )
}

function WorkflowToolCallRow({ tool, detailed, workflowRunId }: { tool: WorkflowToolView; detailed: boolean; workflowRunId: string }) {
  const summary = workflowToolSummary(tool)
  const status = workflowStepStatus(tool.status)
  const name = workflowToolDisplayName(tool)
  const input = detailed
    ? (tool.args ? stringifyValue(tool.args) : tool.argsPreview)
    : ''
  return (
    <li className={`quickforge-workflow-tool-call quickforge-workflow-tool-call--${tool.status}`}>
      <div className="quickforge-local-tool-shell">
        <ToolDetails
          className="group/tool quickforge-local-tool"
          initiallyOpen={false}
          stateKey={workflowToolStateKey(workflowRunId, tool.id)}
          aria-busy={status === 'running' ? 'true' : undefined}
        >
          <summary
            className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none"
            title={tool.error ? `${summary || name}: ${tool.error}` : (summary || name)}
          >
            {renderToolIcon(tool.name)}
            <span className="quickforge-tool-title min-w-0">
              <span className={status === 'running' ? 'quickforge-tool-label quickforge-tool-running-sweep' : 'quickforge-tool-label'}>
                {name}
                {summary ? <span className="quickforge-tool-summary-detail text-muted-foreground"> · <span className="quickforge-command-summary">{summary}</span></span> : null}
              </span>
              {renderToolChevron()}
              {status === 'running' ? null : renderStatus(status, workflowStepTiming(tool.durationMs, status))}
            </span>
          </summary>
          <div className="mt-3 min-w-0 max-w-full space-y-3">
            {input ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(input, 'json')}</div> : null}
            {tool.resultPreview ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{t('output')}</div>
                {tool.name === 'run_command'
                  ? renderConsoleBlock(tool.resultPreview, tool.status === 'error' ? 'error' : 'default')
                  : renderCodeBlock(tool.resultPreview, 'text')}
              </div>
            ) : null}
            {tool.error ? <div className="quickforge-workflow-tool-call-error">{tool.error}</div> : null}
          </div>
        </ToolDetails>
      </div>
    </li>
  )
}

/**
 * run_workflow 摘要卡：折叠头一行状态 + Agent/工具计数，运行中把当前阶段或
 * 正在执行的步骤放进跑马灯；展开体按 phase 分组，按提交顺序交错展示 Agent 与
 * 工具调用。工具行与外部普通工具卡同构（图标 + 名称 · 参数 + chevron +
 * 状态/耗时，点击展开 input/output）；Agent 行与外部 run_subagent 同构
 *（整行点击打开运行详情，运行中显示当前工具跑马灯）。
 * 数据契约见 src/lib/workflow-run-detail.ts，服务端 details 见
 * server/agent-workflow-runner.mjs。
 */
export class WorkflowToolRenderer {
  render(
    params: Record<string, unknown> | undefined,
    result: ToolResultLike | undefined,
    isStreaming?: boolean,
  ) {
    const view = buildWorkflowRunView(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const detailed = toolDisplayDetailed()
    const script = typeof params?.script === 'string' ? params.script : ''
    const details = detailed ? stringifyValue(result?.details) : ''

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
            {fallbackError ? (
              <div className="quickforge-workflow-error" role="alert">
                <span className="quickforge-workflow-error-label">{t('workflowError')}</span>
                <span>{fallbackError}</span>
              </div>
            ) : null}
          </div>
        ),
      }
    }

    const currentPhase = workflowCurrentPhase(view)
    const activeSteps = workflowActiveStepLabels(view)
    const marqueeText = activeSteps.length > 0
      ? activeSteps.join(' · ')
      : view.status === 'running' && currentPhase
        ? t('workflowCurrentPhase', { phase: currentPhase })
        : ''
    const status = workflowRenderStatus(view)
    const summaryParams = {
      agents: t(view.agentCount === 1 ? 'workflowAgentCountOne' : 'workflowAgentCountMany', { count: view.agentCount }),
      tools: t(view.toolCount === 1 ? 'workflowToolCountOne' : 'workflowToolCountMany', { count: view.toolCount }),
    }

    return {
      isCustom: true,
      content: (
        <div className="quickforge-local-tool-shell quickforge-workflow-tool-shell">
          <ToolDetails
            className="group/tool quickforge-local-tool quickforge-workflow-tool"
            initiallyOpen={false}
            aria-busy={view.status === 'running' ? 'true' : undefined}
          >
            <summary className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              {renderToolIcon('run_workflow')}
              <span className="quickforge-tool-title quickforge-workflow-title min-w-0">
                <span className={view.status === 'running' ? 'quickforge-tool-label quickforge-tool-running-sweep' : 'quickforge-tool-label'}>
                  {t(workflowSummaryKey(view), summaryParams)}
                </span>
                {marqueeText ? renderToolMarquee(marqueeText, t(workflowStatusLabelKey(view.status)), 'quickforge-workflow-marquee') : null}
                {renderToolChevron()}
                {view.status === 'running' ? null : renderStatus(status, timing)}
              </span>
            </summary>
            <div className="mt-3 space-y-3 text-xs">
              {view.error ? (
                <div className="quickforge-workflow-error" role="alert">
                  <span className="quickforge-workflow-error-label">{t('workflowError')}</span>
                  <span>{view.error}</span>
                </div>
              ) : null}
              {view.phases.length === 0 ? (
                <div className="quickforge-workflow-empty">{t('workflowNoAgents')}</div>
              ) : view.phases.map((phase, phaseIndex) => {
                const steps = [
                  ...phase.agents.map((agent) => ({ kind: 'agent' as const, seq: agent.seq, agent })),
                  ...phase.tools.map((tool) => ({ kind: 'tool' as const, seq: tool.seq, tool })),
                ].sort((left, right) => left.seq - right.seq)
                return (
                  <section className="quickforge-workflow-phase" key={`${phase.title}:${phaseIndex}`}>
                    {phase.title ? <div className="quickforge-workflow-phase-title">{phase.title}</div> : null}
                    {steps.length > 0 ? (
                      <ul className="quickforge-workflow-agent-list">
                        {steps.map((step) => (
                          step.kind === 'agent'
                            ? <WorkflowAgentRow agent={step.agent} workflowRunId={view.runId} key={step.agent.id} />
                            : <WorkflowToolCallRow tool={step.tool} detailed={detailed} workflowRunId={view.runId} key={step.tool.id} />
                        ))}
                      </ul>
                    ) : null}
                    {phase.logs.length > 0 ? (
                      <ul className="quickforge-workflow-log-list">
                        {phase.logs.map((log, logIndex) => (
                          <li className={`quickforge-workflow-log quickforge-workflow-log--${log.level}`} key={`${log.at}:${logIndex}`}>
                            {log.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                )
              })}
              {view.resultPreview ? (
                <details className="quickforge-workflow-result-section">
                  <summary className="cursor-pointer list-none text-muted-foreground select-none">
                    {t('workflowResult')}
                    {view.resultsTruncated ? ` · ${t('workflowResultTruncated')}` : ''}
                  </summary>
                  <pre className="quickforge-workflow-result" title={view.resultPreview}>{view.resultPreview}</pre>
                </details>
              ) : null}
              {detailed && script ? (
                <details className="quickforge-workflow-script">
                  <summary className="cursor-pointer list-none text-muted-foreground select-none">{t('workflowScript')}</summary>
                  <div className="mt-2">{renderCodeBlock(script, 'javascript')}</div>
                </details>
              ) : null}
              {details ? (
                <div>
                  <div className="mb-1 font-medium text-muted-foreground">{t('details')}</div>
                  {renderCodeBlock(details, 'json')}
                </div>
              ) : null}
            </div>
          </ToolDetails>
        </div>
      ),
    }
  }
}
