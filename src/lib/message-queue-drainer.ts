/**
 * Background drain for persisted message queues.
 *
 * The panel host only auto-sends queued messages for the session it displays;
 * after the user switches away, `agent_end` still fires on the background task
 * (see useAgentManager) but nothing owns that session's in-memory queue. This
 * module drains the *persisted* queue straight from localStorage so queued
 * composer messages keep auto-sending in the background. Aborted / failed
 * turns pause the queue instead (user stays in control — same policy as the
 * panel host's agent_end handling).
 */

import {
  loadStoredMessageQueueState,
  removeQueuedMessage,
  saveStoredMessageQueueState,
} from './message-queue'

export interface QueueDrainAgent {
  readonly state: { isStreaming: boolean }
  prompt(text: string): Promise<unknown>
}

const activeDrains = new Map<string, Promise<void>>()

async function runStoredQueueDrain(sessionId: string, agent: QueueDrainAgent): Promise<void> {
  for (;;) {
    const state = loadStoredMessageQueueState(sessionId)
    if (state.paused || state.items.length === 0) return
    if (agent.state.isStreaming) return // Turn restarted — wait for the next agent_end.
    const item = state.items[0]
    try {
      await agent.prompt(item.text)
    } catch {
      // Keep the failed item at the head and pause; never rejects.
      saveStoredMessageQueueState(sessionId, { ...loadStoredMessageQueueState(sessionId), paused: true })
      return
    }
    // Re-read before writing: enqueues made during the prompt must survive.
    const current = loadStoredMessageQueueState(sessionId)
    saveStoredMessageQueueState(sessionId, { ...current, items: removeQueuedMessage(current.items, item.id) })
  }
}

/**
 * Sequentially auto-sends the persisted queue of one session. Per-session
 * single-flight: concurrent calls share the in-flight drain instead of
 * double-sending. The returned promise never rejects (prompt failures
 * converge into a paused queue).
 */
export function drainStoredMessageQueue(sessionId: string, agent: QueueDrainAgent): Promise<void> {
  const existing = activeDrains.get(sessionId)
  if (existing) return existing
  const drain: Promise<void> = runStoredQueueDrain(sessionId, agent).finally(() => {
    if (activeDrains.get(sessionId) === drain) activeDrains.delete(sessionId)
  })
  activeDrains.set(sessionId, drain)
  return drain
}

/** Pauses a non-empty, running stored queue; a no-op otherwise. */
export function pauseStoredMessageQueue(sessionId: string): void {
  const state = loadStoredMessageQueueState(sessionId)
  if (state.items.length === 0 || state.paused) return
  saveStoredMessageQueueState(sessionId, { ...state, paused: true })
}
