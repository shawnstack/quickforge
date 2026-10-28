import { readJsonBody, sendJson } from '../utils/response.mjs'
import { createDreamingRepository } from '../sqlite/dreaming-repository.mjs'
import { normalizeDreamingSettings, readDreamingSettings, saveDreamingSettings } from '../dreaming/settings.mjs'
import { isDreamingRunning, modelLabelOf, nextScheduledRunAt, readAutoNotes, resolveDreamingModel, runDreaming } from '../dreaming/runner.mjs'
import { noteIdOf, noteKindOf, noteTextOf } from '../dreaming/recall.mjs'
import { composeAutoSection } from '../dreaming/notes.mjs'
import { listModelCatalog, modelReferenceFromSnapshot, resolveModelBinding } from '../model-catalog.mjs'
import { readGlobalMemory, readDreamingNotes, writeDreamingNotes } from '../global-memory.mjs'

const MAX_DREAMING_REQUEST_BYTES = 32 * 1024
const MAX_NOTE_PAGE_SIZE = 200

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function pagination(url) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/** Notes as rows for the settings page: identity is derived, semantics are not. */
function noteRows(lines, firstSeen = null, stats = null) {
  return lines.map((line) => {
    const id = noteIdOf(line)
    const stat = stats?.get(id)
    return {
      id,
      kind: noteKindOf(line),
      text: noteTextOf(line),
      // When this note first appeared in a recorded run, so the page can answer
      // "where did this come from" without a per-entry table.
      firstSeen: firstSeen?.get(line) ?? null,
      // Recall feedback: how many times a search actually returned this note.
      recallCount: stat?.recallCount ?? 0,
      lastRecalledAt: stat?.lastRecalledAt ?? null,
    }
  })
}

/**
 * Which run first wrote each note, scanned oldest-to-newest over recent runs.
 * Bounded by the run page size, so this stays a cheap read.
 */
function noteOrigins(repository, { runLimit = 50 } = {}) {
  const origins = new Map()
  for (const run of repository.listRuns({ limit: runLimit }).reverse()) {
    for (const note of run.operations?.notesAfter ?? []) {
      if (!origins.has(note)) origins.set(note, { runId: run.id, at: run.startedAt })
    }
  }
  return origins
}

async function overview(repository) {
  const settings = await readDreamingSettings()
  const resolved = await resolveDreamingModel(settings)
  const models = await listModelCatalog().catch(() => [])
  const notes = await readAutoNotes()
  return {
    settings,
    // What a run would actually use right now, and why. Without this the page
    // can only show the pinned value, so "auto" looks like it does nothing.
    model: {
      effective: modelLabelOf(resolved.model),
      source: resolved.source,
      available: models.map((model) => ({
        id: model.id,
        provider: model.provider,
        name: model.name || model.id,
        ref: modelReferenceFromSnapshot(model),
      })),
    },
    running: isDreamingRunning(),
    nextRunAt: settings.nextRunAt,
    lastRun: repository.latestRun(),
    counts: {
      notes: notes.length,
      runs: repository.countRuns(),
    },
    memoryDocument: {
      // The notes file is machine-owned; the manual file is a different document
      // and is edited elsewhere (Settings → Memory).
      dreamingNotes: (await readDreamingNotes().catch(() => '')).trim().length > 0,
      manual: (await readGlobalMemory()).markdown,
    },
  }
}

export async function handleDreamingApi(req, res, url) {
  const repository = createDreamingRepository()
  const parts = url.pathname.split('/').filter(Boolean)
  // parts = ['api', 'dreaming', ...rest]
  const rest = parts.slice(2)

  if (rest.length === 0) {
    if (req.method === 'GET') {
      sendJson(res, 200, await overview(repository))
      return
    }
    throw requestError('Method not allowed', 405)
  }

  if (rest[0] === 'settings') {
    if (req.method === 'GET') {
      sendJson(res, 200, await readDreamingSettings())
      return
    }
    if (req.method === 'PUT') {
      const body = await readJsonBody(req, MAX_DREAMING_REQUEST_BYTES)
      if (!body || typeof body !== 'object') throw requestError('Dreaming settings payload is required.')
      // A pinned model must resolve now, not silently degrade at 03:00 tomorrow.
      if (body.modelRef) {
        await resolveModelBinding({ modelRef: body.modelRef }, { context: { source: 'dreaming' }, forExecution: true })
      }
      const current = await readDreamingSettings()
      const next = normalizeDreamingSettings({ ...current, ...body })
      // Enabled means "run daily at executeTime", so a target always exists; it is
      // recomputed when the switch flips or the time changes, otherwise the
      // runner's own advance is kept.
      if (next.enabled) {
        const needsSchedule = !current.enabled
          || current.executeTime !== next.executeTime
          || !next.nextRunAt
        if (needsSchedule) next.nextRunAt = nextScheduledRunAt(next.executeTime, new Date())
      } else {
        next.nextRunAt = null
      }
      sendJson(res, 200, await saveDreamingSettings(next))
      return
    }
    throw requestError('Method not allowed', 405)
  }

  if (rest[0] === 'run') {
    if (req.method !== 'POST') throw requestError('Method not allowed', 405)
    if (isDreamingRunning()) throw requestError('Dreaming is already running.', 409)
    const settings = await readDreamingSettings()
    if (!settings.enabled) throw requestError('Dreaming is disabled in Settings.', 403)
    const result = await runDreaming({ trigger: 'manual' })
    if (result.skipped) {
      sendJson(res, 200, { skipped: true, reason: result.reason, run: result.run ?? null })
      return
    }
    sendJson(res, 200, { skipped: false, run: result.run ?? null, error: result.error ?? null })
    return
  }

  if (rest[0] === 'runs') {
    if (req.method !== 'GET' && rest.length < 2) throw requestError('Method not allowed', 405)
    if (rest.length === 1) {
      const { page, pageSize, offset } = pagination(url)
      const runs = repository.listRuns({ limit: pageSize, offset })
      sendJson(res, 200, { runs, page, pageSize, total: repository.countRuns() })
      return
    }
    if (rest[2] === 'restore') {
      if (req.method !== 'POST') throw requestError('Method not allowed', 405)
      const run = repository.findRun(decodeURIComponent(rest[1]))
      if (!run) throw requestError('Dreaming run not found.', 404)
      const notes = run.operations?.notesAfter
      if (!Array.isArray(notes)) {
        // Runs written before notesAfter existed cannot be restored: guessing the
        // list from a partial diff would silently lose notes.
        throw requestError('This run did not record its notes, so it cannot be restored.', 409)
      }
      const settings = await readDreamingSettings()
      const saved = await writeDreamingNotes(composeAutoSection(notes), { allowSensitive: settings.allowSensitive })
      sendJson(res, 200, { restored: notes.length, run, changed: saved.changed })
      return
    }
    if (req.method !== 'GET') throw requestError('Method not allowed', 405)
    const run = repository.findRun(decodeURIComponent(rest[1]))
    if (!run) throw requestError('Dreaming run not found.', 404)
    // Nothing else to join: the run row already carries the notes diff, and the
    // raw model reply is the only other artifact a user can inspect.
    sendJson(res, 200, { run })
    return
  }

  if (rest[0] === 'notes') {
    if (rest.length === 2) {
      if (req.method !== 'DELETE') throw requestError('Method not allowed', 405)
      const id = decodeURIComponent(rest[1])
      const lines = await readAutoNotes()
      const remaining = lines.filter((line) => noteIdOf(line) !== id)
      if (remaining.length === lines.length) throw requestError('Note not found.', 404)
      const settings = await readDreamingSettings()
      // Deleting through the API keeps the file the single source of truth: the
      // next run sees the shortened list and cannot resurrect the line.
      await writeDreamingNotes(composeAutoSection(remaining), { allowSensitive: settings.allowSensitive })
      try {
        repository.deleteNoteStat(id)
      } catch {
        // Usage bookkeeping is best-effort; the note is already gone from the file.
      }
      sendJson(res, 200, { removed: 1, total: remaining.length })
      return
    }
    if (req.method !== 'GET') throw requestError('Method not allowed', 405)
    const query = String(url.searchParams.get('query') || '').trim().toLowerCase()
    const kind = url.searchParams.get('kind') || null
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = Math.min(MAX_NOTE_PAGE_SIZE, Math.max(1, Number(url.searchParams.get('pageSize')) || MAX_NOTE_PAGE_SIZE))
    const lines = await readAutoNotes()
    const filtered = lines.filter((line) => {
      if (kind && noteKindOf(line) !== kind) return false
      return query ? line.toLowerCase().includes(query) : true
    })
    const offset = (page - 1) * pageSize
    const stats = (() => {
      try {
        return repository.listNoteStats()
      } catch {
        return null
      }
    })()
    sendJson(res, 200, {
      notes: noteRows(filtered.slice(offset, offset + pageSize), noteOrigins(repository), stats),
      page,
      pageSize,
      total: filtered.length,
      hasNotes: lines.length > 0,
    })
    return
  }

  throw requestError('Not found', 404)
}
