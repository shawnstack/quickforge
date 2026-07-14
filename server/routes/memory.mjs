import { readJsonBody, sendJson } from '../utils/response.mjs'
import { readGlobalMemoryDocument, saveGlobalMemoryDocument } from '../global-memory.mjs'

const MAX_MEMORY_REQUEST_BYTES = 20 * 1024

export async function handleMemoryApi(req, res, options = {}) {
  if (req.method === 'GET') {
    sendJson(res, 200, await readGlobalMemoryDocument(options))
    return
  }

  if (req.method === 'PUT') {
    const body = await readJsonBody(req, MAX_MEMORY_REQUEST_BYTES)
    if (!body || typeof body.markdown !== 'string') {
      const error = new Error('Memory Markdown is required.')
      error.statusCode = 400
      throw error
    }
    sendJson(res, 200, await saveGlobalMemoryDocument(body.markdown, options))
    return
  }

  const error = new Error('Method not allowed')
  error.statusCode = 405
  throw error
}
