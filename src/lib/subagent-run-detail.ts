/**
 * subagent 运行详情的纯逻辑与实时 store（不依赖 DOM/Lit/React/i18n 运行时，便于单元测试）。
 *
 * 稳定 run id：新消息以 run_subagent 父工具调用的 `toolCallId` 为主键。
 * tool_execution_start 的 partialResult.details 已带 toolCallId（此时 sessionId 是父
 * 会话），后续 tool_execution_update/end 的 details.sessionId 变为子代理会话 id；若把
 * sessionId 当主键，start 时打开的 Tab 会与后续更新失配。因此 runId 推导顺序为：
 * 显式 toolCallId → toolResult 顶层 toolCallId → details.toolCallId → details.sessionId（仅历史兼容 fallback：旧
 * 消息/旧服务器没有 toolCallId 时才使用，不作为新消息主键）→ `${name}:${task}`
 * （无任何 id 的历史消息安全回退）。
 *
 * 实时数据流：ServerAgent 在 tool_execution_start/update/end SSE 路径主动构建载荷
 * 并发布到 subagentRunStore；local-tools 的渲染器只在聊天重渲染（含恢复会话回填）时
 * 发布到同一 store，由内容指纹去重，避免重复；Workspace Inspector 订阅 store 按 runId
 * 更新已打开的 Tab。不依赖 ChatPanelHost rAF 或 ToolRenderer.render 作为主通道。
 *
 * i18n 通过 t 参数注入（由 local-tools.ts / server-agent.ts 传入真实 t 函数），
 * 保持本模块可测试。
 */

import type { AppTextKey } from '@/lib/i18n'
import { subagentProcessTraceMessages } from '@/lib/subagent-process-trace'
import { extractQuickForgeTiming, toolStartEventWithPartialResult, type QuickForgeToolTiming, type ToolExecutionEvent } from '@/lib/tool-execution-events'
import { normalizeToolArguments, summarizeParams, truncateSummary } from '@/lib/tool-param-summary'

export type SubagentRunStatus = 'running' | 'done' | 'error' | 'called'

/** 与 tool-display-settings 的显示模式一致（compact 也视为非详细模式）。 */
export type SubagentToolDisplayMode = 'concise' | 'compact' | 'detailed'

export type SubagentRunI18n = (key: AppTextKey, params?: Record<string, string | number>) => string

export type SubagentRunErrorSource = 'trace' | 'output' | 'details' | 'fallback'

export type SubagentRunPayload = {
  /** 稳定运行 id：新消息以显式 toolCallId / toolResult 顶层 toolCallId / details.toolCallId 为主键；details.sessionId 仅历史兼容 fallback；旧消息回退 `${name}:${task}`。 */
  runId: string
  /** canonical 父工具调用 id；新运行的实时更新和 Tab 主键必须使用它。 */
  canonicalToolCallId?: string
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
  /** 失败原因；fallback 表示上游未提供可显示的具体错误正文，由渲染层本地化。 */
  errorMessage: string
  errorSource?: SubagentRunErrorSource
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

/** subagent 运行载荷的实时订阅者。 */
export type SubagentRunListener = (payload: SubagentRunPayload) => void

/** 实时快照缓存上限：超过后按插入顺序淘汰最旧运行，避免长期会话内存泄漏。 */
export const MAX_SUBAGENT_RUN_SNAPSHOTS = 100

/**
 * 轻量实时 store：发布 payload、按 runId 获取最新快照、订阅更新、指纹去重。
 * 纯内存实现、不依赖 DOM/React，便于单元测试；不做轮询，事件到达即发布。
 * 订阅方抛错不会中断发布链或影响其他订阅者。
 */
export class SubagentRunStore {
  private readonly snapshots = new Map<string, SubagentRunPayload>()
  private readonly listeners = new Set<SubagentRunListener>()

  /** 发布最新快照；与现有快照指纹相同时去重返回 false。 */
  publish(payload: SubagentRunPayload): boolean {
    if (!payload.runId) return false
    const existing = this.snapshots.get(payload.runId)
    if (existing && existing.fingerprint === payload.fingerprint) return false
    if (!existing && this.snapshots.size >= MAX_SUBAGENT_RUN_SNAPSHOTS) {
      const oldestKey = this.snapshots.keys().next().value
      if (oldestKey !== undefined) this.snapshots.delete(oldestKey)
    }
    // 已存在 key 的重复发布不改变 Map 插入顺序：淘汰顺序按首次插入有界即可。
    this.snapshots.set(payload.runId, payload)
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(payload)
      } catch {
        // 订阅方异常不应破坏发布链，也不应阻止其他订阅者收到更新。
      }
    }
    return true
  }

  get(runId: string): SubagentRunPayload | undefined {
    return this.snapshots.get(runId)
  }

  /** 订阅全部更新，返回取消订阅函数。 */
  subscribe(listener: SubagentRunListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 仅清空快照缓存；订阅者集合保持不变（订阅关系与数据生命周期分离）。 */
  clear(): void {
    this.snapshots.clear()
  }

  get size(): number {
    return this.snapshots.size
  }
}

/**
 * 全局单例：ServerAgent 的 SSE 事件路径与 local-tools 的聊天渲染回填路径共用，
 * Workspace Inspector 订阅它实现实时更新。
 */
export const subagentRunStore = new SubagentRunStore()

export type ToolResultLike = {
  toolCallId?: string
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

function nonEmptyText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

type AssistantTerminalState = {
  stopReason: string
  errorMessage: string
}

/** 仅以最后一个带 stopReason 的 assistant 为当前终态，避免旧错误污染后续成功结果。 */
function finalAssistantTerminalState(messages: unknown[]): AssistantTerminalState | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== 'assistant') continue
    const stopReason = nonEmptyText(message.stopReason)
    if (!stopReason) continue
    return { stopReason, errorMessage: nonEmptyText(message.errorMessage) }
  }
  return undefined
}

function traceAssistantErrorMessage(messages: unknown[]): string {
  const terminal = finalAssistantTerminalState(messages)
  return terminal?.stopReason === 'error' || terminal?.stopReason === 'aborted' ? terminal.errorMessage : ''
}

function errorTextFromUnknown(value: unknown): string {
  const direct = nonEmptyText(value)
  if (direct) return direct
  if (!isRecord(value)) return ''
  for (const key of ['errorMessage', 'error', 'message', 'reason']) {
    const nested = nonEmptyText(value[key])
    if (nested) return nested
  }
  return ''
}

function subagentRunError(
  status: SubagentRunStatus,
  traceMessages: unknown[],
  output: string,
  details: unknown,
): { errorMessage: string; errorSource?: SubagentRunErrorSource } {
  if (status !== 'error') return { errorMessage: '' }
  const traceError = traceAssistantErrorMessage(traceMessages)
  if (traceError) return { errorMessage: traceError, errorSource: 'trace' }
  const outputError = nonEmptyText(output)
  if (outputError) return { errorMessage: outputError, errorSource: 'output' }
  const detailsError = errorTextFromUnknown(details)
  if (detailsError) return { errorMessage: detailsError, errorSource: 'details' }
  return { errorMessage: '', errorSource: 'fallback' }
}

export function subagentRunTraceMessagesForDisplay(
  payload: Pick<SubagentRunPayload, 'status' | 'errorSource' | 'errorMessage' | 'traceMessages'>,
): unknown[] {
  if (payload.status !== 'error' || payload.errorSource !== 'trace' || !payload.errorMessage) {
    return payload.traceMessages
  }
  const duplicateIndex = payload.traceMessages.findLastIndex((message) => (
    isRecord(message)
    && message.role === 'assistant'
    && (message.stopReason === 'error' || message.stopReason === 'aborted')
    && nonEmptyText(message.errorMessage) === payload.errorMessage
  ))
  if (duplicateIndex < 0) return payload.traceMessages
  return payload.traceMessages.map((message, index) => (
    index === duplicateIndex && isRecord(message)
      ? { ...message, stopReason: undefined, errorMessage: undefined }
      : message
  ))
}

/** 从外层 result 与 trace 最终 assistant 终态推导状态；内部错误/中止优先于不准确的 running/done。 */
export function subagentRunStatus(
  result: ToolResultLike | undefined,
  isStreaming?: boolean,
  traceMessages: unknown[] = [],
): SubagentRunStatus {
  const details = isRecord(result?.details) ? result.details : undefined
  const assistantTerminal = finalAssistantTerminalState(traceMessages)
  if (
    result?.isError
    || details?.aborted === true
    || details?.timedOut === true
    || assistantTerminal?.stopReason === 'error'
    || assistantTerminal?.stopReason === 'aborted'
  ) return 'error'
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
 * 稳定运行 id：新消息优先显式 toolCallId / toolResult 顶层 toolCallId /
 * details.toolCallId（run_subagent 父工具
 * 调用 id，start/update/end 全程不变，是主键）；details.sessionId 仅作历史兼容
 * fallback（旧消息/旧服务器没有 toolCallId 时使用，start 时为父会话、update 后为
 * 子代理会话，不作为新消息主键）；两者都没有时回退 `${name}:${task}`。
 */
export function subagentRunId(details: unknown, name: string, task: string, toolCallId?: string): string {
  const explicitToolCallId = typeof toolCallId === 'string' && toolCallId ? toolCallId : ''
  const detailsToolCallId = isRecord(details) && typeof details.toolCallId === 'string' && details.toolCallId ? details.toolCallId : ''
  const sessionId = isRecord(details) && typeof details.sessionId === 'string' && details.sessionId ? details.sessionId : ''
  if (explicitToolCallId) return explicitToolCallId
  if (detailsToolCallId) return detailsToolCallId
  if (sessionId) return sessionId
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
 * 输出/错误/输入/详情文本、耗时、pending 工具）都会改变指纹，用于实时更新去重。
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
      payload.canonicalToolCallId,
      payload.statusLabel,
      payload.errorMessage,
      payload.errorSource,
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
 * task/context/expectedOutput → 详细摘要 → trace → 错误正文 → 非重复 output → input → details。
 * 渲染器按此顺序输出；单元测试直接断言该顺序。
 */
export type SubagentRunBodyBlock = 'task' | 'summary' | 'trace' | 'error' | 'output' | 'input' | 'details'

export function subagentRunBodyBlocks(
  payload: Pick<
    SubagentRunPayload,
    'task' | 'context' | 'expectedOutput' | 'status' | 'detailed' | 'traceMessages' | 'errorMessage' | 'errorSource' | 'output' | 'input' | 'details'
  >,
): SubagentRunBodyBlock[] {
  const blocks: SubagentRunBodyBlock[] = []
  if (payload.task || payload.context || payload.expectedOutput) blocks.push('task')
  if (payload.detailed) blocks.push('summary')
  if (payload.traceMessages.length > 0) blocks.push('trace')
  if (payload.status === 'error') blocks.push('error')
  const outputDuplicatesError = payload.errorSource === 'output' && payload.output.trim() === payload.errorMessage.trim()
  if (payload.output && !outputDuplicatesError && (payload.traceMessages.length === 0 || payload.status === 'error')) {
    blocks.push('output')
  }
  if (payload.detailed && payload.input) blocks.push('input')
  if (payload.detailed && payload.details) blocks.push('details')
  return blocks
}

function canonicalSubagentToolCallId(details: unknown, result: ToolResultLike | undefined, toolCallId?: string): string {
  const explicitToolCallId = typeof toolCallId === 'string' && toolCallId ? toolCallId : ''
  const resultToolCallId = typeof result?.toolCallId === 'string' && result.toolCallId ? result.toolCallId : ''
  const detailsToolCallId = isRecord(details) && typeof details.toolCallId === 'string' && details.toolCallId ? details.toolCallId : ''
  return explicitToolCallId || resultToolCallId || detailsToolCallId
}

/** 只有 canonical toolCallId 存在的载荷才可进入全局实时 store。 */
export function canPublishSubagentRunPayload(payload: Pick<SubagentRunPayload, 'canonicalToolCallId'>): boolean {
  return Boolean(payload.canonicalToolCallId)
}

/** canonical 任意状态可打开；无 canonical 时仅允许历史终态载荷直接打开。 */
export function canOpenSubagentRunPayload(payload: Pick<SubagentRunPayload, 'canonicalToolCallId' | 'status'>): boolean {
  return Boolean(payload.canonicalToolCallId) || (payload.status !== 'running' && payload.status !== 'called')
}

/**
 * renderer 只补齐安全快照：首次 canonical 载荷可发布；已有非终态可被恢复出的终态修正；
 * 其他已有快照不覆盖，保持 SSE 路径权威。
 */
export function shouldPublishSubagentRunPayload(
  payload: Pick<SubagentRunPayload, 'canonicalToolCallId' | 'status'>,
  existing?: Pick<SubagentRunPayload, 'status'>,
): boolean {
  if (!canPublishSubagentRunPayload(payload)) return false
  if (!existing) return true
  const existingIsRunning = existing.status === 'called' || existing.status === 'running'
  const payloadIsTerminal = payload.status === 'done' || payload.status === 'error'
  return existingIsRunning && payloadIsTerminal
}

/** canonical 点击取 store 最新同 ID 快照；历史 fallback 必须使用当前 renderer 载荷。 */
export function resolveSubagentRunPayloadForOpen(
  payload: SubagentRunPayload,
  storePayload?: SubagentRunPayload,
): SubagentRunPayload {
  if (!payload.canonicalToolCallId) return payload
  return storePayload?.canonicalToolCallId === payload.canonicalToolCallId ? storePayload : payload
}

/** 跑马灯单项摘要的最大长度（半角字符计），超出截断加 …。 */
export const SUBAGENT_TOOL_SUMMARY_MAX_LENGTH = 80

/**
 * 子代理当前正在执行的工具摘要列表（纯函数，供聊天摘要卡跑马灯使用）。
 * pendingToolCalls（toolCall id）× traceMessages（assistant content 的 toolCall chunk）
 * 求交集，按 trace 出现顺序返回 `工具名 · 参数摘要`；无 pending 或找不到 chunk 时为空。
 */
export function currentSubagentToolSummaries(payload: SubagentRunPayload): string[] {
  const pending = new Set(payload.pendingToolCalls)
  if (pending.size === 0) return []
  const summaries: string[] = []
  for (const message of payload.traceMessages) {
    if (!isRecord(message) || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const chunk of message.content) {
      if (!isRecord(chunk) || chunk.type !== 'toolCall') continue
      const id = typeof chunk.id === 'string' ? chunk.id : ''
      if (!id || !pending.has(id) || typeof chunk.name !== 'string' || !chunk.name) continue
      pending.delete(id)
      const summary = truncateSummary(
        summarizeParams(chunk.name, normalizeToolArguments(chunk.arguments)),
        SUBAGENT_TOOL_SUMMARY_MAX_LENGTH,
      )
      summaries.push(summary ? `${chunk.name} · ${summary}` : chunk.name)
    }
    if (pending.size === 0) break
  }
  return summaries
}

/** 「当前工具」摘要记忆的运行数上限：超过后按插入顺序淘汰最旧运行，防长期会话内存泄漏。 */
export const MAX_SUBAGENT_TOOL_SUMMARY_RUNS = 100

/**
 * running 期间「上一个工具」摘要的有界记忆（纯内存，便于单元测试）。
 * 工具结束到下一个工具开始（或运行收尾文本生成）之间存在 pendingToolCalls 为空的
 * 间隙，直接渲染空列表会让摘要卡跑马灯闪空消失；该记忆在 fresh 摘要非空时更新，
 * fresh 为空且运行未结束时回放该 run 最近一次非空摘要，保持工作过程展示连续。
 */
export class SubagentToolSummaryMemory {
  private readonly summariesByRunId = new Map<string, string[]>()

  remember(runId: string, summaries: string[]): void {
    if (!runId || summaries.length === 0) return
    if (!this.summariesByRunId.has(runId) && this.summariesByRunId.size >= MAX_SUBAGENT_TOOL_SUMMARY_RUNS) {
      const oldestKey = this.summariesByRunId.keys().next().value
      if (oldestKey !== undefined) this.summariesByRunId.delete(oldestKey)
    }
    this.summariesByRunId.set(runId, summaries)
  }

  recall(runId: string): string[] {
    return this.summariesByRunId.get(runId) ?? []
  }

  clear(): void {
    this.summariesByRunId.clear()
  }
}

/**
 * 带记忆的跑马灯数据源（渲染层使用）：
 * - 非 running 一律空列表（终态不显示跑马灯）；
 * - fresh 非空时记住并返回；running 且 fresh 为空（工具间隙、pending 未流出的瞬时）
 *   回放该 run 最近一次非空摘要，直到下一个工具摘要出现为止。
 */
export function currentSubagentToolSummariesWithMemory(
  payload: SubagentRunPayload,
  memory: SubagentToolSummaryMemory,
): string[] {
  if (payload.status !== 'running') return []
  const fresh = currentSubagentToolSummaries(payload)
  if (fresh.length > 0) {
    memory.remember(payload.runId, fresh)
    return fresh
  }
  return memory.recall(payload.runId)
}

/**
 * 从 run_subagent 的 params/result.details 构建规范化载荷。
 * 聊天摘要与 Workspace Inspector 运行详情 Tab 共用此函数，保证状态和内容一致。
 * toolCallId 为可选显式稳定 run id（SSE 事件路径传入父工具调用 id）。
 */
export function buildSubagentRunPayload(
  params: Record<string, unknown> | undefined,
  result: ToolResultLike | undefined,
  isStreaming: boolean | undefined,
  toolDisplayMode: SubagentToolDisplayMode,
  t: SubagentRunI18n,
  toolCallId?: string,
): SubagentRunPayload {
  const details = isRecord(result?.details) ? result.details : undefined
  const name = typeof params?.subagent === 'string'
    ? params.subagent
    : isRecord(params?.subagent) && typeof params.subagent.name === 'string'
      ? params.subagent.name
      : typeof details?.subagent === 'string'
        ? details.subagent
        : ''
  const task = typeof params?.task === 'string' ? params.task : ''
  const context = typeof params?.context === 'string' ? params.context : ''
  const expectedOutput = typeof params?.expectedOutput === 'string' ? params.expectedOutput : ''
  const canonicalToolCallId = canonicalSubagentToolCallId(details, result, toolCallId)
  const paramsLabel = isRecord(params?.subagent) && typeof params.subagent.label === 'string' ? params.subagent.label : ''
  const label = paramsLabel || subagentRunLabel(name, details, t)
  const detailed = toolDisplayMode === 'detailed'
  const traceMessages = subagentProcessTraceMessages(arrayFromUnknown(details?.messages))
  const status = subagentRunStatus(result, isStreaming, traceMessages)
  const output = resultText(result)
  const error = subagentRunError(status, traceMessages, output, result?.details)

  const payload: Omit<SubagentRunPayload, 'fingerprint'> = {
    runId: subagentRunId(details, name, task, canonicalToolCallId),
    ...(canonicalToolCallId ? { canonicalToolCallId } : {}),
    name,
    label,
    task,
    context,
    expectedOutput,
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
    output,
    ...error,
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

/**
 * 从 tool_execution_start/update/end 事件构建 subagent 运行载荷（纯函数，便于单测）。
 * - 必须使用事件 args 作为 params、partialResult/result 作为结果；
 * - isStreaming：start/update 传 true（running），end 传 false（done/error）；
 * - update/end 缺 args 时由调用方按 toolCallId 恢复 start 的 args 传入 cachedArgs，
 *   保证 task/context/expectedOutput 不丢；
 * - end 的 isError 合并进 result，使 aborted/timedOut/error 正确归为 error；
 * - previousPayload：事件本身缺少终态 details/messages 时回填上一次载荷的 trace/元数据；
 *   quickforgeTiming 仍以事件自带值优先。
 * 非 run_subagent 或无法取得 args 时返回 undefined。
 */
export function subagentRunPayloadFromToolEvent(
  event: ToolExecutionEvent,
  isStreaming: boolean,
  cachedArgs: Record<string, unknown> | undefined,
  toolDisplayMode: SubagentToolDisplayMode,
  t: SubagentRunI18n,
  previousPayload?: SubagentRunPayload,
): SubagentRunPayload | undefined {
  if (event.toolName !== 'run_subagent') return undefined
  const args = isRecord(event.args) ? event.args as Record<string, unknown> : cachedArgs
  if (!args) return undefined
  let rawResult = isStreaming ? event.partialResult : event.result
  if (!isStreaming && previousPayload) {
    let previousDetails: Record<string, unknown> | undefined
    try {
      const parsed = previousPayload.details ? JSON.parse(previousPayload.details) : undefined
      if (isRecord(parsed)) previousDetails = parsed
    } catch {
      // 非 JSON details 无法安全合并，保留终态原值。
    }
    const terminalDetails = isRecord(rawResult) && isRecord(rawResult.details) ? rawResult.details : undefined
    const hasTerminalMetadata = Boolean(terminalDetails && Object.keys(terminalDetails).length > 0)
    if (previousDetails && !hasTerminalMetadata) {
      rawResult = isRecord(rawResult)
        ? { ...rawResult, details: previousDetails }
        : { content: [], details: previousDetails }
    }
  }
  const rawIsError = isRecord(rawResult) && 'isError' in rawResult && typeof rawResult.isError === 'boolean'
    ? rawResult.isError
    : undefined
  const result = rawResult
    ? { ...rawResult, isError: event.isError ?? rawIsError }
    : event.isError
      ? { content: [], details: {}, isError: true }
      : undefined
  if (result?.isError && previousPayload?.output && !resultText(result).trim()) {
    result.content = [{ type: 'text', text: previousPayload.output }]
  }
  const build = (timing: QuickForgeToolTiming | undefined) => {
    const resultForBuild = timing
      ? {
          ...result,
          details: isRecord(result?.details)
            ? { ...result.details, quickforgeTiming: timing }
            : { quickforgeTiming: timing },
        }
      : result
    return buildSubagentRunPayload(args, resultForBuild, isStreaming, toolDisplayMode, t, event.toolCallId)
  }
  const payload = build(undefined)
  if (payload.timing === undefined && previousPayload?.timing) return build(previousPayload.timing)
  return payload
}

export type SubagentRunEventPublisherOptions = {
  /** 数据 store；默认全局 subagentRunStore（测试可传入独立实例，避免污染全局单例）。 */
  store?: SubagentRunStore
  /** i18n；默认返回 key 本身，真实调用方（ServerAgent / local-tools）传入全局 t。 */
  t?: SubagentRunI18n
  /** 当前工具显示模式；默认 concise。 */
  getToolDisplayMode?: () => SubagentToolDisplayMode
}

/**
 * tool_execution_start/update/end SSE 事件 → subagentRunStore 的实时发布器。
 * ServerAgent 持有它并在 tool_execution_* 分支调用，与 local-tools 的聊天渲染回填
 * 完全解耦（发布不依赖 ToolRenderer.render 被调用）。
 * - start：仅 run_subagent 参与；按 toolCallId 缓存 args 与 toolName，并用
 *   toolStartEventWithPartialResult 生成带 partialResult 的规范事件再构建载荷；
 * - update：事件缺 args/toolName 时回填缓存；previous payload 取 store 中同 runId
 *   的上一次载荷，避免运行中丢失 startedAt，并在终态空 details 时保留 trace/元数据；
 * - end：发布终态后清理该 toolCallId 的缓存；
 * - 非 run_subagent 或无法取得 toolCallId/args 的事件直接忽略，不影响其他工具。
 */
export class SubagentRunEventPublisher {
  private readonly store: SubagentRunStore
  private readonly t: SubagentRunI18n
  private readonly getToolDisplayMode: () => SubagentToolDisplayMode
  private readonly argsByToolCallId = new Map<string, Record<string, unknown>>()
  private readonly toolNamesByToolCallId = new Map<string, string>()

  constructor(options: SubagentRunEventPublisherOptions = {}) {
    this.store = options.store ?? subagentRunStore
    this.t = options.t ?? ((key) => key)
    this.getToolDisplayMode = options.getToolDisplayMode ?? (() => 'concise')
  }

  /** tool_execution_start：缓存 args/toolName 后按规范化事件发布 running 载荷。 */
  handleToolStart(event: ToolExecutionEvent): SubagentRunPayload | undefined {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    if (!toolCallId || event.toolName !== 'run_subagent') return undefined
    const args = isRecord(event.args) ? event.args as Record<string, unknown> : undefined
    if (!args) return undefined
    this.argsByToolCallId.set(toolCallId, args)
    this.toolNamesByToolCallId.set(toolCallId, event.toolName)
    return this.publish(toolStartEventWithPartialResult(event), true, undefined, toolCallId)
  }

  /** tool_execution_update：事件缺 args/toolName 时从缓存回填，发布 running 载荷。 */
  handleToolUpdate(event: ToolExecutionEvent): SubagentRunPayload | undefined {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    if (!toolCallId) return undefined
    const eventArgs = isRecord(event.args) ? event.args as Record<string, unknown> : undefined
    const args = eventArgs ?? this.argsByToolCallId.get(toolCallId)
    const toolName = typeof event.toolName === 'string' && event.toolName
      ? event.toolName
      : this.toolNamesByToolCallId.get(toolCallId)
    if (!args || toolName !== 'run_subagent') return undefined
    if (eventArgs) this.argsByToolCallId.set(toolCallId, eventArgs)
    this.toolNamesByToolCallId.set(toolCallId, toolName)
    const effectiveEvent = toolName !== event.toolName ? { ...event, toolName } : event
    return this.publish(effectiveEvent, true, args, toolCallId)
  }

  /** tool_execution_end：发布终态后清理该 toolCallId 的缓存。 */
  handleToolEnd(event: ToolExecutionEvent): SubagentRunPayload | undefined {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    if (!toolCallId) return undefined
    const eventArgs = isRecord(event.args) ? event.args as Record<string, unknown> : undefined
    const args = eventArgs ?? this.argsByToolCallId.get(toolCallId)
    const toolName = typeof event.toolName === 'string' && event.toolName
      ? event.toolName
      : this.toolNamesByToolCallId.get(toolCallId)
    try {
      if (!args || toolName !== 'run_subagent') return undefined
      const effectiveEvent = toolName !== event.toolName ? { ...event, toolName } : event
      return this.publish(effectiveEvent, false, args, toolCallId)
    } finally {
      this.argsByToolCallId.delete(toolCallId)
      this.toolNamesByToolCallId.delete(toolCallId)
    }
  }

  /** 清空按 toolCallId 的 args/toolName 缓存；在 ServerAgent.dispose 时调用。 */
  dispose(): void {
    this.argsByToolCallId.clear()
    this.toolNamesByToolCallId.clear()
  }

  private publish(
    event: ToolExecutionEvent,
    isStreaming: boolean,
    cachedArgs: Record<string, unknown> | undefined,
    toolCallId: string,
  ): SubagentRunPayload | undefined {
    const previousPayload = this.store.get(toolCallId)
    const payload = subagentRunPayloadFromToolEvent(
      event,
      isStreaming,
      cachedArgs,
      this.getToolDisplayMode(),
      this.t,
      previousPayload,
    )
    if (payload) this.store.publish(payload)
    return payload
  }
}
