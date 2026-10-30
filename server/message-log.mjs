/**
 * 会话消息日志（message log）：把「消息数组的变化」变成可对齐的帧语义。
 *
 * 设计前提（双端实时一致的地基）：
 *
 * 1. **单一真相**：会话内存里的 `agent.state.messages` 是权威数组，**下标即 seq**。
 *    所有对外投影都从这里出发，不再有「本地长度 == 服务端下标」的隐含假设。
 * 2. **`logVersion` 只随消息真的变化递增**（append / replace / truncate），与
 *    `stateVersion`（每个 SSE 事件都 +1，含 token delta）分离。前者回答「消息
 *    变了吗」，后者回答「帧新不新」，两者混用是此前多处对账误判的根源。
 * 3. **每个带消息的定稿帧都携带 `messagesAfter`**（本帧首条消息的绝对 seq），
 *    客户端据此把增量拼到自己的 `baseSeq` 上，而不是猜数组长度。
 * 4. **投递游标属于连接，不属于会话**。此前 `session.deliveredMessageCount` 是
 *    会话级单值，两个客户端共享同一个游标，后加入者会从别人的进度开始收增量，
 *    于是结构性漏消息——这是「双端内容不一致」的硬伤。
 */

/** 单帧最多携带的尾部消息条数（与只读视图 / 快照缓存一致）。 */
export const SESSION_TAIL_LIMIT = 200

/** 会推进连接游标的定稿帧：消息体已定稿，可以安全地「跳过已投递前缀」。 */
const FINAL_MESSAGE_FRAMES = new Set([
  'message_end',
  'agent_end',
  'messages_replaced',
  'turn_end',
  'state',
])

/**
 * 读会话的消息日志版本。旧会话（字段缺失）按 0 处理，保证单调比较安全。
 */
export function messageLogVersion(session) {
  const value = session?.messageLogVersion
  return Number.isInteger(value) && value >= 0 ? value : 0
}

/**
 * 推进消息日志版本。只在消息数组**实质变化**后调用（见 `sessionMessagesChanged`）。
 */
export function bumpMessageLogVersion(session) {
  const next = messageLogVersion(session) + 1
  session.messageLogVersion = next
  return next
}

/**
 * 判断一次事件是否真的改了消息数组：条数变化或尾消息身份变化都算变化。
 *
 * 用「条数 + 尾消息身份」而不是深比较：agent 的每帧 message_end 都带完整
 * messages，深比较是 O(会话字节数)；条数 + 尾身份能覆盖 append / truncate /
 * 尾替换这三类真实变更，原地改历史内容由 digest 对账兜底（见
 * `session-state-service.mjs` 的中间行 digest 探针）。
 */
export function sessionMessagesChanged(previous, next) {
  const before = Array.isArray(previous) ? previous : []
  const after = Array.isArray(next) ? next : []
  if (before.length !== after.length) return true
  if (before.length === 0) return false
  return messageIdentity(before[before.length - 1]) !== messageIdentity(after[after.length - 1])
}

/**
 * 消息身份：优先稳定 id，其次 toolCallId / role+timestamp。
 *
 * 与前端 `messageRenderIdentity`（content-parts.ts）同构，因此两端对「是不是
 * 同一条消息」的判断一致——跨端去重、游标对齐都依赖这个共识。
 */
export function messageIdentity(message) {
  if (!message || typeof message !== 'object') return ''
  if (typeof message.id === 'string' && message.id) return `id:${message.id}`
  if (typeof message.toolCallId === 'string' && message.toolCallId) return `tool:${message.toolCallId}`
  const role = typeof message.role === 'string' ? message.role : ''
  const timestamp = Number.isFinite(message.timestamp) ? message.timestamp : ''
  return `${role}:${timestamp}`
}

/**
 * 尾部窗口投影：把 `messages` 裁成最后 `limit` 条，并标注绝对起点。
 *
 * 返回 `{ messages, messagesAfter, total }`；不修改入参。
 */
export function tailWindow(messages, limit = SESSION_TAIL_LIMIT) {
  const list = Array.isArray(messages) ? messages : []
  const total = list.length
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : SESSION_TAIL_LIMIT
  const after = Math.max(0, total - safeLimit)
  return {
    messages: after > 0 ? list.slice(after) : list,
    messagesAfter: after,
    total,
  }
}

/**
 * 会话快照：`/state`、`/restore`、会话级 SSE 初始帧共用的形状。
 *
 * 与旧 `stripSplitSessionState` 的差别：不再把消息整体删掉（那样客户端必须再发
 * 一次 `/messages` 才能显示内容，且两次请求之间没有一致性保证），而是带上一段
 * 尾部窗口 + `messagesAfter` + `logVersion`，客户端一次请求就能自洽。
 *
 * `state` 必须已经包含 `messages`（调用方在 `getSessionState` 之后传入）。
 */
export function projectSessionSnapshot(state, options = {}) {
  if (!state || typeof state !== 'object') return state
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : SESSION_TAIL_LIMIT
  const window = tailWindow(state.messages, limit)
  const logVersion = Number.isInteger(state.logVersion) ? state.logVersion : 0
  const next = {
    ...state,
    messages: window.messages,
    messagesAfter: window.messagesAfter,
    messagesSummary: { count: window.total, logVersion },
    logVersion,
  }
  // goal 迭代标记按绝对 seq 标注（此前用窗口内下标，导致窗口态错位）。
  next.goalIterationMarkers = goalIterationMarkers(next.messages, window.messagesAfter)
  return next
}

/**
 * 稀疏的 goal 迭代标记。`index` 一律是**绝对 seq**（服务端数组下标），与
 * `messagesAfter` 叠加后才是窗口内位置。
 */
export function goalIterationMarkers(messages, baseSeq = 0) {
  const list = Array.isArray(messages) ? messages : []
  return list.flatMap((message, offset) => {
    const marker = message?.details?.quickforgeGoalIteration
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return []
    return [{
      seq: baseSeq + offset,
      index: baseSeq + offset,
      role: message.role,
      ...(typeof message.id === 'string' ? { id: message.id } : {}),
      ...(Number.isFinite(message.timestamp) ? { timestamp: message.timestamp } : {}),
      quickforgeGoalIteration: marker,
    }]
  })
}

/**
 * 连接级投影器：每个 SSE 连接持有一份，按 `sessionId` 记录「已投递到哪个 seq」。
 *
 * 这是替代 `session.deliveredMessageCount` 的核心：同一会话的两个客户端各有
 * 自己的游标，新加入者只从尾部窗口开始，不会因为别人已经收到而空帧。
 *
 * 用法：
 *   const projector = createConnectionProjector()
 *   const frame = projector.project(sessionId, event)   // 返回已裁剪的帧
 *   projector.seed(sessionId, total)                    // 初始快照后对齐游标
 */
export function createConnectionProjector(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : SESSION_TAIL_LIMIT
  /** @type {Map<string, { logVersion: number, deliveredSeq: number }>} */
  const cursors = new Map()

  const readCursor = (sessionId) => cursors.get(sessionId) ?? null

  return {
    limit,

    /** 当前连接对某会话的游标（测试与诊断用）。 */
    cursor(sessionId) {
      return readCursor(sessionId)
    },

    /**
     * 初始快照发送后对齐游标：客户端已经拿到 `[messagesAfter, total)`。
     */
    seed(sessionId, total, logVersion = 0) {
      cursors.set(sessionId, {
        logVersion,
        deliveredSeq: Number.isInteger(total) && total > 0 ? total : 0,
      })
    },

    /**
     * 按本连接游标裁剪事件。
     *
     * - 非定稿帧（message_update / tool_execution_update / 其他）原样返回：
     *   它们带的是「当前完整累积消息」，裁剪会破坏流式渲染。
     * - 无 messages 的帧原样返回（纯状态/通知帧）。
     * - 定稿帧：只投递本连接尚未见过的后缀；重叠部分（一次涌入超过窗口）保留，
     *   由客户端按消息身份去重。`messagesAfter` 是**该帧 messages 的绝对起点**。
     */
    project(sessionId, event) {
      if (!event || typeof event !== 'object') return event
      if (!Array.isArray(event.messages)) return event
      if (!FINAL_MESSAGE_FRAMES.has(event.type)) return event

      const total = event.messages.length
      const floor = Math.max(0, total - limit)
      const current = readCursor(sessionId)
      const logVersion = Number.isInteger(event.logVersion) ? event.logVersion : (current?.logVersion ?? 0)

      // 替换 / 回滚语义：旧前缀已经失效，游标不可信，必须以尾部窗口重建。
      // 判据有两个：帧类型是 messages_replaced，或服务端总数比本连接已投递的
      // 位置还少（说明被截断）。漏了这条，回滚后客户端会把「已投递到 5」当成
      // 仍然成立，于是永远不重发前 2 条。
      const replaced = event.type === 'messages_replaced' || (current ? total < current.deliveredSeq : false)
      // 无游标 = 该连接还没见过这条会话的历史：只给尾部窗口。
      const delivered = current ? Math.min(current.deliveredSeq, total) : floor
      // 起点取「已投递位置」与「尾部窗口下界」的较大者：既跳过已见前缀，
      // 又不让单帧超过窗口上限（超出部分客户端会通过 /messages 按需补齐）。
      const start = replaced ? floor : Math.min(total, Math.max(delivered, floor))

      cursors.set(sessionId, { logVersion, deliveredSeq: total })

      const next = {
        ...event,
        messagesAfter: start,
        messagesSummary: { count: total, logVersion },
        logVersion,
      }
      if (replaced) next.messagesReplaced = true
      if (start >= total) {
        // 没有新消息：不带消息体，避免重复传输。
        delete next.messages
        return next
      }
      next.messages = event.messages.slice(start)
      next.messagesIncremental = !replaced && start > 0
      return next
    },

    /** 丢弃某会话的游标（会话销毁/重置时调用）。 */
    forget(sessionId) {
      cursors.delete(sessionId)
    },

    /** 清空全部游标（连接关闭）。 */
    clear() {
      cursors.clear()
    },
  }
}
