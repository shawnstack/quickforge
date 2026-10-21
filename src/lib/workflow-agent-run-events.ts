import {
  subagentRunStore,
  type SubagentRunI18n,
  type SubagentRunPayload,
  type SubagentRunStore,
  type SubagentToolDisplayMode,
} from '@/lib/subagent-run-detail'
import type { ToolExecutionEvent } from '@/lib/tool-execution-events'
import { buildWorkflowRunView } from '@/lib/workflow-run-detail'
import { buildWorkflowSubagentRunPayload } from '@/lib/workflow-subagent-detail'

type WorkflowAgentRunEventPublisherOptions = {
  store?: SubagentRunStore
  t?: SubagentRunI18n
  getToolDisplayMode?: () => SubagentToolDisplayMode
}

/** Keep the replay cache small; the Inspector store itself already has an LRU. */
const MAX_PREVIOUS_PAYLOADS = 120

function isTerminalStatus(status: SubagentRunPayload['status']): boolean {
  return status === 'done' || status === 'error'
}

function isWorkflowDetails(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as { workflow?: unknown }).workflow === true)
}

/**
 * run_workflow 的 tool_execution_start/update/end → subagentRunStore。
 *
 * 与 SubagentRunEventPublisher（run_subagent）完全对称：ServerAgent 在 SSE 分支
 * 主动调用，不依赖聊天卡片是否渲染/是否被窗口化卸载。每个 workflow agent 用
 * `${workflowRunId}:agent:${agent.id}` 作为稳定 runId 发布，Inspector 已打开的
 * Tab 通过 store 订阅持续刷新，点击时也能直接取到最新快照。
 *
 * 服务端 details 预算可能整体裁掉 subagentRun 或压缩掉消息；发布器保留上一次
 * 载荷并在缺 trace 时回填（traceDropped 标记透出），避免详情页闪空。
 */
export class WorkflowAgentRunEventPublisher {
  private readonly store: SubagentRunStore
  private readonly t: SubagentRunI18n
  private readonly getToolDisplayMode: () => SubagentToolDisplayMode
  private readonly previousByRunId = new Map<string, SubagentRunPayload>()
  private readonly toolNamesByToolCallId = new Map<string, string>()

  constructor(options: WorkflowAgentRunEventPublisherOptions = {}) {
    this.store = options.store ?? subagentRunStore
    this.t = options.t ?? ((key) => key)
    this.getToolDisplayMode = options.getToolDisplayMode ?? (() => 'concise')
  }

  handleToolStart(event: ToolExecutionEvent): SubagentRunPayload[] {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    if (!toolCallId || event.toolName !== 'run_workflow') return []
    this.toolNamesByToolCallId.set(toolCallId, event.toolName)
    return this.publishFromEvent(event, true, toolCallId)
  }

  handleToolUpdate(event: ToolExecutionEvent): SubagentRunPayload[] {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    if (!toolCallId) return []
    const details = event.partialResult?.details ?? event.result?.details
    const cachedToolName = this.toolNamesByToolCallId.get(toolCallId)
    // A reconnect/resume can deliver updates before their start frame. The
    // workflow marker in details is authoritative, so do not require a cached
    // tool name (which would silently drop every live update in that case).
    const toolName = typeof event.toolName === 'string' && event.toolName
      ? event.toolName
      : cachedToolName
    if (toolName !== 'run_workflow' && !isWorkflowDetails(details)) return []
    this.toolNamesByToolCallId.set(toolCallId, 'run_workflow')
    return this.publishFromEvent(event, true, toolCallId)
  }

  handleToolEnd(event: ToolExecutionEvent): SubagentRunPayload[] {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    if (!toolCallId) return []
    const details = event.partialResult?.details ?? event.result?.details
    const cachedToolName = this.toolNamesByToolCallId.get(toolCallId)
    const toolName = typeof event.toolName === 'string' && event.toolName
      ? event.toolName
      : cachedToolName
    try {
      if (toolName !== 'run_workflow' && !isWorkflowDetails(details)) return []
      return this.publishFromEvent(event, false, toolCallId)
    } finally {
      this.toolNamesByToolCallId.delete(toolCallId)
    }
  }

  /** Clear caches on ServerAgent.dispose; published payloads stay in the store. */
  dispose(): void {
    this.previousByRunId.clear()
    this.toolNamesByToolCallId.clear()
  }

  private publishFromEvent(event: ToolExecutionEvent, isStreaming: boolean, toolCallId: string): SubagentRunPayload[] {
    const details = event.partialResult?.details ?? event.result?.details
    const view = buildWorkflowRunView({ details }, isStreaming)
    if (!view) return []
    const workflowRunId = view.runId || toolCallId
    const published: SubagentRunPayload[] = []
    for (const agent of view.agents) {
      const runId = `${workflowRunId}:agent:${agent.id}`
      // Prefer the store: it is the shared source of truth and may have been
      // safely corrected by the renderer with a fuller terminal trace. The
      // local cache only matters after store LRU eviction.
      const previous = this.store.get(runId) ?? this.previousByRunId.get(runId)
      const payload = buildWorkflowSubagentRunPayload(workflowRunId, agent, this.t, {
        toolDisplayMode: this.getToolDisplayMode(),
        previous,
      })
      // A late/queued frame must never pull an already finished run back to
      // running; otherwise the Inspector would lose its terminal result.
      const existing = this.store.get(payload.runId)
      if (existing && isTerminalStatus(existing.status) && !isTerminalStatus(payload.status)) continue
      this.store.publish(payload)
      this.remember(payload)
      published.push(payload)
    }
    return published
  }

  private remember(payload: SubagentRunPayload): void {
    this.previousByRunId.delete(payload.runId)
    this.previousByRunId.set(payload.runId, payload)
    while (this.previousByRunId.size > MAX_PREVIOUS_PAYLOADS) {
      const oldest = this.previousByRunId.keys().next().value
      if (oldest === undefined) break
      this.previousByRunId.delete(oldest)
    }
  }
}
