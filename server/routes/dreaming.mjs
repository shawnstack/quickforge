import { readJsonBody, sendJson } from '../utils/response.mjs'
import { createDreamingRepository } from '../sqlite/dreaming-repository.mjs'
import { normalizeDreamingSettings, readDreamingSettings, saveDreamingSettings } from '../dreaming/settings.mjs'
import { isDreamingRunning, modelLabelOf, nextScheduledRunAt, resolveDreamingModel, runDreaming } from '../dreaming/runner.mjs'
import { listModelCatalog, modelReferenceFromSnapshot, resolveModelBinding } from '../model-catalog.mjs'
import { DREAMING_SECTION_BEGIN, splitMemorySections, readGlobalMemory } from '../global-memory.mjs'

const MAX_DREAMING_REQUEST_BYTES = 32 * 1024

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

async function overview(repository) {
  const settings = await readDreamingSettings()
  const memory = await readGlobalMemory()
  const resolved = await resolveDreamingModel(settings)
  const models = await listModelCatalog().catch(() => [])
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
      active: repository.countMemories({ status: 'active' }),
      retired: repository.countMemories({ status: 'retired' }),
      superseded: repository.countMemories({ status: 'superseded' }),
      runs: repository.countRuns(),
    },
    memoryDocument: {
      hasAutoSection: memory.markdown.includes(DREAMING_SECTION_BEGIN),
      manual: splitMemorySections(memory.markdown).manual,
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
      // Recompute the schedule whenever the trigger configuration changes, so a
      // newly enabled daily run does not wait for the next tick to get a target.
      if (next.scheduleEnabled && next.enabled) {
        const needsSchedule = !current.enabled || !current.scheduleEnabled
          || current.executeTime !== next.executeTime
          || !next.nextRunAt
        if (needsSchedule) next.nextRunAt = nextScheduledRunAt(next.executeTime, new Date())
      } else if (!next.enabled || !next.scheduleEnabled) {
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
    if (req.method !== 'GET') throw requestError('Method not allowed', 405)
    if (rest.length === 1) {
      const { page, pageSize, offset } = pagination(url)
      const runs = repository.listRuns({ limit: pageSize, offset })
      sendJson(res, 200, { runs, page, pageSize, total: repository.countRuns() })
      return
    }
    const run = repository.findRun(decodeURIComponent(rest[1]))
    if (!run) throw requestError('Dreaming run not found.', 404)
    sendJson(res, 200, {
      run,
      events: collectRunEvents(repository, run),
      memories: collectTouchedMemories(repository, run),
    })
    return
  }

  if (rest[0] === 'memories') {
    if (rest.length === 1) {
      if (req.method !== 'GET') throw requestError('Method not allowed', 405)
      const { page, pageSize, offset } = pagination(url)
      const memories = repository.listMemories({
        query: url.searchParams.get('query') || '',
        kind: url.searchParams.get('kind') || null,
        status: url.searchParams.get('status') || 'active',
        scope: url.searchParams.get('scope') || null,
        projectId: url.searchParams.get('projectId') || null,
        limit: pageSize,
        offset,
      })
      sendJson(res, 200, { memories, page, pageSize, total: repository.countMemories({ status: url.searchParams.get('status') || 'active' }) })
      return
    }
    const id = decodeURIComponent(rest[1])
    if (rest[2] === 'retire') {
      if (req.method !== 'POST') throw requestError('Method not allowed', 405)
      const memory = repository.findById(id)
      if (!memory) throw requestError('Memory not found.', 404)
      if (memory.status !== 'active') throw requestError(`Memory is already ${memory.status}.`, 409)
      const retired = repository.setStatus(id, 'retired', { now: Date.now() })
      repository.logEvent({ memoryId: id, action: 'retire', before: memory, after: retired, now: Date.now() })
      sendJson(res, 200, { memory: retired })
      return
    }
    if (req.method !== 'GET') throw requestError('Method not allowed', 405)
    const memory = repository.findById(id)
    if (!memory) throw requestError('Memory not found.', 404)
    sendJson(res, 200, { memory, events: repository.listEvents(id) })
    return
  }

  throw requestError('Not found', 404)
}

/**
 * The run row already carries the applied/rejected summary, but the audit trail
 * in `memory_events` is what proves an entry was actually touched; the detail
 * page shows both.
 */
function collectRunEvents(repository, run) {
  const ids = new Set()
  for (const operation of run.operations) {
    if (operation.id) ids.add(operation.id)
    if (operation.replacementId) ids.add(operation.replacementId)
  }
  const events = []
  for (const memoryId of ids) {
    for (const event of repository.listEvents(memoryId, 20)) {
      if (event.runId === run.id) events.push(event)
    }
  }
  return events.sort((a, b) => b.ts - a.ts)
}

/**
 * Current state of every memory the run touched, keyed by id.
 *
 * The run page shows the *result* of each operation (content, evidence,
 * strength) next to what the model proposed, and the audit events carry the
 * before/after snapshots. Resolving them here keeps the client from issuing one
 * request per operation.
 */
function collectTouchedMemories(repository, run) {
  const ids = new Set()
  for (const operation of run.operations) {
    if (operation.id) ids.add(operation.id)
    if (operation.replacementId) ids.add(operation.replacementId)
  }
  const memories = {}
  for (const id of ids) {
    const memory = repository.findById(id)
    if (memory) memories[id] = memory
  }
  return memories
}
