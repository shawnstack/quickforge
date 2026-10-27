import { createDreamingRepository } from '../sqlite/dreaming-repository.mjs'

export const RECALL_DEFAULT_LIMIT = 8
export const RECALL_MAX_LIMIT = 30

function decay(updatedAt, now) {
  const ageDays = Math.max(0, (now - updatedAt) / (24 * 60 * 60 * 1000))
  // Half-life of ~30 days: an old lesson is still useful, just less prominent.
  return 1 / (1 + ageDays / 30)
}

/**
 * Score blends retrieval relevance with memory health.
 *
 * When a query is present the FTS rank is already ordered by relevance (bm25 is
 * ascending, lower = better), so it drives ordering and strength/recency act as
 * tie-breakers. Without a query there is nothing to rank against and the
 * strongest, most recent memories win.
 */
export function rankMemories(memories, { now = Date.now(), hasQuery = false } = {}) {
  const decorated = memories.map((memory) => ({
    memory,
    score: memory.strength * decay(memory.updatedAt, now) * (0.5 + memory.confidence / 2),
  }))
  if (!hasQuery) {
    decorated.sort((a, b) => b.score - a.score)
  }
  return decorated.map((entry) => entry.memory)
}

export function recallExperiences({
  query = '',
  kind = null,
  scope = null,
  projectId = null,
  limit = RECALL_DEFAULT_LIMIT,
  now = Date.now(),
  repository = null,
  markRecalled = false,
} = {}) {
  const repo = repository || createDreamingRepository()
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || RECALL_DEFAULT_LIMIT, RECALL_MAX_LIMIT))
  const normalizedQuery = String(query || '').trim()

  let memories
  if (scope) {
    memories = repo.listMemories({
      scope,
      projectId,
      kind,
      status: 'active',
      query: normalizedQuery,
      limit: normalizedLimit * 4,
    })
  } else {
    // Project memories are the more specific context, so they are searched
    // first; global rows fill the remaining budget.
    const projectRows = projectId
      ? repo.listMemories({
        scope: 'project',
        projectId,
        kind,
        status: 'active',
        query: normalizedQuery,
        limit: normalizedLimit * 4,
      })
      : []
    const globalRows = repo.listMemories({
      scope: 'global',
      kind,
      status: 'active',
      query: normalizedQuery,
      limit: normalizedLimit * 4,
    })
    memories = [...projectRows, ...globalRows]
  }

  const ranked = rankMemories(memories, { now, hasQuery: Boolean(normalizedQuery) }).slice(0, normalizedLimit)
  if (markRecalled) repo.recordRecall(ranked.map((memory) => memory.id), now)
  return ranked
}

export function formatRecalledMemory(memory) {
  const evidenceSessions = [...new Set((memory.evidence || [])
    .map((entry) => entry?.sessionId)
    .filter(Boolean))].slice(0, 3)
  return [
    `- ${memory.content}`,
    `  id=${memory.id} kind=${memory.kind} scope=${memory.scope} confidence=${memory.confidence.toFixed(2)} strength=${memory.strength.toFixed(1)}`,
    evidenceSessions.length > 0 ? `  evidence=${evidenceSessions.join(', ')}` : null,
    `  updated=${new Date(memory.updatedAt).toISOString().slice(0, 10)}${memory.recallCount > 0 ? ` recalled=${memory.recallCount}x` : ''}`,
  ].filter(Boolean).join('\n')
}
