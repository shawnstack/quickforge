import type { ChatScope } from '@/lib/types'
import type { ComposerDraft } from '@/components/chat/chat-utils'

const COMPOSER_DRAFTS_STORAGE_KEY = 'quickforge:composer-drafts:v1'
const MAX_COMPOSER_DRAFTS = 100

export type ComposerDraftContext = {
  sessionId?: string
  scope: ChatScope
  projectId?: string
}

type PersistedComposerDraft = {
  text: string
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

function normalizeDrafts(value: unknown): PersistedComposerDrafts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const drafts: PersistedComposerDrafts = {}
  for (const [key, draft] of Object.entries(value as Record<string, unknown>)) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) continue
    const record = draft as Record<string, unknown>
    if (typeof record.text !== 'string') continue
    drafts[key] = {
      text: record.text,
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
      .filter(([, draft]) => draft.text.length > 0)
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
  if (!draft || draft.text.length === 0) return undefined
  return { text: draft.text, attachments: [] }
}

export async function saveComposerDraft(
  key: string,
  draft: ComposerDraft,
  context: ComposerDraftContext,
): Promise<void> {
  const text = draft.text ?? ''
  if (text.length === 0) {
    await clearComposerDraft(key)
    return
  }

  const drafts = readDrafts()
  drafts[key] = {
    text,
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
