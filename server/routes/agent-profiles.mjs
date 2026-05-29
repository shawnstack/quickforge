import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import {
  createCustomAgentProfile,
  deleteCustomAgentProfile,
  getAgentProfile,
  listAgentProfiles,
  listAvailableAgentTools,
  updateCustomAgentProfile,
} from '../agent-profiles.mjs'

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

export async function handleAgentProfilesApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/agent-profiles') {
    sendJson(res, 200, { agents: await listAgentProfiles({ includeDisabled: true }) })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/agent-profiles/available-tools') {
    sendJson(res, 200, { tools: listAvailableAgentTools() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agent-profiles') {
    const body = await readJsonBody(req)
    sendJson(res, 200, { agent: await createCustomAgentProfile(body || {}) })
    return
  }

  if (parts[0] === 'api' && parts[1] === 'agent-profiles' && parts[2]) {
    const id = decodeSegment(parts[2])

    if (req.method === 'GET') {
      const agent = await getAgentProfile(id)
      if (!agent) throw requestError('Agent not found', 404)
      sendJson(res, 200, { agent })
      return
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const current = await getAgentProfile(id)
      if (current?.builtin) throw requestError('Built-in agents cannot be modified', 403)
      const body = await readJsonBody(req)
      sendJson(res, 200, { agent: await updateCustomAgentProfile(id, body || {}) })
      return
    }

    if (req.method === 'DELETE') {
      const current = await getAgentProfile(id)
      if (current?.builtin) throw requestError('Built-in agents cannot be deleted', 403)
      await deleteCustomAgentProfile(id)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  throw requestError('Not found', 404)
}
