import type { AgentMessage } from './ChatTypes'
import { messageRenderIdentity } from './content-parts'

/**
 * 已提交行的 key 序列 + 「再追加一行」的 key。
 *
 * 流式期间 `messages` 不变、只有尾行每帧换新对象，所以已提交部分的 key 应当
 * 缓存下来（`useMemo`），尾行的 key 单独推导。旧实现每帧对
 * `[...messages, streamingAssistant]` 整体求一次 key，成本与窗口行数线性相关，
 * 而这一帧真正变化的只有最后一行。
 *
 * `appendKey` 与 `messageRenderKeys([...messages, message])[messages.length]`
 * 逐字一致（同一套 occurrence 后缀规则），这是 `message_end` 原地复用 DOM 的
 * 前提；等价性由 `tests/frontend/render-key-index.test.ts` 锁定。
 *
 * `appendKey` **只读**计数：如果它递增计数，同一行每帧都会拿到新 key，React
 * 会卸载重建整行（流式闪烁）。
 */
export function createRenderKeyIndex(messages: readonly AgentMessage[]): {
  keys: string[]
  appendKey: (message: AgentMessage) => string
} {
  const occurrences = new Map<string, number>()
  const keys = messages.map((message) => {
    const identity = messageRenderIdentity(message)
    const occurrence = occurrences.get(identity)
    if (occurrence === undefined) {
      occurrences.set(identity, 1)
      return identity
    }
    occurrences.set(identity, occurrence + 1)
    return `${identity}#${occurrence}`
  })
  return {
    keys,
    appendKey(message) {
      const identity = messageRenderIdentity(message)
      const occurrence = occurrences.get(identity) ?? 0
      return occurrence === 0 ? identity : `${identity}#${occurrence}`
    },
  }
}
