import { MEMORY_KINDS, memoryFingerprint } from '../sqlite/dreaming-repository.mjs'
import { containsSensitiveMemory } from '../global-memory.mjs'

export const MAX_CONTENT_CHARS = 500
export const MAX_OPERATIONS = 25

const ACTION_SET = new Set(['create', 'update', 'supersede', 'retire'])
const KIND_SET = new Set(MEMORY_KINDS)

/**
 * Pull a JSON object out of a model reply.
 *
 * The prompt forbids fences, but models still emit them; stripping is cheaper
 * than a retry, and a hard failure here would lose the whole run.
 */
export function parseDreamingOutput(text) {
  const raw = String(text ?? '').trim()
  if (!raw) throw new Error('Dreaming returned an empty response.')
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('Dreaming response contained no JSON object.')
  let parsed
  try {
    parsed = JSON.parse(body.slice(start, end + 1))
  } catch (error) {
    throw new Error(`Dreaming response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Dreaming response was not a JSON object.')
  if (parsed.operations !== undefined && !Array.isArray(parsed.operations)) throw new Error('Dreaming operations must be an array.')
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 500) : '',
    operations: Array.isArray(parsed.operations) ? parsed.operations.slice(0, MAX_OPERATIONS) : [],
  }
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return []
  const evidence = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const sessionId = String(item.sessionId ?? '').trim()
    if (!sessionId) continue
    // The transcript carries no sequence numbers (only user text and final
    // answers are projected), so evidence is cited by session plus a note.
    evidence.push({
      sessionId,
      note: typeof item.note === 'string' ? item.note.trim().slice(0, 200) : '',
    })
    if (evidence.length >= 10) break
  }
  return evidence
}

/**
 * Apply a validated operation list inside one transaction.
 *
 * Every rejected operation is returned with a reason instead of being dropped:
 * the run detail page is the only place a user can see that the model proposed
 * something the code refused, and silently swallowing it would make the
 * automatic pipeline unauditable.
 */
export function applyDreamingOperations(operations, {
  repository,
  runId,
  now = Date.now(),
  allowSensitive = true,
  defaultProjectId = null,
} = {}) {
  const result = { created: 0, updated: 0, retired: 0, createdIds: [], updatedIds: [], retiredIds: [], rejected: [], applied: [] }

  const reject = (operation, index, reason) => {
    result.rejected.push({ index, action: operation?.action ?? null, reason, operation })
  }

  repository.transaction(() => {
    operations.forEach((operation, index) => {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        reject(operation, index, '操作不是对象')
        return
      }
      const action = String(operation.action ?? '').trim()
      if (!ACTION_SET.has(action)) {
        reject(operation, index, `未知动作：${action || '(空)'}`)
        return
      }

      if (action === 'create') {
        const content = String(operation.content ?? '').replace(/\s+/g, ' ').trim()
        if (!content) {
          reject(operation, index, 'content 为空')
          return
        }
        if (content.length > MAX_CONTENT_CHARS) {
          reject(operation, index, `content 超过 ${MAX_CONTENT_CHARS} 字符`)
          return
        }
        const kind = String(operation.kind ?? '').trim()
        if (!KIND_SET.has(kind)) {
          reject(operation, index, `未知类型：${kind || '(空)'}`)
          return
        }
        const scope = operation.scope === 'project' ? 'project' : 'global'
        const projectId = scope === 'project' ? String(operation.projectId ?? defaultProjectId ?? '').trim() : ''
        if (scope === 'project' && !projectId) {
          reject(operation, index, 'scope=project 但缺少 projectId')
          return
        }
        const evidence = normalizeEvidence(operation.evidence)
        if (evidence.length === 0) {
          reject(operation, index, 'create 缺少 evidence')
          return
        }
        if (!allowSensitive && containsSensitiveMemory(content)) {
          reject(operation, index, '内容包含疑似凭据，已按设置丢弃')
          return
        }
        // Evidence breadth caps confidence: one citation cannot claim 0.95.
        const confidence = Math.min(Math.max(0, Number(operation.confidence) || 0.5), 0.5 + 0.2 * evidence.length)

        const existing = repository.findByFingerprint(scope, projectId, memoryFingerprint(content))
        if (existing) {
          const before = existing
          const after = repository.updateMemory(existing.id, {
            content,
            confidence: Math.max(existing.confidence, confidence),
            strength: existing.strength + 0.5,
          }, now)
          repository.logEvent({ memoryId: existing.id, action: 'update', before, after, runId, now })
          result.updated += 1
          result.updatedIds.push(existing.id)
          result.applied.push({ action: 'update', id: existing.id, content: after.content, reason: 'duplicate content' })
          return
        }

        const created = repository.insertMemory({
          scope,
          projectId,
          kind,
          content,
          evidence,
          confidence,
          strength: 1,
          sourceRunId: runId,
          now,
        })
        repository.logEvent({ memoryId: created.id, action: 'create', after: created, runId, now })
        result.created += 1
        result.createdIds.push(created.id)
        result.applied.push({ action: 'create', id: created.id, kind, scope, content: created.content })
        return
      }

      const targetId = String(operation.targetId ?? '').trim()
      if (!targetId) {
        reject(operation, index, '缺少 targetId')
        return
      }
      const target = repository.findById(targetId)
      if (!target) {
        reject(operation, index, `targetId 不存在：${targetId}`)
        return
      }
      if (target.status !== 'active') {
        reject(operation, index, `targetId 状态为 ${target.status}，不可修改`)
        return
      }

      if (action === 'update') {
        const content = String(operation.content ?? '').replace(/\s+/g, ' ').trim()
        if (!content) {
          reject(operation, index, 'content 为空')
          return
        }
        if (content.length > MAX_CONTENT_CHARS) {
          reject(operation, index, `content 超过 ${MAX_CONTENT_CHARS} 字符`)
          return
        }
        if (!allowSensitive && containsSensitiveMemory(content)) {
          reject(operation, index, '内容包含疑似凭据，已按设置丢弃')
          return
        }
        const confidence = Math.min(1, Math.max(0, Number(operation.confidence) || target.confidence))
        const after = repository.updateMemory(target.id, {
          content,
          confidence,
          strength: target.strength + 0.5,
        }, now)
        repository.logEvent({ memoryId: target.id, action: 'update', before: target, after, runId, now })
        result.updated += 1
        result.updatedIds.push(target.id)
        result.applied.push({ action: 'update', id: target.id, content: after.content })
        return
      }

      if (action === 'supersede') {
        const replacementId = String(operation.replacementId ?? '').trim()
        if (!replacementId) {
          reject(operation, index, '缺少 replacementId')
          return
        }
        if (replacementId === targetId) {
          reject(operation, index, 'replacementId 不能等于 targetId')
          return
        }
        const replacement = repository.findById(replacementId)
        if (!replacement) {
          reject(operation, index, `replacementId 不存在：${replacementId}`)
          return
        }
        if (replacement.status !== 'active') {
          reject(operation, index, `replacementId 状态为 ${replacement.status}`)
          return
        }
        const after = repository.setStatus(target.id, 'superseded', { supersededBy: replacementId, now })
        repository.logEvent({ memoryId: target.id, action: 'supersede', before: target, after, runId, now })
        result.retired += 1
        result.retiredIds.push(target.id)
        result.applied.push({ action: 'supersede', id: target.id, replacementId })
        return
      }

      const after = repository.setStatus(target.id, 'retired', { now })
      repository.logEvent({
        memoryId: target.id,
        action: 'retire',
        before: target,
        after,
        runId,
        now,
      })
      result.retired += 1
      result.retiredIds.push(target.id)
      result.applied.push({ action: 'retire', id: target.id, reason: String(operation.reason ?? '').slice(0, 200) })
    })
  })

  for (const rejected of result.rejected) {
    repository.logEvent({
      memoryId: rejected.action === 'create' ? 'unassigned' : String(rejected.operation?.targetId ?? 'unassigned'),
      action: 'reject',
      after: { reason: rejected.reason, operation: rejected.operation },
      runId,
      now,
    })
  }

  return result
}
