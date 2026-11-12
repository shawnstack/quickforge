import { toolStartEventWithPartialResult, upsertToolResult, type ToolExecutionEvent } from '@/lib/tool-execution-events'
import type { ServerAgentCore } from './core'

/**
 * tool_execution_start / update / end（原 `case 'tool_execution_*'`，逐字迁出）。
 * 同时喂给 subagentRunStore / workflowRunStore 的实时发布器。
 */

export function handleToolExecutionStart(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const toolEvent = event as ToolExecutionEvent
  if (toolEvent.toolCallId) {
    core.state.messages = upsertToolResult(core.state.messages, toolStartEventWithPartialResult(toolEvent, core.sessionId), true)
    core.state.pendingToolCalls = new Set([...core.state.pendingToolCalls, toolEvent.toolCallId])
    // 工具开始执行意味着对应审批已落定：权威清除审批态（CAS 同
    // approveToolCall/rejectToolCall，避免误杀期间到达的新审批）。
    const settledApproval = core.state.pendingToolApproval
    if (settledApproval && settledApproval.toolCallId === toolEvent.toolCallId) {
      core.state.pendingToolApproval = null
    }
    core.stateVersion++
    core.subagentRunPublisher.handleToolStart(toolEvent)
    core.workflowAgentRunPublisher.handleToolStart(toolEvent)
  }
  return true
}

export function handleToolExecutionUpdate(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const toolEvent = event as ToolExecutionEvent
  core.state.messages = upsertToolResult(core.state.messages, toolEvent, true)
  if (toolEvent.toolCallId) {
    core.state.pendingToolCalls = new Set([...core.state.pendingToolCalls, toolEvent.toolCallId])
  }
  core.stateVersion++
  core.subagentRunPublisher.handleToolUpdate(toolEvent)
  core.workflowAgentRunPublisher.handleToolUpdate(toolEvent)
  return true
}

export function handleToolExecutionEnd(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const toolEvent = event as ToolExecutionEvent
  core.state.messages = upsertToolResult(core.state.messages, toolEvent, false)
  if (toolEvent.toolCallId) {
    const pending = new Set(core.state.pendingToolCalls)
    pending.delete(toolEvent.toolCallId)
    core.state.pendingToolCalls = pending
  }
  core.stateVersion++
  core.subagentRunPublisher.handleToolEnd(toolEvent)
  core.workflowAgentRunPublisher.handleToolEnd(toolEvent)
  return true
}
