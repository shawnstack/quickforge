import { normalizeToolArguments } from '@/lib/tool-param-summary'
import { isRecord, nonEmptyText, type ToolResultLike } from './guards'
import { buildSubagentRunPayload } from './payload'
import { MAX_TERMINAL_SUBAGENT_RUNS, type SubagentRunI18n, type SubagentRunPayload, type SubagentToolDisplayMode } from './types'

type SubagentRunMessageLike = {
  role?: string
  content?: unknown
  toolName?: string
  toolCallId?: string
  isError?: boolean
  details?: unknown
  timestamp?: unknown
}

/** 按出现顺序收集当前消息分支中 run_subagent 的 toolCall（id → args），终态/运行中提取共用。 */
function collectRunSubagentToolCalls(messages: readonly SubagentRunMessageLike[]): Map<string, Record<string, unknown>> {
  const calls = new Map<string, Record<string, unknown>>()
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'toolCall' || block.name !== 'run_subagent') continue
      const toolCallId = nonEmptyText(block.id)
      const args = normalizeToolArguments(block.arguments)
      if (toolCallId && args) calls.set(toolCallId, args)
    }
  }
  return calls
}

/**
 * 从当前消息分支提取最近结束的 run_subagent，返回轻量载荷。仅扫描传入消息，不依赖全局运行 store。
 * toolResult 时间戳优先用于排序；缺失时回退其在当前分支中的消息索引。
 * limit 语义为 1..MAX_TERMINAL_SUBAGENT_RUNS（非法值回退默认 3）。
 */
export function extractLatestTerminalSubagentRuns(
  messages: readonly SubagentRunMessageLike[],
  pendingToolCalls: Iterable<string> | undefined,
  toolDisplayMode: SubagentToolDisplayMode,
  t: SubagentRunI18n,
  limit = 3,
): SubagentRunPayload[] {
  const pending = new Set(pendingToolCalls ?? [])
  const calls = collectRunSubagentToolCalls(messages)

  const terminal: Array<{ payload: SubagentRunPayload; timestamp?: number; index: number }> = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'toolResult' || message.toolName !== 'run_subagent') continue
    const toolCallId = nonEmptyText(message.toolCallId)
    if (!toolCallId || pending.has(toolCallId)) continue
    const args = calls.get(toolCallId)
    if (!args) continue
    const result: ToolResultLike = {
      toolCallId,
      isError: message.isError,
      content: Array.isArray(message.content)
        ? message.content.filter((block): block is { type: string; text?: string } => isRecord(block) && typeof block.type === 'string')
        : undefined,
      details: message.details,
    }
    const payload = buildSubagentRunPayload(args, result, false, toolDisplayMode, t, toolCallId, { lightweight: true })
    if (payload.status !== 'done' && payload.status !== 'error') continue
    terminal.push({ payload, timestamp: typeof message.timestamp === 'number' ? message.timestamp : undefined, index })
  }

  terminal.sort((left, right) => {
    if (left.timestamp !== undefined && right.timestamp !== undefined) return right.timestamp - left.timestamp
    if (left.timestamp !== undefined) return -1
    if (right.timestamp !== undefined) return 1
    return right.index - left.index
  })

  const result: SubagentRunPayload[] = []
  const seen = new Set<string>()
  const boundedLimit = Math.min(MAX_TERMINAL_SUBAGENT_RUNS, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 3))
  for (const item of terminal) {
    const canonicalId = item.payload.canonicalToolCallId || item.payload.runId
    if (!canonicalId || seen.has(canonicalId)) continue
    seen.add(canonicalId)
    result.push(item.payload)
    if (result.length >= boundedLimit) break
  }
  return result
}

/**
 * 从当前消息分支提取仍在 pendingToolCalls 中的 run_subagent（运行中）。
 * 运行中的 run 尚无 toolResult，仅由 tool call 的 params 构建 running 载荷
 * （name/label 回落与 task 提取复用 buildSubagentRunPayload），按调用出现顺序返回；
 * 同一 toolCallId 的重复调用块在收集阶段已去重。
 */
export function extractRunningSubagentRuns(
  messages: readonly SubagentRunMessageLike[],
  pendingToolCalls: Iterable<string> | undefined,
  toolDisplayMode: SubagentToolDisplayMode,
  t: SubagentRunI18n,
): SubagentRunPayload[] {
  const pending = new Set(pendingToolCalls ?? [])
  if (pending.size === 0) return []
  const calls = collectRunSubagentToolCalls(messages)
  const runs: SubagentRunPayload[] = []
  for (const [toolCallId, args] of calls) {
    if (!pending.has(toolCallId)) continue
    runs.push(buildSubagentRunPayload(args, undefined, true, toolDisplayMode, t, toolCallId))
  }
  return runs
}
