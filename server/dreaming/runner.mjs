import { logger } from '../utils/logger.mjs'
import { readStore } from '../storage.mjs'
import { resolveImplicitModelPreference, resolveModelBinding } from '../model-catalog.mjs'
import { isGlobalMemoryEnabled } from '../global-memory.mjs'
import { readExperienceIndex } from '../experiences.mjs'
import { createDreamingRepository } from '../sqlite/dreaming-repository.mjs'
import { collectSessionEntries } from './collect.mjs'
import { runCuratorTurn } from './curator.mjs'
import { pruneSnapshots, snapshotMemory } from './snapshot.mjs'
import { readDreamingSettings, saveDreamingSettings } from './settings.mjs'

export const DREAMING_TICK_INTERVAL_MS = 60_000
export const DREAMING_INITIAL_DELAY_MS = 2 * 60_000
/**
 * Wall-clock ceiling for one run.
 *
 * The curator processes every session of the window one at a time, so the cost is
 * proportional to how busy the day was. A night that would run past this stops at
 * a session boundary and leaves the rest for tomorrow: a half-tidied memory is
 * fine, a run that is still going at breakfast is not.
 */
export const MAX_RUN_MS = 45 * 60 * 1000

let runnerTimer = null
let runnerInitialTimer = null
let running = false

export function isDreamingRunning() {
  return running
}

function dayStart(now) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Window for the next run: everything since the last completed run, or since
 * local midnight on a first run. The stored `period_to` is the watermark — no
 * separate bookmark table, so a manual run and a scheduled run can never
 * double-process the same span.
 */
export function computeWindow({ now, lastPeriodTo }) {
  const periodTo = now
  if (lastPeriodTo) return { periodFrom: Math.max(0, Math.min(lastPeriodTo, periodTo)), periodTo }
  // `setHours(0,0,0,0)` on a UTC+ timezone can produce a negative epoch for
  // early-1970 inputs, and the table CHECKs period_from >= 0.
  const start = Math.max(0, dayStart(now))
  return { periodFrom: Math.min(start, periodTo), periodTo }
}

export function nextScheduledRunAt(executeTime, base = new Date()) {
  const [hours, minutes] = String(executeTime || '03:00').split(':').map(Number)
  const next = new Date(base)
  next.setHours(hours || 0, minutes || 0, 0, 0)
  if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime()
}

/**
 * Which model a run should use, and why.
 *
 * Resolution order:
 *   1. the model pinned for Dreaming (`dreaming-settings.modelRef`);
 *   2. otherwise the model the user last used in chat (`active-model`);
 *   3. otherwise the first catalog entry (only when nothing has been chosen yet).
 */
export async function resolveDreamingModel(settings) {
  if (settings.modelRef) {
    try {
      const binding = await resolveModelBinding({ modelRef: settings.modelRef }, { forExecution: true })
      if (binding?.model) return { model: binding.model, source: 'explicit' }
    } catch {
      // The pinned model was deleted or hidden: fall through instead of failing
      // the whole run, and let the settings page report it as unavailable.
    }
  }

  const store = await readStore('settings').catch(() => null)
  const chatPreference = store?.['active-model']
  if (chatPreference) {
    // Only when the user has actually picked a chat model; passing `undefined`
    // would make the catalog helper return its first entry and we would then
    // mislabel that as "follows chat".
    const active = await resolveImplicitModelPreference(chatPreference).catch(() => null)
    if (active) return { model: active, source: 'active' }
  }

  const fallback = await resolveImplicitModelPreference(null).catch(() => null)
  return fallback ? { model: fallback, source: 'catalog' } : { model: null, source: 'none' }
}

export function modelLabelOf(model) {
  return model ? `${model.provider}/${model.id}` : null
}

/**
 * One Dreaming pass.
 *
 * Every session in the window gets its own agent turn that edits the
 * notes folder and, when warranted, promotes something into the
 * experience library. Sessions are processed serially and in chronological order
 * — parallel turns would race on the same notes, and the chronological order is
 * what lets a later session correct an earlier one.
 *
 * Single-flight by design: two concurrent passes would both read the same
 * watermark and both edit the same folders. Callers get `{ skipped: true }`
 * instead of queuing, because a queued pass would immediately re-scan a window
 * the running pass is already covering.
 */
export async function runDreaming({
  trigger = 'schedule',
  now = Date.now(),
  repository = null,
  // Exposed so tests can exercise the stop-at-a-session-boundary behaviour
  // without sleeping for 45 minutes.
  maxRunMs = MAX_RUN_MS,
  curator = runCuratorTurn,
} = {}) {
  if (running) return { skipped: true, reason: 'already_running' }
  running = true
  const settings = await readDreamingSettings()
  const repo = repository || createDreamingRepository()
  const { periodFrom, periodTo } = computeWindow({
    now,
    lastPeriodTo: repo.latestSucceededPeriodTo(),
  })

  let run = null
  const startedAt = Date.now()
  try {
    if (!settings.enabled) return { skipped: true, reason: 'disabled' }
    if (!(await isGlobalMemoryEnabled())) {
      run = repo.createRun({ trigger, periodFrom, periodTo, startedAt: now })
      run = repo.finishRun(run.id, { status: 'skipped', error: '全局记忆已关闭', finishedAt: now, durationMs: 0 })
      return { skipped: true, reason: 'global_memory_disabled', run }
    }

    const collected = collectSessionEntries({ from: periodFrom, to: periodTo })
    if (collected.sessions.length === 0) {
      run = repo.createRun({ trigger, periodFrom, periodTo, startedAt: now, inputChars: 0, sessions: [] })
      run = repo.finishRun(run.id, {
        status: 'skipped',
        sessionCount: 0,
        summary: '窗口内没有会话',
        finishedAt: Date.now(),
        durationMs: Date.now() - now,
      })
      await saveDreamingSettings({ lastRunAt: now })
      return { skipped: true, reason: 'no_sessions', run }
    }

    const resolved = await resolveDreamingModel(settings)
    const model = resolved.model
    if (!model) {
      run = repo.createRun({ trigger, periodFrom, periodTo, startedAt: now })
      run = repo.finishRun(run.id, { status: 'failed', error: '未配置任何模型', finishedAt: Date.now(), durationMs: Date.now() - now })
      return { skipped: false, reason: 'no_model', run }
    }

    // Explicit setting wins over detection; detection wins over nothing.
    const contentLanguage = settings.contentLanguage === 'auto'
      ? collected.contentLanguage
      : settings.contentLanguage
    run = repo.createRun({
      trigger,
      periodFrom,
      periodTo,
      startedAt: now,
      modelLabel: modelLabelOf(model),
      inputChars: collected.chars,
      sessions: collected.sessions.map((session) => ({
        sessionId: session.sessionId,
        projectId: session.projectId,
        title: session.title,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        chars: session.chars,
        correctionSignals: session.correctionSignals,
        preview: session.preview,
      })),
      contentLanguage,
    })

    // Snapshot before the first write. If this fails the run must not start: an
    // agent editing memory with no way back is worse than a night of no curation.
    let snapshot = null
    try {
      snapshot = await snapshotMemory({ runId: run.id })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      repo.finishRun(run.id, { status: 'failed', error: `记忆快照失败，本轮未执行：${message}`, finishedAt: Date.now(), durationMs: Date.now() - now })
      return { skipped: false, reason: 'snapshot_failed', error: message, run: repo.findRun(run.id) }
    }

    const results = []
    let stopReason = null
    for (const session of collected.sessions) {
      if (Date.now() - startedAt > maxRunMs) {
        stopReason = `时间预算用尽（>${Math.round(maxRunMs / 60000)} 分钟），剩余 ${collected.sessions.length - results.length} 个会话留到下一轮`
        break
      }
      const result = await curator({
        runId: run.id,
        model,
        session,
        transcript: session.transcript,
        periodFrom,
        periodTo,
        contentLanguage,
        allowSensitive: settings.allowSensitive,
      })
      results.push(result)
    }

    // Regenerate the index once at the end: a per-session rewrite would produce
    // the same file over and over, and this also picks up files the agent wrote
    // without touching the index.
    await readExperienceIndex().catch((error) => {
      logger.warn('Dreaming could not rebuild the experience index:', error instanceof Error ? error.message : String(error))
    })
    await pruneSnapshots().catch(() => null)

    const actions = results.flatMap((result) => (result.actions || []).map((action) => ({
      ...action,
      sessionId: result.sessionId,
    })))
    const failures = results.filter((result) => !result.ok)
    const written = actions.filter((action) => action.kind === 'write' && action.scope === 'working').length
    const experiences = actions.filter((action) => action.scope === 'experience' && action.kind === 'write').length
    const archived = actions.filter((action) => action.kind === 'archive').length
    const renamed = actions.filter((action) => action.kind === 'rename').length

    const finishedAt = Date.now()
    const warning = [
      failures.length > 0 ? `${failures.length} 个会话处理失败` : null,
      stopReason,
    ].filter(Boolean).join('; ') || null
    // No session at all means nothing was even attempted: that is a skip, not a
    // failure. Every session failing is a failure.
    const status = results.length === 0
      ? 'skipped'
      : (failures.length === results.length ? 'failed' : 'succeeded')
    run = repo.finishRun(run.id, {
      status,
      inputChars: collected.chars,
      sessions: collected.sessions.map((session) => ({
        sessionId: session.sessionId,
        projectId: session.projectId,
        title: session.title,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        chars: session.chars,
        correctionSignals: session.correctionSignals,
        preview: session.preview,
      })),
      rawResponse: results.map((result) => `## ${result.sessionId}\n${result.reply || result.error || ''}`).join('\n\n').slice(0, 8000),
      sessionCount: results.length,
      createdCount: written + experiences,
      updatedCount: renamed,
      retiredCount: archived,
      rejectedCount: 0,
      summary: `${results.length}/${collected.sessions.length} 个会话，写工作记忆 ${written} 篇，沉淀经验 ${experiences} 条，归档 ${archived} 篇`,
      // Per-session report plus the snapshot path: enough for a human to see what
      // happened, and enough to roll the whole night back.
      operations: {
        sessions: results,
        actions,
        snapshot: snapshot?.dir ?? null,
        snapshotFiles: snapshot
          ? { workingMemory: snapshot.workingMemoryFiles, experiences: snapshot.experienceFiles }
          : null,
        stopped: stopReason,
      },
      error: warning,
      finishedAt,
      durationMs: finishedAt - now,
    })
    await saveDreamingSettings({ lastRunAt: now })
    return { skipped: false, run }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Dreaming run failed:', message)
    if (run?.id) {
      try {
        run = repo.finishRun(run.id, { status: 'failed', error: message, finishedAt: Date.now(), durationMs: Date.now() - now })
      } catch (finishError) {
        logger.error('Dreaming run bookkeeping failed:', finishError)
      }
    }
    return { skipped: false, reason: 'error', error: message, run }
  } finally {
    running = false
  }
}

async function tick() {
  const settings = await readDreamingSettings()
  if (!settings.enabled) return
  const now = Date.now()
  const due = settings.nextRunAt ? settings.nextRunAt <= now : false
  if (!due) {
    if (!settings.nextRunAt) await saveDreamingSettings({ nextRunAt: nextScheduledRunAt(settings.executeTime, new Date(now)) })
    return
  }
  await saveDreamingSettings({ nextRunAt: nextScheduledRunAt(settings.executeTime, new Date(now)) })
  await runDreaming({ trigger: 'schedule', now })
}

// Same shape as auto-archive: unref'd interval plus a delayed first pass so the
// startup request burst is not competing with a scan + model call.
export function startDreamingRunner() {
  if (runnerTimer) return
  runnerTimer = setInterval(() => {
    tick().catch((error) => logger.error('Dreaming scheduler tick failed:', error))
  }, DREAMING_TICK_INTERVAL_MS)
  runnerTimer.unref?.()
  runnerInitialTimer = setTimeout(() => {
    runnerInitialTimer = null
    tick().catch((error) => logger.error('Initial dreaming scheduler tick failed:', error))
  }, DREAMING_INITIAL_DELAY_MS)
  runnerInitialTimer.unref?.()
}

export function stopDreamingRunner() {
  if (runnerInitialTimer) {
    clearTimeout(runnerInitialTimer)
    runnerInitialTimer = null
  }
  if (!runnerTimer) return
  clearInterval(runnerTimer)
  runnerTimer = null
}
