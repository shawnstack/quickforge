import type { AppStorage } from '@earendil-works/pi-web-ui'
import type { ChatScope } from '@/lib/types'
import type { ComposerDraft } from '@/components/chat/chat-utils'

const COMPOSER_DRAFTS_SETTING_KEY = 'composer-drafts:v1'

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

async function loadDrafts(storage: AppStorage): Promise<PersistedComposerDrafts> {
  return normalizeDrafts(await storage.settings.get<unknown>(COMPOSER_DRAFTS_SETTING_KEY))
}

export async function loadComposerDraft(storage: AppStorage, key: string): Promise<ComposerDraft | undefined> {
  const draft = (await loadDrafts(storage))[key]
  if (!draft || draft.text.length === 0) return undefined
  return { text: draft.text, attachments: [] }
}

export async function saveComposerDraft(
  storage: AppStorage,
  key: string,
  draft: ComposerDraft,
  context: ComposerDraftContext,
): Promise<void> {
  const text = draft.text ?? ''
  if (text.length === 0) {
    await clearComposerDraft(storage, key)
    return
  }

  const drafts = await loadDrafts(storage)
  drafts[key] = {
    text,
    updatedAt: new Date().toISOString(),
    scope: context.scope,
    projectId: context.scope === 'project' ? context.projectId : undefined,
    sessionId: isRealSessionId(context.sessionId) ? context.sessionId : undefined,
  }
  await storage.settings.set(COMPOSER_DRAFTS_SETTING_KEY, drafts)
}

export async function clearComposerDraft(storage: AppStorage, key: string): Promise<void> {
  const drafts = await loadDrafts(storage)
  if (!Object.prototype.hasOwnProperty.call(drafts, key)) return
  delete drafts[key]
  await storage.settings.set(COMPOSER_DRAFTS_SETTING_KEY, drafts)
}
