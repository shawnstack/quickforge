/**
 * Shape a session event for the SSE wire.
 *
 * `message_update` originates from pi-agent-core and carries two copies of the
 * accumulated assistant message: `message` and `assistantMessageEvent.partial`.
 * The browser only consumes `message`, so forwarding the upstream event
 * verbatim doubles every streaming frame. This is the one place that decides
 * what leaves the process; in-process subscribers (ACP, goals, hooks) keep the
 * full event object.
 */
export function toSseWireEvent(event) {
  if (event?.type !== 'message_update') return event
  // Keep the rest of the event payload (ids, versions, diagnostics) intact;
  // only the duplicated accumulated body is transport noise.
  const { assistantMessageEvent: _assistantMessageEvent, ...wire } = event
  return wire
}
