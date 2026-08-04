import { cloudEndpoint } from './config.mjs'

export class CloudApiError extends Error {
  constructor(message, { status = 0, code = 'cloud_request_failed', retryable = false, details } = {}) {
    super(message)
    this.name = 'CloudApiError'
    this.status = status
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

async function parseError(response) {
  let payload
  try { payload = await response.json() } catch { payload = undefined }
  const error = payload?.error
  return new CloudApiError(error?.message || `QuickForge Cloud request failed (${response.status}).`, {
    status: response.status,
    code: error?.code || 'cloud_request_failed',
    retryable: Boolean(error?.retryable),
    details: error?.details,
  })
}

function timeoutSignal(timeoutMs, outerSignal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout
}

export class CloudClient {
  constructor({ baseUrl, timeoutMs = 10_000, fetchImpl = fetch } = {}) {
    if (!(baseUrl instanceof URL)) throw new Error('CloudClient requires a configured base URL.')
    this.baseUrl = baseUrl
    this.timeoutMs = timeoutMs
    this.fetch = fetchImpl
  }

  async request(pathname, { method = 'GET', token, body, headers, signal, raw = false, timeout = true } = {}) {
    const requestHeaders = { Accept: 'application/json', ...headers }
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json'
    if (token) requestHeaders.Authorization = `Bearer ${token}`
    const response = await this.fetch(cloudEndpoint(this.baseUrl, pathname), {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeout ? timeoutSignal(this.timeoutMs, signal) : signal,
      redirect: 'error',
    })
    if (!response.ok) throw await parseError(response)
    if (raw) return response
    if (response.status === 204) return undefined
    return response.json()
  }

  health(signal) { return this.request('healthz', { signal }) }
  ready(signal) { return this.request('readyz', { signal }) }
  registerGuest(input, idempotencyKey, signal) {
    return this.request('v1/guest/installations', {
      method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey }, signal,
    })
  }
  refresh(refreshToken, signal) {
    return this.request('oauth/token', {
      method: 'POST', body: { grantType: 'refresh_token', refreshToken }, signal,
    })
  }
  me(token, signal) { return this.request('v1/me', { token, signal }) }
  models(token, signal) { return this.request('v1/models', { token, signal }) }
  usage(token, signal) { return this.request('v1/usage', { token, signal }) }
  installations(token, signal) { return this.request('v1/installations', { token, signal }) }
  revokeInstallation(token, installationId, signal) {
    return this.request(`v1/installations/${encodeURIComponent(installationId)}`, { method: 'DELETE', token, signal })
  }
  chat(token, payload, idempotencyKey, signal) {
    return this.request('v1/chat/completions', {
      method: 'POST', token, body: payload,
      headers: { 'Idempotency-Key': idempotencyKey }, signal, raw: true, timeout: false,
    })
  }
}
