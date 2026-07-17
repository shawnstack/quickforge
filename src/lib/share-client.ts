export type SharePermission = 'read' | 'operate'

export type ConversationShare = {
  id: string
  sessionId?: string
  permission: SharePermission
  createdAt?: string
  expiresAt?: string
  revokedAt?: string
  titleSnapshot?: string
  scope?: 'global' | 'project'
  projectId?: string
  accessCount?: number
  lastAccessedAt?: string
  hasPassword?: boolean
  url?: string
}

type JsonResponse<T> = T & { error?: string }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : undefined),
      ...init?.headers,
    },
  })
  const payload = (await response.json().catch(() => null)) as JsonResponse<T> | null
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`)
  }
  return payload as T
}

function randomAlphabetChar(alphabet: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = new Uint8Array(1)
    crypto.getRandomValues(values)
    return alphabet[values[0] % alphabet.length]
  }
  return alphabet[Math.floor(Math.random() * alphabet.length)]
}

export function generateSharePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part = () => Array.from({ length: 6 }, () => randomAlphabetChar(alphabet)).join('')
  return `${part()}-${part()}`
}

export function defaultShareExpiresAt(hours = 24) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

export async function createConversationShare(input: {
  sessionId: string
  permission: SharePermission
  password?: string
  expiresAt?: string
}) {
  return request<{
    ok: boolean
    share: ConversationShare
    url: string
    password?: string
    clipboardText: string
    lanUrls?: string[]
  }>('/api/shares', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function listConversationShares(sessionId?: string) {
  const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  return request<{ shares: ConversationShare[] }>(`/api/shares${suffix}`)
}

export async function revokeConversationShare(shareId: string) {
  return request<{ ok: boolean; share: ConversationShare }>(`/api/shares/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
  })
}

export async function loadSharedConversationMeta(shareId: string) {
  return request<{ share: ConversationShare }>(`/api/shared/${encodeURIComponent(shareId)}/meta`)
}

export async function unlockSharedConversation(shareId: string, password = '') {
  return request<{
    ok: boolean
    share: ConversationShare
    permission: SharePermission
    title?: string
    expiresAt?: string
  }>(`/api/shared/${encodeURIComponent(shareId)}/unlock`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export type SharedModelProvider = {
  id?: string
  name: string
  type?: string
  baseUrl?: string
  models?: unknown[]
}

export async function loadSharedModelProviders(shareId: string) {
  return request<{ providers: SharedModelProvider[] }>(`/api/shared/${encodeURIComponent(shareId)}/models`)
}
