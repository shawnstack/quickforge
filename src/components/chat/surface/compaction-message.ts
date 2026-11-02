
/**
 * 压缩摘要消息（方案 B：压缩点就是消息本身）。
 *
 * 契约来自 server/conversation-compaction.mjs：`details.quickforgeCompaction`，
 * kind 为 summary（摘要）或 notice（旧的助手提示行）。手动 /compact 生成的会话里
 * 早就在用同一条契约，这里只是为了渲染与装饰层跳过而复用它。
 */
export type CompactionMessageDetails = {
  kind?: string
  compactedAt?: string
  sourceMessageCount?: number
  usageBefore?: unknown
  thresholdPercent?: number
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

/** 读取 `details.quickforgeCompaction`（不是压缩消息则返回 null）。 */
export function compactionDetailsOf(message: unknown): CompactionMessageDetails | null {
  if (!message || typeof message !== 'object') return null
  const record = message as MessageRecord
  if (record.role !== 'user') return null
  const details = record.details
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const compaction = (details as MessageRecord).quickforgeCompaction
  if (!compaction || typeof compaction !== 'object' || Array.isArray(compaction)) return null
  return compaction as CompactionMessageDetails
}

/**
 * 这是一条压缩摘要消息吗？
 *
 * 首选 details 标记；旧数据没有标记时退回文本判定（正文里带 <compact_summary>），
 * 这样升级前生成的手动 /compact 会话也不会被当成用户气泡。
 */
export function isCompactionMessage(message: unknown): boolean {
  const details = compactionDetailsOf(message)
  if (details) return details.kind !== 'notice'
  if (!message || typeof message !== 'object') return false
  const record = message as MessageRecord
  if (record.role !== 'user') return false
  return textOf(record).includes('<compact_summary>')
}
