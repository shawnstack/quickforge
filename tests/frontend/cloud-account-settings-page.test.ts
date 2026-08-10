import { describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { CloudInstallation, CloudServiceConfig, CloudUsage } from '../../src/lib/cloud-client'
import {
  canRebuildCloudIdentity,
  cloudDetailsReducer,
  emptyCloudDetailsState,
  getCloudAccountContentVisibility,
  getCloudAccountViewState,
  loadCloudAccountDetails,
  rebuildCloudIdentityAndSaveUrl,
  shouldPollCloudRemoteStatus,
} from '../../src/components/cloud/cloud-account-settings-state'

const usage: CloudUsage = { remaining: 42, resetsAt: '2026-03-01T00:00:00.000Z' }
const installations: CloudInstallation[] = [{ id: 'device-1', name: 'Current device' }]
const models = [{ id: 'cloud-model', name: 'Cloud Model', provider: 'quickforge-cloud' }] as Model<Api>[]
const config: CloudServiceConfig = {
  schemaVersion: 1,
  serviceType: 'quickforge-cloud',
  enabled: true,
  cloudUrl: 'https://new.example.test/',
  source: 'saved',
}

function describeError(kind: 'usage' | 'installations' | 'models') {
  return { message: `${kind} failed`, unavailable: false }
}

describe('Cloud account settings state', () => {
  it('polls remote status only while starting or authorizing', () => {
    expect(shouldPollCloudRemoteStatus('starting')).toBe(true)
    expect(shouldPollCloudRemoteStatus('authorizing')).toBe(true)
    expect(shouldPollCloudRemoteStatus('running')).toBe(false)
    expect(shouldPollCloudRemoteStatus('disabled')).toBe(false)
    expect(shouldPollCloudRemoteStatus(undefined)).toBe(false)
  })

  it('keeps usage and devices when models fail', async () => {
    const state = await loadCloudAccountDetails({
      usage: async () => usage,
      installations: async () => installations,
      models: async () => { throw new Error('models failed') },
    }, describeError)

    expect(state.usage).toEqual(usage)
    expect(state.installations).toEqual(installations)
    expect(state.models).toEqual([])
    expect(state.errors).toEqual({ models: { message: 'models failed', unavailable: false } })
  })

  it('clears old quota when usage refresh fails', async () => {
    const previous = {
      ...emptyCloudDetailsState,
      usage,
      installations,
      models,
    }
    const next = await loadCloudAccountDetails({
      usage: async () => { throw new Error('usage failed') },
      installations: async () => installations,
      models: async () => models,
    }, describeError)

    const state = cloudDetailsReducer(previous, { type: 'replace', state: next })
    expect(state.usage).toBeUndefined()
    expect(state.errors.usage?.message).toBe('usage failed')
    expect(state.installations).toEqual(installations)
    expect(state.models).toEqual(models)
  })

  it('shows the identity rebuild entry for a session service mismatch', () => {
    const status = { configured: true, mode: 'guest' as const, hasSession: true, sessionServiceMismatch: true }

    expect(getCloudAccountViewState({ loading: false, loadError: '', status, details: emptyCloudDetailsState })).toBe('session-mismatch')
    expect(canRebuildCloudIdentity(status, false)).toBe(true)
  })

  it('shows a resumable device flow before the ordinary connected state', () => {
    const status = {
      configured: true,
      mode: 'guest' as const,
      hasSession: true,
      pendingDeviceFlow: { userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() + 60_000, interval: 5 },
    }
    expect(getCloudAccountViewState({ loading: false, loadError: '', status, details: emptyCloudDetailsState })).toBe('connected')
  })

  it('keeps guest details visible for a usable guest session', () => {
    const visibility = getCloudAccountContentVisibility({ configured: true, mode: 'guest', hasSession: true })
    expect(visibility).toEqual({
      showDeviceFlow: false,
      showDisconnectedActions: false,
      showDetails: true,
    })
  })

  it('restores a pending device flow instead of showing guest upgrade, while retaining loaded guest details', () => {
    const status = {
      configured: true,
      mode: 'guest' as const,
      hasSession: true,
      pendingDeviceFlow: { userCode: 'ABCD-EFGH', verificationUri: 'https://cloud.test/device', expiresAt: Date.now() + 60_000, interval: 5 },
    }
    expect(getCloudAccountViewState({ loading: false, loadError: '', status, details: { ...emptyCloudDetailsState, installations, models } })).toBe('connected')
    expect(getCloudAccountContentVisibility(status)).toEqual({
      showDeviceFlow: true,
      showDisconnectedActions: false,
      showDetails: true,
    })
  })

  it('keeps the partial-success state when identity reset succeeds but URL save fails', async () => {
    const onIdentityReset = vi.fn()
    const saveError = new Error('save failed')
    const result = await rebuildCloudIdentityAndSaveUrl('https://new.example.test/', {
      reset: vi.fn().mockResolvedValue({ ok: true }),
      save: vi.fn().mockRejectedValue(saveError),
      onIdentityReset,
    })

    expect(onIdentityReset).toHaveBeenCalledOnce()
    expect(result).toEqual({ status: 'url-save-failed', error: saveError })
  })

  it('replaces all detail data after a successful refresh', async () => {
    const previous = {
      ...emptyCloudDetailsState,
      usage: { remaining: 1 },
      installations: [{ id: 'old-device' }],
      models: [{ id: 'old-model', provider: 'quickforge-cloud' }] as Model<Api>[],
    }
    const refreshed = await loadCloudAccountDetails({
      usage: async () => usage,
      installations: async () => installations,
      models: async () => models,
    }, describeError)

    expect(cloudDetailsReducer(previous, { type: 'replace', state: refreshed })).toEqual({
      usage,
      installations,
      models,
      errors: {},
      loading: false,
    })
  })

  it('clears all old details immediately after logout', () => {
    const previous = {
      ...emptyCloudDetailsState,
      usage,
      installations,
      models,
      errors: { usage: { message: 'old error', unavailable: false } },
    }

    expect(cloudDetailsReducer(previous, { type: 'clear' })).toEqual(emptyCloudDetailsState)
  })

  it('returns success only after both identity reset and URL save succeed', async () => {
    const result = await rebuildCloudIdentityAndSaveUrl('https://new.example.test/', {
      reset: vi.fn().mockResolvedValue({ ok: true }),
      save: vi.fn().mockResolvedValue(config),
    })

    expect(result).toEqual({ status: 'success', config })
  })
})
