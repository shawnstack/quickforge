import type { Api, Model } from '@earendil-works/pi-ai'
import type { CloudInstallation, CloudServiceConfig, CloudStatus, CloudUsage } from '@/lib/cloud-client'

export type CloudDetailError = {
  message: string
  unavailable: boolean
}

export type CloudDetailsState = {
  usage?: CloudUsage
  installations: CloudInstallation[]
  models: Model<Api>[]
  errors: {
    usage?: CloudDetailError
    installations?: CloudDetailError
    models?: CloudDetailError
  }
  loading: boolean
}

export type CloudDetailsAction =
  | { type: 'begin' }
  | { type: 'replace'; state: CloudDetailsState }
  | { type: 'clear' }

export const emptyCloudDetailsState: CloudDetailsState = {
  usage: undefined,
  installations: [],
  models: [],
  errors: {},
  loading: false,
}

export function cloudDetailsReducer(_state: CloudDetailsState, action: CloudDetailsAction): CloudDetailsState {
  if (action.type === 'replace') return action.state
  return {
    ...emptyCloudDetailsState,
    loading: action.type === 'begin',
  }
}

type CloudDetailsLoaders = {
  usage: () => Promise<CloudUsage>
  installations: () => Promise<CloudInstallation[]>
  models: () => Promise<Model<Api>[]>
}

export async function loadCloudAccountDetails(
  loaders: CloudDetailsLoaders,
  describeError: (kind: keyof CloudDetailsLoaders, error: unknown) => CloudDetailError,
): Promise<CloudDetailsState> {
  const [usage, installations, models] = await Promise.allSettled([
    loaders.usage(),
    loaders.installations(),
    loaders.models(),
  ])

  return {
    usage: usage.status === 'fulfilled' ? usage.value : undefined,
    installations: installations.status === 'fulfilled' ? installations.value : [],
    models: models.status === 'fulfilled' ? models.value : [],
    errors: {
      ...(usage.status === 'rejected' ? { usage: describeError('usage', usage.reason) } : {}),
      ...(installations.status === 'rejected' ? { installations: describeError('installations', installations.reason) } : {}),
      ...(models.status === 'rejected' ? { models: describeError('models', models.reason) } : {}),
    },
    loading: false,
  }
}

export type CloudAccountViewState =
  | 'loading'
  | 'load-error'
  | 'unconfigured'
  | 'no-session'
  | 'session-mismatch'
  | 'cloud-unavailable'
  | 'partial-details'
  | 'connected'

export function getCloudAccountViewState({
  loading,
  loadError,
  status,
  details,
}: {
  loading: boolean
  loadError: string
  status?: CloudStatus
  details: CloudDetailsState
}): CloudAccountViewState {
  if (loading && !status) return 'loading'
  if (loadError) return 'load-error'
  if (!status?.configured) return 'unconfigured'
  if (status.sessionServiceMismatch) return 'session-mismatch'
  if (status.pendingDeviceFlow) return status.hasSession ? 'connected' : 'no-session'
  if (!status.hasSession) return 'no-session'

  const detailErrors = Object.values(details.errors)
  if (status.cloudAvailable === false || (detailErrors.length === 3 && detailErrors.every((item) => item?.unavailable))) {
    return 'cloud-unavailable'
  }
  if (detailErrors.length > 0) return 'partial-details'
  return 'connected'
}

export type CloudAccountContentVisibility = {
  showDeviceFlow: boolean
  showDisconnectedActions: boolean
  showGuestUpgrade: boolean
  showDetails: boolean
}

export function getCloudAccountContentVisibility(status?: CloudStatus): CloudAccountContentVisibility {
  const configured = status?.configured === true
  const hasSession = configured && status.hasSession === true
  const usableSession = hasSession && status.sessionServiceMismatch !== true
  return {
    showDeviceFlow: configured && Boolean(status.pendingDeviceFlow),
    showDisconnectedActions: configured && !status.pendingDeviceFlow && !hasSession,
    showGuestUpgrade: usableSession && !status.pendingDeviceFlow && status.mode === 'guest',
    showDetails: usableSession,
  }
}

export function canRebuildCloudIdentity(status: CloudStatus | undefined, changedUrl: boolean) {
  return Boolean(status?.hasSession && (changedUrl || status.sessionServiceMismatch))
}

export type CloudIdentitySwitchResult =
  | { status: 'success'; config: CloudServiceConfig }
  | { status: 'url-save-failed'; error: unknown }

export async function rebuildCloudIdentityAndSaveUrl(
  targetCloudUrl: string,
  actions: {
    reset: () => Promise<unknown>
    save: (cloudUrl: string) => Promise<CloudServiceConfig>
    onIdentityReset?: () => void
  },
): Promise<CloudIdentitySwitchResult> {
  await actions.reset()
  actions.onIdentityReset?.()
  try {
    return { status: 'success', config: await actions.save(targetCloudUrl) }
  } catch (error) {
    return { status: 'url-save-failed', error }
  }
}
