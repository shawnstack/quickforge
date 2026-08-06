import type { Api, Model } from '@earendil-works/pi-ai'

export type CloudMode = 'local' | 'guest' | 'account'

const CLOUD_ACTION_HEADER = 'x-quickforge-action'
const CLOUD_ACTION_VALUE = 'cloud-action'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type CloudStatus = {
  configured: boolean
  mode: CloudMode
  hasSession?: boolean
  installationId?: string
  installationName?: string
  platform?: string
  clientVersion?: string
  hasInstallationKey?: boolean
  account?: CloudAccount
  updatedAt?: string
  cloudAvailable?: boolean
  cloudError?: string
  configurationError?: string
}

export type CloudAccount = {
  id?: string
  mode?: CloudMode
  plan?: string
  [key: string]: unknown
}

export type CloudUsage = {
  remaining?: number
  limit?: number
  used?: number
  unit?: string
  resetsAt?: string
  expiresAt?: string
  [key: string]: unknown
}

export type CloudInstallation = {
  id: string
  name?: string
  installationName?: string
  platform?: string
  clientVersion?: string
  current?: boolean
  createdAt?: string
  lastSeenAt?: string
  revokedAt?: string
  [key: string]: unknown
}

async function requestCloudJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || 'GET').toUpperCase()
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.headers || {}),
      ...(SAFE_METHODS.has(method) ? {} : { [CLOUD_ACTION_HEADER]: CLOUD_ACTION_VALUE }),
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  })
  if (!response.ok) {
    let message = `QuickForge Cloud request failed (${response.status})`
    try {
      const payload = await response.json() as { error?: string | { message?: string } }
      if (typeof payload.error === 'string') message = payload.error
      else if (payload.error?.message) message = payload.error.message
    } catch {
      // Keep the status-based fallback.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export function getCloudStatus(signal?: AbortSignal) {
  return requestCloudJson<CloudStatus>('/api/cloud/status', { signal })
}

export function startCloudGuest(signal?: AbortSignal) {
  return requestCloudJson<CloudStatus>('/api/cloud/guest/start', { method: 'POST', signal })
}

export async function getCloudModels(signal?: AbortSignal): Promise<Model<Api>[]> {
  const response = await requestCloudJson<{ items?: Model<Api>[] }>('/api/cloud/models', { signal })
  return Array.isArray(response.items) ? response.items : []
}

export function getCloudUsage(signal?: AbortSignal) {
  return requestCloudJson<CloudUsage>('/api/cloud/usage', { signal })
}

export async function getCloudInstallations(signal?: AbortSignal): Promise<CloudInstallation[]> {
  const response = await requestCloudJson<{ items?: CloudInstallation[] }>('/api/cloud/installations', { signal })
  return Array.isArray(response.items) ? response.items : []
}

export function revokeCloudInstallation(installationId: string, signal?: AbortSignal) {
  return requestCloudJson<{ ok: boolean }>(`/api/cloud/installations/${encodeURIComponent(installationId)}`, { method: 'DELETE', signal })
}

export function logoutCloud(signal?: AbortSignal) {
  return requestCloudJson<{ ok: boolean; mode: CloudMode }>('/api/cloud/logout', { method: 'POST', signal })
}

export { requestCloudJson }
