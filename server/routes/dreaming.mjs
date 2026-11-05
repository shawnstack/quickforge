import { readJsonBody, sendJson } from '../utils/response.mjs'
import { createDreamingRepository } from '../sqlite/dreaming-repository.mjs'
import { normalizeDreamingSettings, readDreamingSettings, saveDreamingSettings } from '../dreaming/settings.mjs'
import { isDreamingRunning, modelLabelOf, nextScheduledRunAt, resolveDreamingModel, runDreaming } from '../dreaming/runner.mjs'
import { restoreMemorySnapshot } from '../dreaming/snapshot.mjs'
import { listModelCatalog, modelReferenceFromSnapshot, resolveModelBinding } from '../model-catalog.mjs'
import { readGlobalMemory } from '../global-memory.mjs'
import { listArchivedExperiences, listExperiences, openExperience, openExperiencesFolder, readExperienceIndex } from '../experiences.mjs'

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
  const resolved = await resolveDreamingModel(settings)
  const models = await listModelCatalog().catch(() => [])
  const experiences = await listExperiences().catch(() => [])
  const index = await readExperienceIndex().catch(() => ({ markdown: '' }))
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
      experiences: experiences.length,
      candidateSkills: experiences.filter((entry) => entry.candidateSkill).length,
      runs: repository.countRuns(),
    },
    // The index is the only experience artefact the chat side ever sees, so it is
    // also the only one worth showing here: if it reads badly, every session pays.
    experienceIndex: index.markdown,
    manual: (await readGlobalMemory()).markdown,
  }
}

export async function handleDreamingApi(req, res, url, options = {}) {
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

  if (rest[0] === 'experiences') {
    // "Open" mirrors the working memory note list: one file revealed in the system
    // file manager, or the whole folder. Both are POST because they have a side
    // effect on the user's desktop, not on our data.
    if (rest.length === 2 && rest[1] === 'open') {
      if (req.method !== 'POST') throw requestError('Method not allowed', 405)
      const body = await readJsonBody(req, MAX_DREAMING_REQUEST_BYTES)
      const name = typeof body?.name === 'string' ? body.name.trim() : ''
      if (!name) throw requestError('Experience name is required.')
      sendJson(res, 200, await openExperience(options, name))
      return
    }
    if (rest.length === 2 && rest[1] === 'open-folder') {
      if (req.method !== 'POST') throw requestError('Method not allowed', 405)
      sendJson(res, 200, await openExperiencesFolder(options))
      return
    }
    if (req.method !== 'GET') throw requestError('Method not allowed', 405)
    if (rest.length === 1) {
      const [experiences, index] = await Promise.all([
        listExperiences(),
        readExperienceIndex(),
      ])
      sendJson(res, 200, {
        experiences,
        index: index.markdown,
        archived: (await listArchivedExperiences().catch(() => [])).length,
      })
      return
    }
    throw requestError('Not found', 404)
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
      // Restore the folders from the pre-run snapshot. Older runs (from the
      // bullet-list era) have no folder snapshot, and guessing their state from a
      // recorded diff would silently lose notes.
      const restored = await restoreMemorySnapshot(run.id)
      sendJson(res, 200, { restored, run })
      return
    }
    if (req.method !== 'GET') throw requestError('Method not allowed', 405)
    const run = repository.findRun(decodeURIComponent(rest[1]))
    if (!run) throw requestError('Dreaming run not found.', 404)
    // Nothing else to join: the run row carries the per-session report and the
    // snapshot path, which is everything a user can act on.
    sendJson(res, 200, { run })
    return
  }

  throw requestError('Not found', 404)
}
