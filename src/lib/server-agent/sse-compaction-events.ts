import type { ServerAgentCompactionNotice, ServerAgentContextCompaction, ServerAgentContextUsage } from '../server-agent-types'
import type { ServerAgentCore } from './core'

/**
 * 压缩通知与持久化降级事件（原 `case 'auto_compact_completed'` /
 * `auto_compact_state` / `persist_degraded`，逐字迁出；`auto_compact_failed`
 * 纯转发，留在分发层）。
 */

export function handleAutoCompactCompleted(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const compactEvent = event as { contextCompaction?: ServerAgentContextCompaction | null; contextUsage?: ServerAgentContextUsage | null }
  if (compactEvent.contextCompaction !== undefined) {
    core.state.contextCompaction = compactEvent.contextCompaction
  }
  if (compactEvent.contextUsage !== undefined) {
    core.state.contextUsage = compactEvent.contextUsage
  }
  return true
}

export function handleAutoCompactState(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  // Authoritative in-flight phase (see COMPACTION_NOTICE_PHASES on the
  // server). Adopting it here — rather than deriving the row from
  // approval/completion events — is what makes the notice impossible to
  // desync: every server enter/exit publishes the complete state, and
  // `null` unambiguously means "nothing running".
  const noticeEvent = event as { compactionNotice?: ServerAgentCompactionNotice | null }
  core.state.compactionNotice = noticeEvent.compactionNotice ?? null
  return true
}

export function handlePersistDegraded(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  // Authoritative persist was skipped after CAS conflicts (or recovered).
  // Update the flag and forward so the panel can show/hide the warning.
  const degradedEvent = event as { persistDegraded?: unknown }
  core.state.persistDegraded = degradedEvent.persistDegraded === true ? true : undefined
  return true
}
