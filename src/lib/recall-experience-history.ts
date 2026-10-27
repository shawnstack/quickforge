/**
 * `recall_experience` 结果 → 聊天工具卡视图模型（纯函数，不依赖 DOM/React/i18n 运行时）。
 *
 * 服务端 details 形状见 `server/tools/index.mjs` 的 toolRecallExperience：
 * `{ type: 'recall_experience_result', query, count, memories: [...] }`。
 * 这里只做防御式收敛与派生，状态/文案 key 由渲染器统一决定。
 */

export const RECALL_EXPERIENCE_KINDS = ['fact', 'preference', 'experience', 'pitfall', 'decision'] as const
export type RecallExperienceKind = (typeof RECALL_EXPERIENCE_KINDS)[number]

export type RecallExperienceScope = 'global' | 'project'

export type RecallExperienceMemoryView = {
  id: string
  kind: RecallExperienceKind
  scope: RecallExperienceScope
  content: string
  confidence: number
  strength: number
  recallCount: number
  sessionCount: number
  updatedAt: number | null
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function finiteOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeKind(value: unknown): RecallExperienceKind {
  return typeof value === 'string' && (RECALL_EXPERIENCE_KINDS as readonly string[]).includes(value)
    ? value as RecallExperienceKind
    : 'experience'
}

function normalizeScope(value: unknown): RecallExperienceScope {
  return value === 'project' ? 'project' : 'global'
}

function countSessions(evidence: unknown) {
  if (!Array.isArray(evidence)) return 0
  const ids = new Set<string>()
  for (const entry of evidence) {
    if (isRecord(entry) && typeof entry.sessionId === 'string' && entry.sessionId) ids.add(entry.sessionId)
  }
  return ids.size
}

export function normalizeRecallMemory(value: unknown, index: number): RecallExperienceMemoryView | null {
  if (!isRecord(value)) return null
  const content = typeof value.content === 'string' ? value.content.trim() : ''
  // 空正文的经验没有阅读价值：宁可不渲染，也不用占位行充数。
  if (!content) return null
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `recall-memory-${index}`,
    kind: normalizeKind(value.kind),
    scope: normalizeScope(value.scope),
    content,
    confidence: clamp(finiteOr(value.confidence, 0), 0, 1),
    strength: Math.max(0, finiteOr(value.strength, 0)),
    recallCount: Math.max(0, Math.trunc(finiteOr(value.recallCount, 0))),
    sessionCount: countSessions(value.evidence),
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) && value.updatedAt > 0
      ? value.updatedAt
      : null,
  }
}

export function buildRecallExperienceViewModel(result: { details?: unknown } | undefined): RecallExperienceViewModel {
  const details = isRecord(result?.details) ? result.details : undefined
  if (!details || details.type !== 'recall_experience_result') {
    return { available: false, query: '', memories: [] }
  }
  const query = typeof details.query === 'string' ? details.query.trim() : ''
  const raw = Array.isArray(details.memories) ? details.memories : []
  const memories = raw
    .map((entry, index) => normalizeRecallMemory(entry, index))
    .filter((entry): entry is RecallExperienceMemoryView => entry !== null)
  return { available: true, query, memories }
}

/** 距今天数（向下取整）；未来时间戳按 0 处理。用于收起状态下的相对时间文案。 */
export function recallRecencyDays(updatedAt: number | null, now = Date.now()) {
  if (updatedAt === null) return null
  return Math.max(0, Math.floor((now - updatedAt) / 86_400_000))
}
