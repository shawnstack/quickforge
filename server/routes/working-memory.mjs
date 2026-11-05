import { readJsonBody, sendJson } from '../utils/response.mjs'
import {
  listWorkingMemoryNotePage,
  openWorkingMemoryFolder,
  openWorkingMemoryNote,
  readWorkingMemoryDocument,
  saveWorkingMemorySettings,
} from '../working-memory.mjs'

const MAX_WORKING_MEMORY_REQUEST_BYTES = 20 * 1024
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function paginationOf(url) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

// The mount point is exact (`/api/working-memory`), so the handler derives the
// sub-path itself instead of relying on the caller to strip a prefix.
function subPathOf(url) {
  return url.pathname.split('/').filter(Boolean).slice(2)
}

export async function handleWorkingMemoryApi(req, res, options = {}) {
  const url = options.url || new URL(req.url || '/api/working-memory', 'http://localhost')
  const rest = subPathOf(url)

  if (rest.length === 0) {
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

  // POST /api/working-memory/open-folder — reveal the notes folder itself, the
  // same action the experience library offers.
  if (rest.length === 1 && rest[0] === 'open-folder') {
    if (req.method !== 'POST') throw requestError('Method not allowed', 405)
    sendJson(res, 200, await openWorkingMemoryFolder(options))
    return
  }

  // GET /api/working-memory/notes?page=1&pageSize=20 — titles and times only.
  if (rest.length === 1 && rest[0] === 'notes') {
    if (req.method !== 'GET') throw requestError('Method not allowed', 405)
    const { page, pageSize, offset } = paginationOf(url)
    const { notes, total } = await listWorkingMemoryNotePage(options, { offset, limit: pageSize })
    sendJson(res, 200, { notes, page, pageSize, total })
    return
  }

  // POST /api/working-memory/notes/open — reveal one note in the file manager.
  if (rest.length === 2 && rest[0] === 'notes' && rest[1] === 'open') {
    if (req.method !== 'POST') throw requestError('Method not allowed', 405)
    const body = await readJsonBody(req, MAX_WORKING_MEMORY_REQUEST_BYTES)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) throw requestError('Note name is required.')
    sendJson(res, 200, await openWorkingMemoryNote(options, name))
    return
  }

  throw requestError('Not found', 404)
}
