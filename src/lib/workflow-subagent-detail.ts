import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { subagentProcessTraceMessages } from '@/lib/subagent-process-trace'
import {
  subagentRunFingerprint,
  type SubagentRunI18n,
  type SubagentRunPayload,
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

/**
 * Build the same `SubagentRunPayload` shape the run_subagent card opens in the
 * Workspace Inspector, from a workflow agent record. The workflow runner keeps a
 * bounded trace (messages/tools) per agent; when that trace was dropped by the
 * details budget the Inspector still opens with task/result/summary.
 */
export function buildWorkflowSubagentRunPayload(
  workflowRunId: string,
  agent: WorkflowAgentView,
  t: SubagentRunI18n,
): SubagentRunPayload {
  const run = isRecord(agent.subagentRun) ? agent.subagentRun : null
  const messages = Array.isArray(run?.messages) ? subagentProcessTraceMessages(run.messages) : []
  const tools = Array.isArray(run?.tools) ? run.tools : []
  const status = agent.status === 'running' || agent.status === 'queued'
    ? 'running'
    : agent.status === 'done'
      ? 'done'
      : agent.status === 'error' || agent.status === 'aborted'
        ? 'error'
        : 'called'
  const statusLabel = status === 'running'
    ? t('subagentRunning', { name: agent.label })
    : status === 'done'
      ? t('subagentCompleted', { name: agent.label })
      : status === 'error'
        ? t('subagentFailed', { name: agent.label })
        : agent.label
  const task = agent.promptPreview || (typeof run?.task === 'string' ? run.task : '')
  const input = JSON.stringify({
    profile: agent.profile,
    label: agent.label,
    prompt: task,
  }, null, 2)
  const summary = run
    ? Object.fromEntries(Object.entries(run).filter(([key]) => key !== 'messages' && key !== 'tools'))
    : null
  const details = summary ? truncate(JSON.stringify(summary, null, 2), 20_000) : ''
  const runId = `${workflowRunId || 'workflow'}:agent:${agent.id}`
  const thinkingLevel = run?.thinkingLevel === 'off'
    || run?.thinkingLevel === 'low'
    || run?.thinkingLevel === 'medium'
    || run?.thinkingLevel === 'high'
    || run?.thinkingLevel === 'xhigh'
    ? run.thinkingLevel
    : undefined
  const payloadWithoutFingerprint: Omit<SubagentRunPayload, 'fingerprint'> = {
    runId,
    canonicalToolCallId: runId,
    name: agent.profile || 'general',
    label: agent.label,
    task,
    context: '',
    expectedOutput: '',
    status,
    statusLabel,
    timing: agent.durationMs > 0 ? { durationMs: agent.durationMs } : undefined,
    toolCalls: agent.toolCalls,
    allowedTools: stringArray(run?.allowedTools),
    traceMessages: messages,
    tools,
    pendingToolCalls: stringArray(run?.pendingToolCalls),
    input,
    details,
    output: agent.resultPreview,
    errorMessage: agent.error,
    ...(agent.error ? { errorSource: 'details' as const } : {}),
    ...(isRecord(run?.model) ? { model: run.model as SubagentRunPayload['model'] } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    detailed: getCachedToolDisplaySettings().toolDisplayMode === 'detailed',
  }
  return { ...payloadWithoutFingerprint, fingerprint: subagentRunFingerprint(payloadWithoutFingerprint) }
}
