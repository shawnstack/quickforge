import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSelect, SettingsSwitch } from '../settings/tabs/shared'
import {
  deleteDreamingNote,
  fetchDreamingNotes,
  fetchDreamingOverview,
  fetchDreamingRun,
  fetchDreamingRuns,
  formatDreamingDuration,
  formatDreamingTimestamp,
  formatModelOptionLabel,
  restoreDreamingRun,
  saveDreamingSettings,
  triggerDreamingRun,
  modelRefKey,
  type DreamingNote,
  type DreamingOverview,
  type DreamingRun,
  type DreamingRunDetail,
  type DreamingSettings,
} from './dreaming-data'

const STATUS_KEY = {
  running: 'dreamingStatusRunning',
  succeeded: 'dreamingStatusSucceeded',
  failed: 'dreamingStatusFailed',
  skipped: 'dreamingStatusSkipped',
} as const

const KIND_KEY = {
  fact: 'dreamingKindFact',
  preference: 'dreamingKindPreference',
  experience: 'dreamingKindExperience',
  pitfall: 'dreamingKindPitfall',
  decision: 'dreamingKindDecision',
} as const

const BADGE_TONE = {
  succeeded: 'quickforge-settings-badge-success',
  failed: 'quickforge-settings-badge-danger',
  running: 'quickforge-settings-badge-info',
  skipped: 'quickforge-settings-badge-muted',
} as const

const CARD = 'rounded-xl border border-[color-mix(in_oklab,var(--border)_72%,transparent)] bg-background'
const HAIRLINE = 'border-[color-mix(in_oklab,var(--border)_60%,transparent)]'

/** Label above control, shadcn field layout. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {hint ? <InfoTip label={hint} /> : null}
      </span>
      {children}
    </div>
  )
}

/** Status dot: the single always-visible "is it working" signal. */
function statusDotState(overview: DreamingOverview | null): 'on' | 'off' | 'running' | 'error' {
  if (!overview) return 'off'
  if (overview.running) return 'running'
  if (!overview.settings.enabled) return 'off'
  if (overview.lastRun?.status === 'failed') return 'error'
  return 'on'
}

/** The same state, spelled out next to the dot so color alone never carries meaning. */
const STATE_TEXT_KEY = {
  on: 'dreamingStateOn',
  off: 'dreamingStateOff',
  running: 'dreamingStatusRunning',
  error: 'dreamingStateFailed',
} as const

function StatusBadge({ status }: { status: DreamingRun['status'] }) {
  return <span className={`quickforge-settings-badge ${BADGE_TONE[status]}`}>{t(STATUS_KEY[status])}</span>
}

function KindBadge({ kind }: { kind: string | null | undefined }) {
  if (!kind) return null
  return <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t(KIND_KEY[kind as keyof typeof KIND_KEY] ?? 'dreamingKindFact')}</span>
}

/** Inline metric cluster, so a run's shape is readable without opening it. */
function RunMetrics({ run }: { run: DreamingRun }) {
  return (
    <div className="quickforge-dreaming-metrics">
      <span>{t('dreamingRunSessions')} {run.sessionCount}</span>
      <span data-tone="added" title={`${t('dreamingRunAdded')} +${run.createdCount}`}>+{run.createdCount}</span>
      <span data-tone="removed" title={`${t('dreamingRunRemoved')} -${run.retiredCount}`}>-{run.retiredCount}</span>
      {run.rejectedCount > 0 ? <span title={`${t('dreamingRunDropped')} ✕${run.rejectedCount}`}>✕{run.rejectedCount}</span> : null}
      <span title={t('dreamingRunDuration')}>{formatDreamingDuration(run.durationMs)}</span>
    </div>
  )
}

function NoteList({ title, lines, tone }: { title: string; lines: string[]; tone?: string }) {
  if (lines.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground" data-tone={tone}>{title} · {lines.length}</span>
      <ul className="quickforge-recall-list">
        {lines.map((line) => (
          <li className="quickforge-recall-item" key={line}>
            <div className="quickforge-recall-content">{line}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SectionToggle({
  title,
  count,
  description,
  defaultOpen = false,
  children,
}: {
  title: string
  count?: number
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={CARD}>
      <button
        className="quickforge-dreaming-toggle-row"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="quickforge-dreaming-toggle-label">
          <span className="quickforge-dreaming-chevron" data-open={open} aria-hidden="true">
            <ChevronDown size={14} strokeWidth={2} />
          </span>
          {title}
          {typeof count === 'number' ? <span className="quickforge-dreaming-toggle-count">{count}</span> : null}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 pb-2">
          {description ? <p className="quickforge-settings-row-description">{description}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Run detail
// ---------------------------------------------------------------------------

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<DreamingRunDetail | null>(null)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchDreamingRun(runId)
      .then((next) => { if (!cancelled) setDetail(next) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed')) })
    return () => { cancelled = true }
  }, [runId])

  const restore = async () => {
    setRestoring(true)
    setRestoreMessage('')
    setError('')
    try {
      const result = await restoreDreamingRun(runId)
      setRestoreMessage(t('dreamingRunRestored', { count: result.restored }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setRestoring(false)
    }
  }

  if (error) return <div className="quickforge-dreaming-error">{error}</div>
  if (!detail) return <div className="text-sm text-muted-foreground">{t('loading')}</div>

  const run = detail.run
  const diff = run.operations ?? { added: [], removed: [], notesAfter: null }
  const canRestore = Array.isArray(diff.notesAfter)
  return (
    <div className="quickforge-settings-stack">
      <Button variant="ghost" size="sm" type="button" onClick={onBack}>{t('back')}</Button>
      <section className={`${CARD} flex flex-col gap-3 p-5`}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={run.status} />
          <span className="quickforge-settings-badge quickforge-settings-badge-muted">
            {t(run.trigger === 'manual' ? 'dreamingTriggerManual' : 'dreamingTriggerSchedule')}
          </span>
          {run.modelLabel ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{run.modelLabel}</span> : null}
          {run.contentLanguage ? (
            <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('dreamingRunLanguage')}: {run.contentLanguage}</span>
          ) : null}
        </div>
        <RunMetrics run={run} />
        <div className="text-xs text-muted-foreground">
          {formatDreamingTimestamp(run.startedAt)} · {t('dreamingInputChars')} {run.inputChars}
        </div>
        {run.error ? <div className="quickforge-dreaming-error">{run.error}</div> : null}

        <NoteList title={t('dreamingRunAdded')} lines={diff.added} tone="added" />
        <NoteList title={t('dreamingRunRemoved')} lines={diff.removed} tone="removed" />
        {(diff.dropped ?? []).length > 0 ? (
          <NoteList title={t('dreamingRunDropped')} lines={(diff.dropped ?? []).map((entry) => `${entry.content}（${entry.reason}）`)} />
        ) : null}

        {run.rawResponse ? (
          <SectionToggle title={t('dreamingRunRawResponse')} defaultOpen={false}>
            <pre className="quickforge-dreaming-raw">{run.rawResponse}</pre>
          </SectionToggle>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={!canRestore || restoring}
            onClick={() => void restore()}
          >
            {restoring ? t('loading') : t('dreamingRunRestore')}
          </Button>
          {!canRestore ? <span className="text-xs text-muted-foreground">{t('dreamingRunRestoreUnavailable')}</span> : null}
          {restoreMessage ? <span className="text-xs text-muted-foreground">{restoreMessage}</span> : null}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

type TabView = 'notes' | 'runs'

export function DreamingSettingsTab() {
  const [overview, setOverview] = useState<DreamingOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [view, setView] = useState<TabView>('notes')

  const [runs, setRuns] = useState<DreamingRun[]>([])
  const [runPage, setRunPage] = useState(1)
  const [runTotal, setRunTotal] = useState(0)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const [notes, setNotes] = useState<DreamingNote[]>([])
  const [notePage, setNotePage] = useState(1)
  const [noteTotal, setNoteTotal] = useState(0)
  const [noteQuery, setNoteQuery] = useState('')
  const [noteKind, setNoteKind] = useState('')

  const pageSize = 20
  const settings = overview?.settings
  const busy = saving || running

  const loadOverview = useCallback(async () => {
    const next = await fetchDreamingOverview()
    setOverview(next)
    setRunning(next.running)
    return next
  }, [])

  const loadRuns = useCallback(async (page: number) => {
    const payload = await fetchDreamingRuns(page, pageSize)
    setRuns(payload.runs)
    setRunTotal(payload.total)
    setRunPage(payload.page)
  }, [])

  const loadNotes = useCallback(async (page: number, query: string, kind: string) => {
    const payload = await fetchDreamingNotes({ page, pageSize, query, kind: kind || undefined })
    setNotes(payload.notes)
    setNoteTotal(payload.total)
    setNotePage(payload.page)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadOverview(), loadRuns(1), loadNotes(1, '', '')])
      } catch (err) {
        setError(err instanceof Error ? err.message : t('requestFailed'))
      } finally {
        setLoading(false)
      }
    })()
  }, [loadNotes, loadOverview, loadRuns])

  useEffect(() => {
    if (loading) return
    const handle = setTimeout(() => {
      void loadNotes(1, noteQuery, noteKind).catch(() => undefined)
    }, 250)
    return () => clearTimeout(handle)
  }, [loadNotes, loading, noteKind, noteQuery])

  const updateSettings = async (patch: Partial<DreamingSettings>) => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await saveDreamingSettings(patch)
      await loadOverview()
      setMessage(t('dreamingSaved'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setSaving(false)
    }
  }

  const removeNote = async (id: string) => {
    setMessage('')
    setError('')
    try {
      await deleteDreamingNote(id)
      setMessage(t('dreamingNoteDeleted'))
      // Deleting the last row of the last page would otherwise leave the user on
      // an empty page.
      const remaining = Math.max(0, noteTotal - 1)
      const targetPage = Math.min(notePage, Math.max(1, Math.ceil(remaining / pageSize)))
      await Promise.all([loadOverview(), loadNotes(targetPage, noteQuery, noteKind)])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const runNow = async () => {
    setRunning(true)
    setMessage('')
    setError('')
    try {
      const result = await triggerDreamingRun()
      setMessage(result.skipped ? t('dreamingRunSkipped') : t('dreamingRunQueued'))
      await loadOverview()
      await Promise.all([loadRuns(1), loadNotes(1, noteQuery, noteKind)])
      if (!result.skipped) setView('runs')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setRunning(false)
    }
  }

  const kindOptions = useMemo(() => [
    { value: '', label: t('dreamingCountAll') },
    ...Object.entries(KIND_KEY).map(([value, key]) => ({ value, label: t(key) })),
  ], [])

  const modelOptions = useMemo(() => {
    // Models without a resolvable reference cannot be pinned (their empty key
    // would collide with "follow chat"), so they are not listed.
    const options = (overview?.model?.available ?? []).filter((model) => model.ref)
    return [
      {
        value: '',
        // Naming the resolved model in the option keeps "follow chat" meaningful
        // without a separate status row.
        label: overview?.model?.effective
          ? `${t('dreamingModelFollowChat')} · ${overview.model.effective}`
          : t('dreamingModelFollowChat'),
        ref: null as DreamingSettings['modelRef'],
      },
      ...options.map((model) => ({
        value: modelRefKey(model.ref),
        label: formatModelOptionLabel(model.name, model.provider),
        ref: model.ref as DreamingSettings['modelRef'],
      })),
    ]
  }, [overview])

  const languageOptions = useMemo(() => [
    { value: 'auto', label: t('dreamingLanguageAuto') },
    { value: 'zh', label: t('dreamingLanguageZh') },
    { value: 'en', label: t('dreamingLanguageEn') },
  ], [])

  if (loading || !settings) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }

  if (selectedRunId) {
    return <RunDetail runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
  }

  const dotState = statusDotState(overview)
  const totalRunPages = Math.max(1, Math.ceil(runTotal / pageSize))
  const totalNotePages = Math.max(1, Math.ceil(noteTotal / pageSize))

  return (
    <div className="quickforge-settings-stack">
      <section className={CARD} aria-label={t('dreamingTab')}>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="quickforge-dreaming-dot" data-state={dotState} aria-hidden="true" />
              {t('dreamingTab')}
              <span className="quickforge-settings-beta">{t('dreamingBeta')}</span>
              <span className="quickforge-dreaming-status-text" data-state={dotState}>{t(STATE_TEXT_KEY[dotState])}</span>
              <InfoTip label={t('dreamingEnabledInfo')} />
              <InfoTip label={t('dreamingBetaInfo')} />
            </div>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">{t('dreamingDescription')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={!settings.enabled || busy}
              onClick={() => void runNow()}
            >
              {running ? t('dreamingRunning') : t('dreamingRunNow')}
            </Button>
            <SettingsSwitch
              checked={settings.enabled}
              onChange={(checked) => void updateSettings({ enabled: checked })}
              disabled={saving}
              aria-label={t('dreamingEnabled')}
            />
          </div>
        </div>

        <div className={`quickforge-dreaming-stats border-t ${HAIRLINE}`}>
          {([
            { label: t('dreamingNextRun'), value: formatDreamingTimestamp(overview?.nextRunAt) },
            { label: t('dreamingLastRun'), value: formatDreamingTimestamp(settings.lastRunAt) },
            { label: t('dreamingNotesCount'), value: String(overview?.counts.notes ?? 0) },
            { label: t('dreamingHistory'), value: String(overview?.counts.runs ?? 0) },
          ] as { label: string; value: string }[]).map(({ label, value }) => (
            <div className="quickforge-dreaming-stat" key={label}>
              <span className="quickforge-dreaming-stat-label">{label}</span>
              <span className="quickforge-dreaming-stat-value">{value}</span>
            </div>
          ))}
        </div>

        <div className={`grid gap-4 border-t p-5 md:grid-cols-2 ${HAIRLINE}`}>
          <Field label={t('dreamingModel')} hint={t('dreamingModelInfo')}>
            <SettingsSelect
              value={modelRefKey(settings.modelRef)}
              options={modelOptions}
              onChange={(value) => {
                const option = modelOptions.find((item) => item.value === value)
                void updateSettings({ modelRef: option?.ref ?? null })
              }}
              disabled={saving}
              searchable
              searchPlaceholder={t('dreamingModelSearchPlaceholder')}
              noResultsLabel={t('dreamingModelNoResults')}
              label={t('dreamingModel')}
            />
          </Field>

          <Field label={t('dreamingExecuteTime')} hint={t('dreamingExecuteTimeHint')}>
            <input
              className="h-9 w-full rounded-md border border-transparent bg-[color-mix(in_oklab,var(--muted)_60%,transparent)] px-2.5 text-sm text-foreground outline-none transition-colors focus:border-[color-mix(in_oklab,var(--border)_70%,transparent)] disabled:opacity-55"
              type="time"
              value={settings.executeTime}
              disabled={!settings.enabled || saving}
              onChange={(event) => void updateSettings({ executeTime: event.currentTarget.value })}
            />
          </Field>

          <Field label={t('dreamingLanguage')} hint={t('dreamingLanguageInfo')}>
            <SettingsSelect
              value={settings.contentLanguage}
              options={languageOptions}
              onChange={(value) => void updateSettings({ contentLanguage: value as typeof settings.contentLanguage })}
              disabled={saving}
              label={t('dreamingLanguage')}
            />
          </Field>

          <Field label={t('dreamingSensitive')} hint={t('dreamingSensitiveInfo')}>
            <div>
              <SettingsSwitch
                checked={settings.allowSensitive}
                onChange={(checked) => void updateSettings({ allowSensitive: checked })}
                disabled={!settings.enabled || saving}
              />
            </div>
          </Field>
        </div>

        {message ? <p className={`px-5 pb-4 text-xs ${HAIRLINE}`}>{message}</p> : null}
        {error ? <p className="quickforge-dreaming-error px-5 pb-4">{error}</p> : null}
      </section>

      <section className={CARD} aria-label={t('dreamingNotes')}>
        <div className="quickforge-dreaming-tabs-wrap">
          <div className="quickforge-dreaming-tabs" role="tablist">
            <button
              className="quickforge-dreaming-tab"
              type="button"
              role="tab"
              aria-selected={view === 'notes'}
              onClick={() => setView('notes')}
            >
              {t('dreamingNotes')}
              <span className="quickforge-dreaming-tab-count">{overview?.counts.notes ?? 0}</span>
            </button>
            <button
              className="quickforge-dreaming-tab"
              type="button"
              role="tab"
              aria-selected={view === 'runs'}
              onClick={() => setView('runs')}
            >
              {t('dreamingHistory')}
              <span className="quickforge-dreaming-tab-count">{overview?.counts.runs ?? 0}</span>
            </button>
          </div>

          {view === 'notes' ? (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <input
                className="h-8 w-full max-w-56 rounded-md border border-transparent bg-[color-mix(in_oklab,var(--muted)_60%,transparent)] px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--border)_70%,transparent)]"
                type="search"
                value={noteQuery}
                placeholder={t('dreamingMemorySearchPlaceholder')}
                onChange={(event) => setNoteQuery(event.currentTarget.value)}
              />
              <SettingsSelect
                value={noteKind}
                options={kindOptions}
                onChange={setNoteKind}
                label={t('dreamingKindFact')}
              />
            </div>
          ) : null}
        </div>

        {view === 'notes' ? (
          <div className="flex flex-col gap-3 p-5">
            <p className="quickforge-settings-row-description">{t('dreamingNotesDescription')}</p>
            {notes.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('dreamingNoNotes')}</div>
            ) : (
              <ul className="quickforge-recall-list">
                {notes.map((note) => (
                  <li className="quickforge-recall-item" key={note.id}>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {note.kind ? (
                        <div className="quickforge-recall-meta">
                          <KindBadge kind={note.kind} />
                        </div>
                      ) : null}
                      <div className="quickforge-recall-content">{note.text}</div>
                      <span className="text-xs text-muted-foreground">
                        {note.recallCount && note.recallCount > 0
                          ? t('dreamingNoteRecallCount', { count: note.recallCount })
                          : t('dreamingNoteNeverRecalled')}
                        {note.firstSeen ? ` · ${t('dreamingNoteFirstSeen', { when: formatDreamingTimestamp(note.firstSeen.at) })}` : ''}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={busy}
                      onClick={() => void removeNote(note.id)}
                    >
                      {t('dreamingNoteDelete')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t('dreamingNotesReadOnly')}</p>
            {totalNotePages > 1 ? (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <Button variant="ghost" size="sm" type="button" disabled={notePage <= 1} onClick={() => void loadNotes(notePage - 1, noteQuery, noteKind)}>
                  {t('dreamingPrev')}
                </Button>
                <span>{t('dreamingPage', { page: notePage, total: totalNotePages })}</span>
                <Button variant="ghost" size="sm" type="button" disabled={notePage >= totalNotePages} onClick={() => void loadNotes(notePage + 1, noteQuery, noteKind)}>
                  {t('dreamingNext')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-5">
            <p className="quickforge-settings-row-description">{t('dreamingHistoryDescription')}</p>
            {runs.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('dreamingNoRuns')}</div>
            ) : (
              <ul className="quickforge-settings-list">
                {runs.map((run) => (
                  <li className="quickforge-settings-list-item" key={run.id}>
                    <button
                      className="flex min-w-0 flex-1 flex-col gap-1 text-left"
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={run.status} />
                        <span className="quickforge-settings-badge quickforge-settings-badge-muted">
                          {t(run.trigger === 'manual' ? 'dreamingTriggerManual' : 'dreamingTriggerSchedule')}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDreamingTimestamp(run.startedAt)}</span>
                      </span>
                      <RunMetrics run={run} />
                      {run.summary ? <span className="quickforge-dreaming-summary">{run.summary}</span> : null}
                      {run.error ? <span className="quickforge-dreaming-error">{run.error}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {totalRunPages > 1 ? (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <Button variant="ghost" size="sm" type="button" disabled={runPage <= 1} onClick={() => void loadRuns(runPage - 1)}>
                  {t('dreamingPrev')}
                </Button>
                <span>{t('dreamingPage', { page: runPage, total: totalRunPages })}</span>
                <Button variant="ghost" size="sm" type="button" disabled={runPage >= totalRunPages} onClick={() => void loadRuns(runPage + 1)}>
                  {t('dreamingNext')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}
