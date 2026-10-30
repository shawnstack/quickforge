/**
 * 消息日志窗口投影（客户端侧）。
 *
 * 这里只做一件事：把服务端的「带绝对 seq 的增量」应用到本地消息窗口，并且
 * **只有这一处**决定 `baseSeq`（本地首条消息对应的服务端绝对下标）怎么变。
 *
 * 为什么要有它：
 * - 旧实现有三套坐标假设并存：`mergeIncrementalMessages` 假设本地从 0 开始、
 *   `mergeWindowedMessages` 才处理窗口偏移、8 处「整体替换」分支则完全不碰
 *   `messageWindowOffset`。于是窗口态下收到增量帧就会错位、重复或丢消息。
 * - 现在所有来源（只读视图快照 / `/state` 快照 / SSE 增量 / 回滚替换 / 单条
 *   更新）都换算成同一种 `MessageLogOp`，由本模块统一落位。`baseSeq` 是唯一
 *   坐标，数组下标只在窗口内部使用（`localIndex = seq - baseSeq`）。
 */

/** 取出消息身份时只看这几个字段（与 server/message-log.mjs 同构）。 */
export type MessageIdentitySource = {
  id?: unknown
  role?: unknown
  timestamp?: unknown
  toolCallId?: unknown
}

/**
 * 消息身份：优先稳定 id，其次 toolCallId，最后 role+timestamp。
 *
 * 与服务端 `messageIdentity` 同构，因此两端对「是不是同一条消息」的判断一致。
 */
export function messageIdentity(message: MessageIdentitySource | null | undefined): string {
  if (!message || typeof message !== 'object') return ''
  if (typeof message.id === 'string' && message.id) return `id:${message.id}`
  if (typeof message.toolCallId === 'string' && message.toolCallId) return `tool:${message.toolCallId}`
  const role = typeof message.role === 'string' ? message.role : ''
  const timestamp = typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) ? message.timestamp : ''
  return `${role}:${timestamp}`
}

/** 本地消息窗口：`baseSeq` 是唯一权威坐标。 */
export type MessageLogWindow<T> = {
  /** 本地 `messages[0]` 对应的服务端绝对 seq。 */
  baseSeq: number
  messages: T[]
  /** 服务端消息日志版本；0 表示未知（冷启动读存储时没有版本）。 */
  logVersion: number
}

/**
 * 消息日志操作：所有来源都必须先换算成这四种之一。
 */
export type MessageLogOp<T> =
  /** 快照：整表替换，`baseSeq` 由服务端给出（只读视图 / `/state`）。 */
  | { kind: 'snapshot'; baseSeq: number; messages: T[]; logVersion?: number }
  /** 增量：服务端 `[after, after+messages.length)` 这一段。 */
  | { kind: 'append'; after: number; messages: T[]; logVersion?: number }
  /** 替换：回滚 / 压缩 / 清理后的新列表（旧前缀语义已失效）。 */
  | { kind: 'replace'; baseSeq: number; messages: T[]; logVersion?: number }
  /** 单条更新：按绝对 seq 原位替换（流式定稿、工具结果回填）。 */
  | { kind: 'update'; seq: number; message: T }

export type MessageLogOutcome = 'applied' | 'noop' | 'gap'

export type MessageLogApplyResult<T> = {
  window: MessageLogWindow<T>
  outcome: MessageLogOutcome
  /** `outcome === 'gap'` 时：本地缺失区间的起始绝对 seq，调用方据此补拉。 */
  gapFrom?: number
}

export function createMessageLogWindow<T>(baseSeq = 0, messages: T[] = [], logVersion = 0): MessageLogWindow<T> {
  return { baseSeq: Math.max(0, Math.floor(baseSeq)), messages, logVersion }
}

/** 本地窗口覆盖的结束位置（不含）。 */
export function messageWindowEnd<T>(window: MessageLogWindow<T>): number {
  return window.baseSeq + window.messages.length
}

/** 绝对 seq 对应的本地下标；窗口外返回 -1。 */
export function localIndexForSeq<T>(window: MessageLogWindow<T>, seq: number): number {
  const index = seq - window.baseSeq
  return index >= 0 && index < window.messages.length ? index : -1
}

function withVersion<T>(window: MessageLogWindow<T>, logVersion: number | undefined): MessageLogWindow<T> {
  if (!Number.isInteger(logVersion)) return window
  if (logVersion === window.logVersion) return window
  return { ...window, logVersion: logVersion as number }
}

/** 内容是否同形（同一位置的服务端覆盖只在内容真的不同时才生效）。 */
function sameMessage<T>(left: T | undefined, right: T): boolean {
  if (left === undefined) return false
  if (left === right) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function applySnapshot<T>(window: MessageLogWindow<T>, op: Extract<MessageLogOp<T>, { kind: 'snapshot' }>): MessageLogApplyResult<T> {
  const messages = Array.isArray(op.messages) ? op.messages : []
  const baseSeq = Number.isInteger(op.baseSeq) && op.baseSeq > 0 ? op.baseSeq : 0
  return {
    window: {
      baseSeq,
      messages,
      logVersion: Number.isInteger(op.logVersion) ? (op.logVersion as number) : window.logVersion,
    },
    outcome: 'applied',
  }
}

function applyReplace<T>(window: MessageLogWindow<T>, op: Extract<MessageLogOp<T>, { kind: 'replace' }>): MessageLogApplyResult<T> {
  // 替换语义与快照一致：旧前缀作废，以服务端给的 baseSeq 重建。
  return applySnapshot(window, { kind: 'snapshot', baseSeq: op.baseSeq, messages: op.messages, logVersion: op.logVersion })
}

function applyAppend<T>(window: MessageLogWindow<T>, op: Extract<MessageLogOp<T>, { kind: 'append' }>): MessageLogApplyResult<T> {
  const incoming = Array.isArray(op.messages) ? op.messages : []
  const after = Number.isInteger(op.after) && op.after > 0 ? op.after : 0
  const versioned = withVersion(window, op.logVersion)

  if (incoming.length === 0) {
    return { window: versioned, outcome: 'noop' }
  }

  // 本地空窗口：直接以服务端起点为准（首屏只有尾部窗口时就是这条路径）。
  if (versioned.messages.length === 0) {
    return {
      window: { baseSeq: after, messages: incoming.slice(), logVersion: versioned.logVersion },
      outcome: 'applied',
    }
  }

  const endSeq = messageWindowEnd(versioned)

  // 缺口：增量起点比本地末尾还远，中间那段没收到（断线、或被窗口跳过）。
  // 交给调用方按 `gapFrom` 补拉，绝不猜测拼接。
  if (after > endSeq) {
    return { window: versioned, outcome: 'gap', gapFrom: endSeq }
  }

  // 全部落在窗口之前：本地已有更新的内容，丢弃这段陈旧增量。
  if (after + incoming.length <= versioned.baseSeq) {
    return { window: versioned, outcome: 'noop' }
  }

  // 落在窗口起点之前的条目属于被省略的前缀，跳过。
  const skip = Math.max(0, versioned.baseSeq - after)
  const startIndex = Math.max(0, after + skip - versioned.baseSeq)
  const messages = versioned.messages.slice()
  let changed = false

  for (let index = 0; index < incoming.length - skip; index += 1) {
    const position = startIndex + index
    const message = incoming[skip + index]
    if (position < messages.length) {
      if (sameMessage(messages[position], message)) continue
      messages[position] = message
      changed = true
      continue
    }
    // 中间出现空洞（本地缺少 position 之前的内容）：不能 push 到末尾，否则
    // 后面所有消息都会整体前移。交给调用方补拉。
    if (position !== messages.length) {
      return { window: versioned, outcome: 'gap', gapFrom: endSeq }
    }
    messages.push(message)
    changed = true
  }

  // 完全相同的一段重复投递（例如重放）不该触发重渲染。
  if (!changed) return { window: versioned, outcome: 'noop' }

  return {
    window: { baseSeq: versioned.baseSeq, messages, logVersion: versioned.logVersion },
    outcome: 'applied',
  }
}

function applyUpdate<T>(window: MessageLogWindow<T>, op: Extract<MessageLogOp<T>, { kind: 'update' }>): MessageLogApplyResult<T> {
  const index = localIndexForSeq(window, op.seq)
  if (index < 0) {
    // 目标不在窗口内：可能是被省略的前缀，也可能还没收到。不是本次能修的，
    // 忽略即可（后续 gap / 对账会补齐）。
    return { window, outcome: 'noop' }
  }
  if (sameMessage(window.messages[index], op.message)) {
    return { window, outcome: 'noop' }
  }
  const messages = window.messages.slice()
  messages[index] = op.message
  return { window: { baseSeq: window.baseSeq, messages, logVersion: window.logVersion }, outcome: 'applied' }
}

/**
 * 应用一个消息日志操作。
 *
 * 纯函数：不修改入参，返回新窗口。`outcome === 'gap'` 时窗口保持不变，
 * 调用方应从 `gapFrom` 开始补拉后再重试。
 */
export function applyMessageLogOp<T>(window: MessageLogWindow<T>, op: MessageLogOp<T>): MessageLogApplyResult<T> {
  switch (op.kind) {
    case 'snapshot':
      return applySnapshot(window, op)
    case 'replace':
      return applyReplace(window, op)
    case 'append':
      return applyAppend(window, op)
    case 'update':
      return applyUpdate(window, op)
    default:
      return { window, outcome: 'noop' }
  }
}
