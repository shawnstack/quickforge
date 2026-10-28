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
  /** Subagent run trace captured by the workflow runner (never trimmed). */
  subagentRun?: Record<string, unknown>
  /**
   * 运行中帧省略了该 Agent 的 trace（只带仍运行中的 Agent trace），
   * 前端复用上一次可见快照，不视为内容丢失。
   */
  subagentRunDeferred: boolean
}

export type WorkflowToolView = {
  id: string
  seq: number
  name: string
  label: string
  phase: string
  status: WorkflowAgentStatus
  /** 工具开始时间（ms epoch）；旧帧可能缺失，时间轴按 seq 顺序兜底。 */
  startedAt?: number
  durationMs: number
  args?: Record<string, unknown>
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

/**
 * 阶段内的展示级步骤：连续的 `tool()` 调用合并为一段嵌套的「工具行区」，
 * 让工具行在视觉上从属于它前面那个 Agent 步骤，而不是与 Agent 平级。
 */
export type WorkflowPhaseStep =
  | { kind: 'agent'; seq: number; agent: WorkflowAgentView }
  | { kind: 'tools'; seq: number; tools: WorkflowToolView[] }

export type WorkflowRunView = {
  runId: string
  status: WorkflowRunStatus
  durationMs: number
  /** 运行开始时间（ms epoch）；时间轴用它换算相对偏移。 */
  runStartedAt?: number
  /** 服务端生效的预算与并发，用于概览条展示。 */
  maxAgents: number
  maxTools: number
  concurrency: number
  maxRuntimeMs: number
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
    subagentRunDeferred: value.subagentRunDeferred === true,
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
    ...(typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)
      ? { startedAt: value.startedAt }
      : {}),
    durationMs: Math.max(0, number(value.durationMs)),
    ...(isRecord(value.args) ? { args: value.args } : {}),
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
    ...(typeof details.startedAt === 'number' && Number.isFinite(details.startedAt)
      ? { runStartedAt: details.startedAt }
      : {}),
    maxAgents: Math.max(0, number(details.maxAgents)),
    maxTools: Math.max(0, number(details.maxTools)),
    concurrency: Math.max(0, number(details.concurrency)),
    maxRuntimeMs: Math.max(0, number(details.maxRuntimeMs)),
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
  }
}

export function workflowStatusLabelKey(status: WorkflowRunStatus): AppTextKey {
  if (status === 'done') return 'workflowCompleted'
  if (status === 'error') return 'workflowFailed'
  if (status === 'aborted') return 'workflowAborted'
  return 'workflowRunning'
}

/** 调用方注入的翻译函数（与 i18n 的 `t` 同签名，便于纯逻辑单测）。 */
export type WorkflowTranslate = (key: AppTextKey, params?: Record<string, string | number>) => string

/**
 * 摘要里的计数片段：只有真实存在的步骤才出现。
 * 没有调用 `agent()` 的工作流不再显示「0 个智能体」，工具数同理。
 */
export function workflowCountParts(view: WorkflowRunView, translate: WorkflowTranslate): string[] {
  const parts: string[] = []
  if (view.agentCount > 0) {
    parts.push(translate(view.agentCount === 1 ? 'workflowAgentCountOne' : 'workflowAgentCountMany', { count: view.agentCount }))
  }
  if (view.toolCount > 0) {
    parts.push(translate(view.toolCount === 1 ? 'workflowToolCountOne' : 'workflowToolCountMany', { count: view.toolCount }))
  }
  return parts
}

/** 摘要卡与 Inspector 概览条共用的一行摘要：状态 + 计数片段，空计数整段省略。 */
export function workflowSummaryText(view: WorkflowRunView, translate: WorkflowTranslate): string {
  return [translate(workflowStatusLabelKey(view.status)), ...workflowCountParts(view, translate)].join(' · ')
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

/**
 * 把阶段内的 Agent 与工具按 `seq` 交错展平，并把连续的 `tool()` 调用合并成
 * 一个 `tools` 步骤。渲染器据此把工具行放进独立的缩进区，形成
 * 「阶段 → Agent → 工具行」的层级，而不是让工具行与 Agent 同级平铺。
 *
 * 合并只按连续性判断（不推断归属关系）：工具调用在时间线上紧挨着前一个 Agent，
 * 语义上就是该步的执行细节。
 */
export function workflowPhaseSteps(phase: WorkflowPhaseView): WorkflowPhaseStep[] {
  const ordered = [
    ...phase.agents.map((agent) => ({ kind: 'agent' as const, seq: agent.seq, agent })),
    ...phase.tools.map((tool) => ({ kind: 'tool' as const, seq: tool.seq, tool })),
  ].sort((left, right) => left.seq - right.seq)

  const steps: WorkflowPhaseStep[] = []
  let pendingTools: WorkflowToolView[] = []
  const flushTools = () => {
    if (pendingTools.length === 0) return
    steps.push({ kind: 'tools', seq: pendingTools[0].seq, tools: pendingTools })
    pendingTools = []
  }

  for (const step of ordered) {
    if (step.kind === 'tool') {
      pendingTools.push(step.tool)
      continue
    }
    flushTools()
    steps.push({ kind: 'agent', seq: step.agent.seq, agent: step.agent })
  }
  flushTools()
  return steps
}

/** 时间轴上的一个步骤：Agent 或工具调用，带相对运行开始的起止时间。 */
export type WorkflowTimelineEntry = {
  id: string
  kind: 'agent' | 'tool'
  seq: number
  label: string
  phase: string
  status: WorkflowAgentStatus
  /** 相对运行开始的偏移（ms）。缺失 startedAt 的旧帧按 seq 顺序顺延兜底。 */
  startOffsetMs: number
  durationMs: number
  /** 与另一个步骤在时间上重叠 —— 只有并行编排才会出现。 */
  parallel: boolean
  /** 并行组内 seq 最小的那一条，渲染时用它画「并行」标注。 */
  parallelGroupStart: boolean
  /** 所属并行组的成员数（含自身）；非并行恒为 1。供组标注「并行×N」。 */
  parallelGroupSize: number
}

export type WorkflowTimeline = {
  entries: WorkflowTimelineEntry[]
  /** 时间轴总跨度（ms），恒 >= 1，可直接做分母。 */
  totalMs: number
  /** 观测到的并发峰值；1 表示纯串行。 */
  peakConcurrency: number
  /** 相对串行执行节省的时间（ms），纯串行时为 0。 */
  savedMs: number
}

type TimelineSource = {
  id: string
  kind: 'agent' | 'tool'
  seq: number
  label: string
  phase: string
  status: WorkflowAgentStatus
  startedAt?: number
  durationMs: number
}

/**
 * 把 view 摊平成甘特图时间轴。
 *
 * 服务端为每个 step 记录 `startedAt`，前端据此还原真实并发关系：串行时后一步的
 * 起点等于前一步的终点；并行（parallel/pipeline）时起点相同或交叠。旧的/裁剪过的
 * 帧可能缺 `startedAt`，此时按 `seq` 顺序顺延，保持单调但不伪造并行。
 *
 * 纯函数、无 React 依赖，可直接单测。
 */
export function workflowTimeline(view: WorkflowRunView): WorkflowTimeline {
  const sources: TimelineSource[] = [
    ...view.agents.map((agent) => ({
      id: `agent:${agent.id}`,
      kind: 'agent' as const,
      seq: agent.seq,
      label: agent.label,
      phase: agent.phase,
      status: agent.status,
      ...(agent.startedAt !== undefined ? { startedAt: agent.startedAt } : {}),
      durationMs: agent.durationMs,
    })),
    ...view.tools.map((tool) => ({
      id: `tool:${tool.id}`,
      kind: 'tool' as const,
      seq: tool.seq,
      label: tool.label,
      phase: tool.phase,
      status: tool.status,
      ...(tool.startedAt !== undefined ? { startedAt: tool.startedAt } : {}),
      durationMs: tool.durationMs,
    })),
  ].sort((left, right) => left.seq - right.seq)

  const knownStarts = sources
    .map((source) => source.startedAt)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const base = knownStarts.length > 0
    ? Math.min(...knownStarts)
    : (view.runStartedAt ?? 0)

  // 缺失 startedAt 的步骤按 seq 顺序顺延到「已有最大终点」，保持串行语义。
  let cursor = 0
  const positioned = sources.map((source) => {
    const start = typeof source.startedAt === 'number' && Number.isFinite(source.startedAt)
      ? Math.max(0, source.startedAt - base)
      : cursor
    const durationMs = Math.max(0, source.durationMs)
    cursor = Math.max(cursor, start + durationMs)
    return { ...source, startOffsetMs: start, durationMs }
  })

  // 重叠判定 + 并查集聚合：同一并行组只标注一次。
  const overlaps = (a: typeof positioned[number], b: typeof positioned[number]) => (
    a.durationMs > 0 && b.durationMs > 0
    && a.startOffsetMs < b.startOffsetMs + b.durationMs
    && b.startOffsetMs < a.startOffsetMs + a.durationMs
  )
  const parent = positioned.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    let cursorIndex = index
    while (parent[cursorIndex] !== cursorIndex) {
      const next = parent[cursorIndex]
      parent[cursorIndex] = root
      cursorIndex = next
    }
    return root
  }
  for (let left = 0; left < positioned.length; left += 1) {
    for (let right = left + 1; right < positioned.length; right += 1) {
      if (!overlaps(positioned[left], positioned[right])) continue
      const leftRoot = find(left)
      const rightRoot = find(right)
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
    }
  }

  const groupStartSeqs = new Map<number, number>()
  const groupSizes = new Map<number, number>()
  for (let index = 0; index < positioned.length; index += 1) {
    const root = find(index)
    const current = groupStartSeqs.get(root)
    if (current === undefined || positioned[index].seq < current) {
      groupStartSeqs.set(root, positioned[index].seq)
    }
    groupSizes.set(root, (groupSizes.get(root) ?? 0) + 1)
  }

  const entries: WorkflowTimelineEntry[] = positioned.map((step, index) => {
    const root = find(index)
    const grouped = (groupSizes.get(root) ?? 0) > 1
    return {
      id: step.id,
      kind: step.kind,
      seq: step.seq,
      label: step.label,
      phase: step.phase,
      status: step.status,
      startOffsetMs: step.startOffsetMs,
      durationMs: step.durationMs,
      parallel: grouped,
      parallelGroupStart: grouped && groupStartSeqs.get(root) === step.seq,
      parallelGroupSize: grouped ? (groupSizes.get(root) ?? 0) : 1,
    }
  })

  const spanEnd = entries.reduce((max, entry) => Math.max(max, entry.startOffsetMs + entry.durationMs), 0)
  const totalMs = Math.max(1, spanEnd, view.durationMs)

  // 并发峰值：+1 / -1 扫描线，同一时刻先结束后开始（边界不算并发）。
  const events = entries.flatMap((entry) => {
    if (entry.durationMs <= 0) return []
    return [
      { at: entry.startOffsetMs, delta: 1 },
      { at: entry.startOffsetMs + entry.durationMs, delta: -1 },
    ]
  }).sort((left, right) => left.at - right.at || left.delta - right.delta)
  let active = 0
  let peakConcurrency = 0
  for (const event of events) {
    active += event.delta
    if (active > peakConcurrency) peakConcurrency = active
  }

  const serialMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0)
  return {
    entries,
    totalMs,
    peakConcurrency,
    savedMs: Math.max(0, serialMs - spanEnd),
  }
}

/** 阶段在时间轴上的跨度（相对运行开始）。没有可定位步骤的阶段返回 null。 */
export type WorkflowPhaseSpan = {
  startOffsetMs: number
  endOffsetMs: number
}

/**
 * 阶段跨度：该阶段全部条目的最早起点 → 最晚终点。
 * 阶段头用它画跨度条（与行绘图区同一几何），阶段之间的串/并行结构一眼可读；
 * 运行中的钳制（不超过当前时刻）由调用方做——这里只报告事实跨度。
 */
export function workflowPhaseSpan(phase: WorkflowPhaseView, timeline: WorkflowTimeline): WorkflowPhaseSpan | null {
  const entries = timeline.entries.filter((entry) => entry.phase === phase.title)
  if (entries.length === 0) return null
  const startOffsetMs = Math.min(...entries.map((entry) => entry.startOffsetMs))
  const endOffsetMs = Math.max(...entries.map((entry) => entry.startOffsetMs + entry.durationMs))
  return { startOffsetMs, endOffsetMs }
}

/**
 * 长错误默认折叠：超过阈值或本身多行时，界面只露两行，由用户显式展开。
 * 阈值按中英文混排「两行内能读完」估算，只是 UI 判断，不影响错误原文与数据。
 */
export const WORKFLOW_ERROR_COLLAPSE_THRESHOLD = 140

export function isWorkflowErrorCollapsible(text: string): boolean {
  return text.length > WORKFLOW_ERROR_COLLAPSE_THRESHOLD || /[\r\n]/.test(text)
}

