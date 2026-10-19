/* eslint-disable react-refresh/only-export-components -- the class renderer and its private row components are intentionally colocated; they carry no HMR state contract. */
import { ExternalLink } from 'lucide-react'
import { t, type AppTextKey } from '@/lib/i18n'
import { summarizeParams } from '@/lib/tool-param-summary'
import { OPEN_SUBAGENT_RUN_EVENT, subagentRunStore } from '@/lib/subagent-run-detail'
import { buildWorkflowSubagentRunPayload } from '@/lib/workflow-subagent-detail'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import {
  buildWorkflowRunView,
  formatWorkflowDuration,
  workflowActiveStepLabels,
  workflowAgentStatusKey,
  workflowCurrentPhase,
  workflowStatusLabelKey,
  workflowSummaryKey,
  type WorkflowAgentView,
  type WorkflowToolView,
} from '@/lib/workflow-run-detail'
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

function WorkflowStepChevron() {
  return (
    <svg className="quickforge-workflow-step-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function openWorkflowAgentRun(workflowRunId: string, agent: WorkflowAgentView) {
  const payload = buildWorkflowSubagentRunPayload(workflowRunId, agent, t)
  subagentRunStore.publish(payload)
  window.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_RUN_EVENT, {
    detail: { runId: payload.runId, payload },
  }))
}

function WorkflowAgentRow({ agent, detailed, workflowRunId }: { agent: WorkflowAgentView; detailed: boolean; workflowRunId: string }) {
  return (
    <li className={`quickforge-workflow-agent quickforge-workflow-agent--${agent.status}`}>
      <details
        className="quickforge-workflow-step-details"
        aria-busy={agent.status === 'running' ? 'true' : undefined}
      >
        <summary className="quickforge-workflow-step-summary" title={agent.error || agent.label}>
          <span className={`quickforge-workflow-agent-dot quickforge-workflow-agent-dot--${agent.status}`} aria-hidden="true" />
          <span className="sr-only">{t(workflowAgentStatusKey(agent.status))}</span>
          <span className="quickforge-workflow-agent-label">{agent.label}</span>
          <span className="quickforge-workflow-agent-meta">
            {agent.profile ? <span className="quickforge-workflow-agent-profile">{agent.profile}</span> : null}
            {agent.toolCalls > 0 ? <span>{t('workflowAgentToolCalls', { count: agent.toolCalls })}</span> : null}
            {agent.durationMs > 0 ? <span>{formatWorkflowDuration(agent.durationMs)}</span> : null}
            {agent.schemaValidated ? <span>{t('workflowAgentSchema')}</span> : null}
          </span>
          <span
            className="quickforge-workflow-step-action"
            role="button"
            tabIndex={0}
            title={t('viewSubagentRunDetails')}
            aria-label={t('viewSubagentRunDetails')}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openWorkflowAgentRun(workflowRunId, agent)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              openWorkflowAgentRun(workflowRunId, agent)
            }}
          >
            <ExternalLink size={12} aria-hidden="true" />
          </span>
          <WorkflowStepChevron />
        </summary>
        <div className="quickforge-workflow-step-body">
          <button
            type="button"
            className="quickforge-workflow-step-open"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openWorkflowAgentRun(workflowRunId, agent)
            }}
          >
            <ExternalLink size={12} aria-hidden="true" />
            <span>{t('viewSubagentRunDetails')}</span>
          </button>
          {detailed && agent.promptPreview ? (
            <div>
              <div className="quickforge-workflow-step-section-label">{t('workflowAgentTask')}</div>
              {renderCodeBlock(agent.promptPreview, 'text')}
            </div>
          ) : null}
          {agent.resultPreview ? (
            <div>
              <div className="quickforge-workflow-step-section-label">{t('workflowToolResult')}</div>
              <pre className="quickforge-workflow-agent-result" title={agent.resultPreview}>{agent.resultPreview}</pre>
            </div>
          ) : null}
          {agent.error ? <div className="quickforge-workflow-agent-error">{agent.error}</div> : null}
        </div>
      </details>
    </li>
  )
}

function WorkflowToolCallRow({ tool, detailed }: { tool: WorkflowToolView; detailed: boolean }) {
  const summary = workflowToolSummary(tool)
  return (
    <li className={`quickforge-workflow-tool-call quickforge-workflow-tool-call--${tool.status}`}>
      <details
        className="quickforge-workflow-step-details"
        aria-busy={tool.status === 'running' ? 'true' : undefined}
      >
        <summary
          className="quickforge-workflow-tool-call-summary quickforge-workflow-step-summary"
          title={tool.error ? `${summary || workflowToolDisplayName(tool)}: ${tool.error}` : (summary || workflowToolDisplayName(tool))}
        >
          {renderToolIcon(tool.name)}
          <span className="quickforge-workflow-tool-call-name" title={tool.name}>{workflowToolDisplayName(tool)}</span>
          {summary ? <span className="quickforge-workflow-tool-call-args" title={summary}>{summary}</span> : null}
          <span className="quickforge-workflow-tool-call-meta">
            {tool.durationMs > 0 ? <span>{formatWorkflowDuration(tool.durationMs)}</span> : null}
            <span className={`quickforge-workflow-agent-dot quickforge-workflow-agent-dot--${tool.status}`} aria-hidden="true" />
            <span className="sr-only">{t(workflowAgentStatusKey(tool.status))}</span>
          </span>
          <WorkflowStepChevron />
        </summary>
        <div className="quickforge-workflow-step-body">
          {detailed && tool.args ? (
            <div>
              <div className="quickforge-workflow-step-section-label">{t('workflowToolParams')}</div>
              {renderCodeBlock(stringifyValue(tool.args), 'json')}
            </div>
          ) : detailed && tool.argsPreview ? (
            <div>
              <div className="quickforge-workflow-step-section-label">{t('workflowToolParams')}</div>
              {renderCodeBlock(tool.argsPreview, 'json')}
            </div>
          ) : null}
          {tool.resultPreview ? (
            <div>
              <div className="quickforge-workflow-step-section-label">{t('workflowToolResult')}</div>
              {tool.name === 'run_command'
                ? renderConsoleBlock(tool.resultPreview, tool.status === 'error' ? 'error' : 'default')
                : renderCodeBlock(tool.resultPreview, 'text')}
            </div>
          ) : null}
          {tool.error ? <div className="quickforge-workflow-tool-call-error">{tool.error}</div> : null}
        </div>
      </details>
    </li>
  )
}

/**
 * run_workflow 摘要卡：折叠头一行状态 + Agent/工具计数，运行中把当前阶段或
 * 正在执行的步骤放进跑马灯；展开体按 phase 分组，按提交顺序交错展示 Agent 与
 * 工具调用。工具行复用 QuickForge 工具卡的图标、摘要、折叠与状态语义。
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
                            ? <WorkflowAgentRow agent={step.agent} detailed={detailed} workflowRunId={view.runId} key={step.agent.id} />
                            : <WorkflowToolCallRow tool={step.tool} detailed={detailed} key={step.tool.id} />
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
                <div className="quickforge-workflow-result-section">
                  <div className="mb-1 font-medium text-muted-foreground">
                    {t('workflowResult')}
                    {view.resultsTruncated ? ` · ${t('workflowResultTruncated')}` : ''}
                  </div>
                  <pre className="quickforge-workflow-result" title={view.resultPreview}>{view.resultPreview}</pre>
                </div>
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
