import { streamSimpleWithAiHttpLogging } from '../ai-http-logger.mjs'
import { logger } from '../utils/logger.mjs'
import { readStore } from '../storage.mjs'
import { resolveImplicitModelPreference, resolveModelBinding } from '../model-catalog.mjs'
import { isGlobalMemoryEnabled, readGlobalMemory, writeDreamingMemorySection } from '../global-memory.mjs'
import { createDreamingRepository } from '../sqlite/dreaming-repository.mjs'
import { collectTranscript, summarizeMemory } from './collect.mjs'
import { DREAMING_SYSTEM_PROMPT, buildDreamingUserPrompt } from './prompt.mjs'
import { applyDreamingOperations, parseDreamingOutput } from './apply.mjs'
import { readDreamingSettings, saveDreamingSettings } from './settings.mjs'

export const DREAMING_TICK_INTERVAL_MS = 60_000
export const DREAMING_INITIAL_DELAY_MS = 2 * 60_000
export const DREAMING_MAX_TOKENS = 4096
export const DREAMING_SNAPSHOT_LIMIT = 120
const DREAMING_STALE_DAYS = 30
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

async function callDreamingModel({ model, settings, transcript, existingMemories, periodFrom, periodTo, contentLanguage }) {
  const apiKey = await getApiKey(model.provider)
  const stream = streamSimpleWithAiHttpLogging(
    model,
    {
      systemPrompt: DREAMING_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildDreamingUserPrompt({
          transcript,
          existingMemories,
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
 * Render the auto section of MEMORY.md from the current strongest memories.
 * Rewritten wholesale every run; the manual section is preserved by
 * `writeDreamingMemorySection`, so this function only decides what the auto
 * block says.
 */
function renderAutoSection(repository) {
  // One document, many projects: the auto section lists the strongest entries
  // regardless of project, tagging project ones so the origin stays visible.
  const memories = repository.listStrongestAcrossProjects({ limit: 36 })
  if (memories.length === 0) return ''
  const lines = ['## 自动记忆（Dreaming 维护，请勿手工编辑本段）', '']
  let bytes = Buffer.byteLength(lines.join('\n'), 'utf8')
  for (const memory of memories) {
    const scopeTag = memory.scope === 'project' ? ` · ${memory.projectId.slice(0, 8)}` : ''
    const line = `- [${memory.kind}${scopeTag}] ${memory.content}`
    const cost = Buffer.byteLength(`${line}\n`, 'utf8')
    if (bytes + cost > 3900) break
    lines.push(line)
    bytes += cost
  }
  if (lines.length === 2) return ''
  return lines.join('\n')
}

/**
 * One Dreaming pass.
 *
 * Single-flight by design: two concurrent passes would both read the same
 * watermark and write overlapping memory rows. Callers get `{ skipped: true }`
 * instead of queuing, because a queued pass would immediately re-scan a window
 * the running pass is already covering.
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
    const existingMemories = repo.listMemories({ limit: DREAMING_SNAPSHOT_LIMIT })
      .map(summarizeMemory)
    const reply = await callDreamingModel({
      model,
      settings,
      contentLanguage,
      transcript: collected.transcript,
      existingMemories,
      periodFrom,
      periodTo,
    })

    let parsed
    try {
      parsed = parseDreamingOutput(reply)
    } catch (error) {
      run = repo.finishRun(run.id, {
        status: 'failed',
        sessionCount: collected.sessionCount,
        inputChars: collected.chars,
        sessions: collected.sessions,
        rawResponse: String(reply).slice(0, 8000),
        error: error.message,
        finishedAt: Date.now(),
        durationMs: Date.now() - now,
      })
      return { skipped: false, reason: 'invalid_output', run }
    }

    const applied = applyDreamingOperations(parsed.operations, {
      repository: repo,
      runId: run.id,
      now,
      allowSensitive: settings.allowSensitive,
    })

    const autoRetired = repo.retireWeakMemories({
      now,
      staleBefore: now - DREAMING_STALE_DAYS * DAY_MS,
    })
    for (const id of autoRetired) {
      repo.logEvent({ memoryId: id, action: 'retire', after: { reason: 'weak_signal_decay' }, runId: run.id, now })
    }

    let memoryWarning = null
    try {
      await writeDreamingMemorySection(renderAutoSection(repo), { allowSensitive: settings.allowSensitive })
    } catch (error) {
      memoryWarning = error instanceof Error ? error.message : String(error)
      logger.warn('Dreaming could not rewrite the MEMORY.md auto section:', memoryWarning)
    }

    const finishedAt = Date.now()
    run = repo.finishRun(run.id, {
      status: 'succeeded',
      inputChars: collected.chars,
      sessions: collected.sessions,
      rawResponse: String(reply).slice(0, 8000),
      sessionCount: collected.sessionCount,
      createdCount: applied.created,
      updatedCount: applied.updated,
      retiredCount: applied.retired + autoRetired.length,
      rejectedCount: applied.rejected.length,
      summary: parsed.summary || null,
      operations: applied.applied.map((entry) => ({ ...entry, phase: 'applied' }))
        .concat(applied.rejected.map((entry) => ({
          action: entry.action,
          phase: 'rejected',
          reason: entry.reason,
          // Keep what the model actually proposed: without it the run page cannot
          // tell "the code was too strict" from "the model drifted".
          kind: entry.operation?.kind ?? null,
          scope: entry.operation?.scope ?? null,
          content: typeof entry.operation?.content === 'string' ? entry.operation.content.slice(0, 500) : null,
          targetId: entry.operation?.targetId ?? null,
        })))
        .concat(autoRetired.map((id) => ({ action: 'retire', phase: 'decayed', id }))),
      error: memoryWarning,
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
  if (!settings.enabled || !settings.scheduleEnabled) return
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
  const memory = await readGlobalMemory()
  return memory.markdown
}
