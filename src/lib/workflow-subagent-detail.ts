import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { subagentProcessTraceMessages } from '@/lib/subagent-process-trace'
import {
  subagentRunError,
  subagentRunFingerprint,
  subagentRunStatus,
  type SubagentRunI18n,
  type SubagentRunPayload,
  type SubagentToolDisplayMode,
  type ToolResultLike,
} from '@/lib/subagent-run-detail'
import type { WorkflowAgentView } from '@/lib/workflow-run-detail'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

type BuildWorkflowSubagentRunPayloadOptions = {
  /** 与聊天卡片使用同一显示模式；默认读全局缓存。 */
  toolDisplayMode?: SubagentToolDisplayMode
  /**
   * 上一次实时快照。服务端 details 预算会整体裁掉 subagentRun（或压缩掉消息），
   * 运行中/终态帧缺 trace 时用它回填，避免详情页闪空或永久丢过程——与
   * run_subagent 的 previousPayload 回填语义一致。
   */
  previous?: SubagentRunPayload
}

/**
 * Build the same `SubagentRunPayload` shape the run_subagent card opens in the
 * Workspace Inspector, from a workflow agent record. Status and error text use
 * the same derivation as run_subagent (trace terminal state → output → details),
 * while workflow metadata (tool count, bounded trace) stays authoritative.
 */
export function buildWorkflowSubagentRunPayload(
  workflowRunId: string,
  agent: WorkflowAgentView,
  t: SubagentRunI18n,
  options: BuildWorkflowSubagentRunPayloadOptions = {},
): SubagentRunPayload {
  const run = isRecord(agent.subagentRun) ? agent.subagentRun : null
  const previous = options.previous
  const ownMessages = Array.isArray(run?.messages) ? subagentProcessTraceMessages(run.messages) : []
  const previousTrace = previous?.traceMessages ?? []
  // 服务端不再按预算裁剪 trace：运行中帧只省略已结束 Agent 的 trace
  // （subagentRunDeferred），终态帧一次性带全量。缺 trace 时沿用上一次可见
  // 快照，保证详情页不闪空，且这属于正常分帧而非内容丢失，不提示不完整。
  const deferred = agent.subagentRunDeferred === true && ownMessages.length === 0
  const traceMessages = deferred || ownMessages.length === 0 ? previousTrace : ownMessages
  const tools = Array.isArray(run?.tools) && run.tools.length > 0 ? run.tools : previous?.tools ?? []
  const allowedTools = run ? stringArray(run.allowedTools) : previous?.allowedTools ?? []
  const pendingToolCalls = run ? stringArray(run.pendingToolCalls) : previous?.pendingToolCalls ?? []
  const isStreaming = agent.status === 'running' || agent.status === 'queued'
  const task = agent.promptPreview || (typeof run?.task === 'string' ? run.task : '')
  // 与 run_subagent 详情同构：context/expectedOutput 来自 `agent()` 参数，服务端
  // 随 workflow details 透传；帧缺失时用上一份快照回填，避免修剪后闪空。
  const context = agent.context || previous?.context || ''
  const expectedOutput = agent.expectedOutput || previous?.expectedOutput || ''
  const output = agent.resultPreview
  // Feed the shared derivation a run_subagent-shaped result so a workflow step
  // reports the same status/error source as a direct run_subagent card. The
  // workflow record's error is exposed through details so it is never lost when
  // the trace is missing.
  const result: ToolResultLike = {
    isError: agent.status === 'error' || agent.status === 'aborted',
    content: output ? [{ type: 'text', text: output }] : [],
    details: {
      ...(run ?? {}),
      ...(agent.error ? { error: agent.error } : {}),
      ...(agent.status === 'aborted' ? { aborted: true } : {}),
    },
  }
  const status = subagentRunStatus(result, isStreaming, traceMessages)
  const statusLabel = status === 'running'
    ? t('subagentRunning', { name: agent.label })
    : status === 'done'
      ? t('subagentCompleted', { name: agent.label })
      : status === 'error'
        ? t('subagentFailed', { name: agent.label })
        : agent.label
  const model = isRecord(run?.model)
    ? run.model as SubagentRunPayload['model']
    : previous?.model
  const thinkingLevel = run?.thinkingLevel === 'off'
    || run?.thinkingLevel === 'low'
    || run?.thinkingLevel === 'medium'
    || run?.thinkingLevel === 'high'
    || run?.thinkingLevel === 'xhigh'
    ? run.thinkingLevel
    : previous?.thinkingLevel
  const toolCalls = agent.toolCalls > 0 ? agent.toolCalls : run && typeof run.toolCalls === 'number' ? run.toolCalls : previous?.toolCalls
  const timing = agent.startedAt
    ? {
        startedAt: agent.startedAt,
        ...(agent.durationMs > 0
          ? { finishedAt: agent.startedAt + agent.durationMs, durationMs: agent.durationMs }
          : {}),
      }
    : agent.durationMs > 0
      ? { durationMs: agent.durationMs }
      : previous?.timing
  const input = JSON.stringify({
    profile: agent.profile,
    label: agent.label,
    prompt: task,
    ...(context ? { context } : {}),
    ...(expectedOutput ? { expectedOutput } : {}),
    ...(agent.phase ? { phase: agent.phase } : {}),
  }, null, 2)
  const summary = run
    ? Object.fromEntries(Object.entries(run).filter(([key]) => key !== 'messages' && key !== 'tools'))
    : null
  const details = summary ? truncate(JSON.stringify(summary, null, 2), 20_000) : ''
  const error = subagentRunError(status, traceMessages, output, result.details)
  const runId = `${workflowRunId || 'workflow'}:agent:${agent.id}`
  const payloadWithoutFingerprint: Omit<SubagentRunPayload, 'fingerprint'> = {
    runId,
    canonicalToolCallId: runId,
    name: agent.profile || 'general',
    label: agent.label,
    task,
    context,
    expectedOutput,
    status,
    statusLabel,
    ...(timing ? { timing } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    allowedTools,
    traceMessages,
    tools,
    pendingToolCalls,
    input,
    details,
    output,
    ...error,
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    detailed: (options.toolDisplayMode ?? getCachedToolDisplaySettings().toolDisplayMode) === 'detailed',
  }
  return { ...payloadWithoutFingerprint, fingerprint: subagentRunFingerprint(payloadWithoutFingerprint) }
}
