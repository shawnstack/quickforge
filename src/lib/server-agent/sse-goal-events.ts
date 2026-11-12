import { normalizeGoalState } from '@/lib/goal'
import type { ServerAgentCore } from './core'

/**
 * SSE `goal_updated`（原 `case 'goal_updated'`，逐字迁出）。
 *
 * 返回是否继续把原始帧转发给订阅者：同值回显或被更新帧取代时不转发
 * （避免无意义的重渲染），真实变更才转发一次。
 */
export function handleGoalUpdated(core: ServerAgentCore, event: Record<string, unknown>): boolean {
  const goalEvent = event as { goal?: unknown }
  // A goal frame never changes messages, so it must NOT bump the local
  // message stateVersion: doing so would discard an in-flight message
  // reconcile (lost messages). A missing `goal` field (older server)
  // preserves the current goal; an explicit null clears it; a stale
  // frame for the same goal id never regresses a newer revision.
  if (Object.prototype.hasOwnProperty.call(goalEvent, 'goal')) {
    // The raw frame is forwarded once below for a real change; a
    // same-value echo or a superseded revision returns early instead of
    // triggering a no-op re-render (never emit a second time here).
    if (!core.goalStateController.adopt(normalizeGoalState(goalEvent.goal)).changed) return false
  }
  return true
}
