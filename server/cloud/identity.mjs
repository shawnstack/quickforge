import { CloudApiError } from './client.mjs'

const SESSION_INVALID_CODES = new Set(['refresh_token_reused', 'installation_revoked', 'invalid_refresh_token'])
const DEVICE_PENDING_CODES = new Set(['authorization_pending', 'pending'])
const DEVICE_SLOW_DOWN_CODES = new Set(['slow_down'])
const DEVICE_DENIED_CODES = new Set(['access_denied', 'authorization_declined', 'denied'])
const DEVICE_EXPIRED_CODES = new Set(['expired_token', 'device_code_expired', 'expired'])
const DEVICE_NETWORK_CODES = new Set(['cloud_unavailable', 'service_unavailable', 'temporarily_unavailable'])
const DEVICE_NETWORK_CAUSE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'])
const DEVICE_CLIENT_ID = 'quickforge-desktop'
const MODEL_CACHE_TTL_MS = 60_000
const MODEL_CACHE_HARD_TTL_MS = 5 * 60_000

function tokenExpiry(expiresIn) {
  const seconds = Number(expiresIn)
  return Date.now() + Math.max(1, Number.isFinite(seconds) ? seconds : 300) * 1000
}

function publicAccountSummary(value) {
  if (!value || typeof value !== 'object') return undefined
  const summary = {}
  for (const field of ['id', 'email', 'plan']) {
    const candidate = value[field]
    if (typeof candidate === 'string' && candidate) summary[field] = candidate
  }
  return Object.keys(summary).length ? summary : undefined
}

function isDeviceFlowNetworkError(error) {
  if (error instanceof CloudApiError) {
    return error.retryable === true
      || error.status >= 500
      || DEVICE_NETWORK_CODES.has(error.code)
  }
  const causeCode = error?.cause?.code || error?.code
  return error instanceof TypeError || DEVICE_NETWORK_CAUSE_CODES.has(causeCode)
}


export class CloudIdentityManager {
  constructor({ client, store, serviceUrl } = {}) {
    if (!client || !store) throw new Error('CloudIdentityManager requires client and store.')
    this.client = client
    this.store = store
    this.serviceUrl = String(serviceUrl || client.baseUrl?.href || '')
    if (!this.serviceUrl) throw new Error('CloudIdentityManager requires a service URL.')
    this.accessToken = undefined
    this.accessExpiresAt = 0
    this.refreshPromise = undefined
    this.devicePollPromise = undefined
    this.modelsCache = undefined
    this.modelsCachedAt = 0
    this.modelsPromise = undefined
  }

  async status() {
    let record = await this.store.read()
    if (record.pendingDeviceFlow && Number(record.pendingDeviceFlow.expiresAt) <= Date.now()) {
      record = await this.store.update((current) => ({ ...current, pendingDeviceFlow: undefined }))
    }
    const publicStatus = await this.store.readPublic()
    const sessionServiceMismatch = Boolean(record.refreshToken && record.sessionCloudUrl !== this.serviceUrl)
    const pendingServiceMismatch = Boolean(record.pendingDeviceFlow && record.pendingDeviceFlow.sessionCloudUrl !== this.serviceUrl)
    return (sessionServiceMismatch || pendingServiceMismatch)
      ? { ...publicStatus, sessionServiceMismatch: true }
      : publicStatus
  }

  assertSessionService(record) {
    if (record.refreshToken && record.sessionCloudUrl !== this.serviceUrl) {
      throw new CloudApiError('The saved QuickForge Cloud session belongs to a different or unknown service. Rebuild the local Cloud identity before continuing.', {
        status: 409,
        code: 'cloud_session_service_mismatch',
      })
    }
    if (record.pendingDeviceFlow && record.pendingDeviceFlow.sessionCloudUrl !== this.serviceUrl) {
      throw new CloudApiError('The pending QuickForge Cloud sign-in belongs to a different service. Cancel or rebuild the local Cloud identity before continuing.', {
        status: 409,
        code: 'cloud_session_service_mismatch',
      })
    }
  }


  async startDeviceFlow({ signal } = {}) {
    let record = await this.store.read()
    this.assertSessionService(record)
    if (record.mode === 'account' && record.refreshToken) {
      throw new CloudApiError('QuickForge Cloud is already connected to an account.', { status: 409, code: 'cloud_account_already_connected' })
    }
    if (record.rotateInstallationBeforeRegistration) {
      record = await this.store.rotateInstallation()
    }
    record = await this.store.ensureInstallation()
    if (!record.installationId || !record.publicKey) {
      throw new CloudApiError('QuickForge Cloud installation identity is incomplete.', { status: 409, code: 'cloud_installation_missing' })
    }
    this.assertSessionService(record)
    const authorization = await this.client.authorizeDevice({
      installationId: record.installationId,
      clientId: DEVICE_CLIENT_ID,
      publicKey: record.publicKey,
      installationName: record.installationName,
      platform: record.platform,
      clientVersion: record.clientVersion,
      signal,
    })
    const expiresIn = Math.max(1, Number(authorization?.expiresIn) || 600)
    const interval = Math.max(1, Number(authorization?.interval) || 5)
    const pendingDeviceFlow = {
      deviceCode: String(authorization?.deviceCode || ''),
      userCode: String(authorization?.userCode || ''),
      verificationUri: String(authorization?.verificationUri || ''),
      verificationUriComplete: String(authorization?.verificationUriComplete || ''),
      expiresAt: Date.now() + expiresIn * 1000,
      interval,
      status: 'pending',
      sessionCloudUrl: this.serviceUrl,
    }
    if (!pendingDeviceFlow.deviceCode || !pendingDeviceFlow.userCode || !pendingDeviceFlow.verificationUri) {
      throw new CloudApiError('QuickForge Cloud returned an invalid device authorization response.', { code: 'invalid_device_authorization_response' })
    }
    await this.store.update((current) => ({ ...current, pendingDeviceFlow }))
    return this.status()
  }

  async pollDeviceFlow(options = {}) {
    if (this.devicePollPromise) return this.devicePollPromise
    this.devicePollPromise = this.pollDeviceFlowOnce(options)
      .finally(() => { this.devicePollPromise = undefined })
    return this.devicePollPromise
  }

  async pollDeviceFlowOnce({ signal } = {}) {
    const record = await this.store.read()
    this.assertSessionService(record)
    const pending = record.pendingDeviceFlow
    if (!pending?.deviceCode) {
      throw new CloudApiError('There is no pending QuickForge Cloud sign-in.', { status: 409, code: 'cloud_device_flow_not_pending' })
    }
    if (Number(pending.expiresAt) <= Date.now()) {
      await this.store.update((current) => ({ ...current, pendingDeviceFlow: undefined }))
      return { ...(await this.status()), deviceFlowResult: 'expired' }
    }
    try {
      const tokens = await this.client.exchangeDeviceCode(pending.deviceCode, DEVICE_CLIENT_ID, signal)
      if (!tokens?.refreshToken || !tokens?.accessToken) {
        throw new CloudApiError('QuickForge Cloud returned an invalid account token response.', { code: 'invalid_token_response' })
      }
      this.setAccess(tokens)
      this.modelsCache = undefined
      this.modelsCachedAt = 0
      this.modelsPromise = undefined
      await this.store.update((current) => ({
        ...current,
        mode: 'account',
        installationId: tokens.installationId || current.installationId,
        refreshToken: tokens.refreshToken,
        sessionCloudUrl: this.serviceUrl,
        pendingDeviceFlow: undefined,
        account: undefined,
      }))
      return { ...(await this.getStatusWithRemoteSummary(signal)), deviceFlowResult: 'success' }
    } catch (error) {
      if (DEVICE_PENDING_CODES.has(error?.code)) return { ...(await this.status()), deviceFlowResult: 'pending' }
      if (DEVICE_SLOW_DOWN_CODES.has(error?.code)) {
        await this.store.update((current) => ({
          ...current,
          pendingDeviceFlow: current.pendingDeviceFlow
            ? { ...current.pendingDeviceFlow, interval: Math.max(1, Number(current.pendingDeviceFlow.interval) || 5) + 5, status: 'slow_down' }
            : undefined,
        }))
        return { ...(await this.status()), deviceFlowResult: 'slow_down' }
      }
      if (DEVICE_DENIED_CODES.has(error?.code) || DEVICE_EXPIRED_CODES.has(error?.code)) {
        await this.store.update((current) => ({ ...current, pendingDeviceFlow: undefined }))
        return { ...(await this.status()), deviceFlowResult: DEVICE_DENIED_CODES.has(error?.code) ? 'denied' : 'expired' }
      }
      if (isDeviceFlowNetworkError(error)) {
        return { ...(await this.status()), deviceFlowResult: 'network' }
      }
      throw error
    }
  }

  async cancelDeviceFlow() {
    const record = await this.store.read()
    this.assertSessionService(record)
    await this.store.update((current) => ({ ...current, pendingDeviceFlow: undefined }))
    return this.status()
  }

  setAccess(tokens) {
    this.accessToken = tokens?.accessToken
    this.accessExpiresAt = tokenExpiry(tokens?.expiresIn)
  }

  async clearInvalidSession({ rotateInstallationBeforeRegistration = false } = {}) {
    this.clearMemory()
    await this.store.clearSession({ rotateInstallationBeforeRegistration })
  }

  clearMemory() {
    this.accessToken = undefined
    this.accessExpiresAt = 0
    this.refreshPromise = undefined
    this.devicePollPromise = undefined
    this.modelsCache = undefined
    this.modelsCachedAt = 0
    this.modelsPromise = undefined
  }

  async resetIdentity() {
    this.clearMemory()
    await this.store.rotateInstallation()
  }

  async refresh({ signal } = {}) {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = (async () => {
      const record = await this.store.read()
      if (!record.refreshToken) throw new CloudApiError('QuickForge Cloud is not connected.', { status: 401, code: 'cloud_not_connected' })
      this.assertSessionService(record)
      try {
        const tokens = await this.client.refresh(record.refreshToken, signal)
        if (!tokens?.refreshToken) throw new CloudApiError('QuickForge Cloud did not rotate the refresh token.', { code: 'invalid_token_response' })
        this.setAccess(tokens)
        await this.store.update((current) => ({
          ...current,
          mode: tokens.identityMode || current.mode || 'account',
          installationId: tokens.installationId || current.installationId,
          refreshToken: tokens.refreshToken,
          sessionCloudUrl: this.serviceUrl,
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
      const [remoteAccount, usage] = await Promise.all([this.me(signal), this.usage(signal)])
      const account = publicAccountSummary(remoteAccount)
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
    this.assertSessionService(record)
    await this.revokeInstallation(record.installationId, signal)
    this.clearMemory()
    await this.store.clearSession({ rotateInstallationBeforeRegistration: true })
  }
  async models(signal, { refresh = false, allowStale = true } = {}) {
    const age = Date.now() - this.modelsCachedAt
    if (!refresh && this.modelsCache && age < MODEL_CACHE_TTL_MS) return this.modelsCache
    if (this.modelsPromise) return this.modelsPromise
    this.modelsPromise = this.withAccessToken((token) => this.client.models(token, signal), { signal })
      .then((response) => {
        this.modelsCache = Array.isArray(response?.data) ? response.data : (Array.isArray(response?.items) ? response.items : [])
        this.modelsCachedAt = Date.now()
        return this.modelsCache
      })
      .catch((error) => {
        if (allowStale && this.modelsCache && age < MODEL_CACHE_HARD_TTL_MS) return this.modelsCache
        throw error
      })
      .finally(() => { this.modelsPromise = undefined })
    return this.modelsPromise
  }
  chat(payload, idempotencyKey, signal) {
    return this.withAccessToken((token) => this.client.chat(token, payload, idempotencyKey, signal), { signal })
  }
}
