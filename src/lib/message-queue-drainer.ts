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
  /**
   * 发出去返回 `true`；**明确没发出去**（已销毁 / 无写租约 / 已在流式 / HTTP 失败）
   * 返回 `false`。返回 `void` 视为成功仅为兼容既有实现，真实 agent 必须给明确结果。
   */
  prompt(text: string): Promise<boolean | void>
}

const activeDrains = new Map<string, Promise<void>>()

async function runStoredQueueDrain(sessionId: string, agent: QueueDrainAgent): Promise<void> {
  for (;;) {
    const state = loadStoredMessageQueueState(sessionId)
    if (state.paused || state.items.length === 0) return
    if (agent.state.isStreaming) return // Turn restarted — wait for the next agent_end.
    const item = state.items[0]
    let accepted: boolean
    try {
      // 「promise 没 reject」不等于发出去了：静默不发送必须按失败处理。
      accepted = (await agent.prompt(item.text)) !== false
    } catch {
      accepted = false
    }
    if (!accepted) {
      // 回合正在跑：不是失败，只是还不能发。保留队首，等下一次 agent_end。
      if (agent.state.isStreaming) return
      // 没发出去就绝不删条目：保留队首并暂停，等用户重试。
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
