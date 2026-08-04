import { createHash, randomUUID } from 'node:crypto'
import { CloudApiError } from './client.mjs'

const SESSION_INVALID_CODES = new Set(['refresh_token_reused', 'installation_revoked', 'invalid_refresh_token'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function tokenExpiry(expiresIn) {
  const seconds = Number(expiresIn)
  return Date.now() + Math.max(1, Number.isFinite(seconds) ? seconds : 300) * 1000
}

function registrationHash(record) {
  return createHash('sha256').update(JSON.stringify({
    installationName: record.installationName,
    platform: record.platform,
    clientVersion: record.clientVersion,
    publicKey: record.publicKey,
  })).digest('base64url')
}

export class CloudIdentityManager {
  constructor({ client, store } = {}) {
    if (!client || !store) throw new Error('CloudIdentityManager requires client and store.')
    this.client = client
    this.store = store
    this.accessToken = undefined
    this.accessExpiresAt = 0
    this.refreshPromise = undefined
    this.modelsCache = undefined
  }

  async status() {
    return this.store.readPublic()
  }

  async startGuest({ signal } = {}) {
    let record = await this.store.read()
    if (record.rotateInstallationBeforeRegistration) {
      record = await this.store.rotateInstallation()
    } else {
      record = await this.store.ensureInstallation()
    }
    const requestHash = registrationHash(record)
    let idempotencyKey = record.pendingRegistrationKey
    if (!UUID_PATTERN.test(idempotencyKey || '') || record.pendingRegistrationHash !== requestHash) {
      idempotencyKey = randomUUID()
      await this.store.update((current) => ({
        ...current,
        pendingRegistrationKey: idempotencyKey,
        pendingRegistrationHash: requestHash,
      }))
    }

    const tokens = await this.client.registerGuest({
      installationName: record.installationName,
      platform: record.platform,
      clientVersion: record.clientVersion,
      publicKey: record.publicKey,
    }, idempotencyKey, signal)

    this.setAccess(tokens)
    await this.store.update((current) => ({
      ...current,
      mode: tokens.identityMode || 'guest',
      installationId: tokens.installationId,
      refreshToken: tokens.refreshToken,
      pendingRegistrationKey: undefined,
      pendingRegistrationHash: undefined,
    }))
    return this.getStatusWithRemoteSummary(signal)
  }

  setAccess(tokens) {
    this.accessToken = tokens?.accessToken
    this.accessExpiresAt = tokenExpiry(tokens?.expiresIn)
  }

  async clearInvalidSession({ rotateInstallationBeforeRegistration = false } = {}) {
    this.accessToken = undefined
    this.accessExpiresAt = 0
    this.modelsCache = undefined
    await this.store.clearSession({ rotateInstallationBeforeRegistration })
  }

  async refresh({ signal } = {}) {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = (async () => {
      const record = await this.store.read()
      if (!record.refreshToken) throw new CloudApiError('QuickForge Cloud is not connected.', { status: 401, code: 'cloud_not_connected' })
      try {
        const tokens = await this.client.refresh(record.refreshToken, signal)
        if (!tokens?.refreshToken) throw new CloudApiError('QuickForge Cloud did not rotate the refresh token.', { code: 'invalid_token_response' })
        this.setAccess(tokens)
        await this.store.update((current) => ({
          ...current,
          mode: tokens.identityMode || current.mode || 'guest',
          installationId: tokens.installationId || current.installationId,
          refreshToken: tokens.refreshToken,
        }))
        return this.accessToken
      } catch (error) {
        if (SESSION_INVALID_CODES.has(error?.code)) {
          await this.clearInvalidSession({ rotateInstallationBeforeRegistration: true })
        }
        throw error
      }
    })().finally(() => { this.refreshPromise = undefined })
    return this.refreshPromise
  }

  async access({ signal, forceRefresh = false } = {}) {
    if (!forceRefresh && this.accessToken && this.accessExpiresAt > Date.now() + 30_000) return this.accessToken
    return this.refresh({ signal })
  }

  async withAccessToken(operation, { signal } = {}) {
    let token = await this.access({ signal })
    try {
      return await operation(token)
    } catch (error) {
      if (!(error instanceof CloudApiError) || error.status !== 401) throw error
      token = await this.access({ signal, forceRefresh: true })
      return operation(token)
    }
  }

  async getStatusWithRemoteSummary(signal) {
    const local = await this.status()
    if (!local.hasSession) return local
    try {
      const [account, usage] = await Promise.all([this.me(signal), this.usage(signal)])
      await this.store.update((record) => ({ ...record, account }))
      return { ...(await this.status()), account, usage, cloudAvailable: true }
    } catch (error) {
      return { ...local, cloudAvailable: false, cloudError: error?.code || 'cloud_unavailable' }
    }
  }

  me(signal) { return this.withAccessToken((token) => this.client.me(token, signal), { signal }) }
  usage(signal) { return this.withAccessToken((token) => this.client.usage(token, signal), { signal }) }
  installations(signal) { return this.withAccessToken((token) => this.client.installations(token, signal), { signal }) }
  revokeInstallation(id, signal) {
    return this.withAccessToken((token) => this.client.revokeInstallation(token, id, signal), { signal })
  }
  async logout({ signal } = {}) {
    const record = await this.store.read()
    if (!record.refreshToken || !record.installationId) {
      await this.clearInvalidSession()
      return
    }
    await this.revokeInstallation(record.installationId, signal)
    this.accessToken = undefined
    this.accessExpiresAt = 0
    this.modelsCache = undefined
    await this.store.clearSession({ rotateInstallationBeforeRegistration: true })
  }
  async models(signal, { refresh = false } = {}) {
    if (!refresh && this.modelsCache) return this.modelsCache
    const response = await this.withAccessToken((token) => this.client.models(token, signal), { signal })
    this.modelsCache = Array.isArray(response?.items) ? response.items : []
    return this.modelsCache
  }
  chat(payload, idempotencyKey, signal) {
    return this.withAccessToken((token) => this.client.chat(token, payload, idempotencyKey, signal), { signal })
  }
}
