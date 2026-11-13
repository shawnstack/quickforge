import type { AppTextKey } from '@/lib/i18n'
import { modelDisplayLabel } from '@/lib/model-display-label'
import { subagentProcessTraceMessages } from '@/lib/subagent-process-trace'
import { extractQuickForgeTiming, type QuickForgeToolTiming, type ToolExecutionEvent } from '@/lib/tool-execution-events'
import {
  arrayFromUnknown,
  errorTextFromUnknown,
  isRecord,
  jsonText,
  messageTextLength,
  nonEmptyText,
  resultText,
  stableHash,
  stringArrayFromUnknown,
  stringifyValue,
  type ToolResultLike,
} from './guards'
import {
  subagentRunModelFromDetails,
  subagentRunThinkingLevelFromDetails,
  type SubagentRunErrorSource,
  type SubagentRunI18n,
  type SubagentRunModel,
  type SubagentRunPayload,
  type SubagentRunStatus,
  type SubagentRunThinkingLevel,
  type SubagentToolDisplayMode,
} from './types'

/** 运行详情「模型」展示名：provider/id 优先，缺失时回落 name；都没有时返回空串。 */
export function subagentRunModelLabel(model: SubagentRunModel | undefined): string {
  if (!model) return ''
  const provider = model.provider || model.providerId || ''
  const id = model.id || model.modelId || model.catalogId || ''
  if (provider && id) return modelDisplayLabel({ provider, id })
  return model.name || id || provider || ''
}

/** 思考等级复用的 i18n key（与主 Agent 思考等级控件文案一致）。 */
export function subagentThinkingLevelLabelKey(level: SubagentRunThinkingLevel): AppTextKey {
  switch (level) {
    case 'low': return 'thinkingLow'
    case 'medium': return 'thinkingMedium'
    case 'high': return 'thinkingHigh'
    case 'xhigh': return 'thinkingXHigh'
    default: return 'thinkingOff'
  }
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



export function subagentRunError(
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

/** subagent 标签：优先 details.label，内置名回落（聊天摘要卡与详情页共用本实现）。 */
function subagentRunLabel(name: string, details: unknown, t: SubagentRunI18n): string {
  if (isRecord(details) && typeof details.label === 'string' && details.label) return details.label
  if (name === 'general') return t('subagentGeneral')
  if (name === 'explore') return t('subagentExplore')
  return name || t('runSubagent')
}

function subagentRunStatusLabel(status: SubagentRunStatus, label: string, t: SubagentRunI18n): string {
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

function canonicalSubagentToolCallId(details: unknown, result: ToolResultLike | undefined, toolCallId?: string): string {
  const explicitToolCallId = typeof toolCallId === 'string' && toolCallId ? toolCallId : ''
  const resultToolCallId = typeof result?.toolCallId === 'string' && result.toolCallId ? result.toolCallId : ''
  const detailsToolCallId = isRecord(details) && typeof details.toolCallId === 'string' && details.toolCallId ? details.toolCallId : ''
  return explicitToolCallId || resultToolCallId || detailsToolCallId
}

/**
 * 从 run_subagent 的 params/result.details 构建规范化载荷。
 * 聊天摘要与 Workspace Inspector 运行详情 Tab 共用此函数，保证状态和内容一致。
 * toolCallId 为可选显式稳定 run id（SSE 事件路径传入父工具调用 id）。
 * options.lightweight=true 时返回轻量载荷（traceMessages/input/details 置空占位），
 * 仅供置顶摘要列表使用：status/error 仍按完整结果本地推导，其余字段照常保留；
 * 点击打开时 Inspector 优先 subagentRunStore 快照，未命中时详情缺 trace/input/details。
 * 默认（不传或 false）返回完整载荷，行为与轻量化之前完全一致。
 */
export function buildSubagentRunPayload(
  params: Record<string, unknown> | undefined,
  result: ToolResultLike | undefined,
  isStreaming: boolean | undefined,
  toolDisplayMode: SubagentToolDisplayMode,
  t: SubagentRunI18n,
  toolCallId?: string,
  options?: { lightweight?: boolean },
): SubagentRunPayload {
  const lightweight = options?.lightweight === true
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
    traceMessages: lightweight ? [] : traceMessages,
    tools: arrayFromUnknown(details?.tools),
    pendingToolCalls: stringArrayFromUnknown(details?.pendingToolCalls),
    input: lightweight ? '' : stringifyValue(params),
    details: lightweight ? '' : stringifyValue(result?.details),
    output,
    ...error,
    model: subagentRunModelFromDetails(details?.model),
    thinkingLevel: subagentRunThinkingLevelFromDetails(details?.thinkingLevel),
    detailed,
  }
  return { ...payload, fingerprint: subagentRunFingerprint(payload) }
}

/** 解析上一次载荷 details JSON 为可回填对象；非 JSON / 非对象时无法安全合并，返回 undefined。 */
function subagentRunDetailsRecord(previousPayload: Pick<SubagentRunPayload, 'details'>): Record<string, unknown> | undefined {
  try {
    const parsed = previousPayload.details ? JSON.parse(previousPayload.details) : undefined
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 从 tool_execution_start/update/end 事件构建 subagent 运行载荷（纯函数，便于单测）。
 * - 必须使用事件 args 作为 params、partialResult/result 作为结果；
 * - isStreaming：start/update 传 true（running），end 传 false（done/error）；
 * - update/end 缺 args 时由调用方按 toolCallId 恢复 start 的 args 传入 cachedArgs，
 *   保证 task/context/expectedOutput 不丢；
 * - end 的 isError 合并进 result，使 aborted/timedOut/error 正确归为 error；
 * - previousPayload：running 帧缺 details 字段（如 pendingToolCalls/messages）时按字段
 *   回填上一次载荷（事件自带值优先，保证同 run 内状态单调不回跳，工具行不闪 done）；
 *   终态 details 无元数据时整份回填上一次载荷的 trace/元数据；
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
  if (isStreaming && previousPayload) {
    const previousDetails = subagentRunDetailsRecord(previousPayload)
    if (previousDetails) {
      const runningDetails = isRecord(rawResult) && isRecord(rawResult.details) ? rawResult.details : undefined
      const missingDetails: Record<string, unknown> = {}
      for (const key of Object.keys(previousDetails)) {
        if (!runningDetails || !(key in runningDetails)) missingDetails[key] = previousDetails[key]
      }
      if (Object.keys(missingDetails).length > 0) {
        rawResult = isRecord(rawResult)
          ? { ...rawResult, details: { ...missingDetails, ...runningDetails } }
          : { content: [], details: missingDetails }
      }
    }
  }
  if (!isStreaming && previousPayload) {
    const previousDetails = subagentRunDetailsRecord(previousPayload)
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
