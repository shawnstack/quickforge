import { sendJson, readJsonBody } from '../utils/response.mjs'
import { refreshAllSessionTools } from '../agent-manager.mjs'
import { deleteMcpServer, normalizeMcpServers, readMcpServers, setMcpServerEnabled, upsertMcpServer, writeMcpServers } from '../mcp/config.mjs'
import { getMcpStatus, reconnectMcpServer, refreshMcpConnections } from '../mcp/registry.mjs'

async function refreshMcpAndAgentTools() {
  await refreshMcpConnections()
  const refreshedSessions = await refreshAllSessionTools()
  return { servers: await getMcpStatus(), refreshedSessions }
}

export async function handleMcpApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/mcp/servers') {
    sendJson(res, 200, { servers: await getMcpStatus() })
    return
  }

  if (req.method === 'PUT' && url.pathname === '/api/mcp/servers') {
    const body = await readJsonBody(req)
    const server = await upsertMcpServer(body?.server || body)
    const payload = await refreshMcpAndAgentTools()
    sendJson(res, 200, { ...payload, saved: server })
    return
  }

  if (req.method === 'PUT' && url.pathname === '/api/mcp/config') {
    const body = await readJsonBody(req)
    const incoming = Array.isArray(body?.servers) ? body.servers : body?.mcpServers
    const mode = body?.mode === 'replace' ? 'replace' : 'merge'
    const imported = normalizeMcpServers(incoming)

    if (mode === 'replace') {
      await writeMcpServers(imported)
    } else {
      for (const server of imported) await upsertMcpServer(server)
    }

    const payload = await refreshMcpAndAgentTools()
    sendJson(res, 200, payload)
    return
  }

  if (req.method === 'PUT' && parts[0] === 'api' && parts[1] === 'mcp' && parts[2] === 'servers' && parts[3] && parts[4] === 'enabled') {
    const body = await readJsonBody(req)
    await setMcpServerEnabled(decodeURIComponent(parts[3]), body?.enabled === true)
    sendJson(res, 200, await refreshMcpAndAgentTools())
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/mcp/reconnect') {
    sendJson(res, 200, await refreshMcpAndAgentTools())
    return
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'mcp' && parts[2] === 'reconnect' && parts[3]) {
    await reconnectMcpServer(decodeURIComponent(parts[3]))
    sendJson(res, 200, await refreshMcpAndAgentTools())
    return
  }

  if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'mcp' && parts[2] === 'servers' && parts[3]) {
    await deleteMcpServer(decodeURIComponent(parts[3]))
    sendJson(res, 200, await refreshMcpAndAgentTools())
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/mcp/config') {
    sendJson(res, 200, { servers: await readMcpServers() })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
