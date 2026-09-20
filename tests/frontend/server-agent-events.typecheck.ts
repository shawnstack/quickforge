// Compiled by server-agent-events-types.test.ts with the project's real compiler
// options. tests/ is not included in tsconfig.app.json, so Vitest transpilation
// or tsc -b alone would not validate these @ts-expect-error contracts.
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { ServerAgent, ServerAgentEvent, ServerAgentLocalEvent, ServerAgentWireEvent } from '../../src/lib/server-agent'
// `CustomAgentMessages` (the `user-with-attachments` / `artifact` roles) is
// augmented by ChatTypes.ts, which the real app build picks up as part of src/.
// This standalone program only has the fixture as a root name, so the
// augmentation has to be imported explicitly or `AgentMessage['role']` loses
// those members and server-agent.ts / tool-execution-events.ts fail TS2367.
import '../../src/components/chat/surface/ChatTypes'

declare const agent: ServerAgent
declare const message: AgentMessage
declare const wire: ServerAgentWireEvent
// Indexed access deliberately checks the actual private local-emission boundary,
// so widening emitToListeners to accept opaque wire also fails these negatives.
declare const emit: ServerAgent['emitToListeners']
const localEvent: ServerAgentLocalEvent = { type: 'agent_start' }
emit(localEvent)

authorLocalEvents()
function authorLocalEvents(): void {
  emit({ type: 'agent_start' })
  emit({ type: 'message_start', message })
  emit({ type: 'message_start' })
  emit({ type: 'message_end' })
  emit({ type: 'message_update', message })
  emit({ type: 'message_metadata_updated' })
  emit({ type: 'goal_updated', goal: null })
  emit({ type: 'error', error: 'failed' })
  emit({ type: 'agent_end', messages: [message], errorMessage: 'failed', status: 'error' })
  // @ts-expect-error local errors require a string
  emit({ type: 'error', error: 123 })
  // @ts-expect-error local goals cannot omit the authoritative goal field
  emit({ type: 'goal_updated' })
  // @ts-expect-error local goals must match GoalState
  emit({ type: 'goal_updated', goal: { id: 123 } })
  // @ts-expect-error invalidation must not make arbitrary messages legal
  emit({ type: 'message_start', message: 123 })
  // @ts-expect-error invalidation must not make arbitrary messages legal
  emit({ type: 'message_end', message: 'bad' })
  // @ts-expect-error local message updates still require an AgentMessage
  emit({ type: 'message_update', message: 123 })
  // @ts-expect-error local update must not accept a malformed standard event
  emit({ type: 'message_update', message, assistantMessageEvent: 'bad' })
  // @ts-expect-error only wire frames can have summary-only agent_end
  emit({ type: 'agent_end', messagesSummary: { count: 1 } })
  // @ts-expect-error local error ends must use an actual string error
  emit({ type: 'agent_end', messages: [message], errorMessage: 123, status: 'error' })
  // @ts-expect-error local end status only models the existing error extension
  emit({ type: 'agent_end', messages: [message], errorMessage: 'failed', status: 'invented' })
  // @ts-expect-error locally authored event names are closed
  emit({ type: 'future_event' })
  // @ts-expect-error metadata invalidations have no arbitrary payload
  emit({ type: 'message_metadata_updated', extra: true })
  // @ts-expect-error opaque wire is not a locally validated event
  emit(wire)
}

// Exact bidirectional assignability preserves the old public signature.
const legacySubscribe: (listener: (event: AgentEvent) => void) => () => void = agent.subscribe
const originalSubscribe: typeof agent.subscribe = legacySubscribe
originalSubscribe((event: AgentEvent) => { void event.type })

agent.subscribeEvents((event: ServerAgentEvent) => {
  const type: unknown = event.type
  void type
  // @ts-expect-error wire type is unknown, not a validated string
  const name: string = event.type
  void name
  if (event.type === 'message_start') {
    // @ts-expect-error matching a wire type does not validate its payload
    void event.message
  }
  // @ts-expect-error no universal index signature
  void event.futurePayload
  if ('message' in event && typeof event.message === 'object' && event.message !== null) {
    // Field guards are permitted, but must validate contents before treating it as AgentMessage.
    void event.message
  }
})
