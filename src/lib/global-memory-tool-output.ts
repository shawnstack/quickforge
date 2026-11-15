type MemoryToolOutputTextKey = 'memoryContentEmpty' | 'memoryContentSaved' | 'memoryContentSavedWorkspace'

type MemoryToolResultLike = {
  isError?: boolean
  details?: unknown
}

type TranslateMemoryToolOutput = (key: MemoryToolOutputTextKey) => string

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function formatManageGlobalMemoryOutput(
  result: MemoryToolResultLike | undefined,
  isStreaming: boolean | undefined,
  translate: TranslateMemoryToolOutput,
) {
  if (!result || result.isError || isStreaming || !isRecord(result.details)) return ''

  const action = result.details.action
  const status = result.details.status
  const markdown = result.details.markdown
  if (typeof markdown !== 'string') return ''

  // The tool no longer has a read action (the document is injected into the system
  // prompt instead), but historical sessions still carry `action: 'read'` results,
  // so this branch stays for rendering old messages.
  if (action === 'read') {
    if (markdown) return markdown
    if (status === 'empty' || status === undefined) return translate('memoryContentEmpty')
  }

  if (action === 'write' && (status === 'saved' || status === undefined)) {
    // 同一个工具在 bot 会话里写的是它自己工作区的 MEMORY.md（服务端 details.target
    // 标记落点）。一律说「全局记忆已保存」，等于让 bot 的写入在界面上冒充用户的记忆。
    // 历史消息没有 target 字段（那一版只会写全局），仍按全局文案渲染。
    return translate(result.details.target === 'workspace' ? 'memoryContentSavedWorkspace' : 'memoryContentSaved')
  }

  return ''
}
