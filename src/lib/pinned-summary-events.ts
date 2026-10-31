/**
 * Agent events that can change the pinned-summary projections.
 *
 * `tool_execution_update` is deliberately absent. It streams tool output at the
 * server's coalesced frame rate (~20fps) and only mutates a toolResult row in
 * place; every projection here changes on a structural boundary instead:
 *
 * - todos / terminal subagent runs: a toolResult lands (`tool_execution_end`,
 *   `message_end`);
 * - running subagent runs: the pending tool-call set changes
 *   (`tool_execution_start` / `tool_execution_end`);
 * - background commands: their own `background_commands` snapshot;
 * - goal / session replacements: their dedicated events.
 *
 * Subscribing to the delta stream would only re-derive those projections — and
 * re-render the whole App — without changing anything visible.
 */
const PINNED_SUMMARY_EVENTS = new Set([
  'tool_execution_start',
  'tool_execution_end',
  'message_end',
  'messages_replaced',
  'agent_end',
  'background_commands',
  'goal_updated',
])

export function shouldInvalidatePinnedSummary(eventType: string): boolean {
  return PINNED_SUMMARY_EVENTS.has(eventType)
}
