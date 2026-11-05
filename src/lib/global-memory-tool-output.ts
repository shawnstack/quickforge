type MemoryToolOutputTextKey = 'memoryContentEmpty' | 'memoryContentSaved'

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
    return translate('memoryContentSaved')
  }

  return ''
}
