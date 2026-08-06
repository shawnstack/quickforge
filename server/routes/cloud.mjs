import { CloudApiError } from '../cloud/client.mjs'
import { getCloudRuntime } from '../cloud/runtime.mjs'
import { isTailscaleAddress } from '../utils/network.mjs'
import { sendJson } from '../utils/response.mjs'

const CLOUD_ACTION_HEADER = 'x-quickforge-action'
const CLOUD_ACTION_VALUE = 'cloud-action'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const JSON_WRITE_ROUTES = new Set([
  'POST /api/cloud/test-connection',
  'PUT /api/cloud/config',
  'POST /api/cloud/identity/reset',
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

export function createCloudRouteHandler({ runtimeFactory = createDefaultRuntime } = {}) {
  let runtime
  let configurationError

  function getRuntime() {
    if (runtime || configurationError) return runtime
    try { runtime = runtimeFactory() } catch (error) { configurationError = error }
    return runtime
  }

  return async function handleCloudApi(req, res, url, {
    isLocalRequest = false,
    remoteAddress,
    remoteAuthorized = false,
  } = {}) {
    const tailscaleAllowed = remoteAuthorized === true
      && isTailscaleAddress(remoteAddress)
    if (!isLocalRequest && !tailscaleAllowed) {
      throw routeError('QuickForge Cloud is available only on this computer or an authorized Tailscale client.', 403, 'cloud_local_only')
    }

    requireProtectedCloudWrite(req, url.pathname)

    const current = getRuntime()
    if (req.method === 'GET' && url.pathname === '/api/cloud/status') {
      if (configurationError) {
        sendJson(res, 200, { configured: false, mode: 'local', configurationError: configurationError.message })
        return
      }
      if (!current?.enabled) {
        sendJson(res, 200, { configured: false, mode: 'local' })
        return
      }
      sendJson(res, 200, { configured: true, ...(await current.identity.status()) })
      return
    }

    if (configurationError) throw routeError(configurationError.message, 503, 'cloud_configuration_error')
    if (!current?.enabled) throw routeError('QuickForge Cloud is not configured.', 503, 'cloud_not_configured')

    try {
      if (req.method === 'POST' && url.pathname === '/api/cloud/guest/start') {
        sendJson(res, 201, await current.identity.startGuest())
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
      if (req.method === 'POST' && url.pathname === '/api/cloud/logout') {
        await current.identity.logout()
        sendJson(res, 200, { ok: true, mode: 'local' })
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
