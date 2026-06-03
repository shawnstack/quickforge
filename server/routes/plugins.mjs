import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { refreshAllSessionTools } from '../agent-manager.mjs'
import { projectContextFromId, readProjectConfig } from '../project-config.mjs'
import { getPluginStatus, refreshPlugins, setPluginConfig, setPluginEnabled } from '../plugins/registry.mjs'

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

export async function handlePluginsApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/plugins') {
    sendJson(res, 200, await getPluginStatus(await activeProjectContext()))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/plugins/reload') {
    sendJson(res, 200, await refreshPluginsAndAgentTools())
    return
  }

  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'plugins' && parts[2]) {
    const name = decodeSegment(parts[2])
    const status = await getPluginStatus(await activeProjectContext())
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
