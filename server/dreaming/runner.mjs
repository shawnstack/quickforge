import { streamSimpleWithAiHttpLogging } from '../ai-http-logger.mjs'
import { logger } from '../utils/logger.mjs'
import { readStore } from '../storage.mjs'
import { resolveImplicitModelPreference, resolveModelBinding } from '../model-catalog.mjs'
import { isGlobalMemoryEnabled, readDreamingNotes, writeDreamingNotes } from '../global-memory.mjs'
import { createDreamingRepository } from '../sqlite/dreaming-repository.mjs'
import { collectTranscript } from './collect.mjs'
import { DREAMING_SYSTEM_PROMPT, buildDreamingUserPrompt } from './prompt.mjs'
import { composeAutoSection, diffNoteLines, normalizeNoteLines, noteIdOf } from './notes.mjs'
import { readAutoNotes } from './recall.mjs'
import { readDreamingSettings, saveDreamingSettings } from './settings.mjs'

export const DREAMING_TICK_INTERVAL_MS = 60_000
export const DREAMING_INITIAL_DELAY_MS = 2 * 60_000
export const DREAMING_MAX_TOKENS = 4096
/**
 * A run that replaces most of the list is suspicious: the model either learned a
 * lot or drifted. It still succeeds (the notes are the model's call), but the run
 * is flagged so a human can look.
 */
export const NOTE_CHURN_WARN_RATIO = 0.8
/** Below this, every run would look like churn just because the list is tiny. */
export const NOTE_CHURN_MIN_NOTES = 5
/** A note nobody ever recalled after this many days is a deletion candidate. */
export const NOTE_UNUSED_DAYS = 60
/**
 * Only ask the model to prune once the list is actually long. Memory notes are
 * injected into every prompt and `recall_experience` is rarely called at all, so
 * on a short list every note looks "never recalled" — proposing deletion there
 * would be noise, not signal.
 */
export const NOTE_PRUNE_MIN_NOTES = 40
const DAY_MS = 24 * 60 * 60 * 1000

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
 * The previous fallback was `resolveImplicitModelPreference(null)`, which returns
 * the *first* model in the catalog. On a machine with several providers that is
 * arbitrary: the worker silently picked whichever model happened to be
 * configured first and the settings page had no way to see or change it.
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

async function getApiKey(provider) {
  const keys = await readStore('provider-keys')
  return keys?.[provider] || undefined
}

/** Current bullets from DREAMING.md — the model's own previous output. */
export { readAutoNotes }

async function callDreamingModel({ model, settings, transcript, existingNotes = [], unusedNotes = [], periodFrom, periodTo, contentLanguage }) {
  const apiKey = await getApiKey(model.provider)
  const stream = streamSimpleWithAiHttpLogging(
    model,
    {
      systemPrompt: DREAMING_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildDreamingUserPrompt({
          transcript,
          existingNotes,
          unusedNotes,
          periodFrom,
          periodTo,
          allowSensitive: settings.allowSensitive,
          contentLanguage,
        }),
        timestamp: Date.now(),
      }],
      tools: [],
    },
    {
      apiKey,
      maxTokens: DREAMING_MAX_TOKENS,
      temperature: 0.2,
      maxRetryDelayMs: 60000,
      metadata: { quickforgePurpose: 'dreaming' },
    },
  )
  const message = await stream.result()
  const text = Array.isArray(message?.content)
    ? message.content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
    : String(message?.content ?? '')
  return text
}

/**
 * One Dreaming pass.
 *
 * Single call, single write: read the notes block, hand it to the model together
 * with the new transcripts, and overwrite the block with the bullet list it
 * returns. No diffing into rows, no dedupe table, no decay — the model is the
 * only thing that decides what is remembered.
 *
 * Single-flight by design: two concurrent passes would both read the same
 * watermark and both rewrite the block. Callers get `{ skipped: true }` instead
 * of queuing, because a queued pass would immediately re-scan a window the
 * running pass is already covering.
 */
export async function runDreaming({ trigger = 'schedule', now = Date.now(), repository = null } = {}) {
  if (running) return { skipped: true, reason: 'already_running' }
  running = true
  const settings = await readDreamingSettings()
  const repo = repository || createDreamingRepository()
  const { periodFrom, periodTo } = computeWindow({
    now,
    lastPeriodTo: repo.latestSucceededPeriodTo(),
  })

  let run = null
  try {
    if (!settings.enabled) return { skipped: true, reason: 'disabled' }
    if (!(await isGlobalMemoryEnabled())) {
      run = repo.createRun({ trigger, periodFrom, periodTo, startedAt: now })
      run = repo.finishRun(run.id, { status: 'skipped', error: '全局记忆已关闭', finishedAt: now, durationMs: 0 })
      return { skipped: true, reason: 'global_memory_disabled', run }
    }

    const collected = collectTranscript({ from: periodFrom, to: periodTo })
    if (collected.sessionCount === 0) {
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
      sessions: collected.sessions,
      contentLanguage,
    })

    const existingNotes = await readAutoNotes()
    // Recall feedback: notes that were never recalled and are old enough are
    // handed to the model as deletion candidates. This is the whole "strength
    // decay" mechanism — it informs the decision instead of overriding it.
    let unusedNotes = []
    try {
      if (existingNotes.length >= NOTE_PRUNE_MIN_NOTES) {
        const stats = repo.listNoteStats()
        unusedNotes = existingNotes.flatMap((line) => {
          const stat = stats.get(noteIdOf(line))
          if (!stat || stat.recallCount > 0) return []
          const ageDays = Math.floor((now - stat.createdAt) / DAY_MS)
          return ageDays >= NOTE_UNUSED_DAYS ? [{ text: line, ageDays }] : []
        })
      }
    } catch (error) {
      logger.warn('Dreaming could not read note usage stats:', error instanceof Error ? error.message : String(error))
    }
    const reply = await callDreamingModel({
      model,
      settings,
      contentLanguage,
      transcript: collected.transcript,
      existingNotes,
      unusedNotes,
      periodFrom,
      periodTo,
    })

    const normalized = normalizeNoteLines(reply, { allowSensitive: settings.allowSensitive })
    // A prose reply that contains no bullets is not an answer: treating it as
    // "clear everything" would let one off-contract response wipe the notes.
    // A genuinely empty reply is still a valid "nothing durable today".
    if (String(reply ?? '').trim() && normalized.lines.length === 0) {
      run = repo.finishRun(run.id, {
        status: 'failed',
        sessionCount: collected.sessionCount,
        inputChars: collected.chars,
        sessions: collected.sessions,
        rawResponse: String(reply).slice(0, 8000),
        error: '模型回复里没有任何笔记条目',
        finishedAt: Date.now(),
        durationMs: Date.now() - now,
      })
      return { skipped: false, reason: 'no_notes_in_reply', run }
    }
    const diff = diffNoteLines(existingNotes, normalized.lines)
    const changedCount = diff.added.length + diff.removed.length
    // Churn is measured against the larger of "what was there" and "what is there
    // now", so both a wholesale rewrite and a sudden shrink trip it.
    const churnRatio = existingNotes.length === 0
      ? 0
      : changedCount / Math.max(existingNotes.length, normalized.lines.length)
    const churnWarning = existingNotes.length >= NOTE_CHURN_MIN_NOTES && churnRatio >= NOTE_CHURN_WARN_RATIO
      ? `本次改动了 ${changedCount}/${existingNotes.length} 条笔记，可能发生了记忆漂移`
      : null
    const autoSection = composeAutoSection(normalized.lines)

    let memoryWarning = null
    try {
      await writeDreamingNotes(autoSection, { allowSensitive: settings.allowSensitive })
    } catch (error) {
      memoryWarning = error instanceof Error ? error.message : String(error)
      logger.warn('Dreaming could not rewrite DREAMING.md:', memoryWarning)
    }
    // Separate from the write: a stats failure must not be reported as "the notes
    // were not saved", which would send the user looking at the wrong problem.
    if (!memoryWarning) {
      try {
        repo.syncNoteStats(normalized.lines.map((line) => ({ id: noteIdOf(line), text: line })), now)
      } catch (error) {
        logger.warn('Dreaming could not sync note usage stats:', error instanceof Error ? error.message : String(error))
      }
    }
    const warning = [memoryWarning, churnWarning].filter(Boolean).join('; ') || null

    const finishedAt = Date.now()
    run = repo.finishRun(run.id, {
      status: 'succeeded',
      inputChars: collected.chars,
      sessions: collected.sessions,
      rawResponse: String(reply).slice(0, 8000),
      sessionCount: collected.sessionCount,
      createdCount: diff.added.length,
      updatedCount: 0,
      retiredCount: diff.removed.length,
      rejectedCount: normalized.dropped.length,
      summary: `${normalized.lines.length} 条笔记（+${diff.added.length} / -${diff.removed.length}）`,
      // The run detail page shows "what it learned / what it forgot"; `notesAfter`
      // is the full list at that point, which is what makes restore possible.
      operations: { added: diff.added, removed: diff.removed, dropped: normalized.dropped, notesAfter: normalized.lines },
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

export async function readDreamingMemoryDocument() {
  return readDreamingNotes()
}
