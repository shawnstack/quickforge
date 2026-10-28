import { readJsonBody, sendJson } from '../utils/response.mjs'
import { readGlobalMemoryDocument, saveGlobalMemoryDocument } from '../global-memory.mjs'

const MAX_MEMORY_REQUEST_BYTES = 20 * 1024

export async function handleMemoryApi(req, res, options = {}) {
  if (req.method === 'GET') {
    // `markdown` is the editable human file; `dreaming` is the machine-owned notes
    // file, returned read-only so the page can show both without owning both.
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
    // The two files are independent, so this write needs no merge step: the
    // Dreaming notes cannot be clobbered from here because they are not here.
    sendJson(res, 200, await saveGlobalMemoryDocument(body.markdown, options))
    return
  }

  const error = new Error('Method not allowed')
  error.statusCode = 405
  throw error
}
