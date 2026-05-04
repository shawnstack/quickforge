import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readStore } from '../storage.mjs'
import { toolHandlers } from '../tools/index.mjs'
import { workspaceTools } from '../tools/definitions.mjs'
import { projectContextFromId } from '../project-config.mjs'

/**
 * GET /api/tools — returns canonical tool definitions (no project context needed).
 */
export function handleGetTools(_req, res) {
  sendJson(res, 200, { tools: workspaceTools })
}

const dangerousTools = new Set(['write_file', 'edit_file', 'run_command'])

async function assertYoloEnabledForTool(name) {
  if (!dangerousTools.has(name)) return

  const settings = await readStore('settings')
  const yoloMode = settings?.['yolo-mode'] === true || settings?.['yolo-mode'] === 'true'
  if (!yoloMode) {
    const error = new Error('YOLO mode is disabled. Enable it to use this tool.')
    error.statusCode = 403
    throw error
  }
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

  await assertYoloEnabledForTool(name)

  const params = await readJsonBody(req)
  const result = await handler(params || {}, context)
  sendJson(res, 200, result)
}
