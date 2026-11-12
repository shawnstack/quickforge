// message_update / tool_execution_update 的 trailing 合并窗口（毫秒）：窗口内
// 每种事件只写出最后一帧。
export const SSE_MESSAGE_UPDATE_THROTTLE_MS = 50

/**
 * 参与 trailing 合并的事件类型。
 *
 * 两者都是「每帧携带完整累积结果」的流式增量（message_update 带完整累积
 * assistant 消息，tool_execution_update 带完整累积 partialResult，客户端按
 * 替换语义写入），所以丢掉窗口内的中间帧等价于少画几帧，终态由
 * `message_end` / `tool_execution_end` 兜底。
 */
export const SSE_COALESCED_EVENTS = new Set(['message_update', 'tool_execution_update'])

// res.writableLength 背压阈值（字节）：超过后丢弃可丢弃事件，终态/关键事件永不丢弃。
export const SSE_BACKPRESSURE_BYTES = 4 * 1024 * 1024

// 背压下可丢弃的事件：纯流式增量（下一帧是完整累积消息，message_end 兜底终态）。
// 其余事件（message_end/agent_end/messages_replaced/error/tool_approval_required/
// ask_user_required/state 等）不在名单内，永不丢弃。
const SSE_DROPPABLE_EVENTS = new Set(['message_update', 'tool_execution_update'])

/**
 * 合并流式增量事件的 SSE 写入器。
 *
 * 每个 token delta 都会产生一帧 message_update（帧内只带一份完整累积消息，
 * 见 `server/utils/sse-wire.mjs`），一回合累计写出量 O(N²)；高频工具输出
 * （长命令 / 流式工具日志）同理产生同量级的 tool_execution_update。
 * 窗口内每种事件只保留最后一帧，窗口到期后按到达顺序写出（trailing 合并）。
 *
 * 分槽的原因：message_update 与 tool_execution_update 会交错到达，单槽会让
 * 后到者顶掉前者，直接丢事件。两个槽共享一个窗口计时器，所以合计仍是最多
 * 20fps 的写出频率。
 *
 * 顺序保证：任何非合并事件到达时先 flush pending 帧再写该事件，
 * 否则客户端会先按终态清空流式容器、再收到迟到帧，导致已完成消息重复渲染。
 */
export function createSseUpdateThrottle({ write, windowMs = SSE_MESSAGE_UPDATE_THROTTLE_MS }) {
  /** 类型 → 窗口内最新一帧；`order` 记住首帧到达顺序。 */
  const pending = new Map()
  const order = []
  let timer = null

  const clearTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }
  const writePending = () => {
    clearTimer()
    if (order.length === 0) return
    const types = order.splice(0, order.length)
    for (const type of types) {
      const event = pending.get(type)
      pending.delete(type)
      if (event !== undefined) write(event)
    }
  }

  return {
    push(event) {
      const type = event?.type
      if (!SSE_COALESCED_EVENTS.has(type)) {
        writePending()
        write(event)
        return
      }
      if (!pending.has(type)) order.push(type)
      pending.set(type, event)
      if (timer) return
      timer = setTimeout(writePending, windowMs)
    },
    flush: writePending,
    dispose() {
      clearTimer()
      pending.clear()
      order.length = 0
    },
  }
}

function isSseBackpressured(res) {
  return typeof res.writableLength === 'number' && res.writableLength > SSE_BACKPRESSURE_BYTES
}

export function writeSseKeepAlive(res) {
  // ping 可丢弃：慢客户端积压时不继续堆积注释帧。
  if (isSseBackpressured(res)) return
  res.write(': ping\n\n')
}

/**
 * SSE 帧的序列化缓存。
 *
 * 同一帧会被**每个连接**各写一次（PC + 手机同看一个会话是常态）。投影对无附件
 * 的事件原样返回同一对象，所以 `JSON.stringify` 的结果可以按对象身份共享：
 * 第二个连接不再重复序列化 MB 级的完整累积消息。WeakMap 随事件对象被 GC 回收，
 * 不需要清理。
 *
 * 只缓存对象帧：字符串帧直接写出，非对象（null/数字）走 JSON.stringify 的
 * 原始语义。
 */
const serializedFrameCache = new WeakMap()

function serializeFramePayload(data) {
  if (typeof data === 'string') return data
  if (data === null || typeof data !== 'object') return JSON.stringify(data)
  const cached = serializedFrameCache.get(data)
  if (cached !== undefined) return cached
  const text = JSON.stringify(data)
  serializedFrameCache.set(data, text)
  return text
}

export function writeSseEvent(res, event, data, id) {
  // 背压保护：慢客户端积压超过阈值时丢弃可丢弃事件；不 await drain，
  // 避免慢客户端拖慢模型 token 流。
  if (SSE_DROPPABLE_EVENTS.has(event) && isSseBackpressured(res)) return
  const payload = serializeFramePayload(data)
  // Split multi-line payloads
  const lines = payload.split('\n')
  // `id:` 让浏览器自动重连带 `Last-Event-ID`，服务端据此重放环里的错失帧。
  if (Number.isInteger(id) && id > 0) res.write(`id: ${id}\n`)
  res.write(`event: ${event}\n`)
  for (const line of lines) {
    res.write(`data: ${line}\n`)
  }
  res.write('\n')
}
