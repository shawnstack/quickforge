export type ToolResultLike = {
  toolCallId?: string
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
  details?: unknown
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function stringifyValue(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

export function resultText(result: ToolResultLike | undefined) {
  return result?.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n') ?? ''
}

export function stringArrayFromUnknown(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function arrayFromUnknown(value: unknown) {
  return Array.isArray(value) ? value : []
}

export function nonEmptyText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export function errorTextFromUnknown(value: unknown): string {
  const direct = nonEmptyText(value)
  if (direct) return direct
  if (!isRecord(value)) return ''
  for (const key of ['errorMessage', 'error', 'message', 'reason']) {
    const nested = nonEmptyText(value[key])
    if (nested) return nested
  }
  return ''
}

export function messageTextLength(messages: unknown[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const raw = messages[index]
    if (!isRecord(raw)) continue
    const content = raw.content
    if (Array.isArray(content)) {
      const text = content
        .filter((block) => isRecord(block) && (block.type === 'text' || block.type === 'thinking'))
        .map((block) => isRecord(block) && typeof block.text === 'string' ? block.text : '')
        .join('')
      if (text) return text.length
    } else if (typeof content === 'string' && content) {
      return content.length
    }
  }
  return 0
}

/** FNV-1a 32 位稳定哈希：纯函数、无依赖，输出固定长度字符串。 */
export function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function jsonText(value: unknown): string {
  try { return JSON.stringify(value) } catch { return String(value) }
}
