/**
 * 工具参数 → 摘要文案的纯函数（不依赖 DOM/Lit/React/i18n 运行时，便于单元测试）。
 * 从 local-tools.ts 提取，聊天工具卡片与 subagent 当前工具跑马灯共用同一套摘要规则。
 */

export type ToolParamSummaryResult = {
  details?: unknown
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function detailString(details: unknown, key: string) {
  return isRecord(details) && typeof details[key] === 'string' ? details[key] : ''
}

export function summarizeParams(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result?: ToolParamSummaryResult,
) {
  if (!params && !result?.details) return ''
  if (toolName === 'run_command' && typeof params?.command === 'string') return params.command
  if (toolName === 'generate_image') {
    const prompt = typeof params?.prompt === 'string' ? params.prompt.trim() : ''
    return prompt.length > 100 ? `${prompt.slice(0, 100)}…` : prompt
  }
  if (toolName === 'present_files') {
    const files = Array.isArray(params?.files) ? params.files : Array.isArray(result?.details && (result.details as Record<string, unknown>).files) ? (result?.details as Record<string, unknown>).files as unknown[] : []
    const paths = files.map((item) => typeof item === 'string' ? item : isRecord(item) && typeof item.path === 'string' ? item.path : '').filter(Boolean)
    return paths.length ? paths.slice(0, 3).join(', ') + (paths.length > 3 ? ` +${paths.length - 3}` : '') : ''
  }
  if (toolName === 'grep_files') {
    const query = typeof params?.query === 'string' && params.query
      ? params.query
      : detailString(result?.details, 'query')
    const path = typeof params?.path === 'string' && params.path
      ? params.path
      : detailString(result?.details, 'path') || '.'
    const regex = Boolean(params?.regex || (isRecord(result?.details) && isRecord(result.details.searchOptions) && result.details.searchOptions.regex))
    const mode = regex ? 'regex' : 'text'
    const scope = path && path !== '.' ? ` in ${path}` : ' in current workspace'
    return query ? `${mode}: ${query}${scope}` : `searching${scope}`
  }
  if (toolName === 'activate_skill' && typeof params?.name === 'string') return params.name
  if (toolName === 'read_skill_resource' && typeof params?.path === 'string') return params.path
  if (params && 'path' in params && typeof params.path === 'string') return params.path
  if (params && 'query' in params && typeof params.query === 'string') return params.query
  if (params && 'search_query' in params && typeof params.search_query === 'string') return params.search_query
  return ''
}

/** 将 toolCall chunk 的 arguments 归一化为参数对象；兼容 JSON 字符串，无效输入返回 undefined。 */
export function normalizeToolArguments(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 截断摘要文案，超长时以 … 结尾（半角字符按 1 计）。 */
export function truncateSummary(text: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}
