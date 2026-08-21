import type { ChatScope } from '@/lib/types'
import type { ComposerDraft } from '@/components/chat/chat-utils'
import { normalizeSelectedCapabilities, selectedCapabilityKey } from '@/lib/selected-capabilities'

const COMPOSER_DRAFTS_STORAGE_KEY = 'quickforge:composer-drafts:v1'
const MAX_COMPOSER_DRAFTS = 100
export const MAX_CONSUMED_RESTORED_DRAFT_IDS = 200

export type ComposerDraftContext = {
  sessionId?: string
  scope: ChatScope
  projectId?: string
}

type PersistedComposerCapabilitySelection = NonNullable<ComposerDraft['selectedCapabilities']>[number] & {
  // Kept for drafts written before capability mentions moved out of the composer.
  mention?: string
}

type PersistedComposerDraft = {
  text: string
  contextReferences?: ComposerDraft['contextReferences']
  selectedCapabilities?: PersistedComposerCapabilitySelection[]
  updatedAt: string
  scope?: ChatScope
  projectId?: string
  sessionId?: string
}

type PersistedComposerDrafts = Record<string, PersistedComposerDraft>

let fallbackDrafts: PersistedComposerDrafts = {}
let useFallbackDrafts = false

function isRealSessionId(sessionId: string | undefined) {
  return Boolean(sessionId && !sessionId.startsWith('pending-'))
}

export function buildComposerDraftKey(context: ComposerDraftContext) {
  if (isRealSessionId(context.sessionId)) return `session:${context.sessionId}`
  if (context.scope === 'project' && context.projectId) return `new:project:${context.projectId}`
  return 'new:global'
}

function normalizePersistedSelectedCapabilities(value: unknown): PersistedComposerCapabilitySelection[] | undefined {
  if (!Array.isArray(value)) return undefined
  const candidates: PersistedComposerCapabilitySelection[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if ((record.description !== undefined && typeof record.description !== 'string')
      || (record.mention !== undefined && typeof record.mention !== 'string')) continue
    const normalized = normalizeSelectedCapabilities([record])[0]
    if (!normalized) continue
    candidates.push({
      ...normalized,
      ...(typeof record.mention === 'string' ? { mention: record.mention } : {}),
    })
  }
  const result = new Map<string, PersistedComposerCapabilitySelection>()
  for (const capability of candidates) {
    const key = selectedCapabilityKey(capability)
    if (result.has(key)) continue
    result.set(key, capability)
    if (result.size >= 4) break
  }
  return result.size > 0 ? [...result.values()] : undefined
}

function normalizeDrafts(value: unknown): PersistedComposerDrafts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const drafts: PersistedComposerDrafts = {}
  for (const [key, draft] of Object.entries(value as Record<string, unknown>)) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) continue
    const record = draft as Record<string, unknown>
    if (typeof record.text !== 'string') continue
    const selectedCapabilities = normalizePersistedSelectedCapabilities(record.selectedCapabilities)
    drafts[key] = {
      text: record.text,
      contextReferences: Array.isArray(record.contextReferences)
        ? record.contextReferences.filter((reference): reference is NonNullable<ComposerDraft['contextReferences']>[number] => Boolean(
            reference
            && typeof reference === 'object'
            && !Array.isArray(reference)
            && (reference as Record<string, unknown>).type === 'file'
            && typeof (reference as Record<string, unknown>).projectId === 'string'
            && typeof (reference as Record<string, unknown>).path === 'string',
          )).slice(0, 8)
        : undefined,
      ...(selectedCapabilities ? { selectedCapabilities } : {}),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
      scope: record.scope === 'project' ? 'project' : record.scope === 'global' ? 'global' : undefined,
      projectId: typeof record.projectId === 'string' ? record.projectId : undefined,
      sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    }
  }
  return drafts
}

function getLocalDraftStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function pruneDrafts(drafts: PersistedComposerDrafts, limit = MAX_COMPOSER_DRAFTS): PersistedComposerDrafts {
  return Object.fromEntries(
    Object.entries(drafts)
      .filter(([, draft]) => draft.text.length > 0
        || (draft.contextReferences?.length ?? 0) > 0
        || (draft.selectedCapabilities?.length ?? 0) > 0)
      .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit),
  )
}

function readDrafts(): PersistedComposerDrafts {
  const storage = getLocalDraftStorage()
  if (!storage || useFallbackDrafts) return fallbackDrafts

  let raw: string | null
  try {
    raw = storage.getItem(COMPOSER_DRAFTS_STORAGE_KEY)
  } catch {
    useFallbackDrafts = true
    return fallbackDrafts
  }

  try {
    return normalizeDrafts(raw ? JSON.parse(raw) : undefined)
  } catch {
    return fallbackDrafts
  }
}

function writeDrafts(drafts: PersistedComposerDrafts): void {
  const prunedDrafts = pruneDrafts(drafts)
  fallbackDrafts = prunedDrafts

  const storage = getLocalDraftStorage()
  if (!storage || useFallbackDrafts) return

  try {
    if (Object.keys(prunedDrafts).length === 0) {
      storage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY)
    } else {
      storage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, JSON.stringify(prunedDrafts))
    }
  } catch {
    const reducedDrafts = pruneDrafts(prunedDrafts, Math.ceil(MAX_COMPOSER_DRAFTS / 2))
    fallbackDrafts = reducedDrafts
    try {
      if (Object.keys(reducedDrafts).length === 0) {
        storage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY)
      } else {
        storage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, JSON.stringify(reducedDrafts))
      }
    } catch {
      useFallbackDrafts = true
      // Keep the in-memory fallback only. Draft persistence should never block chat usage.
    }
  }
}

export async function loadComposerDraft(key: string): Promise<ComposerDraft | undefined> {
  const draft = readDrafts()[key]
  if (!draft || (draft.text.length === 0
    && (draft.contextReferences?.length ?? 0) === 0
    && (draft.selectedCapabilities?.length ?? 0) === 0)) return undefined
  const result: ComposerDraft = { text: draft.text, attachments: [] }
  if (draft.contextReferences?.length) result.contextReferences = [...draft.contextReferences]
  if (draft.selectedCapabilities?.length) result.selectedCapabilities = [...draft.selectedCapabilities]
  return result
}

export async function saveComposerDraft(
  key: string,
  draft: ComposerDraft,
  context: ComposerDraftContext,
): Promise<void> {
  const text = draft.text ?? ''
  const contextReferences = draft.contextReferences ? [...draft.contextReferences].slice(0, 8) : []
  const selectedCapabilities = normalizeSelectedCapabilities(draft.selectedCapabilities)
  if (text.length === 0 && contextReferences.length === 0 && selectedCapabilities.length === 0) {
    await clearComposerDraft(key)
    return
  }

  const drafts = readDrafts()
  drafts[key] = {
    text,
    contextReferences,
    ...(selectedCapabilities.length > 0 ? { selectedCapabilities } : {}),
    updatedAt: new Date().toISOString(),
    scope: context.scope,
    projectId: context.scope === 'project' ? context.projectId : undefined,
    sessionId: isRealSessionId(context.sessionId) ? context.sessionId : undefined,
  }
  writeDrafts(drafts)
}

export async function clearComposerDraft(key: string): Promise<void> {
  const drafts = readDrafts()
  if (!Object.prototype.hasOwnProperty.call(drafts, key)) return
  delete drafts[key]
  writeDrafts(drafts)
}

export function rememberConsumedRestoredDraftId(
  consumedIds: Set<number>,
  draftId: number,
  limit = MAX_CONSUMED_RESTORED_DRAFT_IDS,
) {
  consumedIds.delete(draftId)
  consumedIds.add(draftId)
  while (consumedIds.size > limit) {
    const oldestId = consumedIds.values().next().value
    if (oldestId === undefined) break
    consumedIds.delete(oldestId)
  }
}

export type ComposerDraftRestoreGuard = {
  version: () => number
  isCurrent: (version: number) => boolean
  invalidate: () => number
}

export function createComposerDraftRestoreGuard(): ComposerDraftRestoreGuard {
  let currentVersion = 0
  return {
    version: () => currentVersion,
    isCurrent: (version: number) => version === currentVersion,
    invalidate: () => {
      currentVersion += 1
      return currentVersion
    },
  }
}
