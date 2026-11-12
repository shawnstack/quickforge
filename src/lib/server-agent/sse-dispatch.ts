import type { ServerAgentCore } from './core'
import { handleAskUserAnswered, handleAskUserRequired, handleToolApprovalRequired } from './sse-approvals'
import { handleAutoCompactCompleted, handleAutoCompactState, handlePersistDegraded } from './sse-compaction-events'
import { handleGoalUpdated } from './sse-goal-events'
import { handleMessageEnd, handleMessagesReplaced, handleResync, handleTurnEnd } from './sse-message-sync'
import { handleAgentEnd, handleAgentStart, handleMessageUpdate } from './sse-run-lifecycle'
import { handleStateFrame } from './sse-state-frame'
import { handleBackgroundCommands, handleError, handleSessionLease } from './sse-session-events'
import { handleToolExecutionEnd, handleToolExecutionStart, handleToolExecutionUpdate } from './sse-tool-events'

/**
 * SSE 事件分发（原 `ServerAgent.handleSseEvent` 的 switch，控制流语义逐字保留：
 * 返回 `true` 的族处理器等价于原来的 `break`——由分发层统一把原始帧转发给
 * 订阅者；返回 `false` 等价于原来的 `return`——该族自行处理转发（含异步
 * 收尾路径里的转发）或刻意不转发）。
 */
export function handleServerAgentSseEvent(core: ServerAgentCore, event: Record<string, unknown>): void {
  if (!core.noteSseEvent(event)) return
  const type = event.type as string

  let forward: boolean
  switch (type) {
    case 'state': {
      forward = handleStateFrame(core, event)
      break
    }

    case 'agent_start': {
      forward = handleAgentStart(core)
      break
    }

    case 'agent_end': {
      forward = handleAgentEnd(core, event)
      break
    }

    case 'message_end': {
      forward = handleMessageEnd(core, event)
      break
    }

    case 'turn_end': {
      forward = handleTurnEnd(core, event)
      break
    }

    case 'messages_replaced': {
      forward = handleMessagesReplaced(core, event)
      break
    }

    case 'resync': {
      forward = handleResync(core)
      break
    }

    case 'error': {
      forward = handleError(core, event)
      break
    }

    case 'title_updated': {
      // Title was updated by server AI generation — no state change needed
      forward = true
      break
    }

    case 'session_forked': {
      forward = true
      break
    }

    case 'goal_updated': {
      forward = handleGoalUpdated(core, event)
      break
    }

    case 'background_commands': {
      forward = handleBackgroundCommands(core, event)
      break
    }

    case 'tool_execution_start': {
      forward = handleToolExecutionStart(core, event)
      break
    }

    case 'tool_execution_update': {
      forward = handleToolExecutionUpdate(core, event)
      break
    }

    case 'tool_execution_end': {
      forward = handleToolExecutionEnd(core, event)
      break
    }

    case 'auto_compact_completed': {
      forward = handleAutoCompactCompleted(core, event)
      break
    }

    case 'message_update': {
      forward = handleMessageUpdate(core, event)
      break
    }

    case 'auto_compact_state': {
      forward = handleAutoCompactState(core, event)
      break
    }

    case 'auto_compact_failed':
    case 'message_start':
    case 'turn_start':
      // Forward as-is
      forward = true
      break

    case 'persist_degraded': {
      forward = handlePersistDegraded(core, event)
      break
    }

    case 'session_lease': {
      forward = handleSessionLease(core, event)
      break
    }

    case 'tool_approval_required': {
      forward = handleToolApprovalRequired(core, event)
      break
    }

    case 'ask_user_required': {
      forward = handleAskUserRequired(core, event)
      break
    }

    case 'ask_user_answered': {
      forward = handleAskUserAnswered(core)
      break
    }

    default:
      // Unknown event types are forwarded as-is (legacy boundary contract).
      forward = true
      break
  }

  // Forward event to subscribers
  if (forward) core.forwardWireEvent(event)
}
