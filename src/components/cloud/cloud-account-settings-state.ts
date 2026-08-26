import type { Api, Model } from '@earendil-works/pi-ai'
import type { CloudServiceConfig, CloudStatus, CloudUsage } from '@/lib/cloud-client'

export type CloudDetailError = {
  message: string
  unavailable: boolean
}

export type CloudDetailsState = {
  usage?: CloudUsage
  models: Model<Api>[]
  errors: {
    usage?: CloudDetailError
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
  models: () => Promise<Model<Api>[]>
}

export async function loadCloudAccountDetails(
  loaders: CloudDetailsLoaders,
  describeError: (kind: keyof CloudDetailsLoaders, error: unknown) => CloudDetailError,
): Promise<CloudDetailsState> {
  const [usage, models] = await Promise.allSettled([
    loaders.usage(),
    loaders.models(),
  ])

  return {
    usage: usage.status === 'fulfilled' ? usage.value : undefined,
    models: models.status === 'fulfilled' ? models.value : [],
    errors: {
      ...(usage.status === 'rejected' ? { usage: describeError('usage', usage.reason) } : {}),
      ...(models.status === 'rejected' ? { models: describeError('models', models.reason) } : {}),
    },
    loading: false,
  }
}

export type CloudAccountContentVisibility = {
  showDeviceFlow: boolean
  showDisconnectedActions: boolean
  showDetails: boolean
}

export function getCloudAccountContentVisibility(status?: CloudStatus): CloudAccountContentVisibility {
  const configured = status?.configured === true
  const hasSession = configured && status.hasSession === true
  const usableSession = hasSession && status.sessionServiceMismatch !== true
  return {
    showDeviceFlow: configured && Boolean(status.pendingDeviceFlow),
    showDisconnectedActions: configured && !status.pendingDeviceFlow && !hasSession,
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
