import type { Api, Model } from '@earendil-works/pi-ai'

export type CloudMode = 'local' | 'guest' | 'account' // 'guest' retained only for legacy stored sessions
export type CloudConfigSource = 'saved' | 'env' | 'default'

const CLOUD_ACTION_HEADER = 'x-quickforge-action'
const CLOUD_ACTION_VALUE = 'cloud-action'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export class CloudClientError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(message: string, { status = 0, code = 'cloud_request_failed', details }: { status?: number; code?: string; details?: unknown } = {}) {
    super(message)
    this.name = 'CloudClientError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type CloudServiceConfig = {
  schemaVersion: 1
  serviceType: 'quickforge-cloud'
  enabled: boolean
  cloudUrl: string
  source: CloudConfigSource
  saved?: boolean
  valid?: boolean
  configurationError?: string
}

export type CloudRemoteStatusValue = 'disabled' | 'unavailable' | 'stopped' | 'starting' | 'authorizing' | 'running' | 'conflict' | 'error'

export type CloudRemoteStatus = {
  enabled: boolean
  status: CloudRemoteStatusValue
  serverUrl?: string | null
  pid?: number | null
  verificationUriComplete?: string | null
  error?: string | null
  updatedAt?: string
}

export type CloudConnectionTest = {
  ok: boolean
  cloudUrl: string
  health?: unknown
  ready?: unknown
}

export type CloudDeviceFlowResult = 'pending' | 'slow_down' | 'denied' | 'expired' | 'network' | 'success'

export type CloudPendingDeviceFlow = {
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresAt: number
  interval: number
  status?: string
}

export type CloudStatus = {
  configured: boolean
  enabled?: boolean
  mode: CloudMode
  hasSession?: boolean
  installationId?: string
  installationName?: string
  platform?: string
  clientVersion?: string
  hasInstallationKey?: boolean
  account?: CloudAccount
  pendingDeviceFlow?: CloudPendingDeviceFlow
  deviceFlowResult?: CloudDeviceFlowResult
  updatedAt?: string
  cloudAvailable?: boolean
  cloudError?: string
  sessionServiceMismatch?: boolean
  configurationError?: string
}

export type CloudAccount = {
  id?: string
  email?: string
  plan?: string
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
  installationId?: string
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
    let code = 'cloud_request_failed'
    let details: unknown
    try {
      const payload = await response.json() as { error?: string | { message?: string; code?: string; details?: unknown }; code?: string }
      if (typeof payload.error === 'string') message = payload.error
      else if (payload.error?.message) message = payload.error.message
      if (typeof payload.code === 'string') code = payload.code
      else if (typeof payload.error === 'object' && typeof payload.error?.code === 'string') code = payload.error.code
      if (typeof payload.error === 'object') details = payload.error?.details
    } catch {
      // Keep the status-based fallback.
    }
    throw new CloudClientError(message, { status: response.status, code, details })
  }
  return response.json() as Promise<T>
}

export function getCloudConfig(signal?: AbortSignal) {
  return requestCloudJson<CloudServiceConfig>('/api/cloud/config', { signal })
}

export function updateCloudConfig(config: { cloudUrl?: string; enabled?: boolean }, signal?: AbortSignal) {
  return requestCloudJson<CloudServiceConfig>('/api/cloud/config', {
    method: 'PUT',
    body: JSON.stringify(config),
    signal,
  })
}

export function testCloudConnection(cloudUrl: string, signal?: AbortSignal) {
  return requestCloudJson<CloudConnectionTest>('/api/cloud/test-connection', {
    method: 'POST',
    body: JSON.stringify({ cloudUrl }),
    signal,
  })
}

export function resetCloudIdentity(signal?: AbortSignal) {
  return requestCloudJson<{ ok: boolean; mode: CloudMode }>('/api/cloud/identity/reset', {
    method: 'POST',
    body: JSON.stringify({ confirm: 'reset-cloud-identity' }),
    signal,
  })
}

export function getCloudStatus(signal?: AbortSignal) {
  return requestCloudJson<CloudStatus>('/api/cloud/status', { signal })
}

export function getCloudRemoteStatus(signal?: AbortSignal) {
  return requestCloudJson<CloudRemoteStatus>('/api/cloud/remote/status', { signal })
}

export function startCloudDeviceFlow(signal?: AbortSignal) {
  return requestCloudJson<CloudStatus>('/api/cloud/device/start', { method: 'POST', body: '{}', signal })
}

export function pollCloudDeviceFlow(signal?: AbortSignal) {
  return requestCloudJson<CloudStatus>('/api/cloud/device/poll', { method: 'POST', body: '{}', signal })
}

export function cancelCloudDeviceFlow(signal?: AbortSignal) {
  return requestCloudJson<CloudStatus>('/api/cloud/device/cancel', { method: 'POST', body: '{}', signal })
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
