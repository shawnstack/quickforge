import type { AppTextKey } from '@/lib/i18n'

/**
 * run_workflow 的纯视图模型：把服务端持久化/流式的 details 归一成渲染器需要的
 * 阶段、Agent、日志与结果。保持无 React / 无 i18n 状态依赖，便于单测；翻译键
 * 只作为字面量返回，由渲染器调用 t()。
 */

export type WorkflowRunStatus = 'running' | 'done' | 'error' | 'aborted'
export type WorkflowAgentStatus = 'queued' | 'running' | 'done' | 'error' | 'aborted'

export type WorkflowAgentView = {
  id: string
  seq: number
  label: string
  profile: string
  phase: string
  status: WorkflowAgentStatus
  /** Agent 开始时间（ms epoch），与 run_subagent 的 quickforgeTiming.startedAt 对齐。 */
  startedAt?: number
  durationMs: number
  toolCalls: number
  schemaValidated: boolean
  promptPreview: string
  /** `agent()` 的 context/expectedOutput（服务端 bounded 透传），用于 Inspector 任务说明与 run_subagent 对齐。 */
  context: string
  expectedOutput: string
  resultPreview: string
  error: string
  /** Bounded subagent run trace captured by the workflow runner. */
  subagentRun?: Record<string, unknown>
  subagentRunDropped: boolean
  /** 服务端为总预算把 trace 缩到更短窗口（非整体移除）；详情保留最后一次可见 trace 并提示不完整。 */
  subagentRunTruncated: boolean
}

export type WorkflowToolView = {
  id: string
  seq: number
  name: string
  label: string
  phase: string
  status: WorkflowAgentStatus
  durationMs: number
  args?: Record<string, unknown>
  argsPreview: string
  resultPreview: string
  error: string
}

export type WorkflowLogView = {
  at: number
  phase: string
  message: string
  level: 'info' | 'error'
}

export type WorkflowPhaseView = {
  title: string
  startedAt?: number
  agents: WorkflowAgentView[]
  tools: WorkflowToolView[]
  logs: WorkflowLogView[]
}

export type WorkflowRunView = {
  runId: string
  status: WorkflowRunStatus
  durationMs: number
  resultPreview: string
  error: string
  phases: WorkflowPhaseView[]
  agents: WorkflowAgentView[]
  tools: WorkflowToolView[]
  logs: WorkflowLogView[]
  agentCount: number
  completedAgentCount: number
  failedAgentCount: number
  runningAgentCount: number
  toolCount: number
  failedToolCount: number
  timedOut: boolean
  aborted: boolean
  resultsTruncated: boolean
}

export type WorkflowResultLike = {
  isError?: boolean
  details?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeAgent(value: unknown, index: number): WorkflowAgentView | null {
  if (!isRecord(value)) return null
  const status = text(value.status)
  const normalizedStatus: WorkflowAgentStatus = status === 'done' || status === 'running' || status === 'error' || status === 'aborted'
    ? status
    : 'queued'
  return {
    id: text(value.id, `agent-${index + 1}`),
    seq: Math.max(0, number(value.seq)),
    label: text(value.label, text(value.profile, `Agent ${index + 1}`)),
    profile: text(value.profile),
    phase: text(value.phase),
    status: normalizedStatus,
    ...(typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)
      ? { startedAt: value.startedAt }
      : {}),
    durationMs: Math.max(0, number(value.durationMs)),
    toolCalls: Math.max(0, number(value.toolCalls)),
    schemaValidated: value.schemaValidated === true,
    promptPreview: text(value.promptPreview),
    context: text(value.context),
    expectedOutput: text(value.expectedOutput),
    resultPreview: text(value.resultPreview),
    error: text(value.error),
    ...(isRecord(value.subagentRun) ? { subagentRun: value.subagentRun } : {}),
    subagentRunDropped: value.subagentRunDropped === true,
    subagentRunTruncated: value.subagentRunTruncated === true,
  }
}

function normalizeTool(value: unknown, index: number): WorkflowToolView | null {
  if (!isRecord(value)) return null
  const status = text(value.status)
  const normalizedStatus: WorkflowAgentStatus = status === 'done' || status === 'running' || status === 'error' || status === 'aborted'
    ? status
    : 'queued'
  return {
    id: text(value.id, `tool-${index + 1}`),
    seq: Math.max(0, number(value.seq)),
    name: text(value.name, 'tool'),
    label: text(value.label, text(value.name, `Tool ${index + 1}`)),
    phase: text(value.phase),
    status: normalizedStatus,
    durationMs: Math.max(0, number(value.durationMs)),
    ...(isRecord(value.args) ? { args: value.args } : {}),
    argsPreview: text(value.argsPreview),
    resultPreview: text(value.resultPreview),
    error: text(value.error),
  }
}

function normalizeLog(value: unknown): WorkflowLogView | null {
  if (!isRecord(value)) return null
  const message = text(value.message)
  if (!message) return null
  return {
    at: number(value.at),
    phase: text(value.phase),
    message,
    level: value.level === 'error' ? 'error' : 'info',
  }
}

/** Hydrate the renderer view from a tool result details payload. */
export function buildWorkflowRunView(result: WorkflowResultLike | undefined, isStreaming?: boolean): WorkflowRunView | null {
  const details = isRecord(result?.details) ? result.details : null
  if (!details || details.workflow !== true) return null

  const rawAgents = Array.isArray(details.agents) ? details.agents : []
  const agents = rawAgents
    .map((agent, index) => normalizeAgent(agent, index))
    .filter((agent): agent is WorkflowAgentView => agent !== null)

  const rawTools = Array.isArray(details.tools) ? details.tools : []
  const tools = rawTools
    .map((tool, index) => normalizeTool(tool, index))
    .filter((tool): tool is WorkflowToolView => tool !== null)

  const rawLogs = Array.isArray(details.logs) ? details.logs : []
  const logs = rawLogs
    .map((log) => normalizeLog(log))
    .filter((log): log is WorkflowLogView => log !== null)

  const phaseOrder: string[] = []
  const phaseStartedAt = new Map<string, number | undefined>()
  const ensurePhase = (title: string, startedAt?: number) => {
    if (!phaseOrder.includes(title)) {
      phaseOrder.push(title)
      phaseStartedAt.set(title, startedAt)
    } else if (startedAt !== undefined && phaseStartedAt.get(title) === undefined) {
      phaseStartedAt.set(title, startedAt)
    }
  }

  const rawPhases = Array.isArray(details.phases) ? details.phases : []
  for (const phase of rawPhases) {
    if (!isRecord(phase)) continue
    ensurePhase(text(phase.title), typeof phase.startedAt === 'number' ? phase.startedAt : undefined)
  }
  for (const agent of agents) ensurePhase(agent.phase)
  for (const tool of tools) ensurePhase(tool.phase)
  for (const log of logs) ensurePhase(log.phase)

  const phases: WorkflowPhaseView[] = phaseOrder.map((title) => ({
    title,
    ...(phaseStartedAt.get(title) !== undefined ? { startedAt: phaseStartedAt.get(title) } : {}),
    agents: agents.filter((agent) => agent.phase === title),
    tools: tools.filter((tool) => tool.phase === title),
    logs: logs.filter((log) => log.phase === title),
  }))

  const rawStatus = text(details.status)
  const aborted = details.aborted === true || rawStatus === 'aborted'
  const timedOut = details.timedOut === true
  const failedAgentCount = agents.filter((agent) => agent.status === 'error' || agent.status === 'aborted').length
  let status: WorkflowRunStatus
  // Aborted results are tool errors too; check the explicit abort marker first
  // so a user stop is not reported as a failure.
  if (aborted) status = 'aborted'
  else if (timedOut || rawStatus === 'error' || result?.isError === true) status = 'error'
  else if (rawStatus === 'done') status = 'done'
  else if (rawStatus === 'running') status = 'running'
  else status = isStreaming ? 'running' : result ? 'done' : 'running'

  return {
    runId: text(details.runId),
    status,
    durationMs: Math.max(0, number(details.durationMs)),
    resultPreview: text(details.resultPreview),
    error: text(details.error),
    phases,
    agents,
    tools,
    logs,
    agentCount: agents.length,
    completedAgentCount: agents.filter((agent) => agent.status === 'done').length,
    failedAgentCount,
    runningAgentCount: agents.filter((agent) => agent.status === 'running' || agent.status === 'queued').length,
    toolCount: tools.length,
    failedToolCount: tools.filter((tool) => tool.status === 'error' || tool.status === 'aborted').length,
    timedOut,
    aborted,
    resultsTruncated: details.resultTruncated === true,
  }
}

export function workflowStatusLabelKey(status: WorkflowRunStatus): AppTextKey {
  if (status === 'done') return 'workflowCompleted'
  if (status === 'error') return 'workflowFailed'
  if (status === 'aborted') return 'workflowAborted'
  return 'workflowRunning'
}

export function workflowSummaryKey(view: WorkflowRunView): AppTextKey {
  if (view.status === 'done') return 'workflowSummaryDone'
  if (view.status === 'error') return 'workflowSummaryFailed'
  if (view.status === 'aborted') return 'workflowSummaryAborted'
  return 'workflowSummaryRunning'
}

/** Running/queued agent and tool labels in submission order. */
export function workflowActiveStepLabels(view: WorkflowRunView): string[] {
  return [...view.agents, ...view.tools]
    .filter((step) => step.status === 'running' || step.status === 'queued')
    .sort((left, right) => left.seq - right.seq)
    .map((step) => step.label)
}

/** Last phase that still has a running step, else the last phase. */
export function workflowCurrentPhase(view: WorkflowRunView): string {
  for (let index = view.phases.length - 1; index >= 0; index -= 1) {
    const phase = view.phases[index]
    if (phase.agents.some((agent) => agent.status === 'running') || phase.tools.some((tool) => tool.status === 'running')) {
      return phase.title
    }
  }
  return view.phases[view.phases.length - 1]?.title ?? ''
}
