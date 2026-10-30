/**
 * 全局 SSE 事件环：给每帧一个全局单调 `seq`，让断线重连可以续传。
 *
 * 为什么需要它：
 * - 现状 SSE 帧没有 `id:`，浏览器无法带 `Last-Event-ID` 重连，断线期间的事件
 *   永久丢失，客户端只能靠「再拉一次 /state」自愈；而全局流连上时**不发任何
 *   初始帧**，非流式期间丢的帧可能一直不被发现（手机后台被挂起就是典型场景）。
 * - 全局流是一条连接承载所有会话，所以重放游标必须是**全局**的，不能按会话各来一套。
 *
 * 环形缓冲里只存**轻量帧**（去掉消息体，只留类型、logVersion、messagesAfter、
 * messagesSummary 等定位信息）。理由：
 * - 消息体会让 2000 条环吃掉上百 MB；
 * - 重放的目的不是「重演内容」，而是让客户端知道「哪些会话变了、缺哪段 seq」，
 *   具体内容它自己按 `messagesAfter` 去 `/messages?from=` 拉。
 * - 流式帧（message_update）不重放：重放过期 token 没有意义。
 */

/** 环容量：按「帧数」计。轻量帧约 200~600 字节，1000 条即 <1MB。 */
export const EVENT_LOG_CAPACITY = 1000

/** 不进入重放环的帧：高频流式增量，重放无意义且会挤掉有用的定稿帧。 */
const NON_REPLAYABLE_EVENTS = new Set(['message_update', 'tool_execution_update'])

/** 重放时保留的字段白名单（够客户端定位缺口即可）。 */
const REPLAY_FIELDS = [
  'type',
  'sessionId',
  'logVersion',
  'messagesAfter',
  'messagesSummary',
  'stateVersion',
  'status',
  'isStreaming',
  'errorMessage',
  'persistDegraded',
  'messageStorage',
  'goalIterationMarkers',
  'contextCompaction',
  'compactionNotice',
  'lease',
  'title',
]

function lightweightFrame(sessionId, event) {
  const frame = {}
  for (const field of REPLAY_FIELDS) {
    if (event[field] !== undefined) frame[field] = event[field]
  }
  if (frame.sessionId === undefined) frame.sessionId = sessionId
  frame.replayed = true
  return frame
}

/**
 * 创建事件环。默认单例（进程内），测试可自建独立实例。
 */
export function createEventLog(options = {}) {
  const capacity = Number.isInteger(options.capacity) && options.capacity > 0
    ? options.capacity
    : EVENT_LOG_CAPACITY
  /** @type {{ seq: number, sessionId: string, frame: object }[]} */
  const entries = []
  let nextSeq = 1

  return {
    capacity,

    /** 下一个待分配的 seq（诊断用）。 */
    peekSeq() {
      return nextSeq
    },

    /** 环里最小可重放的 seq；环空时返回 null。 */
    floorSeq() {
      return entries.length > 0 ? entries[0].seq : null
    },

    /** 环里最大已分配 seq；环空时返回 null。 */
    topSeq() {
      return entries.length > 0 ? entries[entries.length - 1].seq : null
    },

    /**
     * 记录一帧并返回其全局 seq。
     *
     * 所有帧都会拿到 seq（客户端用它当 `id:`），但流式帧不进环——它们只用于
     * 「连接内有序」，不参与重放。
     */
    publish(sessionId, event) {
      const seq = nextSeq
      nextSeq += 1
      if (event && typeof event === 'object' && !NON_REPLAYABLE_EVENTS.has(event.type)) {
        entries.push({ seq, sessionId, frame: lightweightFrame(sessionId, event) })
        while (entries.length > capacity) entries.shift()
      }
      return seq
    },

    /**
     * 从 `lastSeq` 之后开始重放。
     *
     * 返回 `{ frames, gap }`：
     * - `gap: false`：环里完整覆盖 `lastSeq+1..topSeq`，客户端按序应用即可。
     * - `gap: true`：`lastSeq` 早于环下界（断线太久或服务重启），中间事件不可
     *   恢复，客户端必须对所有活跃会话重新取一次快照。此时 `frames` 仍是环内
     *   可用的那部分，便于先追平再决定是否重取。
     */
    since(lastSeq) {
      const from = Number.isInteger(lastSeq) && lastSeq >= 0 ? lastSeq : 0
      const floor = this.floorSeq()
      const gap = floor === null ? false : from + 1 < floor
      const frames = entries.filter((entry) => entry.seq > from).map((entry) => ({ seq: entry.seq, frame: entry.frame }))
      return { frames, gap }
    },

    /** 清空（仅测试用）。 */
    reset() {
      entries.length = 0
      nextSeq = 1
    },
  }
}

/** 进程内默认事件环：所有 SSE 连接共享。 */
export const globalEventLog = createEventLog()
