/**
 * Queued-composer-message subsystem for `ChatPanelHost`.
 *
 * Enter while streaming enqueues a message instead of sending it. This module
 * owns the panel controller, the 250ms auto-send timer, the debounced persist,
 * session hydrate-on-mount, the agent_end drain policy, and the cleanup that
 * hands a still-pending queue to the background drainer.
 *
 * Plain setup function (no React hooks): the host calls it from the main
 * effect so the effect count / ordering stays unchanged.
 */

import { logger } from '@/lib/logger'
import {
  loadStoredMessageQueueState,
  saveStoredMessageQueueState,
  type QueuedMessage,
} from '@/lib/message-queue'
import { drainStoredMessageQueue } from '@/lib/message-queue-drainer'
import type { ServerAgent } from '@/lib/server-agent'
import type { ChatCapabilities } from '@/lib/chat-capabilities'
import { createMessageQueuePanelController } from '../panel-decoration/message-queue'

type MessageQueueAgent = {
  state: { isStreaming: boolean }
}

export type MessageQueueWiringDeps = {
  panel: HTMLElement
  sessionId: string
  agent: MessageQueueAgent
  sideChatMode: boolean
  readOnly: boolean
  isDisposed: () => boolean
  getCapabilities: () => ChatCapabilities
  /** Controller cleared the composer: host hides menus / syncs the draft. */
  onComposerCleared: () => void
}

export type MessageQueueWiring = {
  /** Panel controller (call `update()` from the decorate pass). */
  controller: ReturnType<typeof createMessageQueuePanelController>
  isActive: () => boolean
  /** Restore the persisted queue for this session (called from panel initialization). */
  hydrate: () => void
  /** agent_end drain / pause policy. */
  onAgentEnd: (status?: string) => void
  cleanup: () => void
}

export function setupMessageQueueWiring(deps: MessageQueueWiringDeps): MessageQueueWiring {
  const { panel, sessionId, agent } = deps
  const serverAgent = agent as unknown as ServerAgent
  const messageQueueActive = () => (
    !deps.sideChatMode
    && !deps.readOnly
    && typeof serverAgent.prompt === 'function'
  )
  let queuedPromptTimer: number | undefined
  let queuedPromptInFlight: QueuedMessage | undefined
  const cancelQueuedPrompt = () => {
    if (queuedPromptTimer === undefined) return
    window.clearTimeout(queuedPromptTimer)
    queuedPromptTimer = undefined
  }
  const submitQueuedPrompt = (item: QueuedMessage) => {
    queuedPromptTimer = undefined
    if (deps.isDisposed()) return
    if (agent.state.isStreaming) {
      // Keep the head in the queue until a prompt is actually accepted.
      return
    }
    queuedPromptInFlight = item
    void Promise.resolve()
      .then(() => serverAgent.prompt(item.text))
      .then(() => {
        if (deps.isDisposed()) return
        queuedPromptInFlight = undefined
        messageQueue.removeItem(item.id)
        saveStoredMessageQueueState(sessionId, messageQueue.getState())
      })
      .catch((error) => {
        if (deps.isDisposed()) return
        queuedPromptInFlight = undefined
        logger.warn('Failed to auto-send queued message:', error)
        messageQueue.setPaused(true)
        saveStoredMessageQueueState(sessionId, messageQueue.getState())
      })
  }
  let messageQueuePersistTimer: number | undefined
  const cancelMessageQueuePersist = () => {
    if (messageQueuePersistTimer === undefined) return
    window.clearTimeout(messageQueuePersistTimer)
    messageQueuePersistTimer = undefined
  }
  const schedulePersistMessageQueue = () => {
    if (!messageQueueActive()) return
    cancelMessageQueuePersist()
    messageQueuePersistTimer = window.setTimeout(() => {
      messageQueuePersistTimer = undefined
      saveStoredMessageQueueState(sessionId, messageQueue.getState())
    }, 300)
  }
  const messageQueue = createMessageQueuePanelController({
    panel,
    enabled: messageQueueActive(),
    isStreaming: () => agent.state.isStreaming,
    steeringEnabled: () => deps.getCapabilities().messageSteering
      && typeof serverAgent.steer === 'function',
    onChange: () => schedulePersistMessageQueue(),
    onComposerCleared: () => deps.onComposerCleared(),
    submitJump: async (item) => {
      if (!deps.getCapabilities().messageSteering || typeof (agent as ServerAgent).steer !== 'function' || !agent.state.isStreaming) {
        // Steering unavailable right now — send it as the next normal prompt.
        messageQueue.moveItemToHead(item.id)
        messageQueue.setPaused(false)
        const head = messageQueue.consumeHead()
        if (head) submitQueuedPrompt(head)
        return
      }
      try {
        await serverAgent.steer({ role: 'user', content: item.text, timestamp: Date.now() })
        if (!deps.isDisposed()) messageQueue.removeItem(item.id)
      } catch (error) {
        logger.warn('Failed to steer queued message:', error)
      }
    },
    resumeQueue: () => {
      const head = messageQueue.consumeHead()
      if (head) submitQueuedPrompt(head)
    },
  })

  return {
    controller: messageQueue,
    isActive: messageQueueActive,

    hydrate() {
      if (deps.isDisposed()) return
      // Restore queued messages persisted for this session (reload mid-turn).
      const storedQueue = loadStoredMessageQueueState(sessionId)
      if (storedQueue.items.length > 0 || storedQueue.paused) {
        messageQueue.hydrate(storedQueue)
      }
      // Switch-back fallback: a turn settled while this session was in the
      // background leaves a non-empty queue with no agent_end to come — reuse
      // the regular 250ms auto-send scheduling for the restored head.
      if (messageQueueActive() && !agent.state.isStreaming
        && storedQueue.items.length > 0 && !storedQueue.paused
        && queuedPromptTimer === undefined && queuedPromptInFlight === undefined) {
        queuedPromptTimer = window.setTimeout(() => {
          const head = messageQueue.getState().items[0]
          if (head) submitQueuedPrompt(head)
        }, 250)
      }
    },

    onAgentEnd(status) {
      // Queue drain: a settled turn auto-sends the next queued message;
      // aborted / errored turns pause the queue so the user stays in control.
      if (!messageQueueActive()) return
      const endedStatus = status
      const queueSnapshot = messageQueue.getState()
      if ((endedStatus === 'aborted' || endedStatus === 'error') && queueSnapshot.items.length > 0) {
        if (!queueSnapshot.paused) messageQueue.setPaused(true)
      } else if (!queueSnapshot.paused && queueSnapshot.items.length > 0 && queuedPromptTimer === undefined && queuedPromptInFlight === undefined) {
        queuedPromptTimer = window.setTimeout(() => {
          const head = messageQueue.getState().items[0]
          if (head) submitQueuedPrompt(head)
        }, 250)
      }
    },

    cleanup() {
      cancelMessageQueuePersist()
      cancelQueuedPrompt()
      if (messageQueueActive()) {
        if (queuedPromptInFlight) messageQueue.restoreHead(queuedPromptInFlight)
        queuedPromptInFlight = undefined
        saveStoredMessageQueueState(sessionId, messageQueue.getState())
        // agent_end fired but the 250ms auto-send timer was just cancelled by
        // this cleanup — hand the persisted queue (saved above, incl. the
        // restored head) to the background drainer so it still auto-sends.
        const savedQueue = messageQueue.getState()
        if (savedQueue.items.length > 0 && !savedQueue.paused && !agent.state.isStreaming) {
          void drainStoredMessageQueue(sessionId, serverAgent)
        }
      }
      messageQueue.cleanup()
    },
  }
}
