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
  /** A pending `ask_user` card is waiting for an answer. */
  isAskPending: () => boolean
  /** Hand composer text to the ask card; true when the card consumed it. */
  submitAskText: (text: string) => boolean
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
  // 是否已经把该会话持久化的队列载入内存。载入之前，内存里的空队列不代表
  // 「用户清空了队列」，不能拿它覆盖 localStorage。
  let hydrated = false
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
      .then((accepted: boolean) => {
        if (deps.isDisposed()) return
        queuedPromptInFlight = undefined
        if (accepted === false) {
          // 没有真正交给服务端：消息必须留在队列里。restoreHead 对仍在队列里的条目是幂等的。
          messageQueue.restoreHead(item)
          if (agent.state.isStreaming) {
            // 只是回合还在跑（不是失败）：保留队首，等下一次 agent_end，不暂停。
            saveStoredMessageQueueState(sessionId, messageQueue.getState())
            return
          }
          // 无写租约 / 已销毁 / HTTP 失败：停下来，等用户处置，绝不悄悄丢掉。
          logger.warn('Queued message was not accepted by the agent; keeping it in the queue')
          messageQueue.setPaused(true)
          saveStoredMessageQueueState(sessionId, messageQueue.getState())
          return
        }
        messageQueue.removeItem(item.id)
        saveStoredMessageQueueState(sessionId, messageQueue.getState())
      })
      .catch((error) => {
        if (deps.isDisposed()) return
        queuedPromptInFlight = undefined
        logger.warn('Failed to auto-send queued message:', error)
        messageQueue.restoreHead(item)
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
    isAskPending: () => deps.isAskPending(),
    submitAskText: (text) => deps.submitAskText(text),
    onChange: () => schedulePersistMessageQueue(),
    onComposerCleared: () => deps.onComposerCleared(),
    submitJump: async (item) => {
      // While a question is waiting, "send now" answers it: steering would only
      // be drained after the ask settles (see the controller's Enter handler).
      if (deps.isAskPending() && deps.submitAskText(item.text)) {
        messageQueue.removeItem(item.id)
        return
      }
      if (!deps.getCapabilities().messageSteering || typeof (agent as ServerAgent).steer !== 'function' || !agent.state.isStreaming) {
        // Steering unavailable right now — send it as the next normal prompt.
        messageQueue.moveItemToHead(item.id)
        messageQueue.setPaused(false)
        const head = messageQueue.consumeHead()
        if (head) submitQueuedPrompt(head)
        return
      }
      try {
        const accepted = await serverAgent.steer({ role: 'user', content: item.text, timestamp: Date.now() })
        if (deps.isDisposed()) return
        if (accepted === false) {
          // 没交给服务端（无写租约 / 已销毁）：消息留在队列里并暂停，绝不悄悄删掉。
          logger.warn('Queued message was not accepted for steering; keeping it in the queue')
          messageQueue.setPaused(true)
          saveStoredMessageQueueState(sessionId, messageQueue.getState())
          return
        }
        messageQueue.removeItem(item.id)
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
      // 之后内存 state 就是权威（已与存储对过账），cleanup 可以安全覆盖。
      hydrated = true
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
        if (hydrated) {
          saveStoredMessageQueueState(sessionId, messageQueue.getState())
        } else {
          // 还没从本地恢复就被销毁（面板刚建好、effect 依赖又变了）：内存里的
          // 空队列不能当成「用户清空了队列」，否则会抹掉这个会话已存的排队消息。
          const stored = loadStoredMessageQueueState(sessionId)
          saveStoredMessageQueueState(sessionId, {
            items: stored.items,
            paused: stored.paused || messageQueue.getState().paused,
          })
        }
        // agent_end fired but the 250ms auto-send timer was just cancelled by
        // this cleanup — hand the persisted queue (saved above, incl. the
        // restored head) to the background drainer so it still auto-sends.
        const savedQueue = messageQueue.getState()
        if (hydrated && savedQueue.items.length > 0 && !savedQueue.paused && !agent.state.isStreaming) {
          void drainStoredMessageQueue(sessionId, serverAgent)
        }
      }
      messageQueue.cleanup()
    },
  }
}
