import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { BackgroundCommandSnapshot } from '../server-agent-types'
import type { ServerAgentCore } from './core'

/**
 * 会话级杂项事件：error / background_commands / session_lease
 * （原 `case 'error'` / `background_commands` / `session_lease`，逐字迁出；
 * `title_updated` / `session_forked` 纯转发，留在分发层）。
 */

export function handleError(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const errMsg = (event as { error?: string }).error
  core.state.errorMessage = errMsg || 'Unknown error'
  core.state.pendingToolApproval = null
  return true
}

export function handleBackgroundCommands(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const backgroundEvent = event as { backgroundCommands?: BackgroundCommandSnapshot[]; messages?: AgentMessage[] }
  if (Array.isArray(backgroundEvent.backgroundCommands)) {
    core.state.backgroundCommands = backgroundEvent.backgroundCommands
  }
  if (Array.isArray(backgroundEvent.messages)) {
    const incoming = backgroundEvent.messages
    if (incoming.length >= core.state.messages.length) {
      core.state.messages = incoming
    } else {
      // 本地已乐观追加了服务端尚未登记的消息（快照更短），整表替换会吞掉它们。
      // 改为按 toolCallId 就地合并：后台命令退出帧的作用只是把对应
      // toolResult 的 details 落成终态，不需要整表覆盖。
      const incomingByToolCall = new Map<string, AgentMessage>()
      for (const message of incoming) {
        if (message?.role !== 'toolResult') continue
        const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
        if (toolCallId) incomingByToolCall.set(toolCallId, message)
      }
      if (incomingByToolCall.size > 0) {
        let replaced = false
        const merged: AgentMessage[] = core.state.messages.map((message) => {
          if (message?.role !== 'toolResult') return message
          const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
          const next = toolCallId ? incomingByToolCall.get(toolCallId) : undefined
          if (!next) return message
          replaced = true
          return next
        })
        if (replaced) core.state.messages = merged
      }
    }
  }
  core.stateVersion++
  return true
}

export function handleSessionLease(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  // Another client acquired/released the write lease. Adopting this frame
  // is what flips a secondary tab into (or out of) read-only without
  // polling: the holder's heartbeat never broadcasts, only hand-overs do.
  const leaseEvent = event as { lease?: { clientId?: string; expiresAt?: string } | null }
  core.sessionLeaseController.applyWireLease(leaseEvent.lease ?? null)
  return false
}
