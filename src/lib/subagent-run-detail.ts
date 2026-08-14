/**
 * subagent 运行详情侧栏的纯逻辑（不依赖 DOM/Lit/React/i18n 运行时，便于单元测试）。
 *
 * 数据流：run_subagent 工具的服务端 details（含稳定 run id `sessionId`、
 * messages/tools/pendingToolCalls/toolCalls/allowedTools/durationMs 等）经 SSE
 * 合并到 toolResult.details 后到达渲染器；本模块负责把 params + details 规范化为
 * 一份统一载荷（SubagentRunPayload），供聊天中的运行摘要与 Workspace Inspector
 * 运行详情 Tab 共用。旧消息没有 sessionId 时按 `${name}:${task}` 安全回退。
 *
 * i18n 通过 t 参数注入（由 local-tools.ts 传入真实 t 函数），保持本模块可测试。
 */

import type { AppTextKey } from '@/lib/i18n'
import { subagentProcessTraceMessages } from '@/lib/subagent-process-trace'
import { extractQuickForgeTiming, type QuickForgeToolTiming } from '@/lib/tool-execution-events'

export type SubagentRunStatus = 'running' | 'done' | 'error' | 'called'

/** 与 tool-display-settings 的显示模式一致（compact 也视为非详细模式）。 */
export type SubagentToolDisplayMode = 'concise' | 'compact' | 'detailed'

export type SubagentRunI18n = (key: AppTextKey, params?: Record<string, string | number>) => string

export type SubagentRunPayload = {
  /** 稳定运行 id：优先 details.sessionId；旧消息回退为 `${name}:${task}`。 */
  runId: string
  name: string
  label: string
  task: string
  context: string
  expectedOutput: string
  status: SubagentRunStatus
  statusLabel: string
  timing?: QuickForgeToolTiming
  toolCalls?: number
  allowedTools: string[]
  /** 已按 subagentProcessTraceMessages 过滤、可直接交给 message-list 的过程消息。 */
  traceMessages: unknown[]
  tools: unknown[]
  pendingToolCalls: string[]
  /** Workspace Inspector 运行详情 Tab 展示的 input / details JSON。 */
  input: string
  details: string
  output: string
  /** 聊天工具显示模式，仅用于兼容统一载荷。 */
  detailed: boolean
  /** 内容指纹，用于去重实时更新事件。 */
  fingerprint: string
}

/** 点击 subagent 运行摘要时派发的桥接事件 detail。 */
export type SubagentRunOpenRequest = {
  runId: string
  payload?: SubagentRunPayload
}

export const OPEN_SUBAGENT_RUN_EVENT = 'quickforge:open-subagent-run'
export const UPDATE_SUBAGENT_RUN_EVENT = 'quickforge:update-subagent-run'

export type ToolResultLike = {
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
  details?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function stringifyValue(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function resultText(result: ToolResultLike | undefined) {
  return result?.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n') ?? ''
}

function stringArrayFromUnknown(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function arrayFromUnknown(value: unknown) {
  return Array.isArray(value) ? value : []
}

/** 与 local-tools.ts 的 toolStatus 一致：从 result/流式状态推导运行状态。 */
export function subagentRunStatus(result: ToolResultLike | undefined, isStreaming?: boolean): SubagentRunStatus {
  const details = isRecord(result?.details) ? result.details : undefined
  if (result?.isError || details?.aborted === true || details?.timedOut === true) return 'error'
  if (isStreaming) return 'running'
  return result ? 'done' : 'called'
}

/** 与 local-tools.ts 的 subagentLabel 一致：优先 details.label，内置名回落。 */
export function subagentRunLabel(name: string, details: unknown, t: SubagentRunI18n): string {
  if (isRecord(details) && typeof details.label === 'string' && details.label) return details.label
  if (name === 'general') return t('subagentGeneral')
  if (name === 'explore') return t('subagentExplore')
  return name || t('runSubagent')
}

export function subagentRunStatusLabel(status: SubagentRunStatus, label: string, t: SubagentRunI18n): string {
  if (status === 'running') return t('subagentRunning', { name: label })
  if (status === 'done') return t('subagentCompleted', { name: label })
  if (status === 'error') return t('subagentFailed', { name: label })
  return t('runSubagent')
}

/**
 * 稳定运行 id：服务端每次 runSubagent 都会生成唯一 sessionId
 * （`<parent>:subagent:<name>:<uuid>`）；旧消息/历史会话没有 sessionId 时，
 * 安全回退为 `${name}:${task}`。
 */
export function subagentRunId(details: unknown, name: string, task: string): string {
  if (isRecord(details) && typeof details.sessionId === 'string' && details.sessionId) return details.sessionId
  const trimmedName = (name || '').trim()
  const trimmedTask = (task || '').trim()
  if (!trimmedName && !trimmedTask) return ''
  return `${trimmedName}:${trimmedTask}`
}

function messageTextLength(messages: unknown[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const raw = messages[index]
    if (!isRecord(raw)) continue
    const content = raw.content
    if (Array.isArray(content)) {
      const text = content
        .filter((block) => isRecord(block) && (block.type === 'text' || block.type === 'thinking'))
        .map((block) => isRecord(block) && typeof block.text === 'string' ? block.text : '')
        .join('')
      if (text) return text.length
    } else if (typeof content === 'string' && content) {
      return content.length
    }
  }
  return 0
}

/** FNV-1a 32 位稳定哈希：纯函数、无依赖，输出固定长度字符串。 */
function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function jsonText(value: unknown): string {
  try { return JSON.stringify(value) } catch { return String(value) }
}

/**
 * 内容指纹：任何会影响展示的变化（状态、工具调用数、消息条数/内容、
 * 输出/输入/详情文本、耗时、pending 工具）都会改变指纹，用于实时更新去重。
 * 对已生成的字符串/JSON 做轻量稳定 hash（而非拼入原始内容），保证
 * “相同长度但内容变化”也会改变指纹，同时避免指纹字符串被巨大内容撑大。
 */
export function subagentRunFingerprint(payload: Omit<SubagentRunPayload, 'fingerprint'>): string {
  return [
    payload.runId,
    payload.status,
    String(payload.toolCalls ?? ''),
    payload.traceMessages.length,
    payload.pendingToolCalls.length,
    stableHash(jsonText([
      payload.name,
      payload.label,
      payload.task,
      payload.context,
      payload.expectedOutput,
      payload.statusLabel,
      payload.allowedTools,
      payload.tools,
      payload.pendingToolCalls,
      payload.detailed,
      payload.timing,
    ])),
    stableHash(payload.output),
    stableHash(payload.input),
    stableHash(payload.details),
    stableHash(jsonText(payload.traceMessages)),
    String(payload.timing?.durationMs ?? ''),
    messageTextLength(payload.traceMessages),
  ].join('|')
}

/**
 * 运行详情侧栏（SubagentRunDetailBody）内部块的展示顺序，单一事实来源。
 * 顺序与 Git 历史最终态（32be493 的聊天内 details）保持一致：
 * task/context/expectedOutput → 详细摘要 → trace → 无 trace 时 output → input → details。
 * 渲染器按此顺序输出；单元测试直接断言该顺序。
 */
export type SubagentRunBodyBlock = 'task' | 'summary' | 'trace' | 'output' | 'input' | 'details'

export function subagentRunBodyBlocks(
  payload: Pick<
    SubagentRunPayload,
    'task' | 'context' | 'expectedOutput' | 'detailed' | 'traceMessages' | 'output' | 'input' | 'details'
  >,
): SubagentRunBodyBlock[] {
  const blocks: SubagentRunBodyBlock[] = []
  if (payload.task || payload.context || payload.expectedOutput) blocks.push('task')
  if (payload.detailed) blocks.push('summary')
  if (payload.traceMessages.length > 0) {
    blocks.push('trace')
  } else if (payload.output) {
    blocks.push('output')
  }
  if (payload.detailed && payload.input) blocks.push('input')
  if (payload.detailed && payload.details) blocks.push('details')
  return blocks
}

/**
 * 从 run_subagent 的 params/result.details 构建规范化载荷。
 * 聊天摘要与 Workspace Inspector 运行详情 Tab 共用此函数，保证状态和内容一致。
 */
export function buildSubagentRunPayload(
  params: Record<string, unknown> | undefined,
  result: ToolResultLike | undefined,
  isStreaming: boolean | undefined,
  toolDisplayMode: SubagentToolDisplayMode,
  t: SubagentRunI18n,
): SubagentRunPayload {
  const details = isRecord(result?.details) ? result.details : undefined
  const name = typeof params?.subagent === 'string'
    ? params.subagent
    : typeof details?.subagent === 'string'
      ? details.subagent
      : ''
  const task = typeof params?.task === 'string' ? params.task : ''
  const status = subagentRunStatus(result, isStreaming)
  const label = subagentRunLabel(name, details, t)
  const detailed = toolDisplayMode === 'detailed'
  const traceMessages = subagentProcessTraceMessages(arrayFromUnknown(details?.messages))

  const payload: Omit<SubagentRunPayload, 'fingerprint'> = {
    runId: subagentRunId(details, name, task),
    name,
    label,
    task,
    context: typeof params?.context === 'string' ? params.context : '',
    expectedOutput: typeof params?.expectedOutput === 'string' ? params.expectedOutput : '',
    status,
    statusLabel: subagentRunStatusLabel(status, label, t),
    timing: extractQuickForgeTiming(result?.details),
    toolCalls: typeof details?.toolCalls === 'number' ? details.toolCalls : undefined,
    allowedTools: stringArrayFromUnknown(details?.allowedTools),
    traceMessages,
    tools: arrayFromUnknown(details?.tools),
    pendingToolCalls: stringArrayFromUnknown(details?.pendingToolCalls),
    input: stringifyValue(params),
    details: stringifyValue(result?.details),
    output: resultText(result),
    detailed,
  }
  return { ...payload, fingerprint: subagentRunFingerprint(payload) }
}

/** 校验 `quickforge:open-subagent-run` 事件 detail，返回规范化 run id，无效输入返回 undefined。 */
export function normalizeOpenSubagentRunRequest(detail: unknown): SubagentRunOpenRequest | undefined {
  if (!isRecord(detail)) return undefined
  const runId = typeof detail.runId === 'string' ? detail.runId.trim() : ''
  if (!runId) return undefined
  const payload = isRecord(detail.payload) ? detail.payload as unknown as SubagentRunPayload : undefined
  return { runId, payload }
}
