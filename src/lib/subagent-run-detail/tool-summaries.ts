import { normalizeToolArguments, summarizeParams } from '@/lib/tool-param-summary'
import { isRecord } from './guards'
import { type SubagentRunPayload } from './types'

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
      const summary = summarizeParams(chunk.name, normalizeToolArguments(chunk.arguments))
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
