import { toolStartEventWithPartialResult, type ToolExecutionEvent } from '@/lib/tool-execution-events'
import { isRecord } from './guards'
import { subagentRunPayloadFromToolEvent } from './payload'
import { subagentRunStore, type SubagentRunStore } from './store'
import { type SubagentRunI18n, type SubagentRunPayload, type SubagentToolDisplayMode } from './types'

type SubagentRunEventPublisherOptions = {
  /** 数据 store；默认全局 subagentRunStore（测试可传入独立实例，避免污染全局单例）。 */
  store?: SubagentRunStore
  /** i18n；默认返回 key 本身，真实调用方（ServerAgent / tool-renderers/subagent-tool-renderer）传入全局 t。 */
  t?: SubagentRunI18n
  /** 当前工具显示模式；默认 concise。 */
  getToolDisplayMode?: () => SubagentToolDisplayMode
}

/**
 * tool_execution_start/update/end SSE 事件 → subagentRunStore 的实时发布器。
 * ServerAgent 持有它并在 tool_execution_* 分支调用，与 tool-renderers/subagent-tool-renderer
 * 的聊天渲染回填完全解耦（发布不依赖 ToolRenderer.render 被调用）。
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
