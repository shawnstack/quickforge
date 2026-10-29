import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { isAuthenticatedAppClient } from '../access-policy.mjs'
import { refreshAllSessionTools } from '../agent-manager.mjs'
import { projectContextFromId, readProjectConfig } from '../project-config.mjs'
import { listPluginAudit } from '../plugins/audit.mjs'
import {
  dispatchUiAction,
  getPluginKv,
  getPluginStatus,
  getUiSnapshot,
  readPluginAsset,
  refreshPlugins,
  setPluginConfig,
  setPluginEnabled,
  setPluginKv,
} from '../plugins/registry.mjs'

async function activeProjectContext() {
  const config = await readProjectConfig()
  const activeProject = config.projects.find((project) => project.id === config.activeProjectId) || config.projects[0]
  if (!activeProject?.id) return null
  return projectContextFromId(activeProject.id)
}

async function refreshPluginsAndAgentTools() {
  const projectContext = await activeProjectContext()
  await refreshPlugins(projectContext)
  const refreshedSessions = await refreshAllSessionTools()
  return { ...(await getPluginStatus(projectContext)), refreshedSessions }
}

function assertAppClient(context) {
  if (isAuthenticatedAppClient({
    isLocalRequest: context?.isLocalRequest,
    remoteAuthorized: context?.remoteAuthorized,
  })) return
  const error = new Error('Plugin UI actions are only available to authenticated app clients')
  error.statusCode = 403
  throw error
}

export async function handlePluginsApi(req, res, url, context = {}) {
  const parts = url.pathname.split('/').filter(Boolean)
  const projectContext = () => activeProjectContext()

  if (req.method === 'GET' && url.pathname === '/api/plugins') {
    sendJson(res, 200, await getPluginStatus(await projectContext()))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/plugins/reload') {
    sendJson(res, 200, await refreshPluginsAndAgentTools())
    return
  }

  // Cold-load snapshot of every declarative slot. Registered before the
  // `/api/plugins/:name` branch so "ui" is never mistaken for a plugin name.
  if (req.method === 'GET' && url.pathname === '/api/plugins/ui') {
    sendJson(res, 200, await getUiSnapshot(await projectContext()))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/plugins/audit') {
    const plugin = url.searchParams.get('plugin') || ''
    const limit = Number(url.searchParams.get('limit'))
    sendJson(res, 200, { entries: await listPluginAudit({ plugin, limit: Number.isFinite(limit) ? limit : 50 }) })
    return
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'plugins' && parts[2] && parts[3] === 'ui') {
    assertAppClient(context)
    const name = decodeSegment(parts[2])
    const body = await readJsonBody(req, 256 * 1024)
    const result = await dispatchUiAction(name, body || {}, await projectContext())
    sendJson(res, 200, result || {})
    return
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'plugins' && parts[2] && parts[3] === 'kv') {
    assertAppClient(context)
    const name = decodeSegment(parts[2])
    sendJson(res, 200, { value: await getPluginKv(name) })
    return
  }

  if (req.method === 'PUT' && parts[0] === 'api' && parts[1] === 'plugins' && parts[2] && parts[3] === 'kv') {
    assertAppClient(context)
    const name = decodeSegment(parts[2])
    const body = await readJsonBody(req, 128 * 1024)
    const patch = body?.patch || body || {}
    sendJson(res, 200, { value: await setPluginKv(name, patch) })
    return
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'plugins' && parts[2] && parts[3] === 'assets') {
    const name = decodeSegment(parts[2])
    const relativePath = parts.slice(4).map((segment) => decodeSegment(segment)).join('/')
    const asset = await readPluginAsset(name, relativePath, await projectContext())
    // Defense in depth: if plugin HTML is ever opened in a top-level window
    // instead of the sandboxed iframe, CSP forces it into a unique origin so
    // it cannot reach host localStorage or same-origin /api endpoints.
    const headers = {
      'content-type': asset.contentType,
      'cache-control': 'no-store',
      'content-length': asset.data.length,
      'x-content-type-options': 'nosniff',
    }
    if (asset.contentType.startsWith('text/html')) {
      headers['content-security-policy'] = 'sandbox allow-scripts'
    }
    res.writeHead(200, headers)
    res.end(asset.data)
    return
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'plugins' && parts[2]) {
    const name = decodeSegment(parts[2])
    const status = await getPluginStatus(await projectContext())
    const plugin = status.plugins.find((item) => item.name === name)
    if (!plugin) {
      const error = new Error(`Unknown plugin: ${name}`)
      error.statusCode = 404
      throw error
    }
    sendJson(res, 200, { ...status, plugin })
    return
  }

  if (req.method === 'PUT' && parts[0] === 'api' && parts[1] === 'plugins' && parts[2] && parts[3] === 'enabled') {
    const body = await readJsonBody(req)
    await setPluginEnabled(decodeSegment(parts[2]), body?.enabled === true)
    sendJson(res, 200, await refreshPluginsAndAgentTools())
    return
  }

  if (req.method === 'PUT' && parts[0] === 'api' && parts[1] === 'plugins' && parts[2] && parts[3] === 'config') {
    const body = await readJsonBody(req)
    await setPluginConfig(decodeSegment(parts[2]), body?.config || body || {})
    sendJson(res, 200, await refreshPluginsAndAgentTools())
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
