/**
 * 「它自己醒的」那一行（心跳唤醒）。
 *
 * 契约来自 server/bot-runner.mjs：`details.quickforgeBotHeartbeat`。心跳走的是普通
 * prompt 通道，落库后 role 就是 user——不读这个标记，界面上它就和用户自己说的话
 * 长得一模一样，而那些字用户从来没打过。
 */
export type BotHeartbeatDetails = {
  version?: number
}

type MessageRecord = Record<string, unknown>

function textOf(record: MessageRecord): string {
  const content = record.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part && typeof part === 'object' && (part as MessageRecord).type === 'text'
      ? String((part as MessageRecord).text ?? '')
      : ''))
    .join('\n')
}

/** 读取 `details.quickforgeBotHeartbeat`（不是心跳消息则返回 null）。 */
export function botHeartbeatDetailsOf(message: unknown): BotHeartbeatDetails | null {
  if (!message || typeof message !== 'object') return null
  const record = message as MessageRecord
  if (record.role !== 'user') return null
  const details = record.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const heartbeat = (details as MessageRecord).quickforgeBotHeartbeat
  if (!heartbeat || typeof heartbeat !== 'object' || Array.isArray(heartbeat)) return null
  return heartbeat as BotHeartbeatDetails
}

/**
 * 这是一条心跳唤醒消息吗？
 *
 * 首选 details 标记；升级前写入的旧数据没有标记，退回正文前缀判定——服务端的
 * 心跳指令固定以 `[心跳]` 开头（heartbeatInstruction）。
 */
export function isBotHeartbeatMessage(message: unknown): boolean {
  if (botHeartbeatDetailsOf(message)) return true
  if (!message || typeof message !== 'object') return false
  const record = message as MessageRecord
  if (record.role !== 'user') return false
  return textOf(record).startsWith('[心跳]')
}

/** 心跳指令原文，展开时显示。 */
export function botHeartbeatTextOf(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  return textOf(message as MessageRecord)
}
