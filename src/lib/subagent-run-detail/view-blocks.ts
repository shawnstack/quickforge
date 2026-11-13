import { isRecord, nonEmptyText } from './guards'
import { subagentRunModelLabel } from './payload'
import { type SubagentRunPayload } from './types'

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

/**
 * 运行详情侧栏（SubagentRunDetailContent）内部块的展示顺序，单一事实来源。
 * 顺序与 Git 历史最终态（32be493 的聊天内 details）保持一致：
 * task/context/expectedOutput → 运行信息 → 详细摘要 → trace → 错误正文 → 非重复 output → input → details。
 * 渲染器按此顺序输出；单元测试直接断言该顺序。
 */
type SubagentRunBodyBlock = 'task' | 'meta' | 'summary' | 'trace' | 'error' | 'output' | 'input' | 'details'

export function subagentRunBodyBlocks(
  payload: Pick<
    SubagentRunPayload,
    'task' | 'context' | 'expectedOutput' | 'model' | 'thinkingLevel' | 'status' | 'detailed' | 'traceMessages' | 'errorMessage' | 'errorSource' | 'output' | 'input' | 'details'
  >,
): SubagentRunBodyBlock[] {
  const blocks: SubagentRunBodyBlock[] = []
  if (payload.task || payload.context || payload.expectedOutput) blocks.push('task')
  // 以「可显示内容」为准：旧会话 details.model 可能只有 {mode,inherited} 而无模型标识，
  // 此时不产出空块（与渲染层 subagentRunModelLabel 的判断保持一致）。
  if (subagentRunModelLabel(payload.model) || payload.thinkingLevel) blocks.push('meta')
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
