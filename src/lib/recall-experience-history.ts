/**
 * `recall_experience` 结果 → 聊天工具卡视图模型（纯函数，不依赖 DOM/React/i18n 运行时）。
 *
 * 服务端 details 形状见 `server/tools/index.mjs` 的 toolRecallExperience：
 * `{ type: 'recall_experience_result', query, count, memories: [{ id, kind, content }] }`。
 * 记忆现在就是 MEMORY.md 里的一个 bullet 列表，所以没有 scope / confidence /
 * strength / 召回次数可展示——一条笔记只有正文，以及可选的 kind 前缀。
 */

export const RECALL_EXPERIENCE_KINDS = ['fact', 'preference', 'experience', 'pitfall', 'decision'] as const
export type RecallExperienceKind = (typeof RECALL_EXPERIENCE_KINDS)[number]

export type RecallExperienceMemoryView = {
  id: string
  /** null 表示这条笔记没有写 kind 前缀。 */
  kind: RecallExperienceKind | null
  content: string
}

export type RecallExperienceViewModel = {
  /** details 是否真的是 recall_experience_result（false 时不伪造列表）。 */
  available: boolean
  query: string
  memories: RecallExperienceMemoryView[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeKind(value: unknown): RecallExperienceKind | null {
  return typeof value === 'string' && (RECALL_EXPERIENCE_KINDS as readonly string[]).includes(value)
    ? value as RecallExperienceKind
    : null
}

export function normalizeRecallMemory(value: unknown, index: number): RecallExperienceMemoryView | null {
  if (!isRecord(value)) return null
  const content = typeof value.content === 'string' ? value.content.trim() : ''
  // 空正文的笔记没有阅读价值：宁可不渲染，也不用占位行充数。
  if (!content) return null
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `recall-note-${index}`,
    kind: normalizeKind(value.kind),
    content,
  }
}

export function buildRecallExperienceViewModel(result: unknown): RecallExperienceViewModel {
  const details = isRecord(result) && isRecord(result.details) ? result.details : null
  if (!details || details.type !== 'recall_experience_result') {
    return { available: false, query: '', memories: [] }
  }
  const source = Array.isArray(details.memories) ? details.memories : []
  const memories: RecallExperienceMemoryView[] = []
  source.forEach((entry, index) => {
    const memory = normalizeRecallMemory(entry, index)
    if (memory) memories.push(memory)
  })
  return {
    available: true,
    query: typeof details.query === 'string' ? details.query.trim() : '',
    memories,
  }
}
