import { readJsonBody, sendJson } from '../utils/response.mjs'
import {
  readWorkingMemoryDocument,
  saveWorkingMemorySettings,
} from '../working-memory.mjs'

const MAX_WORKING_MEMORY_REQUEST_BYTES = 20 * 1024

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

export async function handleWorkingMemoryApi(req, res, options = {}) {
  if (req.method === 'GET') {
    sendJson(res, 200, await readWorkingMemoryDocument(options))
    return
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody(req, MAX_WORKING_MEMORY_REQUEST_BYTES)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw requestError('Working memory settings are required.')
    }
    // The note-writing prompt is an internal contract; Settings can only toggle
    // the feature. Rejecting is clearer than silently ignoring the field.
    if (body.prompt !== undefined) {
      throw requestError('Working memory prompt is not editable from Settings.')
    }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      throw requestError('enabled must be a boolean.')
    }
    const saved = await saveWorkingMemorySettings({ enabled: body.enabled }, options)
    sendJson(res, 200, await readWorkingMemoryDocument({ ...options, settings: saved }))
    return
  }

  throw requestError('Method not allowed', 405)
}
