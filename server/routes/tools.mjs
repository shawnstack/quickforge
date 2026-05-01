import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { toolHandlers } from '../tools/index.mjs'
import { workspaceTools } from '../tools/definitions.mjs'
import { projectContextFromId } from '../project-config.mjs'

/**
 * GET /api/tools — returns canonical tool definitions (no project context needed).
 */
export function handleGetTools(_req, res) {
  sendJson(res, 200, { tools: workspaceTools })
}

export async function handleToolApi(req, res, url) {
  if (req.method !== 'POST') {
    const error = new Error('Tool endpoints require POST')
    error.statusCode = 405
    throw error
  }

  const parts = url.pathname.split('/').filter(Boolean)
  let name = decodeSegment(parts[2])
  let context

  if (parts[1] === 'projects' && parts[3] === 'tools') {
    context = await projectContextFromId(decodeSegment(parts[2]))
    name = decodeSegment(parts[4])
  }

  const handler = toolHandlers[name]
  if (!handler) {
    const error = new Error(`Unknown tool: ${name}`)
    error.statusCode = 404
    throw error
  }

  const params = await readJsonBody(req)
  const result = await handler(params || {}, context)
  sendJson(res, 200, result)
}
