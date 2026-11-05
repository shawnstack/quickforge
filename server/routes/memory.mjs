import { readJsonBody, sendJson } from '../utils/response.mjs'
import { readGlobalMemoryDocument, saveGlobalMemoryDocument } from '../global-memory.mjs'

const MAX_MEMORY_REQUEST_BYTES = 20 * 1024

export async function handleMemoryApi(req, res, options = {}) {
  if (req.method === 'GET') {
    // `markdown` is the editable human file; `count` is how many experiences exist
    // in the (separate, machine-owned) experience library, which is what decides
    // whether the page shows the "that lives elsewhere" hint.
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
    // This file is independent of both memory folders, so the write needs no merge
    // step: working memory and the experience library cannot be clobbered from here
    // because they are not here.
    sendJson(res, 200, await saveGlobalMemoryDocument(body.markdown, options))
    return
  }

  const error = new Error('Method not allowed')
  error.statusCode = 405
  throw error
}
