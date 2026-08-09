import { getQfAgentStatus } from '../cloud/qf-agent-process.mjs'
import { isAuthenticatedAppClient } from '../access-policy.mjs'
import { CloudClient, CloudApiError } from '../cloud/client.mjs'
import { parseCloudBaseUrl } from '../cloud/config.mjs'
import { createCloudCredentialStore } from '../cloud/credential-store.mjs'
import { getCloudRuntime, invalidateCloudRuntime } from '../cloud/runtime.mjs'
import {
  publicCloudServiceConfig,
  readCloudServiceConfig,
  saveCloudServiceConfig,
} from '../cloud/service-config.mjs'
import { readJsonBody, sendJson } from '../utils/response.mjs'

const CLOUD_CONFIG_BODY_MAX_BYTES = 16 * 1024
const CLOUD_ACTION_HEADER = 'x-quickforge-action'
const CLOUD_ACTION_VALUE = 'cloud-action'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const JSON_WRITE_ROUTES = new Set([
  'POST /api/cloud/test-connection',
  'PUT /api/cloud/config',
  'POST /api/cloud/identity/reset',
  'POST /api/cloud/device/start',
  'POST /api/cloud/device/poll',
  'POST /api/cloud/device/cancel',
])

function routeError(message, statusCode, code) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.errorCode = code
  error.code = code
  return error
}

function mapCloudError(error) {
  if (!(error instanceof CloudApiError)) return error
  const mapped = routeError(error.message, error.status || 503, error.code)
  mapped.retryable = error.retryable
  mapped.details = error.details
  return mapped
}

function createDefaultRuntime() {
  return getCloudRuntime()
}

function sameCloudUrl(left, right) {
  try {
    return parseCloudBaseUrl(left).href === parseCloudBaseUrl(right).href
  } catch {
    return false
  }
}

function requireDangerousConfirmation(body) {
  if (body?.confirm !== 'reset-cloud-identity') {
    throw routeError('Explicit confirmation is required to rebuild the QuickForge Cloud identity.', 400, 'cloud_reset_confirmation_required')
  }
}

function requireProtectedCloudWrite(req, pathname) {
  const method = String(req.method || 'GET').toUpperCase()
  if (SAFE_METHODS.has(method)) return

  if (req.headers[CLOUD_ACTION_HEADER] !== CLOUD_ACTION_VALUE) {
    throw routeError('QuickForge Cloud action header is required.', 403, 'cloud_action_header_required')
  }

  if (!JSON_WRITE_ROUTES.has(`${method} ${pathname}`)) return
  const mediaType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw routeError('QuickForge Cloud JSON requests require Content-Type: application/json.', 415, 'cloud_json_content_type_required')
  }
}

export function createCloudRouteHandler({
  runtimeFactory = createDefaultRuntime,
  readServiceConfig = readCloudServiceConfig,
  saveServiceConfig = saveCloudServiceConfig,
  credentialStoreFactory = createCloudCredentialStore,
  invalidateRuntime = invalidateCloudRuntime,
  cloudClientFactory = (config) => new CloudClient(config),
  qfAgentStatus = getQfAgentStatus,
  onCloudServiceConfigChanged,
} = {}) {
  async function runtimeOrError() {
    try {
      return { runtime: await runtimeFactory() }
    } catch (error) {
      return { configurationError: error }
    }
  }

  return async function handleCloudApi(req, res, url, context = {}) {
    if (!isAuthenticatedAppClient(context)) {
      throw routeError('QuickForge Cloud is available only on this computer or an authenticated remote client.', 403, 'cloud_local_only')
    }

    requireProtectedCloudWrite(req, url.pathname)

    if (req.method === 'GET' && url.pathname === '/api/cloud/remote/status') {
      sendJson(res, 200, qfAgentStatus())
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/cloud/config') {
      sendJson(res, 200, publicCloudServiceConfig(await readServiceConfig({ strict: false })))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/cloud/test-connection') {
      const body = await readJsonBody(req, CLOUD_CONFIG_BODY_MAX_BYTES)
      const baseUrl = parseCloudBaseUrl(body?.cloudUrl)
      const timeoutValue = Number(process.env.QUICKFORGE_CLOUD_TIMEOUT_MS || 10_000)
      const client = cloudClientFactory({
        baseUrl,
        timeoutMs: Number.isFinite(timeoutValue) ? Math.min(60_000, Math.max(1_000, timeoutValue)) : 10_000,
      })
      try {
        const [health, ready] = await Promise.all([client.health(), client.ready()])
        sendJson(res, 200, { ok: true, cloudUrl: baseUrl.href, health, ready })
      } catch (error) {
        throw mapCloudError(error)
      }
      return
    }

    if (req.method === 'PUT' && url.pathname === '/api/cloud/config') {
      const body = await readJsonBody(req, CLOUD_CONFIG_BODY_MAX_BYTES)
      if (body?.enabled !== undefined && typeof body.enabled !== 'boolean') {
        throw routeError('QuickForge Cloud enabled must be a boolean.', 400, 'cloud_enabled_invalid')
      }
      const currentConfig = await readServiceConfig({ strict: false })
      const explicitCloudUrl = body?.cloudUrl !== undefined
      const nextUrl = explicitCloudUrl ? parseCloudBaseUrl(body.cloudUrl).href : currentConfig.cloudUrl
      const nextEnabled = body?.enabled === undefined ? currentConfig.enabled === true : body.enabled
      const urlChanged = explicitCloudUrl && !sameCloudUrl(currentConfig.cloudUrl, nextUrl)
      if (explicitCloudUrl) {
        const credentialStore = credentialStoreFactory()
        const identityRecord = await credentialStore.read()
        if (identityRecord.refreshToken || identityRecord.pendingDeviceFlow) {
          const boundUrl = String(identityRecord.pendingDeviceFlow?.sessionCloudUrl || identityRecord.sessionCloudUrl || '').trim()
          const sameUrl = boundUrl ? sameCloudUrl(boundUrl, nextUrl) : false
          if (!sameUrl) {
            throw routeError('A QuickForge Cloud session is active. Sign out first, or explicitly rebuild the identity before switching services.', 409, 'cloud_session_active')
          }
        }
      }
      await saveServiceConfig({ cloudUrl: nextUrl, enabled: nextEnabled, allowInvalidUrl: !explicitCloudUrl })
      invalidateRuntime()
      const saved = await readServiceConfig({ strict: false })
      const notify = context.onCloudServiceConfigChanged || onCloudServiceConfigChanged
      if (typeof notify === 'function') await notify(saved, { urlChanged })
      sendJson(res, 200, publicCloudServiceConfig(saved))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/cloud/identity/reset') {
      const body = await readJsonBody(req, CLOUD_CONFIG_BODY_MAX_BYTES)
      requireDangerousConfirmation(body)
      const { runtime } = await runtimeOrError()
      if (runtime?.identity) await runtime.identity.resetIdentity()
      else {
        const store = credentialStoreFactory()
        await store.rotateInstallation()
      }
      invalidateRuntime()
      sendJson(res, 200, { ok: true, mode: 'local' })
      return
    }

    const { runtime: current, configurationError } = await runtimeOrError()
    if (req.method === 'GET' && url.pathname === '/api/cloud/status') {
      if (configurationError) {
        const service = await readServiceConfig({ strict: false })
        if (!service.enabled) {
          const store = credentialStoreFactory()
          sendJson(res, 200, { ...(await store.readPublic()), configured: Boolean(service.cloudUrl), enabled: false, configurationError: service.configurationError || configurationError.message })
          return
        }
        sendJson(res, 200, { configured: false, enabled: true, mode: 'local', configurationError: configurationError.message })
        return
      }
      if (!current?.enabled) {
        const localStatus = current?.identity ? await current.identity.status() : current?.store ? await current.store.readPublic() : { mode: 'local' }
        sendJson(res, 200, { ...localStatus, configured: Boolean(current?.config?.baseUrl), enabled: false })
        return
      }
      sendJson(res, 200, { configured: true, enabled: true, ...(await current.identity.status()) })
      return
    }

    if (configurationError) {
      const service = await readServiceConfig({ strict: false })
      if (req.method === 'POST' && url.pathname === '/api/cloud/logout' && !service.enabled) {
        await credentialStoreFactory().clearSession({ rotateInstallationBeforeRegistration: true })
        invalidateRuntime()
        sendJson(res, 200, { ok: true, mode: 'local' })
        return
      }
      throw routeError(configurationError.message, 503, 'cloud_configuration_error')
    }

    if (req.method === 'POST' && url.pathname === '/api/cloud/logout') {
      if (current?.identity) await current.identity.logout()
      else if (current?.store) await current.store.clearSession({ rotateInstallationBeforeRegistration: true })
      else await credentialStoreFactory().clearSession({ rotateInstallationBeforeRegistration: true })
      invalidateRuntime()
      sendJson(res, 200, { ok: true, mode: 'local' })
      return
    }

    if (!current?.enabled) throw routeError('QuickForge Cloud is disabled.', 503, 'cloud_disabled')

    try {
      if (req.method === 'POST' && url.pathname === '/api/cloud/device/start') {
        await readJsonBody(req, CLOUD_CONFIG_BODY_MAX_BYTES)
        sendJson(res, 201, await current.identity.startDeviceFlow())
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/cloud/device/poll') {
        await readJsonBody(req, CLOUD_CONFIG_BODY_MAX_BYTES)
        sendJson(res, 200, await current.identity.pollDeviceFlow())
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/cloud/device/cancel') {
        await readJsonBody(req, CLOUD_CONFIG_BODY_MAX_BYTES)
        sendJson(res, 200, await current.identity.cancelDeviceFlow())
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/cloud/models') {
        sendJson(res, 200, { items: await current.models.list(undefined, { refresh: true }) })
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/cloud/usage') {
        sendJson(res, 200, await current.identity.usage())
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/cloud/installations') {
        sendJson(res, 200, await current.identity.installations())
        return
      }
      const revokeMatch = url.pathname.match(/^\/api\/cloud\/installations\/([^/]+)$/)
      if (req.method === 'DELETE' && revokeMatch) {
        await current.identity.revokeInstallation(decodeURIComponent(revokeMatch[1]))
        sendJson(res, 200, { ok: true })
        return
      }
    } catch (error) {
      throw mapCloudError(error)
    }

    throw routeError('Not found', 404, 'route_not_found')
  }
}

export const handleCloudApi = createCloudRouteHandler()
